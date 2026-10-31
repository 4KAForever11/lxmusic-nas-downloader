const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { downloadTrack, extensionForQuality, resolveMusicUrl, sanitizeFileName } = require('../electron/download-service.cjs')

test('sanitizes Windows filenames and maps audio extensions', () => {
  assert.equal(sanitizeFileName('周杰伦: 晴天?'), '周杰伦_ 晴天_')
  assert.equal(extensionForQuality('flac24bit'), '.flac')
  assert.equal(extensionForQuality('320k'), '.mp3')
})

test('resolves a URL and writes a streamed audio response with progress', async () => {
  const server = http.createServer((_request, response) => {
    const body = Buffer.from('fake-audio-data')
    response.writeHead(200, { 'content-length': body.length, 'content-type': 'audio/mpeg' })
    response.end(body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lxmusic-download-test-'))
  const progress = []
  try {
    const destination = await downloadTrack({
      api: { resolve: async () => ({ success: true, result: `http://127.0.0.1:${port}/audio.mp3` }) },
      track: { name: '晴天', singer: '周杰伦', source: 'kw', songmid: '1', quality: '320k' },
      outDir: root,
      onProgress: (value) => progress.push(value.percent)
    })
    assert.equal(await fs.readFile(destination, 'utf8'), 'fake-audio-data')
    assert.equal(destination.endsWith('周杰伦 - 晴天.mp3'), true)
    assert.equal(progress.at(-1), 100)
  } finally {
    server.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('reuses a resolved URL for NAS handoff instead of resolving a second link', async () => {
  let resolveCalls = 0
  const api = { resolve: async () => { resolveCalls += 1; return { success: true, result: 'https://music.example/song.flac' } } }
  const track = { source: 'kw', songmid: '1', quality: 'flac', name: 'song' }
  const url = await resolveMusicUrl(api, track)
  assert.equal(url, 'https://music.example/song.flac')
  assert.equal(resolveCalls, 1)
})
