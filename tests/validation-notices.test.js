import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const html = readFileSync('Crash_Solution_Publicacion/index.html', 'utf8')
let page
afterEach(() => page?.window.close())

describe.each([390, 1440])('Validación del formulario real (viewport %ipx)', width => {
  function mount() {
    page = new JSDOM(html, {
      url: 'http://localhost:5173/', runScripts: 'dangerously',
      beforeParse(win) { win.scrollTo = () => {}; win.innerWidth = width }
    })
    page.window.newJob()
    return page.window
  }
  function input(win, field, value) {
    const element = win.document.querySelector(`[data-rec="${field}"]`)
    element.value = value
    element.dispatchEvent(new win.Event('input', { bubbles: true }))
  }

  it('bloquea los pasos 2 y 3, conserva lo cargado y limpia al completar cliente y patente', () => {
    const win = mount()
    input(win, 'marca', 'Ford')
    for (const step of ['inspection', 'budget']) {
      win.showStep(step)
      expect(win.step).toBe('reception')
      expect(win.document.getElementById('notice').hidden).toBe(false)
      expect(win.document.getElementById('notice').dataset.validation).toBe('reception')
    }
    input(win, 'cliente', 'Ana Pérez')
    expect(win.document.getElementById('notice').hidden).toBe(false)
    input(win, 'patente', 'ab123cd')
    const notice = win.document.getElementById('notice')
    expect(notice.hidden).toBe(true)
    expect(notice.textContent).toBe('')
    expect(notice.dataset.validation).toBeUndefined()
    win.showStep('inspection')
    expect(win.step).toBe('inspection')
    expect(win.active.rec).toMatchObject({ cliente: 'Ana Pérez', patente: 'AB123CD', marca: 'Ford' })
    const saved = JSON.parse(win.localStorage.getItem('crash_solution_presentation_v1'))
    expect(saved.jobs.find(job => job.id === win.active.id).rec.marca).toBe('Ford')
  })

  it('no restaura mensajes al volver a abrir el borrador ni los acumula', () => {
    const win = mount()
    input(win, 'marca', 'Ford')
    win.showStep('inspection')
    win.showStep('budget')
    const notice = win.document.getElementById('notice')
    expect(notice.textContent.match(/Completá/g)).toHaveLength(1)
    const job = win.active
    win.showJobs()
    expect(notice.hidden).toBe(true)
    expect(notice.textContent).toBe('')
    win.openJob(job.id, 'reception')
    expect(notice.hidden).toBe(true)
    expect(win.active).toBe(job)
    expect(win.active.rec.marca).toBe('Ford')
    win.showStep('inspection')
    expect(notice.hidden).toBe(false)
    expect(win.step).toBe('reception')
  })

  it('limpia también la validación de presupuesto al corregir descripción y cantidad', () => {
    const win = mount()
    input(win, 'cliente', 'Ana Pérez'); input(win, 'patente', 'TEST123')
    win.showStep('budget')
    win.active.quote = [{ description: '', qty: 0, price: 100 }]
    win.renderBudget()
    expect(win.quoteValid()).toBe(false)
    const notice = win.document.getElementById('notice')
    expect(notice.dataset.validation).toBe('budget')
    for (const [field, value] of [['description', 'Reparación'], ['qty', '2']]) {
      const element = win.document.querySelector(`[data-line="0"][data-field="${field}"]`)
      element.value = value
      element.dispatchEvent(new win.Event('input'))
    }
    expect(notice.hidden).toBe(true)
    expect(win.quoteValid()).toBe(true)
    expect(win.active.quote[0]).toMatchObject({ description: 'Reparación', qty: 2, price: 100 })
  })

  it('completar datos no elimina un aviso de fallo de guardado', () => {
    const win = mount()
    win.showStep('inspection')
    win.notify('No hay espacio para guardar en este dispositivo.')
    input(win, 'cliente', 'Ana Pérez'); input(win, 'patente', 'TEST123')
    expect(win.document.getElementById('notice').hidden).toBe(false)
    expect(win.document.getElementById('notice').textContent).toContain('No hay espacio')
  })

  it('recarga el borrador incompleto sin persistir una alerta antigua', () => {
    const win = mount()
    input(win, 'marca', 'Ford')
    win.showStep('inspection')
    const id = win.active.id
    const saved = win.localStorage.getItem('crash_solution_presentation_v1')
    const reloaded = new JSDOM(html, {
      url: 'http://localhost:5173/', runScripts: 'dangerously',
      beforeParse(next) {
        next.scrollTo = () => {}
        next.innerWidth = width
        next.localStorage.setItem('crash_solution_presentation_v1', saved)
      }
    })
    try {
      reloaded.window.openJob(id, 'reception')
      expect(reloaded.window.active.rec.marca).toBe('Ford')
      expect(reloaded.window.document.getElementById('notice').hidden).toBe(true)
      reloaded.window.showStep('budget')
      expect(reloaded.window.step).toBe('reception')
      expect(reloaded.window.document.getElementById('notice').hidden).toBe(false)
    } finally { reloaded.window.close() }
  })
})
