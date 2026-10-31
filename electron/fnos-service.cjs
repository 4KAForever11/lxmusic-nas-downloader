const crypto = require('node:crypto')

function normalizeFnosSettings(input = {}) {
  const apiBase = String(input.apiBase || '').trim().replace(/\/+$/, '')
  let url
  try { url = new URL(apiBase) } catch { throw new Error('请输入有效的 FNOS-API 地址。') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('FNOS-API 地址需为不含凭据和参数的 HTTP 或 HTTPS 地址。')
  }
  const token = String(input.token || '').trim()
  if (!token) throw new Error('请输入 FNOS-API Token。')
  const remoteDir = `/${String(input.remoteDir || '').trim().replace(/^\/+|\/+$/g, '')}`
  if (remoteDir === '/') throw new Error('请输入 NAS 目标目录。')
  if (remoteDir.split('/').some((part) => part === '.' || part === '..')) throw new Error('目标目录不能包含 . 或 .. 路径段。')
  return { apiBase, token, remoteDir }
}

function apiSucceeded(body) {
  if (body && typeof body === 'object' && body.success === false) {
    throw new Error(body.message || body.error || body.errmsg || 'FNOS-API 请求失败。')
  }
  return body
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { redirect: 'error', ...options })
  const text = await response.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  if (!response.ok) {
    if (response.status === 404) throw new Error('FNOS-API 返回 404，请核对已安装 FPK 是否提供该接口。')
    if (response.status === 401 || response.status === 403) {
      const hint = body?.hint ? ` ${body.hint}` : ''
      const detail = body?.errmsg || body?.stderr || body?.error || body?.message || '请检查 API Token。'
      throw new Error(`FNOS-API 拒绝访问：${String(detail).slice(0, 600)}${hint}`)
    }
    const detail = body?.errmsg || body?.stderr || body?.message || body?.error || (text ? text.slice(0, 360) : '')
    throw new Error(detail ? `FNOS-API HTTP ${response.status}：${String(detail).slice(0, 600)}` : `FNOS-API 返回 HTTP ${response.status}`)
  }
  return { body: apiSucceeded(body), response }
}

async function testFnosConnection(settings, { signal, timeoutMs = 12000 } = {}) {
  const config = normalizeFnosSettings(settings)
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const { body } = await requestJson(`${config.apiBase}/api/system/host-name`, {
    headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' },
    signal: combined
  })
  const data = body?.data ?? body
  let backendNasHost = ''
  let backendNasPort = ''
  try {
    const configResponse = await requestJson(`${config.apiBase}/api/config`, {
      headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' },
      signal: combined
    })
    const backend = configResponse.body?.data ?? configResponse.body
    backendNasHost = String(backend?.nas_host || '')
    backendNasPort = String(backend?.nas_port || '')
  } catch {
    // Some older FNOS-API builds do not expose the safe config endpoint.
  }
  return { ok: true, hostName: data?.hostName || data?.hostname || '', backendNasHost, backendNasPort }
}

async function queueUriToFnos(uri, settings, { signal, timeoutMs = 15000, fileSize = 0 } = {}) {
  const config = normalizeFnosSettings(settings)
  let url
  try { url = new URL(String(uri)) } catch { throw new Error('音乐源返回了无效的下载地址。') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('NAS 只接受 HTTP 或 HTTPS 音频地址。')
  const fileName = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) || 'audio')
  const targetPath = `${config.remoteDir}/${fileName}`
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
  const authHeaders = { Authorization: `Bearer ${config.token}`, Accept: 'application/json', 'Content-Type': 'application/json' }
  const { body: checkBody } = await requestJson(`${config.apiBase}/api/file/check-upload`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ path: targetPath, size: Math.max(0, Number(fileSize) || 0), overwrite: false }),
    signal: requestSignal
  })
  const check = checkBody?.data ?? checkBody
  if (check?.skip === 1 || check?.skip === true || check?.result === 'skip') {
    throw new Error(`NAS 目标文件已存在，已跳过：${targetPath}`)
  }
  const { body } = await requestJson(`${config.apiBase}/api/download/add-uri`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ uri: url.toString(), saveDir: config.remoteDir }),
    signal: requestSignal
  })
  const data = body?.data ?? body
  return {
    data,
    taskId: data?.id ?? data?.taskId ?? data?.task_id ?? data?.task?.id ?? null,
    saveDir: config.remoteDir,
    targetPath
  }
}

module.exports = { normalizeFnosSettings, queueUriToFnos, testFnosConnection }
