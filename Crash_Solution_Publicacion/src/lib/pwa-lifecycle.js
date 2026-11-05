const SHELL_CACHE_PREFIX = 'crash-solution-shell-'

export async function configureServiceWorker({
  isDev,
  navigator: nav = globalThis.navigator,
  caches: cacheStorage = globalThis.caches,
  location: loc = globalThis.location
}) {
  if (!nav?.serviceWorker) return
  const workerUrl = new URL('./sw.js', loc.href).href
  const scope = new URL('./', loc.href).href
  if (isDev) {
    const controlled = nav.serviceWorker.controller?.scriptURL === workerUrl
    const registrations = await nav.serviceWorker.getRegistrations()
    for (const registration of registrations) {
      const workers = [registration.active, registration.waiting, registration.installing]
      if (registration.scope === scope && workers.some(worker => worker?.scriptURL === workerUrl)) {
        await registration.unregister()
      }
    }
    if (cacheStorage) {
      const keys = await cacheStorage.keys()
      await Promise.all(keys.filter(key => key.startsWith(SHELL_CACHE_PREFIX)).map(key => cacheStorage.delete(key)))
    }
    // Unregistering alone leaves the current document controlled. A fresh
    // navigation releases it; jobs/localStorage/IndexedDB are never cleared.
    if (controlled) loc.reload()
    return
  }
  if (loc.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(loc.hostname)) {
    await nav.serviceWorker.register(workerUrl, { scope, updateViaCache: 'none' })
  }
}
