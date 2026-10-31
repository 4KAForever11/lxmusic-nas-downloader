const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

const QUALITY_EXTENSION = { flac: '.flac', flac24bit: '.flac', '128k': '.mp3', '320k': '.mp3' }
const ILLEGAL_FILENAME = /[\\/:*?"<>|\u0000-\u001f]/g

function sanitizeFileName(value) {
  const cleaned = String(value || '未命名曲目').replace(ILLEGAL_FILENAME, '_').replace(/\s+/g, ' ').trim()
  return (cleaned || '未命名曲目').slice(0, 180)
}

function extensionForQuality(quality) {
  return QUALITY_EXTENSION[quality] || '.mp3'
}

async function uniqueDestination(outDir, baseName, extension) {
  await fsp.mkdir(outDir, { recursive: true })
  let attempt = 0
  while (true) {
    const suffix = attempt === 0 ? '' : ` (${attempt})`
    const candidate = path.join(outDir, `${baseName}${suffix}${extension}`)
    try {
      await fsp.access(candidate, fs.constants.F_OK)
      attempt += 1
    } catch {
      return candidate
    }
  }
}

function toProviderParams(track) {
  return {
    source: track.source,
    action: 'musicUrl',
    info: {
      type: track.quality,
      musicInfo: {
        ...track,
        name: track.name || '',
        singer: track.singer || '',
        interval: track.interval || '',
        songmid: String(track.songmid || ''),
        source: track.source
      }
    }
  }
}

async function resolveMusicUrl(api, track, fallbackApis = []) {
  let lastError
  for (const resolver of [api, ...fallbackApis].filter(Boolean)) {
    try {
      const response = await resolver.resolve(toProviderParams(track))
      if (!response?.success) {
        lastError = response?.error instanceof Error ? response.error : new Error(String(response?.error || '音乐源未返回直链'))
        continue
      }
      const value = response.result
      const url = typeof value === 'string' ? value : value?.url
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url
      lastError = new Error('音乐源返回了无效的音频地址')
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('音乐源未返回直链')
}

async function writeResponseToFile(response, destination, signal, onProgress) {
  if (!response.body) throw new Error('下载响应没有可读取的数据流')
  const total = Number(response.headers.get('content-length')) || 0
  const tempPath = `${destination}.${process.pid}.part`
  const output = fs.createWriteStream(tempPath)
  const outputError = new Promise((_, reject) => output.once('error', reject))
  const reader = response.body.getReader()
  let received = 0
  try {
    while (true) {
      if (signal?.aborted) throw new Error('下载已取消')
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (!output.write(Buffer.from(value))) await Promise.race([
        new Promise((resolve) => output.once('drain', resolve)),
        outputError
      ])
      onProgress?.({ received, total, percent: total > 0 ? Math.min(99, Math.round(received / total * 100)) : null })
    }
    await new Promise((resolve, reject) => {
      output.end((error) => error ? reject(error) : resolve())
    })
    await fsp.rename(tempPath, destination)
    onProgress?.({ received, total, percent: 100 })
    return destination
  } catch (error) {
    output.destroy()
    await fsp.rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}

async function downloadTrack({ api, fallbackApis = [], track, outDir, signal, onProgress, onResolvedUrl, initialUrl, maxAttempts = 3 }) {
  const base = sanitizeFileName(track.singer ? `${track.singer} - ${track.name}` : track.name || track.songmid)
  const destination = await uniqueDestination(outDir, base, extensionForQuality(track.quality))
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const url = attempt === 1 && initialUrl ? initialUrl : await resolveMusicUrl(api, track, fallbackApis)
      onResolvedUrl?.(url, { attempt })
      const response = await fetch(url, { redirect: 'follow', signal })
      if (!response.ok) throw new Error(`音频下载 HTTP ${response.status}`)
      return await writeResponseToFile(response, destination, signal, (progress) => onProgress?.({ ...progress, attempt }))
    } catch (error) {
      lastError = error
      if (signal?.aborted || /取消/.test(error.message)) throw new Error('下载已取消')
      if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
    }
  }
  throw lastError || new Error('下载失败')
}

module.exports = { downloadTrack, extensionForQuality, resolveMusicUrl, sanitizeFileName, toProviderParams }
