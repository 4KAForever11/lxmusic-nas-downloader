const crypto = require('node:crypto')

const PAGE_SIZES = { kw: 30, kg: 30, tx: 50, wy: 30 }
const QUALITY_MAP = { '4000': 'flac24bit', '2000': 'flac', '320': '320k', '128': '128k' }
const QQ_SIGN_PART_1 = [23, 14, 6, 36, 16, 40, 7, 19]
const QQ_SIGN_PART_2 = [16, 1, 32, 12, 19, 27, 8, 5]
const QQ_SIGN_SCRAMBLE = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179]

function formatDuration(value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

function decodeName(value = '') {
  const text = String(value)
  if (!/%[0-9a-f]{2}/i.test(text)) return text
  try { return decodeURIComponent(text) } catch { return text }
}

function parseKuwoResult(raw) {
  const list = Array.isArray(raw?.abslist) ? raw.abslist : []
  return {
    provider: 'kw',
    total: Number(raw?.TOTAL) || 0,
    list: list.flatMap((item) => {
      const songmid = String(item.MUSICRID || '').replace(/^MUSIC_/, '')
      if (!songmid) return []
      const types = []
      for (const match of String(item.N_MINFO || '').matchAll(/level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/g)) {
        const type = QUALITY_MAP[match[2]]
        if (type) types.push({ type, size: match[4] })
      }
      return [{
        id: `kw:${songmid}`,
        source: 'kw',
        songmid,
        name: decodeName(item.SONGNAME),
        singer: decodeName(item.ARTIST),
        albumName: decodeName(item.ALBUM),
        interval: formatDuration(item.DURATION),
        img: null,
        types: [...new Map(types.map((quality) => [quality.type, quality])).values()]
      }]
    })
  }
}

function parseKugouResult(raw) {
  const list = Array.isArray(raw?.data?.lists) ? raw.data.lists : []
  return {
    provider: 'kg',
    total: Number(raw?.data?.total) || 0,
    list: list.flatMap((item) => {
      const songmid = String(item.Audioid || '')
      if (!songmid) return []
      const singers = Array.isArray(item.Singers)
        ? item.Singers.map((singer) => typeof singer === 'string' ? singer : singer.name).filter(Boolean).join('、')
        : ''
      const types = [
        ['FileSize', '128k', 'FileHash'],
        ['HQFileSize', '320k', 'HQFileHash'],
        ['SQFileSize', 'flac', 'SQFileHash'],
        ['ResFileSize', 'flac24bit', 'ResFileHash']
      ].flatMap(([sizeField, type, hashField]) => Number(item[sizeField]) > 0 ? [{ type, size: String(item[sizeField]), hash: item[hashField] || '' }] : [])
      return [{
        id: `kg:${songmid}:${item.FileHash || ''}`,
        source: 'kg',
        songmid,
        hash: String(item.FileHash || ''),
        name: decodeName(`${item.OriSongName || ''}${item.Suffix ? ` ${item.Suffix}` : ''}`),
        singer: decodeName(singers),
        albumName: decodeName(item.AlbumName),
        interval: formatDuration(item.Duration),
        img: null,
        types
      }]
    })
  }
}

function parseTencentResult(raw) {
  const rows = raw?.body?.song?.list || raw?.song?.list || raw?.data?.body?.song?.list || raw?.songList || []
  return {
    provider: 'tx',
    total: Number(raw?.meta?.sum || raw?.body?.song?.total || raw?.data?.meta?.sum || rows.length),
    list: rows.flatMap((item) => {
      if (!item?.mid) return []
      const file = item.file || {}
      const types = [
        ['size_128mp3', '128k'], ['size_320mp3', '320k'], ['size_flac', 'flac'], ['size_hires', 'flac24bit']
      ].flatMap(([field, type]) => Number(file[field]) > 0 ? [{ type, size: String(file[field]) }] : [])
      return [{
        id: `tx:${item.mid}`,
        source: 'tx',
        songmid: String(item.mid),
        songId: String(item.id || ''),
        strMediaMid: String(file.media_mid || ''),
        albumMid: String(item.album?.mid || ''),
        name: String(item.title || item.name || ''),
        singer: Array.isArray(item.singer) ? item.singer.map((person) => person.name).filter(Boolean).join('、') : '',
        albumName: String(item.album?.name || ''),
        interval: formatDuration(item.interval),
        img: null,
        types
      }]
    })
  }
}

function parseNeteaseResult(raw) {
  const rows = raw?.result?.songs || raw?.data?.resources || raw?.songs || []
  const total = Number(raw?.result?.songCount || raw?.data?.totalCount || raw?.songCount || 0)
  return {
    provider: 'wy',
    total,
    list: rows.flatMap((row) => {
      const item = row?.baseInfo?.simpleSongData || row
      if (item?.id == null) return []
      const privilege = item.privilege || {}
      const maxBitrate = Number(privilege.maxbr || 0)
      const types = []
      if (privilege.maxBrLevel === 'hires') types.push({ type: 'flac24bit', size: String(item.hr?.size || '') })
      if (maxBitrate >= 999000) types.push({ type: 'flac', size: String(item.sq?.size || '') })
      if (maxBitrate >= 320000) types.push({ type: '320k', size: String(item.h?.size || '') })
      if (maxBitrate >= 128000) types.push({ type: '128k', size: String(item.l?.size || '') })
      const artists = item.ar || item.artists || []
      const album = item.al || item.album || {}
      const duration = Number(item.dt ?? item.duration ?? 0)
      return [{
        id: `wy:${item.id}`,
        source: 'wy',
        songmid: String(item.id),
        name: String(item.name || ''),
        singer: Array.isArray(artists) ? artists.map((person) => person.name).filter(Boolean).join('、') : '',
        albumName: String(album.name || ''),
        interval: formatDuration(duration > 10000 ? duration / 1000 : duration),
        img: album.picUrl || null,
        types
      }]
    })
  }
}

function qqSign(text) {
  const hash = crypto.createHash('sha1').update(text).digest('hex')
  const part1 = QQ_SIGN_PART_1.map((index) => hash[index]).join('')
  const part2 = QQ_SIGN_PART_2.map((index) => hash[index]).join('')
  const scrambled = QQ_SIGN_SCRAMBLE.map((value, index) => value ^ Number.parseInt(hash.slice(index * 2, index * 2 + 2), 16))
  const encoded = Buffer.from(scrambled).toString('base64').replace(/[\\/+=]/g, '')
  return `zzc${part1}${encoded}${part2}`.toLowerCase()
}

function createNeteaseSearchBody(query, page) {
  return new URLSearchParams({
    s: query,
    type: '1',
    limit: String(PAGE_SIZES.wy),
    offset: String(PAGE_SIZES.wy * (page - 1)),
    total: String(page === 1),
    csrf_token: ''
  }).toString()
}

async function requestJson(url, signal, options = {}) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'LXMusicNASDownloader/0.2', ...(options.headers || {}) },
    method: options.method || 'GET',
    body: options.body,
    signal
  })
  if (!response.ok) throw new Error(`搜索服务返回 HTTP ${response.status}`)
  return response.json()
}

async function searchOne(provider, query, page, signal) {
  const encoded = encodeURIComponent(query)
  if (provider === 'kw') {
    const url = `https://search.kuwo.cn/r.s?client=kt&all=${encoded}&pn=${page - 1}&rn=${PAGE_SIZES.kw}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`
    const raw = await requestJson(url, signal)
    if (!Array.isArray(raw?.abslist)) throw new Error('酷我搜索结果格式异常。')
    return parseKuwoResult(raw)
  }
  if (provider === 'kg') {
    const url = `https://songsearch.kugou.com/song_search_v2?platform=AndroidFilter&iscorrection=1&keyword=${encoded}&hifiquality=0&pagesize=${PAGE_SIZES.kg}&PrivilegeFilter=0&page=${page}`
    const raw = await requestJson(url, signal)
    if (Number(raw?.error_code) !== 0 || !Array.isArray(raw?.data?.lists)) throw new Error('酷狗搜索结果格式异常。')
    return parseKugouResult(raw)
  }
  if (provider === 'tx') {
    let failure
    for (let attempt = 0; attempt < 3; attempt++) {
      const payload = {
        comm: {
          _channelid: '0', _os_version: '6.2.9200-2', ct: '19', cv: '2151', guid: crypto.randomBytes(16).toString('hex').toUpperCase(),
          patch: '118', psrf_access_token_expiresAt: 0, psrf_qqaccess_token: '', psrf_qqopenid: '', psrf_qqunionid: '',
          tmeAppID: 'qqmusic', tmeLoginType: 0, uin: '0', wid: '7223299733393904640'
        },
        'music.search.SearchCgiService': {
          module: 'music.search.SearchCgiService',
          method: 'DoSearchForQQMusicDesktop',
          param: { grp: 1, num_per_page: PAGE_SIZES.tx, page_num: page, query, remoteplace: 'txt.newclient.top', search_type: 0, searchid: `${crypto.randomUUID().replaceAll('-', '').toUpperCase()}${String(crypto.randomInt(100000)).padStart(5, '0')}` }
        }
      }
      const serialized = JSON.stringify(payload)
      const url = `https://u.y.qq.com/cgi-bin/musics.fcg?sign=${qqSign(serialized)}`
      try {
        const raw = await requestJson(url, signal, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'QQMusic 14090508(android 12)' }, body: serialized })
        const request = raw?.['music.search.SearchCgiService'] || raw?.req
        if (Number(raw?.code) === 0 && Number(request?.code) === 0 && request?.data) return parseTencentResult(request.data)
        failure = new Error(`腾讯搜索响应异常${raw?.code == null ? '' : `（${raw.code}/${request?.code ?? '无服务结果'}）`}`)
      } catch (error) {
        if (error.name === 'AbortError') throw error
        failure = error
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    }
    throw failure || new Error('企鹅音乐搜索暂不可用。')
  }
  if (provider === 'wy') {
    const form = createNeteaseSearchBody(query, page)
    const raw = await requestJson('https://music.163.com/api/cloudsearch/pc?csrf_token=', signal, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': 'https://music.163.com', 'Referer': 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36' },
      body: form
    })
    if (!raw?.result) throw new Error('网易搜索结果格式异常。')
    return parseNeteaseResult(raw)
  }
  throw new Error('不支持的搜索平台。')
}

async function searchTracks({ query, provider = 'all', page = 1 }) {
  const term = String(query || '').trim()
  if (!term) throw new Error('请输入歌曲名或歌手名。')
  if (term.length > 100) throw new Error('搜索内容不能超过 100 个字符。')
  if (!['kw', 'kg', 'tx', 'wy', 'all'].includes(provider)) throw new Error('不支持的搜索平台。')
  const pageNumber = Math.max(1, Math.min(1000, Number.parseInt(page, 10) || 1))
  const providers = provider === 'all' ? ['kw', 'kg', 'tx', 'wy'] : [provider]
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const settled = await Promise.allSettled(providers.map((name) => searchOne(name, term, pageNumber, controller.signal)))
    const successful = settled.flatMap((item) => item.status === 'fulfilled' ? [item.value] : [])
    if (!successful.length) {
      const error = settled.find((item) => item.status === 'rejected')?.reason
      throw new Error(error?.name === 'AbortError' ? '搜索超时，请稍后重试。' : error?.message || '搜索失败，请稍后重试。')
    }
    return {
      list: successful.flatMap((item) => item.list),
      total: successful.reduce((sum, item) => sum + item.total, 0),
      pageSize: successful.reduce((sum, item) => sum + PAGE_SIZES[item.provider], 0),
      providers: successful.map((item) => item.provider),
      warnings: settled.flatMap((item, index) => item.status === 'rejected' ? [`${providerName(providers[index])}：${item.reason?.message || '搜索失败'}`] : [])
    }
  } finally {
    clearTimeout(timeout)
  }
}

function providerName(provider) { return ({ kw: '酷我', kg: '酷狗', tx: '企鹅音乐', wy: '网易音乐' })[provider] || provider }

module.exports = { createNeteaseSearchBody, formatDuration, parseKuwoResult, parseKugouResult, parseNeteaseResult, parseTencentResult, qqSign, searchTracks }
