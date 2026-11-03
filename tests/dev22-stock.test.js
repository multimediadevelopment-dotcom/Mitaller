import { describe, it, expect } from 'vitest'
import {
  STOCK_CATEGORIES,
  isLowStock,
  validateStockItemInput,
  validateCompatibilityEntries,
  validateStockMovementInput,
  formatCompatibilityLabel,
  filterStockItems
} from '../Crash_Solution_Publicacion/src/lib/stock.js'
import { supabase } from '../Crash_Solution_Publicacion/src/lib/supabase.js'

describe('DEV-22 — Sistema de Stock, Compatibilidad Vehicular, Movimientos RPC y Aislamiento RLS', () => {
  it('valida el alta y edición de productos de taller (pinturas, materiales, insumos, repuestos)', () => {
    expect(STOCK_CATEGORIES).toEqual(['Pinturas', 'Materiales', 'Insumos', 'Repuestos', 'Otros'])

    expect(validateStockItemInput({ name: 'A' }).valid).toBe(false)
    expect(validateStockItemInput({ name: 'Barniz', category: 'Inexistente' }).valid).toBe(false)
    expect(validateStockItemInput({ name: 'Barniz', category: 'Pinturas', purchase_price: -10 }).valid).toBe(false)

    const validItem = validateStockItemInput({
      name: 'Espejo retrovisor exterior derecho',
      category: 'Repuestos',
      brand: 'Fitam',
      sku: 'esp-vw-204r',
      description: 'Espejo eléctrico con desempañador',
      unit: 'un.',
      location: 'Estante B-3',
      purchase_price: 42500.5,
      sale_price: 68000,
      minimum_quantity: 2,
      initial_quantity: 5,
      notes: 'Repuesto homologado'
    })

    expect(validItem.valid).toBe(true)
    expect(validItem.values.sku).toBe('ESP-VW-204R')
    expect(validItem.values.location).toBe('Estante B-3')
    expect(validItem.initialQuantity).toBe(5)
    // Asegura que values no incluya quantity directo para que solo se modifique vía record_stock_movement
    expect('quantity' in validItem.values).toBe(false)
  })

  it('valida la compatibilidad por marca, modelo, rango de años, versión y posición', () => {
    const missingMake = validateCompatibilityEntries([
      { vehicle_make: '', vehicle_model: 'Vento', year_from: 2015, year_to: 2020 }
    ])
    expect(missingMake.valid).toBe(false)

    const invertedYears = validateCompatibilityEntries([
      { vehicle_make: 'Volkswagen', vehicle_model: 'Vento', year_from: 2021, year_to: 2016 }
    ])
    expect(invertedYears.valid).toBe(false)

    const validCompat = validateCompatibilityEntries([
      {
        vehicle_make: 'Volkswagen',
        vehicle_model: 'Vento',
        year_from: 2015,
        year_to: 2020,
        version: '2.0 TSI',
        position: 'Delantero derecho'
      }
    ])
    expect(validCompat.valid).toBe(true)
    expect(validCompat.entries).toHaveLength(1)
    expect(formatCompatibilityLabel(validCompat.entries[0])).toBe(
      'Volkswagen Vento (2015–2020 · 2.0 TSI · Delantero derecho)'
    )
  })

  it('impide movimientos de inventario que generen cantidades negativas o sin motivo', () => {
    const negativeResult = validateStockMovementInput({
      itemId: 'item-1',
      currentQuantity: 3,
      quantityChange: -4,
      reason: 'Consumo en OT-0012'
    })
    expect(negativeResult.valid).toBe(false)
    expect(negativeResult.error).toContain('supera el stock disponible')

    const missingReason = validateStockMovementInput({
      itemId: 'item-1',
      currentQuantity: 3,
      quantityChange: -1,
      reason: 'ab'
    })
    expect(missingReason.valid).toBe(false)

    const validOut = validateStockMovementInput({
      itemId: 'item-1',
      currentQuantity: 3,
      quantityChange: -2,
      reason: 'Consumo en OT patente AB 123 CD'
    })
    expect(validOut).toEqual({
      valid: true,
      delta: -2,
      reason: 'Consumo en OT patente AB 123 CD',
      resultingQuantity: 1
    })
  })

  it('detecta alertas de stock mínimo y filtra por búsqueda rápida, categoría, marca y compatibilidad vehicular', () => {
    const catalog = [
      {
        id: '1',
        name: 'Barniz Bicapa Alto Sólido',
        category: 'Pinturas',
        brand: 'PPG',
        sku: 'PPG-8000',
        quantity: 2,
        minimum_quantity: 3,
        unit: 'lt',
        location: 'Estante A-1',
        archived_at: null,
        compatibilities: []
      },
      {
        id: '2',
        name: 'Espejo retrovisor derecho',
        category: 'Repuestos',
        brand: 'Fitam',
        sku: 'ESP-HIL-R',
        quantity: 4,
        minimum_quantity: 1,
        unit: 'un.',
        location: 'Pasillo 2 · Estante C',
        archived_at: null,
        compatibilities: [
          {
            vehicle_make: 'Toyota',
            vehicle_model: 'Hilux',
            year_from: 2016,
            year_to: 2022,
            version: 'SRV',
            position: 'Delantero derecho'
          }
        ]
      },
      {
        id: '3',
        name: 'Lija al agua P1200 (Descontinuada)',
        category: 'Insumos',
        brand: '3M',
        sku: '3M-P1200',
        quantity: 0,
        minimum_quantity: 10,
        unit: 'un.',
        location: 'Cajón 4',
        archived_at: '2026-11-01T10:00:00Z',
        compatibilities: []
      }
    ]

    expect(isLowStock(catalog[0])).toBe(true)
    expect(isLowStock(catalog[1])).toBe(false)
    expect(isLowStock(catalog[2])).toBe(false) // Archivado no dispara alerta activa

    // Filtro por alerta de stock bajo
    const lowList = filterStockItems(catalog, { status: 'low' })
    expect(lowList.map(i => i.id)).toEqual(['1'])

    // Filtro por archivados
    const archivedList = filterStockItems(catalog, { status: 'archived' })
    expect(archivedList.map(i => i.id)).toEqual(['3'])

    // Filtro por compatibilidad: Toyota Hilux año 2019 (dentro del rango 2016-2022)
    const hilux2019 = filterStockItems(catalog, {
      status: 'active',
      vehicleMake: 'toyota',
      vehicleModel: 'hilux',
      vehicleYear: '2019'
    })
    expect(hilux2019.map(i => i.id)).toEqual(['2'])

    // Filtro por compatibilidad fuera de rango de año (2012)
    const hilux2012 = filterStockItems(catalog, {
      status: 'active',
      vehicleMake: 'toyota',
      vehicleModel: 'hilux',
      vehicleYear: '2012'
    })
    expect(hilux2012).toHaveLength(0)

    // Búsqueda rápida por ubicación física
    const byLocation = filterStockItems(catalog, { status: 'active', search: 'Pasillo 2' })
    expect(byLocation.map(i => i.id)).toEqual(['2'])
  })

  it('verifica en vivo contra Supabase que un usuario sin membresía en un taller ajeno no puede leer ni modificar su stock', async () => {
    expect(supabase).toBeTruthy()

    const otherWorkshopId = '99999999-9999-4999-8999-999999999999'

    // 1. Lectura de stock de otro taller devuelve 0 filas por RLS
    const { data: foreignStock, error: readErr } = await supabase
      .from('stock_items')
      .select('id, name')
      .eq('workshop_id', otherWorkshopId)
    expect(readErr).toBeNull()
    expect(foreignStock).toEqual([])

    // 2. Inserción en stock_items de otro taller es rechazada con código 42501 (RLS)
    const { error: insertErr } = await supabase.from('stock_items').insert({
      workshop_id: otherWorkshopId,
      name: 'Intento intruso',
      category: 'Materiales',
      quantity: 0,
      unit: 'un.'
    })
    expect(insertErr).toBeTruthy()
    expect(insertErr.code).toBe('42501')

    // 3. Llamada no autorizada a record_stock_movement es rechazada por seguridad (42501)
    const { error: rpcErr } = await supabase.rpc('record_stock_movement', {
      p_item_id: otherWorkshopId,
      p_quantity: 5,
      p_reason: 'Intento intruso'
    })
    expect(rpcErr).toBeTruthy()
    expect(rpcErr.code).toBe('42501')
  })
})
