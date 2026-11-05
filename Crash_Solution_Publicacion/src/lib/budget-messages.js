import { formatCuit } from './workshop-profile.js'

const toSafeNumber = v => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0)
const toBounded = (v, min, max) => Math.min(max, Math.max(min, toSafeNumber(v)))

export function formatArsCurrency(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2
  })
    .format(toSafeNumber(value))
    .replace(/[\u00A0\u202F]/g, ' ')
}

export function getVehicleYear(rec = {}) {
  if (!rec || typeof rec !== 'object') return ''
  const raw = rec.anio ?? rec['año'] ?? rec.year ?? ''
  return String(raw).trim()
}

export function formatIsoDateAr(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) return 'Sin fecha'
  return String(isoDate).split('-').reverse().join('/')
}

export function computeExpiryIsoDate(doc = {}) {
  const rawDate = doc?.date || new Date().toISOString().slice(0, 10)
  const dt = new Date(`${rawDate}T12:00:00Z`)
  if (!Number.isFinite(dt.getTime())) return ''
  dt.setUTCDate(dt.getUTCDate() + toBounded(doc?.validDays ?? 15, 1, 365))
  return dt.toISOString().slice(0, 10)
}

/**
 * Mantiene exactamente la misma fórmula de cálculo de presupuestos que `totals(j)` en index.html
 */
export function computeBudgetTotals(job = {}) {
  const quoteLines = Array.isArray(job?.quote) ? job.quote : []
  const subtotal = quoteLines.reduce(
    (sum, line) => sum + toSafeNumber(line?.qty) * toSafeNumber(line?.price),
    0
  )
  const discountPct = toBounded(job?.discount, 0, 100)
  const taxPct = toBounded(job?.tax, 0, 100)
  const discount = (subtotal * discountPct) / 100
  const net = subtotal - discount
  const tax = (net * taxPct) / 100
  return {
    subtotal,
    discount,
    discountPct,
    net,
    tax,
    taxPct,
    total: net + tax
  }
}

export function validateBudgetForDelivery(job) {
  if (!job || typeof job !== 'object') {
    return { valid: false, error: 'No hay un trabajo activo seleccionado.' }
  }
  const cliente = String(job?.rec?.cliente || '').trim()
  const patente = String(job?.rec?.patente || '').trim()
  if (!cliente || !patente) {
    return { valid: false, error: 'Completá el nombre del cliente y la patente antes de compartir el presupuesto.' }
  }
  const quoteLines = Array.isArray(job?.quote) ? job.quote : []
  if (!quoteLines.length || quoteLines.some(q => !String(q?.description || '').trim() || !toSafeNumber(q?.qty))) {
    return {
      valid: false,
      error: 'Agregá al menos un trabajo o repuesto y completá su descripción y cantidad.'
    }
  }
  return { valid: true }
}

/**
 * Normaliza un número telefónico para enlaces wa.me (formato internacional sin + ni símbolos).
 * Si recibe un número móvil argentino de 10 dígitos (ej. 11 5555 1234), antepone 549.
 */
export function normalizeWhatsappPhone(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D+/g, '')
  if (!digits || digits.length < 8) return ''
  if (digits.startsWith('549') && digits.length >= 12) return digits
  if (digits.startsWith('54') && digits.length === 12) return `549${digits.slice(2)}`
  if (digits.startsWith('0')) {
    const stripped = digits.replace(/^0+/, '')
    if (stripped.length === 10) return `549${stripped}`
    return stripped
  }
  if (digits.length === 10) {
    return `549${digits}`
  }
  return digits
}

export function buildBudgetFilename(job = {}) {
  const cleanPlate = String(job?.rec?.patente || 'VEHICULO')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_')
  const datePart = /^\d{4}-\d{2}-\d{2}$/.test(job?.document?.date || '')
    ? job.document.date
    : new Date().toISOString().slice(0, 10)
  return `Presupuesto_${cleanPlate}_${datePart}.pdf`
}

/**
 * Construye el mensaje profesional de texto para WhatsApp (Opción A)
 * sin exponer enlaces públicos a presupuestos privados.
 */
export function buildBudgetWhatsappMessage(job = {}, shop = {}) {
  const shopName = String(shop?.name || 'Crash Solution').trim()
  const legalName = String(shop?.legal_name || '').trim()
  const cuit = shop?.tax_id ? formatCuit(shop.tax_id) : ''
  const contactParts = [
    shop?.phone ? `Tel: ${String(shop.phone).trim()}` : '',
    shop?.whatsapp ? `WhatsApp: ${String(shop.whatsapp).trim()}` : '',
    shop?.address ? String(shop.address).trim() : '',
    shop?.email ? String(shop.email).trim() : ''
  ].filter(Boolean)

  const quoteRef = String(job?.number || '').startsWith('LOCAL-')
    ? `Ref. ${String(job?.id || '').slice(0, 8).toUpperCase()}`
    : String(job?.number || 'S/N').trim()

  const yearStr = getVehicleYear(job?.rec)
  const plateStr = String(job?.rec?.patente || '').trim().toUpperCase()
  const makeModelStr = [job?.rec?.marca, job?.rec?.modelo]
    .map(v => String(v || '').trim())
    .filter(Boolean)
    .join(' ')

  const vehicleLabel = [
    makeModelStr,
    yearStr,
    plateStr ? `(${plateStr})` : ''
  ]
    .filter(Boolean)
    .join(' ')

  const t = computeBudgetTotals(job)
  const doc = job?.document || {}
  const issueDate = formatIsoDateAr(doc.date)
  const validUntil = formatIsoDateAr(computeExpiryIsoDate(doc))

  const linesText = (job?.quote || [])
    .map(q => {
      const qty = toSafeNumber(q.qty)
      const unitPrice = toSafeNumber(q.price)
      const lineTotal = qty * unitPrice
      const desc = String(q.description || '').replace(/\s+/g, ' ').trim()
      const qtyLabel = qty !== 1 ? ` (${qty} x ${formatArsCurrency(unitPrice)})` : ''
      return `- ${desc}${qtyLabel}: ${formatArsCurrency(lineTotal)}`
    })
    .join('\n')

  const headerLines = [`*${shopName} - Presupuesto ${quoteRef}*`]
  if (legalName || cuit) {
    headerLines.push([legalName, cuit ? `CUIT ${cuit}` : ''].filter(Boolean).join(' | '))
  }
  if (contactParts.length) {
    headerLines.push(contactParts.join(' | '))
  }

  const clientBlock = [
    `*Cliente:* ${String(job?.rec?.cliente || 'Sin especificar').replace(/\s+/g, ' ').trim()}`,
    `*Vehículo:* ${vehicleLabel || 'Sin especificar'}`,
    yearStr ? `*Año:* ${yearStr}` : '',
    plateStr ? `*Patente:* ${plateStr}` : '',
    job?.rec?.km ? `*Kilometraje:* ${String(job.rec.km).trim()} km` : ''
  ].filter(Boolean)

  const sections = [
    headerLines.join('\n'),
    clientBlock.join('\n'),
    `*Detalle de trabajos y repuestos:*\n${linesText}`
  ]

  const totalsLines = []
  if (t.discount > 0 || t.tax > 0) {
    totalsLines.push(`Subtotal: ${formatArsCurrency(t.subtotal)}`)
  }
  if (t.discount > 0) {
    totalsLines.push(`Descuento (${t.discountPct}%): - ${formatArsCurrency(t.discount)}`)
  }
  if (t.tax > 0) {
    totalsLines.push(`Impuestos (${t.taxPct}%): + ${formatArsCurrency(t.tax)}`)
  }
  totalsLines.push(`*TOTAL PRESUPUESTADO: ${formatArsCurrency(t.total)}*`)
  sections.push(totalsLines.join('\n'))

  const metaLines = [`Fecha: ${issueDate} | Válido hasta: ${validUntil}`]
  if (doc.terms && String(doc.terms).trim()) {
    const cleanTerms = String(doc.terms)
      .split(/\r?\n/)
      .map(line => line.replace(/[\t\u00A0\u202F]+/g, ' ').replace(/ {2,}/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
    metaLines.push(`*Observaciones / Condiciones:*\n${cleanTerms}`)
  }
  metaLines.push('_Presupuesto estimativo sujeto al alcance indicado. No válido como factura._')
  sections.push(metaLines.join('\n'))

  return sections
    .join('\n\n')
    .replace(/[\t\u00A0\u202F]+/g, ' ')
    .replace(/\uFFFD/g, '')
    .normalize('NFC')
}

export function buildWhatsappShareUrl(job = {}, shop = {}) {
  const text = buildBudgetWhatsappMessage(job, shop)
  const phone = normalizeWhatsappPhone(job?.rec?.telefono)
  const baseUrl = phone ? `https://wa.me/${phone}` : 'https://wa.me/'
  return `${baseUrl}?text=${encodeURIComponent(text)}`
}

/**
 * Abre WhatsApp con el mensaje preparado.
 * NUNCA afirma que el mensaje ya fue enviado si solamente se abrió WhatsApp.
 */
export function openWhatsappWithBudgetText(job = {}, shop = {}, windowObj = globalThis.window) {
  const check = validateBudgetForDelivery(job)
  if (!check.valid) {
    throw new Error(check.error)
  }
  const url = buildWhatsappShareUrl(job, shop)
  if (windowObj?.open) {
    windowObj.open(url, '_blank', 'noopener,noreferrer')
  }
  return {
    opened: true,
    sentConfirmed: false,
    url,
    userMessage: 'Se abrió WhatsApp con el presupuesto preparado. Confirmá el envío desde la aplicación.'
  }
}
