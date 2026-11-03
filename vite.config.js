import { defineConfig } from 'vite'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

const appRoot = resolve(import.meta.dirname, 'Crash_Solution_Publicacion')
const outDir = resolve(import.meta.dirname, 'dist')

function copyStaticPwaAssets() {
  return {
    name: 'copy-static-pwa-assets',
    closeBundle() {
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
      const rootFiles = [
        'sw.js',
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
  root: 'Crash_Solution_Publicacion',
  envDir: import.meta.dirname,
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  plugins: [copyStaticPwaAssets()],
  test: {
    root: '.',
    environment: 'jsdom',
    include: ['tests/**/*.test.js']
  }
})
