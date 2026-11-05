import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'

describe('Listado grande de trabajos sin perder datos', () => {
  it('renderiza 60 tarjetas, muestra más bajo demanda y busca sobre todos los registros', () => {
    const jobs = Array.from({ length: 150 }, (_, index) => ({
      id: `benchmark-${index}`, number: `OT-${index}`, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      rec: { cliente: `Cliente ${index}`, patente: `TEST${index}` }, quote: [], inspection: {},
      status: 'Borrador', area: 'Parte delantera', document: { date: '2026-01-01' }
    }))
    const page = new JSDOM(readFileSync(resolve('Crash_Solution_Publicacion/index.html'), 'utf8'), {
      url: 'http://localhost:5173/', runScripts: 'dangerously',
      beforeParse(win) {
        win.scrollTo = () => {}
        win.localStorage.setItem('crash_solution_presentation_v1', JSON.stringify({ schema: 4, jobs }))
      }
    })
    const doc = page.window.document
    expect(doc.querySelectorAll('.job-card')).toHaveLength(60)
    expect(page.window.store.jobs).toHaveLength(150)
    doc.querySelector('.list-load-more').click()
    expect(doc.querySelectorAll('.job-card')).toHaveLength(120)
    doc.getElementById('jobSearch').value = 'TEST149'
    page.window.renderJobs()
    expect(doc.querySelectorAll('.job-card')).toHaveLength(1)
    expect(doc.querySelector('.job-card').textContent).toContain('Cliente 149')
    doc.getElementById('jobSearch').value = ''
    page.window.jobDisplayLimit = 120
    page.window.renderJobs()
    expect(doc.querySelectorAll('.job-card')).toHaveLength(120)
    expect(page.window.store.jobs).toHaveLength(150)
    page.window.close()
  })
})
