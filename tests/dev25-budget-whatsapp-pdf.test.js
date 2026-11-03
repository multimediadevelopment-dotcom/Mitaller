import { describe, it, expect, vi } from 'vitest'
import {
  computeBudgetTotals,
  validateBudgetForDelivery,
  normalizeWhatsappPhone,
  buildBudgetFilename,
  buildBudgetWhatsappMessage,
  buildWhatsappShareUrl,
  openWhatsappWithBudgetText,
  generateBudgetPdfBytes,
  generateBudgetPdfBlob,
  generateBudgetPdfFile,
  shareBudgetPdf
} from '../Crash_Solution_Publicacion/src/lib/budget-delivery.js'

const SAMPLE_SHOP = {
  id: 'ws-demo-01',
  name: 'Crash Solution',
  legal_name: 'Crash Solution S.R.L.',
  tax_id: '30-71234567-9',
  phone: '011 4555-1234',
  whatsapp: '+54 9 11 5555-1234',
  email: 'presupuestos@crashsolution.com.ar',
  address: 'Av. Warnes 1234, CABA',
  // 1x1 PNG transparente en base64 para probar incrustación real de logo en el PDF
  logo_url:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
}

const SAMPLE_JOB = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  number: 'OT-00142',
  status: 'Enviado',
  rec: {
    cliente: 'Martín Gómez',
    telefono: '11 5555 1002',
    patente: 'AE 456 FG',
    marca: 'Fiat',
    modelo: 'Cronos',
    anio: '2021',
    km: '51000',
    localidad: 'CABA',
    direccion: 'Av. Corrientes 4500',
    motivo: 'Rayón y abolladura en puerta trasera'
  },
  quote: [
    {
      id: 'q1',
      description: 'Guardabarros derecho · Pintura bicapa',
      qty: 1,
      price: 95000
    },
    {
      id: 'q2',
      description: 'Puerta trasera izquierda · Chapa y pintura',
      qty: 2,
      price: 70000
    }
  ],
  discount: 10,
  tax: 21,
  document: {
    date: '2026-10-10',
    validDays: 15,
    terms: 'Plazo de entrega: 5 días hábiles. Forma de pago: 50% de anticipo.'
  }
}

describe('DEV-25 — Envío profesional de presupuestos por WhatsApp y PDF', () => {
  it('mantiene exactamente los cálculos actuales de subtotal, descuento, impuesto y total', () => {
    const t = computeBudgetTotals(SAMPLE_JOB)
    // Subtotal = (1 * 95000) + (2 * 70000) = 235000
    expect(t.subtotal).toBe(235000)
    // Descuento 10% = 23500
    expect(t.discount).toBe(23500)
    // Neto = 211500
    expect(t.net).toBe(211500)
    // IVA 21% sobre neto = 44415
    expect(t.tax).toBe(44415)
    // Total = 255915
    expect(t.total).toBe(255915)
  })

  it('valida los datos obligatorios antes de emitir o compartir el presupuesto', () => {
    expect(validateBudgetForDelivery(null).valid).toBe(false)
    expect(
      validateBudgetForDelivery({
        ...SAMPLE_JOB,
        rec: { ...SAMPLE_JOB.rec, cliente: '' }
      }).valid
    ).toBe(false)
    expect(
      validateBudgetForDelivery({
        ...SAMPLE_JOB,
        quote: []
      }).valid
    ).toBe(false)
    expect(validateBudgetForDelivery(SAMPLE_JOB).valid).toBe(true)
  })

  it('normaliza números telefónicos y construye el mensaje de WhatsApp con datos del taller, CUIT, cliente, vehículo, trabajos y total sin enlaces públicos', () => {
    expect(normalizeWhatsappPhone('11 5555-1002')).toBe('5491155551002')
    expect(normalizeWhatsappPhone('011 5555 1002')).toBe('5491155551002')
    expect(normalizeWhatsappPhone('+54 9 11 5555-1002')).toBe('5491155551002')
    expect(normalizeWhatsappPhone('')).toBe('')

    const message = buildBudgetWhatsappMessage(SAMPLE_JOB, SAMPLE_SHOP)
    expect(message).toContain('Crash Solution')
    expect(message).toContain('Crash Solution S.R.L.')
    expect(message).toContain('CUIT 30-71234567-9')
    expect(message).toContain('Av. Warnes 1234, CABA')
    expect(message).toContain('Martín Gómez')
    expect(message).toContain('Fiat Cronos 2021 (AE 456 FG)')
    expect(message).toContain('Guardabarros derecho · Pintura bicapa')
    expect(message).toContain('Puerta trasera izquierda · Chapa y pintura')
    expect(message).toContain('TOTAL PRESUPUESTADO:')
    expect(message).toContain('255.915')
    expect(message).toContain('Plazo de entrega: 5 días hábiles.')
    // Verifica que NO exponga presupuestos privados mediante enlaces públicos http/https
    expect(message).not.toMatch(/https?:\/\//i)

    const url = buildWhatsappShareUrl(SAMPLE_JOB, SAMPLE_SHOP)
    expect(url.startsWith('https://wa.me/5491155551002?text=')).toBe(true)
  })

  it('no afirma que el mensaje fue enviado cuando solamente se abrió WhatsApp', () => {
    const fakeWindow = { open: vi.fn() }
    const res = openWhatsappWithBudgetText(SAMPLE_JOB, SAMPLE_SHOP, fakeWindow)

    expect(fakeWindow.open).toHaveBeenCalledTimes(1)
    expect(res.opened).toBe(true)
    expect(res.sentConfirmed).toBe(false)
    expect(res.userMessage).toContain('Se abrió WhatsApp')
    expect(res.userMessage).toContain('Confirmá el envío')
    expect(res.userMessage).not.toMatch(/presupuesto enviado exitosamente/i)
  })

  it('genera un archivo PDF real descargable (%PDF-1.x) con logo, CUIT, datos del taller, cliente, vehículo, trabajos y total', () => {
    const pdfBytes = generateBudgetPdfBytes(SAMPLE_JOB, SAMPLE_SHOP)
    expect(pdfBytes).toBeInstanceOf(Uint8Array)
    expect(pdfBytes.byteLength).toBeGreaterThan(1500)

    const asciiHeader = new TextDecoder('latin1').decode(pdfBytes.slice(0, 8))
    expect(asciiHeader.startsWith('%PDF-')).toBe(true)

    const rawPdfText = new TextDecoder('latin1').decode(pdfBytes)
    expect(rawPdfText).toContain('CRASH SOLUTION')
    expect(rawPdfText).toContain('30-71234567-9')
    expect(rawPdfText).toContain('AE 456 FG')
    expect(rawPdfText).toContain('OT-00142')

    const pdfBlob = generateBudgetPdfBlob(SAMPLE_JOB, SAMPLE_SHOP)
    expect(pdfBlob.type).toBe('application/pdf')
    expect(pdfBlob.size).toBe(pdfBytes.byteLength)

    const pdfFile = generateBudgetPdfFile(SAMPLE_JOB, SAMPLE_SHOP)
    expect(pdfFile.name).toBe(buildBudgetFilename(SAMPLE_JOB))
    expect(pdfFile.name).toBe('Presupuesto_AE_456_FG_2026-10-10.pdf')
    expect(pdfFile.type).toBe('application/pdf')
  })

  it('permite compartir el archivo PDF mediante Web Share API en dispositivos compatibles o aplica fallback en escritorio', async () => {
    // 1. Dispositivo móvil / navegador compatible con Web Share API para archivos
    const mockShare = vi.fn().mockResolvedValue(undefined)
    const mockNavigatorMobile = {
      canShare: vi.fn().mockReturnValue(true),
      share: mockShare
    }

    const mobileResult = await shareBudgetPdf(SAMPLE_JOB, SAMPLE_SHOP, {
      navigatorObj: mockNavigatorMobile,
      windowObj: { open: vi.fn() },
      documentObj: {}
    })

    expect(mockNavigatorMobile.canShare).toHaveBeenCalledTimes(1)
    expect(mockShare).toHaveBeenCalledTimes(1)
    const sharedPayload = mockShare.mock.calls[0][0]
    expect(sharedPayload.files).toHaveLength(1)
    expect(sharedPayload.files[0].name).toBe('Presupuesto_AE_456_FG_2026-10-10.pdf')
    expect(mobileResult.mode).toBe('web-share-file')
    expect(mobileResult.sentConfirmed).toBe(false)

    // 2. Navegador de escritorio sin soporte para navigator.canShare({ files })
    const mockWindowDesktop = { open: vi.fn() }
    const desktopResult = await shareBudgetPdf(SAMPLE_JOB, SAMPLE_SHOP, {
      navigatorObj: { canShare: () => false },
      windowObj: mockWindowDesktop,
      documentObj: {}
    })

    expect(desktopResult.mode).toBe('download-and-whatsapp')
    expect(desktopResult.sentConfirmed).toBe(false)
    expect(mockWindowDesktop.open).toHaveBeenCalledTimes(1)
    expect(desktopResult.userMessage).toContain('Adjuntá el PDF descargado y confirmá el envío')
  })
})
