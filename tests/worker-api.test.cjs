const test = require('node:test')
const assert = require('node:assert/strict')

test('loads a local source in an isolated worker and resolves a music URL', async () => {
  const { WorkerUserApiManager } = await import('lx-user-api-env')
  const manager = new WorkerUserApiManager('dedicated')
  const script = `/* @name Safe test source\n * @version 1\n */ ;(async()=>{await lx.on(lx.EVENT_NAMES.request, async () => 'http://127.0.0.1/test.mp3'); await lx.send(lx.EVENT_NAMES.inited,{sources:{kw:{type:'music',actions:['musicUrl'],qualitys:['320k']}}})})()`
  const api = manager.load(script, {}, { env: 'desktop', timeout: 5000 })
  await api.waitInit()
  const result = await api.resolve({ source: 'kw', action: 'musicUrl', info: { type: '320k', musicInfo: { name: 'x', singer: 'y', songmid: '1' } } })
  assert.equal(api.isInited, true)
  assert.deepEqual(result, { success: true, result: 'http://127.0.0.1/test.mp3' })
  await manager.destroyAll()
})
