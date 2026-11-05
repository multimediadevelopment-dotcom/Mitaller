import { defineConfig } from 'vite'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'

const appRoot = resolve(import.meta.dirname, 'Crash_Solution_Publicacion')
const outDir = resolve(import.meta.dirname, 'dist')

function retireDevelopmentWorker() {
  return {
    name: 'retire-development-service-worker',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== '/sw.js') return next()
        response.setHeader('Content-Type', 'application/javascript')
        response.setHeader('Cache-Control', 'no-store')
        // Retire an old registration even when its page still has old code.
        // Production builds continue to copy the real offline worker.
        response.end("self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', event => event.waitUntil(self.registration.unregister()));")
      })
    }
  }
}

function copyStaticPwaAssets() {
  return {
    name: 'copy-static-pwa-assets',
    generateBundle(_options, bundle) {
      const code = Object.keys(bundle).filter(name => /\.(js|css)$/.test(name))
      const vehiclesDir = join(appRoot, 'public', 'vehicle-assets')
      const vehicles = existsSync(vehiclesDir) ? readdirSync(vehiclesDir).map(name => `vehicle-assets/${name}`) : []
      const manifest = JSON.stringify([...code, ...vehicles])
      this.emitFile({ type: 'asset', fileName: 'precache-manifest.json', source: manifest })
      const revision = createHash('sha256').update(manifest).digest('hex').slice(0, 12)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: readFileSync(join(appRoot, 'sw.js'), 'utf8').replace('crash-solution-shell-v4', `crash-solution-shell-v4-${revision}`) })
    },
    closeBundle() {
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
      const rootFiles = [
        'manifest.webmanifest',
        '_headers',
        'auto_1_sedan_4_puertas.png',
        'auto_2_coupe_2_puertas.png',
        'auto_3_camioneta_doble_cabina.png',
        'auto_4_van_3_filas.png',
        'auto_4_van_3_filas.svg',
        'comparativa.png'
      ]
      for (const file of rootFiles) {
        const src = join(appRoot, file)
        if (existsSync(src)) copyFileSync(src, join(outDir, file))
      }
      const iconsSrc = join(appRoot, 'icons')
      const iconsDest = join(outDir, 'icons')
      if (existsSync(iconsSrc)) {
        if (!existsSync(iconsDest)) mkdirSync(iconsDest, { recursive: true })
        for (const icon of readdirSync(iconsSrc)) {
          copyFileSync(join(iconsSrc, icon), join(iconsDest, icon))
        }
      }
    }
  }
}

export default defineConfig({
  root: appRoot,
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    headers: { 'Cache-Control': 'no-store' }
  },
  envDir: import.meta.dirname,
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  plugins: [retireDevelopmentWorker(), copyStaticPwaAssets()],
  test: {
    root: '.',
    environment: 'jsdom',
    include: ['tests/**/*.test.js']
  }
})
