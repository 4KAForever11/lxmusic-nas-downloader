function parseHeader(code) {
  const header = String(code).slice(0, 8192).match(/^\s*\/\*!?([\s\S]*?)\*\//)?.[1] || ''
  const field = (key) => header.match(new RegExp(`^\\s*\\*?\\s*@${key}\\s+(.+?)\\s*$`, 'mi'))?.[1]?.trim() || ''
  return {
    name: field('name') || '未命名音源',
    description: field('description'),
    version: field('version') || '未标注',
    author: field('author')
  }
}

module.exports = { parseHeader }
