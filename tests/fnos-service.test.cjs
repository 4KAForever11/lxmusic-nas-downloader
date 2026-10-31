const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { normalizeFnosSettings, queueUriToFnos, testFnosConnection } = require('../electron/fnos-service.cjs')

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}

test('normalizes FNOS target directory and rejects missing credentials', () => {
  assert.deepEqual(normalizeFnosSettings({ apiBase: 'http://nas.local:9932/', token: 'secret', remoteDir: '/vol1/music/' }), {
    apiBase: 'http://nas.local:9932', token: 'secret', remoteDir: '/vol1/music'
  })
  assert.throws(() => normalizeFnosSettings({ apiBase: 'ftp://nas.local', token: 'x', remoteDir: '/music' }), /HTTP 或 HTTPS/)
  assert.throws(() => normalizeFnosSettings({ apiBase: 'http://nas.local', remoteDir: '/music' }), /Token/)
})

test('submits a temporary audio URL and NAS save directory through the documented FNOS download API', async () => {
  const received = []
  const server = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      received.push({ url: request.url, auth: request.headers.authorization, contentType: request.headers['content-type'], body })
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(request.url === '/api/config'
        ? { success: true, data: { nas_host: '192.168.1.223', nas_port: '5666', api_token: 'hidden' } }
        : request.url === '/api/file/check-upload'
          ? { success: true, data: { result: 'succ', skip: 0 } }
          : { success: true, data: { ok: true } }))
    })
  })
  const port = await listen(server)
  const settings = { apiBase: `http://127.0.0.1:${port}`, token: 'fixture-token', remoteDir: '/vol1/music/下载' }
  try {
    const connection = await testFnosConnection(settings)
    assert.equal(connection.ok, true)
    assert.equal(connection.backendNasHost, '192.168.1.223')
    assert.equal(received[0].url, '/api/system/host-name')
    assert.equal(received[1].url, '/api/config')
    assert.equal(received[0].auth, 'Bearer fixture-token')
    const queued = await queueUriToFnos('http://192.168.1.50:41234/nas-transfer/token/song.flac', settings, { fileSize: 1024 })
    assert.equal(received[2].url, '/api/file/check-upload')
    assert.equal(received[2].auth, 'Bearer fixture-token')
    assert.deepEqual(JSON.parse(received[2].body), {
      path: '/vol1/music/下载/song.flac', size: 1024, overwrite: false
    })
    assert.equal(received[3].url, '/api/download/add-uri')
    assert.equal(received[3].auth, 'Bearer fixture-token')
    assert.deepEqual(JSON.parse(received[3].body), {
      uri: 'http://192.168.1.50:41234/nas-transfer/token/song.flac',
      saveDir: '/vol1/music/下载'
    })
    assert.equal(queued.saveDir, '/vol1/music/下载')
    assert.equal(queued.targetPath, '/vol1/music/下载/song.flac')
  } finally {
    server.close()
  }
})

test('rejects a non-HTTP source URL before creating a NAS download task', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"success":true}')
  })
  const port = await listen(server)
  try {
    await assert.rejects(queueUriToFnos('file:///C:/music/song.flac', { apiBase: `http://127.0.0.1:${port}`, token: 'x', remoteDir: '/music' }), /HTTP 或 HTTPS/)
  } finally {
    server.close()
  }
})

test('does not submit a download when FNOS reports that the destination should be skipped', async () => {
  const requests = []
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) {}
    requests.push(request.url)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(request.url === '/api/file/check-upload'
      ? { success: true, data: { result: 'succ', skip: 1 } }
      : { success: true }))
  })
  const port = await listen(server)
  try {
    await assert.rejects(queueUriToFnos('http://192.168.1.50:40000/song.flac', { apiBase: `http://127.0.0.1:${port}`, token: 'x', remoteDir: '/music' }), /目标文件已存在/)
    assert.deepEqual(requests, ['/api/file/check-upload'])
  } finally {
    server.close()
  }
})

test('shows the FNOS API hint when a saved token is rejected', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end('{"success":false,"error":"令牌不匹配","hint":"在 NAS API 配置中查看 token"}')
  })
  const port = await listen(server)
  try {
    await assert.rejects(testFnosConnection({ apiBase: `http://127.0.0.1:${port}`, token: 'wrong', remoteDir: '/music' }), /令牌不匹配.*查看 token/)
  } finally {
    server.close()
  }
})

test('preserves FNOS backend diagnostics for download-task failures', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(403, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ success: false, error: 'exit status 1', errmsg: 'failed to get download data from localhost:5666: HTTP proxy returned 403 Forbidden: Forbidden' }))
  })
  const port = await listen(server)
  try {
    await assert.rejects(queueUriToFnos('http://192.168.1.50:40000/file', { apiBase: `http://127.0.0.1:${port}`, token: 'x', remoteDir: '/music' }), /HTTP proxy returned 403 Forbidden/)
  } finally {
    server.close()
  }
})
