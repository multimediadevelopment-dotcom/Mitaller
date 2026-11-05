import { describe, expect, it, vi } from 'vitest'
import { configureServiceWorker } from '../Crash_Solution_Publicacion/src/lib/pwa-lifecycle.js'

function environment(controlled = true) {
  const workerUrl = 'http://localhost:5173/sw.js'
  const unregister = vi.fn(async () => true)
  const unrelated = { scope: 'http://localhost:5173/other/', active: { scriptURL: 'http://localhost:5173/other/sw.js' }, unregister: vi.fn() }
  const serviceWorker = {
    controller: controlled ? { scriptURL: workerUrl } : null,
    getRegistrations: vi.fn(async () => [{ scope: 'http://localhost:5173/', active: { scriptURL: workerUrl }, unregister }, unrelated]),
    register: vi.fn(async () => ({}))
  }
  return {
    navigator: { serviceWorker },
    location: { href: 'http://localhost:5173/?utm_source=test', protocol: 'http:', hostname: 'localhost', reload: vi.fn() },
    caches: { keys: vi.fn(async () => ['crash-solution-shell-v3', 'other-app']), delete: vi.fn(async () => true) },
    unregister, unrelated
  }
}

describe('Service Worker y Vite', () => {
  it('en desarrollo retira el worker anterior, borra solo el app shell y libera el documento controlado', async () => {
    const env = environment()
    localStorage.setItem('pending-jobs', 'conservar')
    await configureServiceWorker({ isDev: true, ...env })
    expect(env.unregister).toHaveBeenCalledOnce()
    expect(env.unrelated.unregister).not.toHaveBeenCalled()
    expect(env.caches.delete).toHaveBeenCalledExactlyOnceWith('crash-solution-shell-v3')
    expect(env.navigator.serviceWorker.register).not.toHaveBeenCalled()
    expect(env.location.reload).toHaveBeenCalledOnce()
    expect(localStorage.getItem('pending-jobs')).toBe('conservar')
  })

  it('con una página libre del worker no vuelve a recargar ni registra otro en desarrollo', async () => {
    const env = environment(false)
    await configureServiceWorker({ isDev: true, ...env })
    expect(env.location.reload).not.toHaveBeenCalled()
    expect(env.navigator.serviceWorker.register).not.toHaveBeenCalled()
  })

  it('mantiene el worker offline en producción y evita cachear su actualización', async () => {
    const env = environment(false)
    await configureServiceWorker({ isDev: false, ...env })
    expect(env.navigator.serviceWorker.register).toHaveBeenCalledWith('http://localhost:5173/sw.js', {
      scope: 'http://localhost:5173/', updateViaCache: 'none'
    })
    expect(env.unregister).not.toHaveBeenCalled()
    expect(env.caches.delete).not.toHaveBeenCalled()
  })
})
