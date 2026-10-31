const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createLanFileRelay, pickLanAddress } = require('../electron/lan-relay.cjs')

test('selects a desktop address on the NAS subnet when available', () => {
  const address = pickLanAddress('192.168.1.223')
  assert.ok(address, 'expected a non-loopback IPv4 address for the LAN relay')
  assert.equal(address.split('.').slice(0, 3).join('.'), '192.168.1')
})

test('serves the local music file only through its one-time relay URL', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lxmusic-lan-relay-'))
  const filePath = path.join(root, '周杰伦 - 枫.flac')
  const content = Buffer.from('relay-fixture-audio')
  await fs.writeFile(filePath, content)
  let fetched = false
  const relay = await createLanFileRelay(filePath, '192.168.1.223', { ttlMs: 5000, onFetched: () => { fetched = true } })
  try {
    const localUrl = new URL(relay.url)
    localUrl.hostname = '127.0.0.1'
    const response = await fetch(localUrl)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-length'), String(content.length))
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), content.toString())
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(fetched, true)
    const denied = await fetch(`${localUrl.origin}/wrong-path`)
    assert.equal(denied.status, 404)
  } finally {
    relay.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})
