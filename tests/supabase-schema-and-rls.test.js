import { describe, it, expect } from 'vitest'
import { supabase, liveTestsEnabled } from './live-supabase.js'

describe.skipIf(!liveTestsEnabled)('Verificación de Conexión, Esquema Real y RLS en Supabase', () => {
  it('accede con estado 200 OK y verifica las columnas reales de las 7 tablas existentes', async () => {
    const schemaExpectations = {
      workshops: 'id, name, legal_name, tax_id, logo_path, phone, whatsapp, email, address, created_by, created_at',
      workshop_members: 'workshop_id, user_id, role',
      user_profiles: 'user_id, display_name, phone, created_at',
      jobs: 'id, workshop_id, job_number, status, revision, payload, customer_name, vehicle_plate, created_at, updated_at',
      stock_items:
        'id, workshop_id, name, category, brand, sku, description, quantity, unit, location, purchase_price, sale_price, minimum_quantity, notes, archived_at, created_at',
      part_compatibility:
        'id, stock_item_id, workshop_id, vehicle_make, vehicle_model, year_from, year_to, version, position',
      stock_movements: 'id, workshop_id, stock_item_id, quantity_change, reason, created_by, created_at'
    }

    for (const [table, columns] of Object.entries(schemaExpectations)) {
      const { data, error, status } = await supabase.from(table).select(columns).limit(1)
      expect(error, `Error en tabla ${table}: ${error?.message}`).toBeNull()
      expect(status).toBe(200)
      expect(Array.isArray(data)).toBe(true)
    }
  })

  it('verifica que las políticas RLS bloquean inserciones no autorizadas (42501) en las 7 tablas', async () => {
    const tables = [
      'workshops',
      'workshop_members',
      'user_profiles',
      'jobs',
      'stock_items',
      'part_compatibility',
      'stock_movements'
    ]

    for (const table of tables) {
      const { error } = await supabase.from(table).insert([{}])
      expect(error).not.toBeNull()
      expect(error.code).toBe('42501')
    }
  })

  it('verifica que la función RPC record_stock_movement(p_item_id, p_quantity, p_reason) existe y está protegida', async () => {
    const { error } = await supabase.rpc('record_stock_movement', {
      p_item_id: '00000000-0000-0000-0000-000000000000',
      p_quantity: 1,
      p_reason: 'Verificación de esquema'
    })
    expect(error).not.toBeNull()
    // No debe ser PGRST202 (función no encontrada), sino 42501 (ejecución denegada a anon)
    expect(error.code).toBe('42501')
  })

  it('verifica la existencia y acceso controlado al bucket workshop-logos', async () => {
    const { data, error } = await supabase.storage.from('workshop-logos').list()
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })
})
