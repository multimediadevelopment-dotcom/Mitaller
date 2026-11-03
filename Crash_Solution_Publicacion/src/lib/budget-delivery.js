import { jsPDF } from 'jspdf'
import { formatCuit } from './workshop-profile.js'

const toSafeNumber = v => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0)
const toBounded = (v, min, max) => Math.min(max, Math.max(min, toSafeNumber(v)))

export function formatArsCurrency(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2
  }).format(toSafeNumber(value))
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
    shop?.phone ? `Tel: ${shop.phone}` : '',
    shop?.whatsapp ? `WhatsApp: ${shop.whatsapp}` : '',
    shop?.address || '',
    shop?.email || ''
  ].filter(Boolean)

  const quoteRef = String(job?.number || '').startsWith('LOCAL-')
    ? `Ref. ${String(job?.id || '').slice(0, 8).toUpperCase()}`
    : String(job?.number || 'S/N')

  const vehicleLabel = [
    job?.rec?.marca,
    job?.rec?.modelo,
    job?.rec?.anio,
    job?.rec?.patente ? `(${String(job.rec.patente).toUpperCase()})` : ''
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
      const qtyLabel = qty !== 1 ? ` (${qty} x ${formatArsCurrency(unitPrice)})` : ''
      return `• ${String(q.description || '').trim()}${qtyLabel}: ${formatArsCurrency(lineTotal)}`
    })
    .join('\n')

  const headerLines = [`*${shopName} · Presupuesto ${quoteRef}*`]
  if (legalName || cuit) {
    headerLines.push([legalName, cuit ? `CUIT ${cuit}` : ''].filter(Boolean).join(' · '))
  }
  if (contactParts.length) {
    headerLines.push(contactParts.join(' · '))
  }

  const sections = [
    headerLines.join('\n'),
    `👤 *Cliente:* ${String(job?.rec?.cliente || 'Sin especificar').trim()}\n🚗 *Vehículo:* ${vehicleLabel || 'Sin especificar'}${
      job?.rec?.km ? ` · ${job.rec.km} km` : ''
    }`,
    `*Detalle de trabajos y repuestos:*\n${linesText}`
  ]

  const totalsLines = []
  if (t.discount > 0 || t.tax > 0) {
    totalsLines.push(`Subtotal: ${formatArsCurrency(t.subtotal)}`)
  }
  if (t.discount > 0) {
    totalsLines.push(`Descuento (${t.discountPct}%): − ${formatArsCurrency(t.discount)}`)
  }
  if (t.tax > 0) {
    totalsLines.push(`Impuestos (${t.taxPct}%): + ${formatArsCurrency(t.tax)}`)
  }
  totalsLines.push(`*TOTAL PRESUPUESTADO: ${formatArsCurrency(t.total)}*`)
  sections.push(totalsLines.join('\n'))

  const metaLines = [`📅 Fecha: ${issueDate} · Válido hasta: ${validUntil}`]
  if (doc.terms && String(doc.terms).trim()) {
    metaLines.push(`📋 *Observaciones / Condiciones:*\n${String(doc.terms).trim()}`)
  }
  metaLines.push('_Presupuesto estimativo sujeto al alcance indicado. No válido como factura._')
  sections.push(metaLines.join('\n'))

  return sections.join('\n\n')
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

function detectImageFormatFromDataUrl(dataUrl) {
  const str = String(dataUrl || '')
  if (str.startsWith('data:image/png')) return 'PNG'
  if (str.startsWith('data:image/jpeg') || str.startsWith('data:image/jpg')) return 'JPEG'
  if (str.startsWith('data:image/webp')) return 'WEBP'
  return null
}

/**
 * Genera el documento PDF real (instancia jsPDF) con logo, CUIT, datos del taller,
 * cliente, vehículo, tabla de trabajos/repuestos, totales, vigencia y observaciones.
 */
export function createBudgetJsPdfDocument(job = {}, shop = {}) {
  const check = validateBudgetForDelivery(job)
  if (!check.valid) {
    throw new Error(check.error)
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  })

  const pageWidth = 210
  const pageHeight = 297
  const margin = 15
  const contentWidth = pageWidth - margin * 2
  let y = margin

  const shopName = String(shop?.name || 'Crash Solution').trim()
  const legalName = String(shop?.legal_name || '').trim()
  const cuit = shop?.tax_id ? formatCuit(shop.tax_id) : ''
  const quoteRef = String(job?.number || '').startsWith('LOCAL-')
    ? `Referencia ${String(job?.id || '').slice(0, 8).toUpperCase()}`
    : String(job?.number || 'OT-0001')
  const d = job?.document || {}
  const issueDate = formatIsoDateAr(d.date)
  const validUntil = formatIsoDateAr(computeExpiryIsoDate(d))

  // 1. Encabezado del taller + Logo (si está disponible como Data URL PNG/JPEG/WEBP)
  let textStartX = margin
  const logoFormat = detectImageFormatFromDataUrl(shop?.logo_url)
  if (logoFormat && shop?.logo_url) {
    try {
      doc.addImage(shop.logo_url, logoFormat, margin, y, 22, 22)
      textStartX = margin + 26
    } catch {
      textStartX = margin
    }
  }

  doc.setTextColor(19, 44, 67)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.text(shopName.toUpperCase(), textStartX, y + 6)

  let leftY = y + 11
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(65, 84, 104)

  if (legalName) {
    doc.text(`Razón social: ${legalName}`, textStartX, leftY)
    leftY += 4.5
  }
  if (cuit) {
    doc.setFont('helvetica', 'bold')
    doc.text(`CUIT: ${cuit}`, textStartX, leftY)
    doc.setFont('helvetica', 'normal')
    leftY += 4.5
  }
  if (shop?.address) {
    doc.text(String(shop.address), textStartX, leftY)
    leftY += 4.5
  }
  const phonesLine = [
    shop?.phone ? `Tel: ${shop.phone}` : '',
    shop?.whatsapp ? `WhatsApp: ${shop.whatsapp}` : ''
  ]
    .filter(Boolean)
    .join(' · ')
  if (phonesLine) {
    doc.text(phonesLine, textStartX, leftY)
    leftY += 4.5
  }
  if (shop?.email) {
    doc.text(`Email: ${shop.email}`, textStartX, leftY)
    leftY += 4.5
  }

  // Bloque derecho del encabezado (Metadatos del presupuesto)
  const rightX = pageWidth - margin
  doc.setTextColor(19, 44, 67)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('PRESUPUESTO', rightX, y + 6, { align: 'right' })

  doc.setFontSize(9.5)
  doc.text(quoteRef, rightX, y + 11.5, { align: 'right' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.8)
  doc.setTextColor(85, 102, 120)
  doc.text(`Fecha de emisión: ${issueDate}`, rightX, y + 16.5, { align: 'right' })
  doc.text(`Válido hasta: ${validUntil}`, rightX, y + 21, { align: 'right' })
  if (job?.status) {
    doc.text(`Estado: ${job.status}`, rightX, y + 25.5, { align: 'right' })
  }

  y = Math.max(leftY, y + 28) + 3
  doc.setDrawColor(19, 44, 67)
  doc.setLineWidth(0.7)
  doc.line(margin, y, pageWidth - margin, y)
  y += 6

  // 2. Bloques de Cliente y Vehículo
  const boxHeight = 26
  const colWidth = (contentWidth - 6) / 2

  doc.setFillColor(244, 247, 251)
  doc.setDrawColor(225, 231, 237)
  doc.setLineWidth(0.3)
  doc.roundedRect(margin, y, colWidth, boxHeight, 2, 2, 'FD')
  doc.roundedRect(margin + colWidth + 6, y, colWidth, boxHeight, 2, 2, 'FD')

  // Datos del Cliente
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(113, 130, 149)
  doc.text('CLIENTE', margin + 4, y + 5.5)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(19, 44, 67)
  doc.text(String(job?.rec?.cliente || 'Sin especificar').slice(0, 48), margin + 4, y + 11)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.8)
  doc.setTextColor(65, 84, 104)
  if (job?.rec?.telefono) {
    doc.text(`WhatsApp / Tel: ${job.rec.telefono}`, margin + 4, y + 16)
  }
  const clientAddress = [job?.rec?.direccion, job?.rec?.localidad].filter(Boolean).join(', ')
  if (clientAddress) {
    doc.text(clientAddress.slice(0, 52), margin + 4, y + 21)
  }

  // Datos del Vehículo
  const vehX = margin + colWidth + 10
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(113, 130, 149)
  doc.text('VEHÍCULO', vehX, y + 5.5)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(19, 44, 67)
  const plateText = String(job?.rec?.patente || '').toUpperCase()
  const makeModel = [job?.rec?.marca, job?.rec?.modelo, job?.rec?.anio].filter(Boolean).join(' ')
  doc.text([plateText, makeModel].filter(Boolean).join(' · ').slice(0, 48), vehX, y + 11)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.8)
  doc.setTextColor(65, 84, 104)
  if (job?.rec?.km) {
    doc.text(`Kilometraje: ${job.rec.km} km`, vehX, y + 16)
  }
  if (job?.rec?.motivo) {
    doc.text(`Ingreso: ${String(job.rec.motivo).slice(0, 50)}`, vehX, y + 21)
  }

  y += boxHeight + 7

  // 3. Tabla de Trabajos y Repuestos
  const renderTableHeader = currentY => {
    doc.setFillColor(237, 243, 253)
    doc.setDrawColor(217, 225, 233)
    doc.rect(margin, currentY, contentWidth, 8, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(40, 70, 110)
    doc.text('TRABAJO O REPUESTO', margin + 3, currentY + 5.3)
    doc.text('CANT.', margin + 108, currentY + 5.3, { align: 'right' })
    doc.text('PRECIO UNIT.', margin + 142, currentY + 5.3, { align: 'right' })
    doc.text('IMPORTE', pageWidth - margin - 3, currentY + 5.3, { align: 'right' })
    return currentY + 8
  }

  y = renderTableHeader(y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.2)
  doc.setTextColor(29, 51, 72)

  for (const line of job.quote || []) {
    const descLines = doc.splitTextToSize(String(line.description || ''), 92)
    const rowHeight = Math.max(8, descLines.length * 4.6 + 3.4)

    if (y + rowHeight > pageHeight - 55) {
      doc.addPage()
      y = margin
      y = renderTableHeader(y)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9.2)
      doc.setTextColor(29, 51, 72)
    }

    const qty = toSafeNumber(line.qty)
    const price = toSafeNumber(line.price)
    const lineSubtotal = qty * price

    doc.text(descLines, margin + 3, y + 5.2)
    doc.text(String(qty), margin + 108, y + 5.2, { align: 'right' })
    doc.text(formatArsCurrency(price), margin + 142, y + 5.2, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.text(formatArsCurrency(lineSubtotal), pageWidth - margin - 3, y + 5.2, { align: 'right' })
    doc.setFont('helvetica', 'normal')

    doc.setDrawColor(225, 231, 237)
    doc.setLineWidth(0.2)
    doc.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight)
    y += rowHeight
  }

  y += 5

  // 4. Cuadro de Totales
  const t = computeBudgetTotals(job)
  if (y + 38 > pageHeight - 25) {
    doc.addPage()
    y = margin
  }

  const totalsBoxWidth = 82
  const totalsBoxX = pageWidth - margin - totalsBoxWidth
  let totalsY = y

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(65, 84, 104)
  doc.text('Subtotal:', totalsBoxX, totalsY + 5)
  doc.setFont('helvetica', 'bold')
  doc.text(formatArsCurrency(t.subtotal), pageWidth - margin, totalsY + 5, { align: 'right' })
  totalsY += 6

  if (t.discount > 0) {
    doc.setFont('helvetica', 'normal')
    doc.text(`Descuento (${t.discountPct}%):`, totalsBoxX, totalsY + 5)
    doc.setFont('helvetica', 'bold')
    doc.text(`− ${formatArsCurrency(t.discount)}`, pageWidth - margin, totalsY + 5, { align: 'right' })
    totalsY += 6
  }

  if (t.tax > 0) {
    doc.setFont('helvetica', 'normal')
    doc.text(`Impuestos (${t.taxPct}%):`, totalsBoxX, totalsY + 5)
    doc.setFont('helvetica', 'bold')
    doc.text(formatArsCurrency(t.tax), pageWidth - margin, totalsY + 5, { align: 'right' })
    totalsY += 6
  }

  doc.setDrawColor(19, 44, 67)
  doc.setLineWidth(0.5)
  doc.line(totalsBoxX, totalsY + 2, pageWidth - margin, totalsY + 2)
  totalsY += 8

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12.5)
  doc.setTextColor(19, 44, 67)
  doc.text('TOTAL:', totalsBoxX, totalsY)
  doc.text(formatArsCurrency(t.total), pageWidth - margin, totalsY, { align: 'right' })

  y = totalsY + 8

  // 5. Condiciones y Observaciones
  if (d.terms && String(d.terms).trim()) {
    const termsLines = doc.splitTextToSize(String(d.terms).trim(), contentWidth - 6)
    const termsHeight = termsLines.length * 4.5 + 10
    if (y + termsHeight > pageHeight - 22) {
      doc.addPage()
      y = margin
    }
    doc.setFillColor(250, 251, 253)
    doc.setDrawColor(225, 231, 237)
    doc.roundedRect(margin, y, contentWidth, termsHeight, 2, 2, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(75, 101, 128)
    doc.text('CONDICIONES Y OBSERVACIONES', margin + 3, y + 5.2)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.8)
    doc.setTextColor(45, 65, 85)
    doc.text(termsLines, margin + 3, y + 10)
    y += termsHeight + 5
  }

  // 6. Pie de página institucional
  const footerY = pageHeight - 13
  doc.setDrawColor(225, 231, 237)
  doc.setLineWidth(0.2)
  doc.line(margin, footerY - 4, pageWidth - margin, footerY - 4)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.8)
  doc.setTextColor(113, 130, 149)
  const footerSummary = [
    shopName,
    legalName,
    cuit ? `CUIT ${cuit}` : '',
    shop?.address,
    shop?.phone ? `Tel: ${shop.phone}` : '',
    shop?.whatsapp ? `WhatsApp: ${shop.whatsapp}` : '',
    shop?.email
  ]
    .filter(Boolean)
    .join(' · ')
  doc.text(footerSummary.slice(0, 135), margin, footerY)
  doc.text(
    'Presupuesto estimativo sujeto al alcance indicado. Este documento no es una factura.',
    margin,
    footerY + 4
  )

  return doc
}

export function generateBudgetPdfBytes(job = {}, shop = {}) {
  const doc = createBudgetJsPdfDocument(job, shop)
  const arrayBuffer = doc.output('arraybuffer')
  return new Uint8Array(arrayBuffer)
}

export function generateBudgetPdfBlob(job = {}, shop = {}) {
  const bytes = generateBudgetPdfBytes(job, shop)
  return new Blob([bytes], { type: 'application/pdf' })
}

export function generateBudgetPdfFile(job = {}, shop = {}) {
  const blob = generateBudgetPdfBlob(job, shop)
  const filename = buildBudgetFilename(job)
  return new File([blob], filename, { type: 'application/pdf' })
}

export function downloadBudgetPdf(job = {}, shop = {}, docObj = globalThis.document) {
  const blob = generateBudgetPdfBlob(job, shop)
  const filename = buildBudgetFilename(job)

  if (docObj?.createElement && typeof URL !== 'undefined' && URL.createObjectURL) {
    const url = URL.createObjectURL(blob)
    const anchor = docObj.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.rel = 'noopener'
    docObj.body?.appendChild(anchor)
    anchor.click()
    anchor.remove?.()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
  }

  return {
    downloaded: true,
    filename,
    size: blob.size,
    userMessage: `PDF "${filename}" generado y descargado correctamente.`
  }
}

/**
 * Permite compartir el archivo PDF real mediante Web Share API en dispositivos compatibles
 * (celulares Android/iOS y navegadores de escritorio compatibles).
 * Si el navegador no soporta compartir archivos directamente, descarga el PDF y abre WhatsApp
 * indicando claramente cómo adjuntarlo, sin afirmar jamás que fue enviado automáticamente.
 */
export async function shareBudgetPdf(
  job = {},
  shop = {},
  { navigatorObj = globalThis.navigator, windowObj = globalThis.window, documentObj = globalThis.document } = {}
) {
  const pdfFile = generateBudgetPdfFile(job, shop)
  const shopName = String(shop?.name || 'Crash Solution').trim()
  const plate = String(job?.rec?.patente || '').toUpperCase()
  const shareTitle = `Presupuesto ${plate} · ${shopName}`
  const shareText = `Presupuesto ${plate} preparado por ${shopName}.`

  if (
    navigatorObj &&
    typeof navigatorObj.canShare === 'function' &&
    typeof navigatorObj.share === 'function'
  ) {
    try {
      const canShareFiles = navigatorObj.canShare({ files: [pdfFile] })
      if (canShareFiles) {
        await navigatorObj.share({
          files: [pdfFile],
          title: shareTitle,
          text: shareText
        })
        return {
          mode: 'web-share-file',
          filename: pdfFile.name,
          sentConfirmed: false,
          userMessage: `Menú de compartir completado para "${pdfFile.name}". Verificá la entrega en la aplicación elegida.`
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        return {
          mode: 'cancelled',
          filename: pdfFile.name,
          sentConfirmed: false,
          userMessage: 'Se canceló el menú para compartir el PDF.'
        }
      }
    }
  }

  // Fallback para escritorio o navegadores sin soporte de Web Share API para archivos:
  // descarga el PDF real y abre WhatsApp con el resumen preparado para que el taller adjunte el archivo descargado.
  downloadBudgetPdf(job, shop, documentObj)
  const waUrl = buildWhatsappShareUrl(job, shop)
  if (windowObj?.open) {
    windowObj.open(waUrl, '_blank', 'noopener,noreferrer')
  }

  return {
    mode: 'download-and-whatsapp',
    filename: pdfFile.name,
    sentConfirmed: false,
    url: waUrl,
    userMessage: `Se descargó "${pdfFile.name}" y se abrió WhatsApp. Adjuntá el PDF descargado y confirmá el envío en WhatsApp.`
  }
}
