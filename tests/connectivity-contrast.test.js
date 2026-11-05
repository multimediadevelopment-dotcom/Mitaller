import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'

const css = readFileSync(resolve(process.cwd(), 'Crash_Solution_Publicacion/src/styles.css'), 'utf8').replace(/@import[^;]+;/g, '')
function luminance(color) {
  const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
    const c = value / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}
function contrast(a, b) {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y)
  return (high + 0.05) / (low + 0.05)
}

describe('Contraste de conexión sobre el menú de usuario blanco', () => {
  it.each(['online', 'offline', 'pending', 'conflict'])('%s tiene contraste AA y no hereda apariencia deshabilitada', state => {
    const page = new JSDOM(`<style>${css}</style><div class="profile-dropdown"><button disabled>Acción deshabilitada</button><span class="conn-badge ${state}" role="status"><span class="conn-dot"></span><span>Estado de conexión</span></span></div>`)
    const badge = page.window.document.querySelector('.conn-badge')
    const style = page.window.getComputedStyle(badge)
    const textStyle = page.window.getComputedStyle(badge.lastElementChild)
    const dotStyle = page.window.getComputedStyle(badge.firstElementChild)
    expect(contrast(textStyle.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(dotStyle.backgroundColor, style.backgroundColor)).toBeGreaterThanOrEqual(3)
    expect(style.opacity).toBe('1')
    expect(style.maxWidth).toBe('100%')
    expect(style.whiteSpace).toBe('normal')
    expect(badge.closest('button, [disabled]')).toBeNull()
    page.window.close()
  })
})
