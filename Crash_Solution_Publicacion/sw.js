/* Crash Solution: Service Worker para uso sin conexión (DEV-26).
 * Cachea únicamente recursos estáticos propios (App Shell, CSS/JS compilados, íconos e ilustraciones).
 * Nunca cachea endpoints de Supabase Auth/REST/Storage ni solicitudes con credenciales privadas.
 */
const CACHE_NAME = 'crash-solution-shell-v4';
const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async cache => {
        let deferred = [];
        try {
          const response = await fetch('./precache-manifest.json', {cache:'no-store'});
          if (response.ok) deferred = await response.json();
        } catch { /* Keep installing the core shell if offline */ }
        // Includes deferred PDF chunks so the first PDF also works offline.
        const assets = [...APP_FILES, ...deferred.filter(path => /^(assets|vehicle-assets)\//.test(path) && !path.includes('..'))];
        for (const asset of assets) {
          try {
            await cache.add(asset);
          } catch {
            // Continuar aunque algún recurso estático opcional no esté disponible aún
          }
        }
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then(keys =>
          Promise.all(
            keys
              .filter(key => key.startsWith('crash-solution-shell-') && key !== CACHE_NAME)
              .map(key => caches.delete(key))
          )
        ),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Nunca cachear llamadas a dominios externos (ej. Supabase) ni rutas de API o autenticadas
  if (
    url.origin !== self.location.origin ||
    url.pathname.includes('/api/') ||
    /\/(auth|rest|storage)\/v1\//.test(url.pathname) ||
    request.headers.has('Authorization')
  ) {
    return;
  }

  // Navegación HTML: Network-first con fallback a index.html en caché para recargas sin conexión
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy)));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Content-hashed bundles and illustrations are immutable; avoid a redundant
  // network request on every cached hit. No Auth/REST/Storage data is cached.
  if (/\/(assets|vehicle-assets)\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|css|webp|svg)$/.test(url.pathname)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, copy)));
      }
      return response;
    })));
    return;
  }

  // Bundles de Vite (/assets/*), estilos, scripts, fuentes e imágenes estáticas locales:
  // Cache-first con actualización en caché al descargar por primera vez
  event.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request)
        .then(response => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
