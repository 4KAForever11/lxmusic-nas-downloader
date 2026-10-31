const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

function pickLanAddress(targetHost) {
  const target = String(targetHost || '').split('.').slice(0, 3).join('.')
  const candidates = Object.values(os.networkInterfaces()).flatMap((items) => items || [])
    .filter((item) => item.family === 'IPv4' && !item.internal)
  return candidates.find((item) => target && item.address.split('.').slice(0, 3).join('.') === target)?.address
    || candidates.find((item) => item.address.startsWith('192.168.'))?.address
    || candidates.find((item) => item.address.startsWith('10.'))?.address
}

function mimeType(filePath) {
  return path.extname(filePath).toLowerCase() === '.flac' ? 'audio/flac' : 'audio/mpeg'
}

function downloadHeaders(filePath) {
  const fileName = path.basename(filePath)
  return {
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `attachment; filename="audio${path.extname(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'Content-Type': mimeType(filePath)
  }
}

async function createLanFileRelay(filePath, targetHost, { ttlMs = 15 * 60 * 1000, onFetched, onClosed } = {}) {
  const stat = await fsp.stat(filePath)
  if (!stat.isFile()) throw new Error('待发送到 NAS 的本地路径不是普通文件。')
  const host = pickLanAddress(targetHost)
  if (!host) throw new Error('没有找到与 NAS 同网段的电脑网卡。请确认电脑与 NAS 在同一局域网。')
  const accessKey = crypto.randomBytes(24).toString('hex')
  const fileName = path.basename(filePath)
  const pathname = `/nas-transfer/${accessKey}/${encodeURIComponent(fileName)}`
  let fetched = false
  let closeTimer
  let closed = false
  const server = http.createServer((request, response) => {
    if (request.url !== pathname || !['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(404).end()
      return
    }
    const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/)
    let start = 0
    let end = stat.size - 1
    if (range) {
      if (range[1]) start = Number(range[1])
      if (range[2]) end = Math.min(end, Number(range[2]))
      if (start > end || start >= stat.size) {
        response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end()
        return
      }
      response.writeHead(206, {
        ...downloadHeaders(filePath),
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`
      })
    } else {
      response.writeHead(200, { ...downloadHeaders(filePath), 'Content-Length': stat.size })
    }
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    fetched = true
    const file = fs.createReadStream(filePath, { start, end })
    file.on('error', () => response.destroy())
    file.pipe(response)
    response.on('finish', () => {
      onFetched?.({ fileName, size: stat.size })
      clearTimeout(closeTimer)
      closeTimer = setTimeout(() => close(), 10000)
      closeTimer.unref?.()
    })
  })

  const close = () => {
    if (closed) return
    closed = true
    clearTimeout(expiryTimer)
    clearTimeout(closeTimer)
    onClosed?.()
    server.close()
  }
  const expiryTimer = setTimeout(close, ttlMs)
  expiryTimer.unref?.()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '0.0.0.0', resolve)
  })
  const address = server.address()
  return {
    url: `http://${host}:${address.port}${pathname}`,
    fileName,
    size: stat.size,
    get fetched() { return fetched },
    close
  }
}

module.exports = { createLanFileRelay, pickLanAddress }
