const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { parseHeader } = require('../electron/source-meta.cjs')
const { createNeteaseSearchBody, formatDuration, parseKuwoResult, parseKugouResult, parseNeteaseResult, parseTencentResult, qqSign } = require('../electron/search-service.cjs')

test('reads only the source header metadata', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lx-music-source-v7.js'), 'utf8')
  assert.deepEqual(parseHeader(source), {
    name: '独家音源',
    description: '后续更新，请关注微信公众号: 洛雪科技',
    version: '7',
    author: 'w'
  })
})

test('uses safe defaults when a source has no metadata header', () => {
  assert.deepEqual(parseHeader('globalThis.lx = {}'), {
    name: '未命名音源', description: '', version: '未标注', author: ''
  })
})

test('maps Kuwo search results into LX music info fields without exposing the ID as a required input', () => {
  const result = parseKuwoResult({ TOTAL: '1', abslist: [{
    MUSICRID: 'MUSIC_987', SONGNAME: '晴天', ARTIST: '周杰伦', ALBUM: '叶惠美', DURATION: '269',
    N_MINFO: 'level:p,bitrate:320,format:mp3,size:9.2M;level:p,bitrate:2000,format:flac,size:24M'
  }] })
  assert.equal(result.list[0].source, 'kw')
  assert.equal(result.list[0].songmid, '987')
  assert.equal(result.list[0].name, '晴天')
  assert.equal(result.list[0].singer, '周杰伦')
  assert.deepEqual(result.list[0].types.map(({ type }) => type), ['320k', 'flac'])
})

test('maps Kugou results while retaining the hash needed by its source resolver', () => {
  const result = parseKugouResult({ error_code: 0, data: { total: 1, lists: [{
    Audioid: 12, FileHash: 'abc123', OriSongName: '晴天', Suffix: '', Singers: [{ name: '周杰伦' }],
    AlbumName: '叶惠美', Duration: 269, FileSize: 100, HQFileSize: 0, SQFileSize: 200, ResFileSize: 0,
    SQFileHash: 'flac-hash'
  }] } })
  assert.equal(result.list[0].songmid, '12')
  assert.equal(result.list[0].hash, 'abc123')
  assert.deepEqual(result.list[0].types.map(({ type }) => type), ['128k', 'flac'])
  assert.equal(result.list[0].interval, '04:29')
})

test('formats invalid durations without throwing', () => {
  assert.equal(formatDuration(Number.NaN), '00:00')
})

test('keeps a valid empty Kugou response as an empty result rather than a service error', () => {
  const result = parseKugouResult({ error_code: 0, data: { total: 0, lists: [] } })
  assert.equal(result.total, 0)
  assert.deepEqual(result.list, [])
})

test('maps QQ Music results into Tencent source fields', () => {
  const result = parseTencentResult({ meta: { sum: 1 }, body: { song: { list: [{
    mid: 'tx-mid', id: 123, title: '晴天', interval: 269, singer: [{ name: '周杰伦' }], album: { mid: 'album-mid', name: '叶惠美' },
    file: { media_mid: 'media-mid', size_128mp3: 10, size_320mp3: 20, size_flac: 0, size_hires: 0 }
  }] } } })
  assert.equal(result.list[0].source, 'tx')
  assert.equal(result.list[0].songmid, 'tx-mid')
  assert.equal(result.list[0].strMediaMid, 'media-mid')
  assert.deepEqual(result.list[0].types.map(({ type }) => type), ['128k', '320k'])
})

test('keeps QQ Music results that have a song mid but no media mid', () => {
  const result = parseTencentResult({ data: { body: { song: { list: [
    { mid: 'song-mid', id: 456, title: '无音质信息曲目', file: {}, singer: [], album: {} }
  ] } } } })
  assert.equal(result.total, 1)
  assert.equal(result.list[0].songmid, 'song-mid')
  assert.equal(result.list[0].strMediaMid, '')
})

test('maps NetEase resources and builds a paged search request body', () => {
  const result = parseNeteaseResult({ code: 200, result: { songCount: 1, songs: [{
    id: 321, name: '晴天', dt: 269000, ar: [{ name: '周杰伦' }], al: { id: 7, name: '叶惠美', picUrl: '' },
    privilege: { maxbr: 320000, maxBrLevel: 'exhigh' }, h: { size: 2048 }, l: { size: 1024 }
  }] } })
  assert.equal(result.list[0].source, 'wy')
  assert.equal(result.list[0].songmid, '321')
  assert.equal(result.list[0].interval, '04:29')
  assert.deepEqual(result.list[0].types.map(({ type }) => type), ['320k', '128k'])
  const form = new URLSearchParams(createNeteaseSearchBody('晴天', 2))
  assert.equal(form.get('s'), '晴天')
  assert.equal(form.get('offset'), '30')
  assert.equal(form.get('limit'), '30')
})

test('generates a Tencent search signature with the expected prefix', () => {
  assert.match(qqSign('{"query":"晴天"}'), /^zzc[a-z0-9]+$/)
})
