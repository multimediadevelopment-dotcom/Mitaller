import { describe, expect, it, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

const source = readFileSync(resolve('Crash_Solution_Publicacion/sw.js'), 'utf8')
function worker() {
  const handlers = {}
  const cache = { add: vi.fn(async () => {}), put: vi.fn(async () => {}) }
  const caches = { open: vi.fn(async () => cache), match: vi.fn(async () => ({ cached: true })) }
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ['assets/pdf-deferred-12345678.js', 'vehicle-assets/vehicle-12345678.webp', 'https://private.invalid/token', '../private'], type: 'basic', clone: () => ({}) }))
  const self = { location: { origin: 'https://app.invalid' }, addEventListener: (name, handler) => { handlers[name] = handler }, skipWaiting: vi.fn() }
  vm.runInNewContext(source, { self, caches, fetch, URL })
  return { handlers, cache, caches, fetch }
}
describe('Recursos diferidos disponibles offline sin cachear datos privados', () => {
  it('la instalación precachea PDF e ilustraciones del manifiesto y rechaza rutas externas o ascendentes', async () => {
    const { handlers, cache } = worker()
    let ready
    handlers.install({ waitUntil: promise => { ready = promise } })
    await ready
    expect(cache.add).toHaveBeenCalledWith('assets/pdf-deferred-12345678.js')
    expect(cache.add).toHaveBeenCalledWith('vehicle-assets/vehicle-12345678.webp')
    expect(cache.add).not.toHaveBeenCalledWith('https://private.invalid/token')
    expect(cache.add).not.toHaveBeenCalledWith('../private')
  })

  it('un bundle con hash ya cacheado funciona sin red y no realiza revalidaciones duplicadas', async () => {
    const { handlers, fetch } = worker()
    let response
    handlers.fetch({ request: { method: 'GET', url: 'https://app.invalid/assets/pdf-12345678.js', mode: 'cors', headers: { has: () => false } }, respondWith: promise => { response = promise } })
    expect(await response).toEqual({ cached: true })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['https://supabase.invalid/storage/v1/object/logo', 'https://app.invalid/rest/v1/jobs', 'https://app.invalid/auth/v1/token'])('no intercepta %s', url => {
    const { handlers } = worker()
    const respondWith = vi.fn()
    handlers.fetch({ request: { method: 'GET', url, headers: { has: () => false } }, respondWith })
    expect(respondWith).not.toHaveBeenCalled()
  })

  it('cada ilustración externalizada existe y el HTML no lleva sus base64 en el inicio', () => {
    const html = readFileSync(resolve('Crash_Solution_Publicacion/index.html'), 'utf8')
    const paths = [...html.matchAll(/\.\/vehicle-assets\/[a-z0-9.-]+/g)].map(match => match[0])
    expect(new Set(paths).size).toBe(4)
    for (const path of paths) expect(existsSync(resolve('Crash_Solution_Publicacion/public', path))).toBe(true)
    expect(html).not.toMatch(/data:image\/(webp|svg\+xml);base64,[A-Za-z0-9+/=]{100}/)
    expect(html).toContain('loading="lazy" decoding="async"')
  })
})
