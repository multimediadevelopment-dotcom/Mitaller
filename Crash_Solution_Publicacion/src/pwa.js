import { configureServiceWorker } from './lib/pwa-lifecycle.js'

configureServiceWorker({ isDev: import.meta.env.DEV })
  .catch(error => console.warn('PWA: no se pudo actualizar el service worker', error))
