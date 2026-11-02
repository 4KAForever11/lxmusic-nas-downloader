const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { parseHeader } = require('./source-meta.cjs')
const { searchTracks } = require('./search-service.cjs')
const { downloadTrack } = require('./download-service.cjs')
const { normalizeFnosSettings, queueUriToFnos, testFnosConnection } = require('./fnos-service.cjs')
const { createLanFileRelay } = require('./lan-relay.cjs')

const isDev = !app.isPackaged
const sourceDir = () => path.join(app.getPath('userData'), 'sources')
const manifestPath = () => path.join(sourceDir(), 'sources.json')
const defaultDownloadDir = () => path.join(app.getPath('downloads'), '洛雪音乐下载器')
const downloadLocationPath = () => path.join(app.getPath('userData'), 'download-location.json')
const seedPath = () => isDev
  ? path.join(app.getAppPath(), 'lx-music-source-v7.js')
  : path.join(process.resourcesPath, 'seed', 'lx-music-source-v7.js')
const fallbackSourcesDir = () => isDev
  ? path.join(app.getAppPath(), 'fallback-sources')
  : path.join(process.resourcesPath, 'fallback-sources')
const fnosSettingsPath = () => path.join(app.getPath('userData'), 'fnos-settings.enc')
let sourceManagerPromise
let fallbackSourcesPromise
const sourceApis = new Map()
const downloadJobs = new Map()
const activeRelays = new Set()

function readDownloadDir() {
  try {
    const settings = JSON.parse(fs.readFileSync(downloadLocationPath(), 'utf8'))
    if (typeof settings.path === 'string' && path.isAbsolute(settings.path) && fs.statSync(settings.path).isDirectory()) return settings.path
  } catch {}
  return defaultDownloadDir()
}

function writeDownloadDir(value) {
  const input = String(value || '').trim()
  if (!input || !path.isAbsolute(input)) throw new Error('请选择一个已存在的本机文件夹。')
  const selectedPath = path.resolve(input)
  let stat
  try { stat = fs.statSync(selectedPath) } catch { throw new Error('所选本机文件夹不存在或无法访问。') }
  if (!stat.isDirectory()) throw new Error('请选择一个文件夹，而不是文件。')
  const file = downloadLocationPath()
  const temp = `${file}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(temp, JSON.stringify({ path: selectedPath }), 'utf8')
  fs.renameSync(temp, file)
  return selectedPath
}

function readFnosSettings() {
  if (!fs.existsSync(fnosSettingsPath())) return null
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 凭据加密暂不可用，未读取已保存的 NAS Token。')
  const settings = JSON.parse(safeStorage.decryptString(fs.readFileSync(fnosSettingsPath())))
  const apiUrl = new URL(settings.apiBase)
  if (apiUrl.port === '5666') {
    apiUrl.port = '9932'
    settings.apiBase = apiUrl.toString().replace(/\/$/, '')
    return writeFnosSettings(settings)
  }
  return settings
}

function writeFnosSettings(settings) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 凭据加密暂不可用，不能安全保存 NAS Token。')
  const normalized = normalizeFnosSettings(settings)
  const encrypted = safeStorage.encryptString(JSON.stringify(normalized))
  const tempPath = `${fnosSettingsPath()}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(fnosSettingsPath()), { recursive: true })
  fs.writeFileSync(tempPath, encrypted)
  fs.renameSync(tempPath, fnosSettingsPath())
  return normalized
}

function readManifest() {
  try { return JSON.parse(fs.readFileSync(manifestPath(), 'utf8')) } catch { return [] }
}

function saveJson(file, data) {
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(temp, file)
}

function ensureSeedSource() {
  fs.mkdirSync(sourceDir(), { recursive: true })
  const manifest = readManifest()
  if (manifest.length || !fs.existsSync(seedPath())) return
  const code = fs.readFileSync(seedPath(), 'utf8')
  const meta = parseHeader(code)
  const id = crypto.createHash('sha256').update(meta.name).digest('hex').slice(0, 12)
  const file = `${id}.js`
  fs.writeFileSync(path.join(sourceDir(), file), code, 'utf8')
  saveJson(manifestPath(), [{ id, file, ...meta, size: Buffer.byteLength(code), updatedAt: new Date().toISOString(), hash: crypto.createHash('sha256').update(code).digest('hex') }])
}

function listSources() {
  ensureSeedSource()
  return readManifest().map(({ id, name, description, version, author, size, updatedAt, hash }) => ({ id, name, description, version, author, size, updatedAt, hash }))
}

async function getSourceApi(sourceId) {
  ensureSeedSource()
  const manifest = readManifest()
  const source = manifest.find((item) => item.id === sourceId)
  if (!source) throw new Error('选中的本地音乐源不存在，请重新选择。')
  const cached = sourceApis.get(source.id)
  if (cached?.hash === source.hash) return cached.api
  if (cached?.api) cached.api.destroy()
  if (!sourceManagerPromise) sourceManagerPromise = import('lx-user-api-env').then(({ WorkerUserApiManager }) => new WorkerUserApiManager('dedicated'))
  const manager = await sourceManagerPromise
  const script = fs.readFileSync(path.join(sourceDir(), source.file), 'utf8')
  let initError
  const api = manager.load(script, {
    onInitError: (error) => { initError = error },
    onRunError: (error) => { console.error('music source worker error', error) }
  }, { env: 'desktop', version: '2.0.0', timeout: 15000 })
  await api.waitInit()
  if (!api.isInited || api.isInitError || initError) {
    api.destroy()
    throw new Error(`音乐源初始化失败：${initError?.message || api.initError?.message || '源未完成初始化'}`)
  }
  sourceApis.set(source.id, { hash: source.hash, api })
  return api
}

async function getFallbackSourceApis() {
  if (!fs.existsSync(fallbackSourcesDir())) return []
  if (!fallbackSourcesPromise) {
    fallbackSourcesPromise = (async () => {
      if (!sourceManagerPromise) sourceManagerPromise = import('lx-user-api-env').then(({ WorkerUserApiManager }) => new WorkerUserApiManager('dedicated'))
      const manager = await sourceManagerPromise
      const files = fs.readdirSync(fallbackSourcesDir()).filter((file) => file.endsWith('.js')).sort()
      const apis = []
      for (const file of files) {
        let initError
        const api = manager.load(fs.readFileSync(path.join(fallbackSourcesDir(), file), 'utf8'), {
          onInitError: (error) => { initError = error },
          onRunError: (error) => { console.error(`fallback music source worker error (${file})`, error) }
        }, { env: 'desktop', version: '2.0.0', timeout: 30000 })
        await api.waitInit()
        if (api.isInited && !api.isInitError && !initError) apis.push(api)
        else api.destroy()
      }
      return apis
    })().catch((error) => {
      fallbackSourcesPromise = null
      console.warn('fallback music source unavailable', error)
      return []
    })
  }
  return fallbackSourcesPromise
}

function sendDownloadEvent(webContents, payload) {
  if (!webContents.isDestroyed()) webContents.send('downloads:event', payload)
}

function startDownloadJob(webContents, tracks, { uploadToNas = false } = {}) {
  const jobId = crypto.randomUUID()
  const controller = new AbortController()
  downloadJobs.set(jobId, controller)
  void (async () => {
    const outDir = readDownloadDir()
    if (!uploadToNas) await fs.promises.mkdir(outDir, { recursive: true })
    sendDownloadEvent(webContents, { jobId, type: 'jobStarted', outDir, uploadToNas, total: tracks.length })
    for (let index = 0; index < tracks.length; index++) {
      const track = tracks[index]
      if (controller.signal.aborted) break
      try {
        let filePath = track.filePath
        if (uploadToNas && (!filePath || !fs.existsSync(filePath))) {
          sendDownloadEvent(webContents, { jobId, type: 'nasQueueError', trackId: track.id, error: '找不到本机已下载文件，请先仅下载这首歌。', index, total: tracks.length })
          continue
        }
        if (!uploadToNas && (!filePath || !fs.existsSync(filePath))) {
          sendDownloadEvent(webContents, { jobId, type: 'started', trackId: track.id, index, total: tracks.length })
          const api = await getSourceApi(track.sourceScriptId)
          const fallbackApis = await getFallbackSourceApis()
          filePath = await downloadTrack({
            api,
            fallbackApis,
            track,
            outDir,
            signal: controller.signal,
            onProgress: (progress) => sendDownloadEvent(webContents, { jobId, type: 'progress', trackId: track.id, ...progress })
          })
          sendDownloadEvent(webContents, { jobId, type: 'completed', trackId: track.id, filePath, index, total: tracks.length })
        }
        let fnosSettings
        try { fnosSettings = readFnosSettings() } catch (error) {
          sendDownloadEvent(webContents, { jobId, type: 'nasQueueError', trackId: track.id, error: error.message, filePath, index, total: tracks.length })
          continue
        }
        if (uploadToNas && track.nasStatus !== 'NAS 下载任务已接收') {
          if (!fnosSettings) {
            sendDownloadEvent(webContents, { jobId, type: 'nasQueueError', trackId: track.id, error: '请先配置并保存 FNOS-API 连接。', filePath, index, total: tracks.length })
            continue
          }
          sendDownloadEvent(webContents, { jobId, type: 'nasQueueStarted', trackId: track.id, index, total: tracks.length })
          let relay
          try {
            const apiHost = new URL(fnosSettings.apiBase).hostname
            relay = await createLanFileRelay(filePath, apiHost, { onClosed: () => relay && activeRelays.delete(relay) })
            activeRelays.add(relay)
            const queued = await queueUriToFnos(relay.url, fnosSettings, { signal: controller.signal, fileSize: relay.size })
            sendDownloadEvent(webContents, {
              jobId,
              type: 'nasQueued',
              trackId: track.id,
              fileName: relay.fileName,
              remoteDir: queued.saveDir,
              taskId: queued.taskId,
              index,
              total: tracks.length
            })
          } catch (error) {
            relay?.close()
            if (relay) activeRelays.delete(relay)
            sendDownloadEvent(webContents, { jobId, type: 'nasQueueError', trackId: track.id, error: error.message, filePath, index, total: tracks.length })
            if (controller.signal.aborted) break
          }
        }
      } catch (error) {
        const cancelled = controller.signal.aborted || /取消/.test(error.message)
        sendDownloadEvent(webContents, { jobId, type: cancelled ? 'cancelled' : 'error', trackId: track.id, error: error.message, index, total: tracks.length })
        if (cancelled) break
      }
    }
    sendDownloadEvent(webContents, { jobId, type: controller.signal.aborted ? 'jobCancelled' : 'jobFinished', uploadToNas })
  })().catch((error) => sendDownloadEvent(webContents, { jobId, type: 'jobFailed', error: error.message })).finally(() => downloadJobs.delete(jobId))
  return jobId
}

function registerSourceHandlers() {
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:open-github', async () => {
    await shell.openExternal('https://github.com/4KAForever11/lxmusic-nas-downloader')
    return true
  })
  ipcMain.handle('downloads:location-load', () => readDownloadDir())
  ipcMain.handle('downloads:location-choose', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择本机音乐下载位置',
      defaultPath: readDownloadDir(),
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return writeDownloadDir(result.filePaths[0])
  })
  ipcMain.handle('fnos:settings-load', () => readFnosSettings())
  ipcMain.handle('fnos:settings-save', (_event, settings) => writeFnosSettings(settings))
  ipcMain.handle('fnos:connection-test', async (_event, settings) => {
    const config = settings ? writeFnosSettings(settings) : readFnosSettings()
    if (!config) throw new Error('请先保存 FNOS-API 地址和 Token。')
    return testFnosConnection(config)
  })
  ipcMain.handle('search:tracks', (_event, params) => searchTracks(params || {}))
  ipcMain.handle('downloads:start', (event, { tracks, uploadToNas = false } = {}) => {
    if (!Array.isArray(tracks) || tracks.length === 0) throw new Error('下载队列为空。')
    if (tracks.length > 200) throw new Error('单次最多下载 200 首歌曲。')
    if (tracks.some((track) => !track.filePath && !track.sourceScriptId)) throw new Error('队列中有曲目未选择本地音乐源。')
    return startDownloadJob(event.sender, tracks, { uploadToNas })
  })
  ipcMain.handle('downloads:cancel', (_event, jobId) => {
    const controller = downloadJobs.get(jobId)
    if (!controller) return false
    controller.abort()
    return true
  })
  ipcMain.handle('sources:list', () => listSources())
  ipcMain.handle('sources:import', async (_event, targetId) => {
    const result = await dialog.showOpenDialog({
      title: targetId ? '选择新版音乐源' : '导入洛雪音乐源',
      properties: ['openFile'],
      filters: [{ name: 'JavaScript 音源', extensions: ['js'] }]
    })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const chosen = result.filePaths[0]
    const stat = fs.statSync(chosen)
    if (stat.size > 5 * 1024 * 1024) throw new Error('音源文件超过 5 MB，已拒绝导入。')
    const code = fs.readFileSync(chosen, 'utf8')
    const meta = parseHeader(code)
    if (!code.trim()) throw new Error('文件内容为空。')
    const manifest = readManifest()
    const existing = targetId ? manifest.find((source) => source.id === targetId) : null
    const id = existing?.id || crypto.createHash('sha256').update(`${meta.name}:${Date.now()}`).digest('hex').slice(0, 12)
    const file = `${id}.js`
    const dest = path.join(sourceDir(), file)
    if (existing && fs.existsSync(dest)) {
      const backupName = `${id}.${Date.now()}.bak.js`
      fs.copyFileSync(dest, path.join(sourceDir(), backupName))
    }
    const temp = `${dest}.${process.pid}.tmp`
    fs.writeFileSync(temp, code, 'utf8')
    fs.renameSync(temp, dest)
    const entry = { id, file, ...meta, size: stat.size, updatedAt: new Date().toISOString(), hash: crypto.createHash('sha256').update(code).digest('hex') }
    saveJson(manifestPath(), existing ? manifest.map((item) => item.id === id ? entry : item) : [...manifest, entry])
    return { source: { id, name: meta.name, description: meta.description, version: meta.version, author: meta.author, size: stat.size, updatedAt: entry.updatedAt, hash: entry.hash }, replaced: Boolean(existing) }
  })
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#f4f6f4',
    title: '洛雪音乐下载器',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (isDev) window.loadURL('http://127.0.0.1:5173')
  else window.loadFile(path.join(__dirname, '../dist/index.html'))
}

app.whenReady().then(() => {
  registerSourceHandlers()
  createWindow()
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => {
  for (const controller of downloadJobs.values()) controller.abort()
  for (const relay of activeRelays) relay.close()
  activeRelays.clear()
  for (const { api } of sourceApis.values()) api.destroy()
  sourceManagerPromise?.then((manager) => manager.destroyAll()).catch(() => {})
})
