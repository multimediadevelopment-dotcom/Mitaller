import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const backend = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('../Crash_Solution_Publicacion/src/lib/supabase.js', () => ({ supabase: backend, isSupabaseConfigured: true }))
import { appAuthState, renderStockScreen } from '../Crash_Solution_Publicacion/src/main.js'
import { validateStockItemInput } from '../Crash_Solution_Publicacion/src/lib/stock.js'
import { privateReadCache } from '../Crash_Solution_Publicacion/src/lib/scoped-cache.js'

let rows, writes, movements
beforeEach(() => {
  privateReadCache.clear(); vi.clearAllMocks()
  document.body.innerHTML = '<section id="stockScreen"></section>'
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  rows = [{ id: 'item-1', workshop_id: 'w1', name: 'Barniz', category: 'Pinturas', unit: 'lt',
    purchase_price: 1200.5, sale_price: 98765, quantity: 2, minimum_quantity: 3, location: 'Estante B', archived_at: null }]
  writes = []; movements = []
  Object.assign(appAuthState, {
    user: { id: 'u1' }, activeWorkshopId: 'w1',
    memberships: [{ workshop_id: 'w1', role: 'owner', workshop: { id: 'w1', name: 'Pruebas' } }],
    editingStockItem: null, movementTargetItem: null, draftCompatibilities: [], stockItems: [], stockMovements: [],
    stockFilters: { term: '', category: '', lowOnly: false, includeArchived: false }, stockVisibleCount: 40
  })
  backend.from.mockImplementation(table => {
    let operation = 'read', values, filters = {}
    const execute = () => {
      if (table !== 'stock_items') return { data: table === 'stock_movements' ? movements : [], error: null }
      if (operation === 'insert') {
        const item = { id: 'item-new', archived_at: null, ...values }
        rows.push(item); writes.push({ operation, values }); return { data: item, error: null }
      }
      if (operation === 'update') {
        const item = rows.find(row => row.id === filters.id && row.workshop_id === filters.workshop_id)
        Object.assign(item, values); writes.push({ operation, values }); return { data: item, error: null }
      }
      return { data: rows.map(row => ({ ...row })), error: null }
    }
    const query = {
      select: () => query, order: () => query, limit: () => query,
      eq: (field, value) => { filters[field] = value; return query },
      insert: input => { operation = 'insert'; values = input; return query },
      update: input => { operation = 'update'; values = input; return query },
      delete: () => query,
      range: async () => execute(), single: async () => execute(),
      then: (resolve, reject) => Promise.resolve(execute()).then(resolve, reject)
    }
    return query
  })
  backend.rpc.mockImplementation(async (name, args) => {
    const row = rows.find(item => item.id === args.p_item_id)
    row.quantity += args.p_quantity
    movements.push({ id: 'movement-1', stock_item_id: row.id, quantity_change: args.p_quantity,
      reason: args.p_reason, created_at: new Date().toISOString() })
    return { data: row, error: null }
  })
})
afterEach(() => { privateReadCache.clear(); delete HTMLElement.prototype.scrollIntoView })
const set = (id, value) => { document.getElementById(id).value = value }
const submit = () => document.getElementById('stockItemForm').dispatchEvent(new Event('submit', { cancelable: true }))

describe('Stock: precio de compra y conservación de datos', () => {
  it('consulta productos con cantidades y alertas, sin venta ni valorización', async () => {
    await renderStockScreen()
    expect(document.getElementById('stPurchasePrice')).not.toBeNull()
    expect(document.getElementById('stSalePrice')).toBeNull()
    const section = document.getElementById('stockScreen')
    expect(section.textContent).not.toMatch(/precio.*venta|valorizad|cotización|valor total/i)
    expect(document.querySelector('.stock-summary-stats').children).toHaveLength(2)
    const card = document.querySelector('.stock-card')
    expect(card.textContent).toContain('Precio de compra')
    expect(card.textContent).toContain('1.200,5')
    expect(card.textContent).not.toContain('98.765')
    expect(card.textContent).toContain('2 lt')
    expect(card.textContent).toContain('Estante B')
    expect(card.classList.contains('low-stock')).toBe(true)
    expect(card.querySelector('[data-mov-item]')).not.toBeNull()
  })

  it('crea y vuelve a consultar un producto con compra y cantidad inicial mediante RPC', async () => {
    await renderStockScreen()
    set('stName', 'Pintura nueva'); set('stPurchasePrice', '2300.75'); set('stInitialQty', '4')
    submit()
    await vi.waitFor(() => expect(document.getElementById('stockAlertBox').textContent).toContain('dado de alta'))
    expect(rows.find(item => item.id === 'item-new')).toMatchObject({ purchase_price: 2300.75, quantity: 4, sale_price: 0 })
    expect(backend.rpc).toHaveBeenCalledWith('record_stock_movement', expect.objectContaining({ p_item_id: 'item-new', p_quantity: 4 }))
    await renderStockScreen()
    expect(document.getElementById('stockItemsGrid').textContent).toContain('2.300,75')
  })

  it('edita y consulta compra sin sobrescribir venta ni cantidades existentes', async () => {
    await renderStockScreen()
    document.querySelector('[data-edit-item="item-1"]').click()
    await vi.waitFor(() => expect(document.getElementById('stName').value).toBe('Barniz'))
    expect(document.getElementById('stPurchasePrice').value).toBe('1200.5')
    set('stPurchasePrice', '1400.25'); submit()
    await vi.waitFor(() => expect(document.getElementById('stockAlertBox').textContent).toContain('actualizados'))
    expect(writes[0].values).not.toHaveProperty('sale_price')
    expect(writes[0].values).not.toHaveProperty('quantity')
    expect(rows[0]).toMatchObject({ purchase_price: 1400.25, sale_price: 98765, quantity: 2 })
    expect(document.querySelector('.stock-card').textContent).toContain('1.400,25')
    expect(backend.rpc).not.toHaveBeenCalled()
  })

  it('omite la venta cuando no se envía y mantiene validación y compatibilidad con datos anteriores', () => {
    expect(validateStockItemInput({ name: 'Barniz', purchase_price: 25 }).values).not.toHaveProperty('sale_price')
    expect(validateStockItemInput({ name: 'Barniz', purchase_price: 25, sale_price: 50 }).values.sale_price).toBe(50)
    expect(validateStockItemInput({ name: 'Barniz', purchase_price: -1 }).valid).toBe(false)
    expect(validateStockItemInput({ name: '' }).valid).toBe(false)
  })
})
