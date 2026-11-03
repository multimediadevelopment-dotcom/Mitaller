/* Crash Solution: Service Worker para uso sin conexión (DEV-26).
 * Cachea únicamente recursos estáticos propios (App Shell, CSS/JS compilados, íconos e ilustraciones).
 * Nunca cachea endpoints de Supabase Auth/REST/Storage ni solicitudes con credenciales privadas.
 */
const CACHE_NAME = 'crash-solution-shell-v3';
const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './auto_1_sedan_4_puertas.png',
  './auto_2_coupe_2_puertas.png',
  './auto_3_camioneta_doble_cabina.png',
  './auto_4_van_3_filas.png',
  './auto_4_van_3_filas.svg',
  './comparativa.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async cache => {
        for (const asset of APP_FILES) {
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
