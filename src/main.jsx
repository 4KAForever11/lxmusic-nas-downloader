import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Archive, ArrowDownToLine, Check, ChevronDown, CircleHelp, CloudUpload, FileAudio2, FileCode2, FolderOpen, Github, HardDrive, ListMusic, LoaderCircle, Moon, Music2, Plus, RefreshCw, Search, Settings2, ShieldAlert, Sun, Trash2, Upload, X } from 'lucide-react'
import './style.css'

function App() {
  const [page, setPage] = useState('search')
  const [sources, setSources] = useState([])
  const [targetId, setTargetId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [appVersion, setAppVersion] = useState('')
  const [notice, setNotice] = useState('')
  const [tracks, setTracks] = useState([])
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState('all')
  const [results, setResults] = useState([])
  const [searchWarnings, setSearchWarnings] = useState([])
  const [searchError, setSearchError] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchPage, setSearchPage] = useState(1)
  const [searchTotal, setSearchTotal] = useState(0)
  const [searchPageSize, setSearchPageSize] = useState(30)
  const [qualityChoices, setQualityChoices] = useState({})
  const [downloadJobId, setDownloadJobId] = useState(null)
  const [downloadLocation, setDownloadLocation] = useState('')
  const [settings, setSettings] = useState({ apiBase: 'http://192.168.1.223:9932', token: '', remoteDir: '/vol1/music/下载' })
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [connectionState, setConnectionState] = useState({ kind: 'idle', message: '尚未检测' })
  const [theme, setTheme] = useState(() => window.localStorage.getItem('lxmusic-theme') || 'dark')

  async function refreshSources() {
    const rows = await window.desktop.listSources()
    setSources(rows)
    setTargetId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id || null)
    setLoading(false)
  }

  useEffect(() => {
    window.desktop.getVersion().then(setAppVersion).catch(() => {})
    const loadDeferredState = () => {
      refreshSources().catch(() => setLoading(false))
      window.desktop.loadDownloadLocation().then(setDownloadLocation).catch(() => {})
      window.desktop.loadFnosSettings().then((saved) => {
        if (saved) setSettings(saved)
      }).catch((error) => setConnectionState({ kind: 'error', message: error.message || '无法读取已保存设置' })).finally(() => setSettingsLoaded(true))
    }
    const idle = window.requestIdleCallback ? window.requestIdleCallback(loadDeferredState, { timeout: 400 }) : window.setTimeout(loadDeferredState, 0)
    return () => window.cancelIdleCallback ? window.cancelIdleCallback(idle) : window.clearTimeout(idle)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('lxmusic-theme', theme)
  }, [theme])
  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(''), 3200)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    const unsubscribe = window.desktop.onDownloadEvent((event) => {
      if (event.type === 'jobStarted') {
        setDownloadJobId(event.jobId)
      }
      if (event.type === 'started') setTracks((items) => items.map((item) => item.id === event.trackId ? { ...item, status: '解析中', progress: 0 } : item))
      if (event.type === 'progress') setTracks((items) => items.map((item) => item.id === event.trackId ? { ...item, status: event.percent == null ? '下载中' : `下载 ${event.percent}%`, progress: event.percent ?? item.progress } : item))
      if (event.type === 'completed') setTracks((items) => items.map((item) => item.id === event.trackId ? { ...item, status: '已完成', progress: 100, filePath: event.filePath } : item))
      if (event.type === 'nasQueueStarted') setTracks((items) => items.map((item) => item.id === event.trackId ? { ...item, nasStatus: '正在提交到 NAS' } : item))
      if (event.type === 'nasQueued') setTracks((items) => items.map((item) => item.id === event.trackId ? { ...item, nasStatus: 'NAS 下载任务已接收', nasTaskId: event.taskId, nasRemoteDir: event.remoteDir } : item))
      if (event.type === 'nasQueueError') {
        setTracks((items) => items.map((item) => item.id === event.trackId ? { ...item, nasStatus: 'NAS 提交失败', nasError: event.error, filePath: event.filePath || item.filePath } : item))
        setNotice(`NAS 下载任务提交失败：${event.error}`)
      }
      if (event.type === 'error') setTracks((items) => items.map((item) => item.id === event.trackId ? { ...item, status: '失败', error: event.error } : item))
      if (event.type === 'cancelled') setTracks((items) => items.map((item) => item.id === event.trackId ? { ...item, status: '已取消' } : item))
      if (event.type === 'jobFinished' || event.type === 'jobCancelled' || event.type === 'jobFailed') {
        setDownloadJobId(null)
        if (event.type === 'jobFailed') setNotice(event.error || '下载任务失败')
        else if (event.type === 'jobFinished') setNotice(event.uploadToNas ? 'NAS 提交队列处理完成' : '本机下载队列处理完成')
      }
    })
    return unsubscribe
  }, [])

  const selectedSource = sources.find((source) => source.id === targetId)
  const pending = useMemo(() => tracks.filter((track) => track.status !== '已完成').length, [tracks])
  const downloadableTracks = useMemo(() => tracks.filter((track) => track.status !== '已完成'), [tracks])
  const uploadableTracks = useMemo(() => tracks.filter((track) => track.status === '已完成' && track.filePath && track.nasStatus !== 'NAS 下载任务已接收'), [tracks])

  async function importSource(update = false) {
    if (update && !targetId) return
    if (update && !window.confirm(`将用新文件替换「${selectedSource?.name}」当前版本。旧版本会保留为备份。继续？`)) return
    try {
      const result = await window.desktop.importSource(update ? targetId : null)
      if (result.canceled) return
      await refreshSources()
      setTargetId(result.source.id)
      setNotice(result.replaced ? `已更新到 v${result.source.version}，旧版本已备份` : `已导入「${result.source.name}」`)
    } catch (error) {
      setNotice(error.message || '导入失败')
    }
  }

  async function runSearch(term = query, source = provider, pageNumber = 1) {
    const searchTerm = term.trim()
    if (!searchTerm) return
    setSearching(true)
    setSearchError('')
    setSearchWarnings([])
    try {
      const result = await window.desktop.searchTracks({ query: searchTerm, provider: source, page: pageNumber })
      setResults(result.list)
      setSearchWarnings(result.warnings)
      setSearchPage(pageNumber)
      setSearchTotal(result.total)
      setSearchPageSize(result.pageSize)
      setQualityChoices({})
      if (!result.list.length) setSearchError('没有找到匹配的歌曲。')
    } catch (error) {
      setResults([])
      setSearchError(error.message || '搜索失败，请稍后重试。')
    } finally {
      setSearching(false)
    }
  }

  function addTrack(track) {
    if (!targetId) {
      setNotice('请先导入并选择一个本地音乐源')
      return
    }
    const quality = qualityChoices[track.id] || preferredQuality(track.types)
    if (tracks.some((item) => item.source === track.source && item.songmid === track.songmid && item.hash === track.hash)) {
      setNotice('这首歌已在下载队列中')
      return
    }
    setTracks((items) => [...items, { ...track, id: crypto.randomUUID(), sourceScriptId: targetId, quality, status: '等待中', progress: 0 }])
    setNotice(`《${track.name}》已加入队列`)
  }

  async function startDownloads(uploadToNas = false) {
    if (downloadJobId) {
      await window.desktop.cancelDownloads(downloadJobId)
      setNotice('正在取消当前任务…')
      return
    }
    if (!tracks.length) return
    const candidates = uploadToNas ? uploadableTracks : downloadableTracks
    if (uploadToNas && !settings.token) {
      setNotice('请先在连接设置中配置并保存 FNOS-API')
      return
    }
    if (!candidates.length) {
      setNotice(uploadToNas ? '没有可提交的已下载曲目' : '队列中的曲目都已下载完成')
      return
    }
    if (!uploadToNas && candidates.some((track) => !track.sourceScriptId && !track.filePath)) {
      setNotice('请重新从搜索结果加入曲目，确保已绑定本地音乐源')
      return
    }
    const action = uploadToNas
      ? `将 ${candidates.length} 首已下载歌曲提交到 NAS 目录 ${settings.remoteDir}。请保持电脑与 NAS 在线，直到 NAS 拉取完成。继续？`
      : `将 ${candidates.length} 首歌曲下载到本机目录：${downloadLocation}。本次不会提交到 NAS。继续？`
    if (!window.confirm(action)) return
    try {
      const jobId = await window.desktop.startDownloads(candidates, uploadToNas)
      setDownloadJobId(jobId)
      if (!uploadToNas) {
        const ids = new Set(candidates.map((track) => track.id))
        setTracks((items) => items.map((item) => ids.has(item.id) ? { ...item, status: '排队中', nasError: '', error: '' } : item))
      }
    } catch (error) {
      setNotice(error.message || '无法开始下载')
    }
  }

  async function chooseDownloadLocation() {
    try {
      const chosen = await window.desktop.chooseDownloadLocation()
      if (chosen) {
        setDownloadLocation(chosen)
        setNotice('本机下载位置已保存')
      }
    } catch (error) {
      setNotice(error.message || '无法设置本机下载位置')
    }
  }

  async function openGithub() {
    try {
      await window.desktop.openGithub()
    } catch {
      setNotice('无法打开 GitHub 项目主页')
    }
  }

  async function saveNasSettings() {
    setSettingsBusy(true)
    try {
      const saved = await window.desktop.saveFnosSettings(settings)
      setSettings(saved)
      setConnectionState({ kind: 'saved', message: '设置已加密保存到本机' })
      setNotice('NAS 设置已加密保存')
    } catch (error) {
      setConnectionState({ kind: 'error', message: error.message || '保存设置失败' })
    } finally {
      setSettingsBusy(false)
    }
  }

  async function testNasConnection() {
    setSettingsBusy(true)
    setConnectionState({ kind: 'testing', message: '正在连接 FNOS-API…' })
    try {
      const result = await window.desktop.testFnosConnection(settings)
      if (['localhost', '127.0.0.1'].includes(result.backendNasHost)) {
        setConnectionState({ kind: 'warning', message: `桌面 REST API 已连接 ${settings.apiBase}（${result.hostName || 'NAS'}）。NAS 内部下载器仍连 ${result.backendNasHost}:${result.backendNasPort || '5666'}；将 FNOS-API 应用配置中的 NAS 地址改为 192.168.1.223，WebSocket 端口保持 5666，保存并重启。` })
      } else {
        setConnectionState({ kind: 'ok', message: `桌面 REST API 已连接 ${settings.apiBase}${result.hostName ? `（${result.hostName}）` : ''}；NAS 内部地址 ${result.backendNasHost || '未提供'}:${result.backendNasPort || '未提供'}` })
      }
      setNotice('FNOS-API 连接成功')
    } catch (error) {
      setConnectionState({ kind: 'error', message: error.message || '连接失败' })
    } finally {
      setSettingsBusy(false)
    }
  }

  const nav = [
    { id: 'search', label: '搜索音乐', Icon: Search },
    { id: 'queue', label: '下载队列', Icon: ListMusic },
    { id: 'sources', label: '音乐源', Icon: FileCode2 },
    { id: 'settings', label: '连接设置', Icon: Settings2 }
  ]

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Music2 size={19} /></span><span>洛雪音乐下载器</span></div>
      <div className="workspace-label">本地工作区</div>
      <nav aria-label="主导航">
        {nav.map(({ id, label, Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => setPage(id)}>
          <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{id === 'queue' && pending > 0 && <span className="nav-count">{pending}</span>}
        </button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="storage-row"><HardDrive size={16} /><span>本机下载位置</span></div>
        <div className="storage-path" title={downloadLocation}>{downloadLocation || '正在读取…'}</div>
        <button className="github-link" onClick={openGithub} title="打开 GitHub 项目主页"><Github size={15} /><span>GitHub 项目主页</span></button>
        <div className="sidebar-footer-row"><div className="version-text">版本 {appVersion || '0.6.6'}</div><div className="theme-switch" role="group" aria-label="主题模式"><button className={theme === 'light' ? 'theme-button active' : 'theme-button'} onClick={() => setTheme('light')} title="浅色模式" aria-label="浅色模式"><Sun size={13} /></button><button className={theme === 'dark' ? 'theme-button active' : 'theme-button'} onClick={() => setTheme('dark')} title="深色模式" aria-label="深色模式"><Moon size={13} /></button></div></div>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="crumb">音乐下载 <span>/</span> {nav.find((item) => item.id === page)?.label}</div><div className="prototype-badge"><span /> NAS 下载任务已接入</div></header>

      {page === 'search' && <section className="page-content search-page">
        <form className="music-search" onSubmit={(event) => { event.preventDefault(); runSearch() }}>
          <Search size={19} />
          <input autoComplete="off" aria-label="搜索歌名、歌手或专辑" placeholder="搜索歌曲、歌手或专辑" value={query} onChange={(event) => setQuery(event.target.value)} />
          {query && <button type="button" className="search-clear" aria-label="清空搜索" onClick={() => { setQuery(''); setResults([]); setSearchError(''); setSearchWarnings([]) }}><X size={15} /></button>}
          <button className="button button-primary search-submit" type="submit" disabled={searching || !query.trim()}>{searching ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}搜索</button>
        </form>
        <div className="provider-tabs" role="tablist" aria-label="搜索平台">
          {[{ id: 'kw', label: '酷我音乐' }, { id: 'kg', label: '酷狗音乐' }, { id: 'tx', label: '企鹅音乐' }, { id: 'wy', label: '网易音乐' }, { id: 'all', label: '聚合搜索' }].map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={provider === tab.id} className={provider === tab.id ? 'selected' : ''} disabled={searching} onClick={() => { setProvider(tab.id); if (query.trim()) runSearch(query, tab.id) }}>{tab.label}</button>)}
        </div>
        <div className="search-results-panel">
          <div className="results-heading"><div><h1>{results.length ? `“${query.trim()}”的搜索结果` : '搜索音乐'}</h1><p>{results.length ? `共找到 ${searchTotal.toLocaleString()} 首歌曲` : '输入歌名、歌手或专辑名，直接选择歌曲加入队列'}</p></div>{results.length > 0 && <span className="result-count">本页 {results.length} 首</span>}</div>
          {searchWarnings.length > 0 && <div className="search-warning">{searchWarnings.join('；')}。已显示可用平台的结果。</div>}
          {searching && <div className="search-state"><LoaderCircle className="spin" size={20} /><span>正在搜索音乐平台…</span></div>}
          {!searching && searchError && <div className="search-state search-error">{searchError}<button className="text-button" onClick={() => runSearch()}>重试</button></div>}
          {!searching && !searchError && !results.length && <div className="search-empty"><div className="search-empty-icon"><Music2 size={24} /></div><strong>搜你所想</strong><span>从酷我、酷狗或聚合搜索开始</span></div>}
          {results.length > 0 && <div className="table-wrap search-table-wrap"><table className="search-table"><thead><tr><th>歌曲</th><th>专辑</th><th>时长</th><th>平台</th><th>音质</th><th aria-label="加入队列"></th></tr></thead><tbody>{results.map((track) => <tr key={track.id}>
            <td><div className="search-track"><span className="track-art"><FileAudio2 size={16} /></span><span><strong>{track.name}</strong><small>{track.singer || '未知歌手'}</small></span></div></td>
            <td className="album-cell">{track.albumName || '—'}</td><td className="duration-cell">{track.interval}</td><td><span className="provider-mark">{providerName(track.source)}</span></td>
            <td><select className="quality-select" aria-label={`${track.name} 音质`} value={qualityChoices[track.id] || preferredQuality(track.types)} onChange={(event) => setQualityChoices((values) => ({ ...values, [track.id]: event.target.value }))}>{(track.types?.length ? track.types.map((item) => item.type) : ['320k', '128k', 'flac']).map((quality) => <option key={quality} value={quality}>{quality}</option>)}</select></td>
            <td><button className="button button-add-result" onClick={() => addTrack(track)}><Plus size={14} />加入队列</button></td>
          </tr>)}</tbody></table></div>}
          {results.length > 0 && searchTotal > searchPageSize && <div className="pagination"><span>第 {searchPage} 页</span><div><button className="button button-secondary" disabled={searching || searchPage <= 1} onClick={() => runSearch(query, provider, searchPage - 1)}>上一页</button><button className="button button-secondary" disabled={searching || searchPage * searchPageSize >= searchTotal} onClick={() => runSearch(query, provider, searchPage + 1)}>下一页</button></div></div>}
        </div>
        <div className="search-disclosure"><ShieldAlert size={14} /><span>搜索词会发送给所选音乐平台；音源脚本仅用于后续解析直链，目前未执行。</span></div>
      </section>}

      {page === 'queue' && <section className="page-content">
        <div className="page-heading"><div><h1>下载队列</h1><p>从搜索结果选择歌曲后会自动带入曲目 ID</p></div><button className="button button-primary" onClick={() => setPage('search')}><Search size={16} />搜索音乐</button></div>
        <div className="summary-strip"><div><span className="summary-label">队列曲目</span><strong>{tracks.length}</strong></div><div><span className="summary-label">待下载</span><strong>{pending}</strong></div><div><span className="summary-label">已完成</span><strong>{tracks.filter((track) => track.status === '已完成').length}</strong></div><div className="strip-source"><span className="summary-label">当前音源</span><strong>{selectedSource?.name || '尚未导入'}</strong><span className="source-version">{selectedSource ? `v${selectedSource.version}` : '导入 JS 音源后可选择'}</span></div></div>
        <div className="workspace-grid">
          <section className="panel track-panel">
            <div className="panel-heading"><div><h2>待下载曲目</h2><p>搜索结果会自动填入平台所需的曲目 ID</p></div><button className="icon-button" title="清空队列" aria-label="清空队列" onClick={() => { setTracks([]); setNotice('队列已清空') }} disabled={!tracks.length}><Trash2 size={16} /></button></div>
            <div className="table-wrap"><table><thead><tr><th>歌曲</th><th>专辑</th><th>音质</th><th>平台</th><th>状态</th><th aria-label="操作"></th></tr></thead><tbody>
              {tracks.map((track) => <tr key={track.id}><td><div className="track-title"><FileAudio2 size={17} /><span><strong>{track.name}</strong><small>{track.singer || '未知歌手'}</small></span></div></td><td className="album-cell">{track.albumName || '—'}</td><td>{track.quality}</td><td>{providerName(track.source)}</td><td><span className={`status status-${statusTone(track.status)}`} title={track.error || track.filePath || ''}>{track.status}</span>{track.progress > 0 && track.progress < 100 && <div className="mini-progress"><span style={{ width: `${track.progress}%` }} /></div>}{track.nasStatus && <small className={`nas-substatus ${track.nasStatus === 'NAS 提交失败' ? 'error' : ''}`} title={track.nasError || ''}>{track.nasStatus}{track.nasTaskId ? ` · ${track.nasTaskId}` : ''}</small>}</td><td><button className="icon-button row-delete" aria-label={`移除${track.name}`} title="移除曲目" onClick={() => setTracks((items) => items.filter((item) => item.id !== track.id))} disabled={downloadJobId && track.status !== '失败' && track.nasStatus !== 'NAS 提交失败' && track.status !== '已完成'}><X size={15} /></button></td></tr>)}
              {!tracks.length && <tr><td colSpan="6"><div className="empty-state"><div className="empty-mark"><ListMusic size={21} /></div><strong>队列为空</strong><span>搜索歌曲并加入队列，无需手动输入曲目 ID。</span></div></td></tr>}
            </tbody></table></div>
            <div className="queue-footer"><span>{tracks.length ? `${tracks.length} 首曲目 · 本机：${downloadLocation || '读取中'}` : '等待添加曲目'}</span><div className="queue-actions">
              {downloadJobId
                ? <button className="button button-secondary" onClick={() => startDownloads()}><X size={16} />取消当前任务</button>
                : <><button className="button button-secondary" disabled={!downloadableTracks.length} onClick={() => startDownloads(false)}><ArrowDownToLine size={16} />仅下载</button><button className="button button-primary" disabled={!uploadableTracks.length || !settings.token} title={!settings.token ? '请先配置并保存 FNOS-API' : ''} onClick={() => startDownloads(true)}><CloudUpload size={16} />提交已下载到 NAS</button></>}
            </div></div>
          </section>
          <aside className="side-stack">
            <section className="panel source-summary"><div className="panel-heading"><div><h2>音源状态</h2><p>本地保存的 JS 音源</p></div><button className="text-button" onClick={() => setPage('sources')}>管理音源 <ChevronDown size={14} /></button></div>
              {loading ? <div className="loading-line"><LoaderCircle size={15} />正在读取</div> : selectedSource ? <div className="source-current"><div className="source-icon"><FileCode2 size={18} /></div><div className="source-name"><strong>{selectedSource.name}</strong><span>版本 {selectedSource.version} · {formatSize(selectedSource.size)}</span></div><span className="dot-status" title="已保存到本地"></span></div> : <div className="inline-empty">尚未导入音源</div>}
              <div className="not-run-note"><ShieldAlert size={15} /><span>点击开始下载后，音源会在隔离 worker 中执行并解析临时直链。</span></div>
            </section>
            <section className="panel destination-summary"><div className="panel-heading"><div><h2>NAS 保存位置</h2><p>提交已下载歌曲时使用</p></div><button className="icon-button" title="连接设置" aria-label="连接设置" onClick={() => setPage('settings')}><Settings2 size={16} /></button></div><div className="destination-path"><FolderOpen size={17} /><span>{settings.remoteDir}</span></div><div className="connection-line"><span className="connection-dot" />{connectionState.kind === 'ok' ? '已连接' : '待验证'} <button onClick={() => setPage('settings')}>连接设置</button></div></section>
            <div className="info-line"><CircleHelp size={15} /><span>下载和 NAS 提交分开执行；提交时电脑需保持在线供 NAS 拉取文件</span></div>
          </aside>
        </div>
      </section>}

      {page === 'sources' && <section className="page-content">
        <div className="page-heading"><div><h1>音乐源</h1><p>本地管理洛雪音乐 JS 源文件</p></div><button className="button button-primary" onClick={() => importSource(false)}><Upload size={16} />导入 JS 音源</button></div>
        <div className="source-safety"><ShieldAlert size={18} /><div><strong>导入不会运行音源代码</strong><span>目前仅将文件保存到本机，并读取文件头部的名称、版本、作者和说明。音源执行与在线探测尚未接入。</span></div></div>
        <section className="panel sources-panel"><div className="panel-heading"><div><h2>已导入音源</h2><p>{sources.length} 个文件保存在当前 Windows 用户目录</p></div><button className="button button-secondary" onClick={() => importSource(true)} disabled={!targetId}><RefreshCw size={15} />更新选中音源</button></div>
          {loading ? <div className="loading-line"><LoaderCircle size={15} />正在读取</div> : sources.length ? <div className="source-list">{sources.map((source) => <button key={source.id} className={`source-row ${targetId === source.id ? 'selected' : ''}`} onClick={() => setTargetId(source.id)}><span className="source-icon"><FileCode2 size={18} /></span><span className="source-details"><strong>{source.name}</strong><span>{source.description || '无说明'}</span><small>版本 {source.version}{source.author ? ` · 作者 ${source.author}` : ''} · {formatSize(source.size)} · 更新于 {formatDate(source.updatedAt)}</small></span><span className="source-row-end">{targetId === source.id && <Check size={16} />}<span>本地保存</span></span></button>)}</div> : <div className="empty-state source-empty"><div className="empty-mark"><Archive size={21} /></div><strong>尚未导入音源</strong><span>选择本机 `.js` 文件以添加音乐源。</span></div>}
        </section>
        <div className="source-footnote"><FileCode2 size={15} /><span>更新会保留旧版本备份；软件不会修改音源原文件。</span></div>
      </section>}

      {page === 'settings' && <section className="page-content settings-page">
        <div className="page-heading"><div><h1>连接设置</h1><p>配置 FNOS-API、NAS 目录和本机下载位置</p></div></div>
        <div className="settings-section"><div className="settings-label"><h2>飞牛 NAS</h2><p>FNOS-API 默认监听 9932 端口。Token 会使用 Windows 凭据加密保存。</p></div><section className="panel settings-panel">
          <label>API 地址<input value={settings.apiBase} onChange={(event) => setSettings({ ...settings, apiBase: event.target.value })} placeholder="http://192.168.1.100:9932" /></label>
          <label>API Token<input type="password" value={settings.token} onChange={(event) => setSettings({ ...settings, token: event.target.value })} placeholder="输入自定义 API Token" autoComplete="new-password" /></label>
          <label>目标目录<input value={settings.remoteDir} onChange={(event) => setSettings({ ...settings, remoteDir: event.target.value })} placeholder="/vol1/music/下载" /></label>
          <div className="source-safety fnos-transfer-note"><ShieldAlert size={16} /><div><strong>NAS 通过下载任务拉取音乐</strong><span>桌面提供带随机访问令牌的一次性局域网文件流；NAS 从中拉取到目标目录。请保持电脑在线并允许本地网络连接，直到 FNOS 下载任务完成。</span></div></div>
          <div className="connection-result" data-state={connectionState.kind}><span className="connection-dot" />{settingsLoaded ? connectionState.message : '正在读取已保存设置…'}</div>
          <div className="settings-actions"><button className="button button-secondary" disabled={settingsBusy || !settingsLoaded} onClick={saveNasSettings}><Check size={15} />保存设置</button><button className="button button-primary" disabled={settingsBusy || !settingsLoaded} onClick={testNasConnection}><CloudUpload size={15} />检查连接</button></div>
        </section></div>
        <div className="settings-section"><div className="settings-label"><h2>本机下载位置</h2><p>“仅下载”和 NAS 提交前的本地文件都会使用此目录。</p></div><section className="panel settings-panel"><div className="path-row"><FolderOpen size={17} /><div><strong title={downloadLocation}>{downloadLocation || '正在读取…'}</strong><span>本机下载文件夹</span></div><button className="button button-secondary" onClick={chooseDownloadLocation}><FolderOpen size={15} />选择目录</button></div></section></div>
      </section>}
    </main>

    {notice && <div className="toast" role="status"><Check size={16} />{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}><X size={14} /></button></div>}
  </div>
}

function formatSize(size = 0) { return size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB` }
function formatDate(value) { return new Date(value).toLocaleDateString('zh-CN') }
function preferredQuality(types = []) {
  const available = new Set(types.map((item) => item.type))
  return ['flac24bit', 'flac', '320k', '128k'].find((quality) => available.has(quality)) || '320k'
}
function providerName(source) { return ({ kw: '酷我', kg: '酷狗', tx: '企鹅音乐', wy: '网易音乐' })[source] || source || '—' }
function statusTone(status = '') { if (status === '已完成') return 'done'; if (status === '失败') return 'error'; if (status === '已取消') return 'cancelled'; if (/下载|解析|排队/.test(status)) return 'active'; return 'wait' }

createRoot(document.getElementById('root')).render(<App />)
