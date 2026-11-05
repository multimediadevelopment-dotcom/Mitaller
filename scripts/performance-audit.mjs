// Local, repeatable production resource audit. Does not run the app or contact Supabase.
import { build } from 'vite'
import { gzipSync } from 'node:zlib'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

const stage = process.argv[2] || 'before'
if (!['before', 'after'].includes(stage)) throw new Error('Expected before or after')
const start = performance.now()
const result = await build({ logLevel: 'error', build: { write: false, emptyOutDir: false } })
const output = (Array.isArray(result) ? result[0] : result).output
const files = new Map(output.map(file => [file.fileName, Buffer.from(file.type === 'chunk' ? file.code : file.source)]))
const chunks = new Map(output.filter(file => file.type === 'chunk').map(file => [file.fileName, file]))
const initial = new Set(['index.html'])
function visit(name) {
  if (initial.has(name)) return
  initial.add(name)
  const chunk = chunks.get(name)
  if (!chunk) return
  chunk.imports.forEach(visit)
  for (const css of chunk.viteMetadata?.importedCss || []) initial.add(css)
}
for (const chunk of chunks.values()) if (chunk.isEntry) visit(chunk.fileName)
const modules = new Map()
for (const chunk of chunks.values()) for (const [id, mod] of Object.entries(chunk.modules)) {
  const key = id.replaceAll('\\', '/')
  modules.set(key, (modules.get(key) || 0) + mod.renderedLength)
}
const compressed = new Map([...files].map(([name, content]) => [name, gzipSync(content)]))
const server = createServer((req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1)
  const body = compressed.get(name)
  if (!body) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'Content-Encoding': 'gzip', 'Cache-Control': 'no-store', 'Content-Length': body.length })
  res.end(body)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const samples = []
try {
  for (let i = 0; i < 12; i++) {
    const t0 = performance.now()
    const html = await fetch(base)
    const ttfb = performance.now() - t0
    await html.arrayBuffer()
    const names = [...initial].filter(name => name !== 'index.html')
    for (let j = 0; j < names.length; j += 6) {
      await Promise.all(names.slice(j, j + 6).map(async name => { const res = await fetch(`${base}/${name}`); await res.arrayBuffer() }))
    }
    if (i >= 2) samples.push({ htmlTtfbMs: ttfb, initialResourceTransferMs: performance.now() - t0 })
  }
} finally {
  await new Promise(resolve => server.close(resolve))
}
const median = field => samples.map(sample => sample[field]).sort((a, b) => a - b)[Math.floor(samples.length / 2)]
const summary = {
  stage, measuredAt: new Date().toISOString(),
  method: 'Local HTTP, production resources with gzip, 10 samples after 2 warmups; no browser execution, no Supabase, no CPU/mobile throttling.',
  totalAuditMs: performance.now() - start,
  initialRawBytes: [...initial].reduce((sum, name) => sum + (files.get(name)?.length || 0), 0),
  initialGzipBytes: [...initial].reduce((sum, name) => sum + (compressed.get(name)?.length || 0), 0),
  initialFiles: [...initial],
  initialJsGzipBytes: [...initial].filter(name => name.endsWith('.js')).reduce((sum, name) => sum + compressed.get(name).length, 0),
  medianHtmlTtfbMs: median('htmlTtfbMs'), medianInitialResourceTransferMs: median('initialResourceTransferMs'), samples,
  files: [...files].map(([name, data]) => ({ name, bytes: data.length, gzipBytes: compressed.get(name).length, initial: initial.has(name) })),
  largestModules: [...modules].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, renderedBytes]) => ({ name: name.replace(/^.*\/node_modules\//, 'node_modules/').replace(/^.*\/Crash_Solution_Publicacion\//, 'src-root/'), renderedBytes }))
}
await mkdir('docs/performance', { recursive: true })
await writeFile(`docs/performance/${stage}-bundle.json`, JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify({ stage, initialRawBytes: summary.initialRawBytes, initialGzipBytes: summary.initialGzipBytes, initialJsGzipBytes: summary.initialJsGzipBytes, medianHtmlTtfbMs: summary.medianHtmlTtfbMs, medianInitialResourceTransferMs: summary.medianInitialResourceTransferMs, largestModules: summary.largestModules.slice(0, 6) }, null, 2))
