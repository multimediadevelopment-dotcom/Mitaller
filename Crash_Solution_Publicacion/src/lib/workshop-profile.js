import { supabase } from './supabase.js'
import { validateEmail } from './auth.js'

const LOGO_BUCKET = 'workshop-logos'
const MAX_LOGO_BYTES = 2 * 1024 * 1024 // 2 MB
const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']

const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export function formatCuit(rawCuit) {
  const digits = String(rawCuit || '').replace(/\D/g, '')
  if (digits.length !== 11) return String(rawCuit || '').trim()
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
}

export function validateCuit(rawCuit) {
  const clean = String(rawCuit || '').trim()
  if (!clean) return { valid: true, formatted: '', value: '' }

  const digits = clean.replace(/[-\s.]/g, '')
  if (!/^\d{11}$/.test(digits)) {
    return {
      valid: false,
      error: 'El CUIT debe contener 11 dígitos numéricos (ej. 30-71234567-9).'
    }
  }

  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  let sum = 0
  for (let i = 0; i < 10; i++) {
    sum += Number(digits[i]) * weights[i]
  }
  let mod = 11 - (sum % 11)
  if (mod === 11) mod = 0
  else if (mod === 10) mod = 9

  const checkDigit = Number(digits[10])
  if (mod !== checkDigit) {
    return {
      valid: false,
      error: 'El CUIT ingresado no supera la validación de dígito verificador.'
    }
  }

  const formatted = `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
  return { valid: true, formatted, value: formatted }
}

export function validatePhoneField(rawPhone, label = 'teléfono') {
  const clean = String(rawPhone || '').trim()
  if (!clean) return { valid: true, value: '' }
  if (!/^[+\d\s()-]{6,30}$/.test(clean) || clean.replace(/\D/g, '').length < 6) {
    return {
      valid: false,
      error: `El ${label} debe tener al menos 6 dígitos válidos.`
    }
  }
  return { valid: true, value: clean }
}

export function validateWorkshopProfileForm(input = {}) {
  const name = String(input.name || '').trim()
  if (!name || name.length < 2) {
    return { valid: false, error: 'El nombre comercial del taller es obligatorio (mínimo 2 caracteres).' }
  }
  if (name.length > 80) {
    return { valid: false, error: 'El nombre comercial no puede superar los 80 caracteres.' }
  }

  const legal_name = String(input.legal_name || '').trim()
  if (legal_name.length > 120) {
    return { valid: false, error: 'La razón social no puede superar los 120 caracteres.' }
  }

  const cuitCheck = validateCuit(input.tax_id)
  if (!cuitCheck.valid) return cuitCheck

  const phoneCheck = validatePhoneField(input.phone, 'teléfono')
  if (!phoneCheck.valid) return phoneCheck

  const whatsappCheck = validatePhoneField(input.whatsapp, 'WhatsApp')
  if (!whatsappCheck.valid) return whatsappCheck

  const rawEmail = String(input.email || '').trim()
  let email = ''
  if (rawEmail) {
    const emailCheck = validateEmail(rawEmail)
    if (!emailCheck.valid) return emailCheck
    email = emailCheck.value
  }

  const address = String(input.address || '').trim()
  if (address.length > 160) {
    return { valid: false, error: 'La dirección no puede superar los 160 caracteres.' }
  }

  return {
    valid: true,
    values: {
      name,
      legal_name: legal_name || null,
      tax_id: cuitCheck.formatted || null,
      phone: phoneCheck.value || null,
      whatsapp: whatsappCheck.value || null,
      email: email || null,
      address: address || null
    }
  }
}

export function validateLogoFile(file) {
  if (!file) return { valid: false, error: 'Seleccioná una imagen para el logo.' }
  if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: 'Formato de imagen no válido. El bucket workshop-logos solo admite PNG, JPEG o WEBP.'
    }
  }
  if (file.size > MAX_LOGO_BYTES) {
    return {
      valid: false,
      error: 'El logo supera el tamaño máximo permitido de 2 MB.'
    }
  }
  return { valid: true }
}

export function formatBudgetContactSummary(shop = {}) {
  const parts = []
  if (shop.address) parts.push(`Dirección: ${shop.address}`)
  if (shop.phone) parts.push(`Tel: ${shop.phone}`)
  if (shop.whatsapp) parts.push(`WhatsApp: ${shop.whatsapp}`)
  if (shop.email) parts.push(`Email: ${shop.email}`)
  return parts.join(' · ')
}

export function buildBudgetShopSnapshot(shop = {}) {
  return {
    id: shop.id || null,
    name: shop.name || 'Crash Solution',
    legal_name: shop.legal_name || '',
    tax_id: shop.tax_id || '',
    logo_path: shop.logo_path || '',
    logo_url: shop.logo_url || '',
    phone: shop.phone || '',
    whatsapp: shop.whatsapp || '',
    email: shop.email || '',
    address: shop.address || '',
    budget_contact: formatBudgetContactSummary(shop)
  }
}

export function buildBudgetWorkshopHeaderHtml(shop = {}, quoteRefOrMeta = '', dateStr = '', validUntilStr = '') {
  const name = esc(shop.name || 'Crash Solution')
  const legal = shop.legal_name ? `<div>Razón social: <b>${esc(shop.legal_name)}</b></div>` : ''
  const cuit = shop.tax_id ? `<div>CUIT: <b>${esc(shop.tax_id)}</b></div>` : ''
  const address = shop.address ? `<div>${esc(shop.address)}</div>` : ''
  const phoneLine = [
    shop.phone ? `Tel: ${esc(shop.phone)}` : '',
    shop.whatsapp ? `WhatsApp: ${esc(shop.whatsapp)}` : ''
  ]
    .filter(Boolean)
    .join(' · ')
  const email = shop.email ? `<div>Email: ${esc(shop.email)}</div>` : ''
  const logoImg = shop.logo_url
    ? `<img src="${esc(shop.logo_url)}" alt="Logo ${name}" style="max-height:64px;max-width:140px;object-fit:contain;border-radius:8px;margin-bottom:6px;display:block">`
    : ''

  const metaHtml =
    dateStr || validUntilStr
      ? `<b>PRESUPUESTO</b><p>${esc(quoteRefOrMeta)}</p><p>Fecha: ${esc(dateStr)}${
          validUntilStr ? `<br>Válido hasta: ${esc(validUntilStr)}` : ''
        }</p>`
      : quoteRefOrMeta

  return `<header class="pdf-header">
    <div style="display:flex;gap:16px;align-items:flex-start">
      ${logoImg ? `<div>${logoImg}</div>` : ''}
      <div>
        <h1 style="margin:0 0 4px">${name}</h1>
        ${legal}
        ${cuit}
        ${address}
        ${phoneLine ? `<div>${phoneLine}</div>` : ''}
        ${email}
      </div>
    </div>
    <div class="pdf-meta">${metaHtml}</div>
  </header>`
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(blob)
  })
}

export async function resolveWorkshopLogoUrl(logoPath) {
  if (!supabase || !logoPath) return ''
  try {
    const { data: blob, error: dlErr } = await supabase.storage.from(LOGO_BUCKET).download(logoPath)
    if (!dlErr && blob) {
      return await blobToDataUrl(blob)
    }
    const { data: signed, error: signErr } = await supabase.storage
      .from(LOGO_BUCKET)
      .createSignedUrl(logoPath, 3600)
    if (!signErr && signed?.signedUrl) {
      return signed.signedUrl
    }
  } catch {
    // Ignorar fallo de red al resolver logo
  }
  return ''
}

export async function fetchWorkshopProfile(workshopId) {
  if (!supabase || !workshopId) return null
  const { data, error } = await supabase
    .from('workshops')
    .select('id, name, legal_name, tax_id, logo_path, phone, whatsapp, email, address, created_by, created_at')
    .eq('id', workshopId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const logo_url = data.logo_path ? await resolveWorkshopLogoUrl(data.logo_path) : ''
  return {
    ...data,
    logo_url
  }
}

export async function updateWorkshopProfile(workshopId, input) {
  if (!supabase || !workshopId) {
    throw new Error('Seleccioná un taller activo para guardar su perfil.')
  }
  const check = validateWorkshopProfileForm(input)
  if (!check.valid) {
    throw new Error(check.error)
  }

  const payload = { ...check.values }
  if ('logo_path' in (input || {})) {
    payload.logo_path = input.logo_path || null
  }

  const { data, error } = await supabase
    .from('workshops')
    .update(payload)
    .eq('id', workshopId)
    .select('id, name, legal_name, tax_id, logo_path, phone, whatsapp, email, address, created_by, created_at')
    .single()

  if (error) throw error
  const logo_url = data.logo_path ? await resolveWorkshopLogoUrl(data.logo_path) : ''
  return { ...data, logo_url }
}

export async function uploadWorkshopLogo(workshopId, file) {
  if (!supabase || !workshopId) {
    throw new Error('Seleccioná un taller activo antes de subir el logo.')
  }
  const check = validateLogoFile(file)
  if (!check.valid) {
    throw new Error(check.error)
  }

  const ext = (file.name?.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const storagePath = `${workshopId}/logo.${ext}`

  const { error: uploadErr } = await supabase.storage.from(LOGO_BUCKET).upload(storagePath, file, {
    upsert: true,
    contentType: file.type
  })

  if (uploadErr) throw uploadErr

  const { data: updated, error: dbErr } = await supabase
    .from('workshops')
    .update({ logo_path: storagePath })
    .eq('id', workshopId)
    .select('id, name, legal_name, tax_id, logo_path, phone, whatsapp, email, address, created_by, created_at')
    .single()

  if (dbErr) throw dbErr

  const dataUrl = await blobToDataUrl(file).catch(() => '')
  const logo_url = dataUrl || (await resolveWorkshopLogoUrl(storagePath))

  return {
    ...updated,
    logo_url
  }
}
