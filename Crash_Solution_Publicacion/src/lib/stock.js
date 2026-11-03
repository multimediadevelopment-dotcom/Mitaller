import { supabase } from './supabase.js'

export const STOCK_CATEGORIES = ['Pinturas', 'Materiales', 'Insumos', 'Repuestos', 'Otros']

export const STOCK_UNITS = ['un.', 'lt', 'ml', 'kg', 'gr', 'mt', 'par', 'kit', 'caja']

export const PART_POSITIONS = [
  '',
  'Delantero derecho',
  'Delantero izquierdo',
  'Trasero derecho',
  'Trasero izquierdo',
  'Delantero',
  'Trasero',
  'Derecho',
  'Izquierdo',
  'Ambos lados',
  'Interior / Motor'
]

const normalizeText = s =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()

export function isLowStock(item) {
  if (!item || item.archived_at) return false
  const qty = Number(item.quantity ?? 0)
  const min = Number(item.minimum_quantity ?? 0)
  return Number.isFinite(qty) && Number.isFinite(min) && qty <= min
}

export function validateStockItemInput(input = {}) {
  const name = String(input.name || '').trim()
  if (!name || name.length < 2) {
    return { valid: false, error: 'El nombre del producto es obligatorio (mínimo 2 caracteres).' }
  }
  if (name.length > 120) {
    return { valid: false, error: 'El nombre del producto no puede superar los 120 caracteres.' }
  }

  const category = String(input.category || 'Materiales').trim()
  if (!STOCK_CATEGORIES.includes(category)) {
    return { valid: false, error: `Categoría inválida. Usá una de: ${STOCK_CATEGORIES.join(', ')}.` }
  }

  const brand = String(input.brand || '').trim()
  const sku = String(input.sku || '').trim().toUpperCase()
  const description = String(input.description || '').trim()
  const unit = String(input.unit || 'un.').trim() || 'un.'
  const location = String(input.location || '').trim()
  const notes = String(input.notes || '').trim()

  const purchasePrice = Number(input.purchase_price ?? 0)
  if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
    return { valid: false, error: 'El precio de compra debe ser un número mayor o igual a 0.' }
  }

  const salePrice = Number(input.sale_price ?? 0)
  if (!Number.isFinite(salePrice) || salePrice < 0) {
    return { valid: false, error: 'El precio de venta debe ser un número mayor o igual a 0.' }
  }

  const minimumQuantity = Number(input.minimum_quantity ?? 0)
  if (!Number.isFinite(minimumQuantity) || minimumQuantity < 0) {
    return { valid: false, error: 'El stock mínimo debe ser un número mayor o igual a 0.' }
  }

  const initialQuantity = input.initial_quantity !== undefined && input.initial_quantity !== '' ? Number(input.initial_quantity) : 0
  if (!Number.isFinite(initialQuantity) || initialQuantity < 0) {
    return { valid: false, error: 'La cantidad inicial debe ser un número mayor o igual a 0.' }
  }

  return {
    valid: true,
    values: {
      name,
      category,
      brand: brand || null,
      sku: sku || null,
      description: description || null,
      unit,
      location: location || null,
      purchase_price: Math.round(purchasePrice * 100) / 100,
      sale_price: Math.round(salePrice * 100) / 100,
      minimum_quantity: Math.round(minimumQuantity * 100) / 100,
      notes: notes || null
    },
    initialQuantity: Math.round(initialQuantity * 100) / 100
  }
}

export function validateCompatibilityEntries(entries = []) {
  if (!Array.isArray(entries)) return { valid: true, entries: [] }
  const cleaned = []

  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue
    const vehicle_make = String(raw.vehicle_make || '').trim()
    const vehicle_model = String(raw.vehicle_model || '').trim()
    const version = String(raw.version || '').trim()
    const position = String(raw.position || '').trim()
    const hasYearFrom = raw.year_from !== undefined && raw.year_from !== null && String(raw.year_from).trim() !== ''
    const hasYearTo = raw.year_to !== undefined && raw.year_to !== null && String(raw.year_to).trim() !== ''

    if (!vehicle_make && !vehicle_model && !version && !position && !hasYearFrom && !hasYearTo) {
      continue
    }

    if (!vehicle_make) {
      return {
        valid: false,
        error: 'En cada compatibilidad de vehículo debés indicar al menos la marca del vehículo (ej. Volkswagen, Ford).'
      }
    }

    let year_from = null
    let year_to = null

    if (hasYearFrom) {
      year_from = Number(raw.year_from)
      if (!Number.isInteger(year_from) || year_from < 1900 || year_from > 2100) {
        return { valid: false, error: 'El año inicial de compatibilidad debe estar entre 1900 y 2100.' }
      }
    }

    if (hasYearTo) {
      year_to = Number(raw.year_to)
      if (!Number.isInteger(year_to) || year_to < 1900 || year_to > 2100) {
        return { valid: false, error: 'El año final de compatibilidad debe estar entre 1900 y 2100.' }
      }
    }

    if (year_from !== null && year_to !== null && year_to < year_from) {
      return {
        valid: false,
        error: `El rango de años (${year_from} - ${year_to}) es inválido: el año final no puede ser menor al año inicial.`
      }
    }

    cleaned.push({
      vehicle_make,
      vehicle_model: vehicle_model || null,
      year_from,
      year_to,
      version: version || null,
      position: position || null
    })
  }

  return { valid: true, entries: cleaned }
}

export function validateStockMovementInput({ itemId, currentQuantity = 0, quantityChange, reason }) {
  if (!itemId) {
    return { valid: false, error: 'Seleccioná un producto válido para registrar el movimiento.' }
  }

  const delta = Number(quantityChange)
  if (!Number.isFinite(delta) || delta === 0) {
    return { valid: false, error: 'La cantidad del movimiento debe ser un número distinto de 0.' }
  }

  const current = Number(currentQuantity ?? 0)
  const resultingQuantity = Math.round((current + delta) * 100) / 100
  if (resultingQuantity < 0) {
    return {
      valid: false,
      error: `Movimiento rechazado: el descuento (${delta}) supera el stock disponible actual (${current}).`
    }
  }

  const cleanReason = String(reason || '').trim()
  if (!cleanReason || cleanReason.length < 3) {
    return {
      valid: false,
      error: 'Indicá el motivo u observación del movimiento (mínimo 3 caracteres, ej. "Compra proveedor", "Uso en OT").'
    }
  }

  return {
    valid: true,
    delta: Math.round(delta * 100) / 100,
    reason: cleanReason,
    resultingQuantity
  }
}

export function formatCompatibilityLabel(c) {
  if (!c) return ''
  const parts = [c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ')
  const years =
    c.year_from && c.year_to
      ? c.year_from === c.year_to
        ? `${c.year_from}`
        : `${c.year_from}–${c.year_to}`
      : c.year_from
        ? `desde ${c.year_from}`
        : c.year_to
          ? `hasta ${c.year_to}`
          : ''
  const details = [years, c.version, c.position].filter(Boolean).join(' · ')
  return [parts, details ? `(${details})` : ''].filter(Boolean).join(' ')
}

export function matchesCompatibilityFilter(item, { vehicleMake = '', vehicleModel = '', vehicleYear = '' } = {}) {
  const makeTerm = normalizeText(vehicleMake)
  const modelTerm = normalizeText(vehicleModel)
  const yearNum = String(vehicleYear || '').trim() ? Number(vehicleYear) : null

  if (!makeTerm && !modelTerm && !yearNum) return true

  const list = Array.isArray(item?.compatibilities) ? item.compatibilities : []
  if (!list.length) return false

  return list.some(c => {
    if (makeTerm && !normalizeText(c.vehicle_make).includes(makeTerm)) return false
    if (modelTerm && !normalizeText(c.vehicle_model).includes(modelTerm)) return false
    if (yearNum && Number.isFinite(yearNum)) {
      if (c.year_from && yearNum < Number(c.year_from)) return false
      if (c.year_to && yearNum > Number(c.year_to)) return false
    }
    return true
  })
}

export function filterStockItems(items = [], filters = {}) {
  const {
    search = '',
    category = '',
    brand = '',
    status = 'active', // 'active' | 'low' | 'archived' | 'all'
    vehicleMake = '',
    vehicleModel = '',
    vehicleYear = ''
  } = filters

  const term = normalizeText(search)
  const brandFilter = normalizeText(brand)

  return items.filter(item => {
    const isArchived = Boolean(item.archived_at)
    if (status === 'active' && isArchived) return false
    if (status === 'archived' && !isArchived) return false
    if (status === 'low' && (isArchived || !isLowStock(item))) return false

    if (category && item.category !== category) return false
    if (brandFilter && !normalizeText(item.brand).includes(brandFilter)) return false

    if (!matchesCompatibilityFilter(item, { vehicleMake, vehicleModel, vehicleYear })) {
      return false
    }

    if (term) {
      const compatText = (item.compatibilities || [])
        .map(c => [c.vehicle_make, c.vehicle_model, c.version, c.position, c.year_from, c.year_to].filter(Boolean).join(' '))
        .join(' ')
      const haystack = normalizeText(
        [item.name, item.sku, item.brand, item.category, item.description, item.location, item.notes, compatText].join(' ')
      )
      if (!haystack.includes(term)) return false
    }

    return true
  })
}

export async function fetchWorkshopStock(workshopId) {
  if (!supabase || !workshopId) return []

  const [itemsRes, compatRes] = await Promise.all([
    supabase
      .from('stock_items')
      .select(
        'id, workshop_id, name, category, brand, sku, description, quantity, unit, location, purchase_price, sale_price, minimum_quantity, notes, archived_at, created_at'
      )
      .eq('workshop_id', workshopId)
      .order('name', { ascending: true }),
    supabase
      .from('part_compatibility')
      .select('id, stock_item_id, workshop_id, vehicle_make, vehicle_model, year_from, year_to, version, position')
      .eq('workshop_id', workshopId)
  ])

  if (itemsRes.error) throw itemsRes.error
  if (compatRes.error) throw compatRes.error

  const compatByItem = new Map()
  for (const c of compatRes.data || []) {
    if (!compatByItem.has(c.stock_item_id)) {
      compatByItem.set(c.stock_item_id, [])
    }
    compatByItem.get(c.stock_item_id).push(c)
  }

  return (itemsRes.data || []).map(item => ({
    ...item,
    quantity: Number(item.quantity ?? 0),
    purchase_price: Number(item.purchase_price ?? 0),
    sale_price: Number(item.sale_price ?? 0),
    minimum_quantity: Number(item.minimum_quantity ?? 0),
    compatibilities: compatByItem.get(item.id) || []
  }))
}

export async function recordStockMovement({ itemId, currentQuantity = 0, quantityChange, reason }) {
  if (!supabase) throw new Error('Supabase no está disponible.')
  const check = validateStockMovementInput({ itemId, currentQuantity, quantityChange, reason })
  if (!check.valid) throw new Error(check.error)

  // DEV-22: Para modificar cantidades se utiliza EXCLUSIVAMENTE la función RPC record_stock_movement
  const { data, error } = await supabase.rpc('record_stock_movement', {
    p_item_id: itemId,
    p_quantity: check.delta,
    p_reason: check.reason
  })

  if (error) throw error
  return data
}

export async function createStockItem(workshopId, input, compatibilities = []) {
  if (!supabase || !workshopId) throw new Error('Seleccioná un taller activo para registrar productos en el stock.')

  const itemCheck = validateStockItemInput(input)
  if (!itemCheck.valid) throw new Error(itemCheck.error)

  const compatCheck = validateCompatibilityEntries(compatibilities)
  if (!compatCheck.valid) throw new Error(compatCheck.error)

  // Se inserta con quantity: 0 y si hay cantidad inicial > 0 se registra mediante record_stock_movement
  const { data: created, error: insertErr } = await supabase
    .from('stock_items')
    .insert({
      workshop_id: workshopId,
      ...itemCheck.values,
      quantity: 0
    })
    .select(
      'id, workshop_id, name, category, brand, sku, description, quantity, unit, location, purchase_price, sale_price, minimum_quantity, notes, archived_at, created_at'
    )
    .single()

  if (insertErr) throw insertErr

  if (compatCheck.entries.length > 0) {
    const compatRows = compatCheck.entries.map(c => ({
      ...c,
      stock_item_id: created.id,
      workshop_id: workshopId
    }))
    const { error: compatErr } = await supabase.from('part_compatibility').insert(compatRows)
    if (compatErr) throw compatErr
  }

  if (itemCheck.initialQuantity > 0) {
    await recordStockMovement({
      itemId: created.id,
      currentQuantity: 0,
      quantityChange: itemCheck.initialQuantity,
      reason: String(input.initial_reason || 'Stock inicial en alta de producto').trim()
    })
  }

  return created
}

export async function updateStockItem(workshopId, itemId, input, compatibilities = []) {
  if (!supabase || !workshopId || !itemId) {
    throw new Error('Faltan datos del taller o producto para guardar los cambios.')
  }

  const itemCheck = validateStockItemInput(input)
  if (!itemCheck.valid) throw new Error(itemCheck.error)

  const compatCheck = validateCompatibilityEntries(compatibilities)
  if (!compatCheck.valid) throw new Error(compatCheck.error)

  // Nunca actualiza quantity directamente; la cantidad solo se modifica vía record_stock_movement
  const { data: updated, error: updateErr } = await supabase
    .from('stock_items')
    .update(itemCheck.values)
    .eq('id', itemId)
    .eq('workshop_id', workshopId)
    .select(
      'id, workshop_id, name, category, brand, sku, description, quantity, unit, location, purchase_price, sale_price, minimum_quantity, notes, archived_at, created_at'
    )
    .single()

  if (updateErr) throw updateErr

  // Reemplazar filas de compatibilidad para este producto
  const { error: delCompatErr } = await supabase
    .from('part_compatibility')
    .delete()
    .eq('stock_item_id', itemId)
    .eq('workshop_id', workshopId)

  if (delCompatErr) throw delCompatErr

  if (compatCheck.entries.length > 0) {
    const compatRows = compatCheck.entries.map(c => ({
      ...c,
      stock_item_id: itemId,
      workshop_id: workshopId
    }))
    const { error: insCompatErr } = await supabase.from('part_compatibility').insert(compatRows)
    if (insCompatErr) throw insCompatErr
  }

  return updated
}

export async function archiveStockItem(workshopId, itemId, archive = true) {
  if (!supabase || !workshopId || !itemId) {
    throw new Error('Seleccioná un producto válido.')
  }

  const { data, error } = await supabase
    .from('stock_items')
    .update({
      archived_at: archive ? new Date().toISOString() : null
    })
    .eq('id', itemId)
    .eq('workshop_id', workshopId)
    .select('id, archived_at')
    .single()

  if (error) throw error
  return data
}

export async function fetchStockMovements(workshopId, itemId = null, limit = 60) {
  if (!supabase || !workshopId) return []

  let query = supabase
    .from('stock_movements')
    .select('id, workshop_id, stock_item_id, quantity_change, reason, created_by, created_at')
    .eq('workshop_id', workshopId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (itemId) {
    query = query.eq('stock_item_id', itemId)
  }

  const { data: movements, error } = await query
  if (error) throw error
  return movements || []
}
