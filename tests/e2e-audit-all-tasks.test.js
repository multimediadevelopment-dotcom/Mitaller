import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  VALID_WORKSHOP_ROLES,
  validateRegistration,
  validatePasswordUpdate,
  isSessionExpired,
  canAccessAdminPanel,
  preventSelfPrivilegeEscalation
} from '../Crash_Solution_Publicacion/src/lib/auth.js'
import {
  validateWorkshopInput,
  validateMemberAssignment,
  validateMemberRemoval,
  sanitizeAdminErrorMessage
} from '../Crash_Solution_Publicacion/src/lib/admin.js'
import {
  validateCuit,
  formatCuit,
  validateLogoFile,
  validateWorkshopProfileForm,
  buildBudgetWorkshopHeaderHtml
} from '../Crash_Solution_Publicacion/src/lib/workshop-profile.js'
import {
  validateStockItemInput,
  validateCompatibilityEntries,
  validateStockMovementInput,
  filterStockItems,
  isLowStock
} from '../Crash_Solution_Publicacion/src/lib/stock.js'
import {
  computeBudgetTotals,
  buildBudgetWhatsappMessage,
  openWhatsappWithBudgetText,
  generateBudgetPdfBytes,
  shareBudgetPdf
} from '../Crash_Solution_Publicacion/src/lib/budget-delivery.js'
import {
  setOfflineSessionOwner,
  enqueueJobSyncOperation,
  getOfflineJobsForScope,
  lockOfflineDataOnLogout,
  unlockOfflineDataForAuthenticatedOwner,
  explicitPurgeLocalWorkshopData
} from '../Crash_Solution_Publicacion/src/lib/offline-sync.js'

describe('Auditoría Integral de Punta a Punta (DEV-19, DEV-20, DEV-21, DEV-22, DEV-25, DEV-26)', () => {
  it('1. Verifica artefactos de investigación (DEV-21), diseño responsive móvil y accesibilidad (prefers-reduced-motion)', () => {
    const competenciaPath = resolve(import.meta.dirname, '../docs/analisis-competencia.md')
    expect(existsSync(competenciaPath)).toBe(true)
    const competenciaDoc = readFileSync(competenciaPath, 'utf8')
    expect(competenciaDoc).toContain('DEV-21')

    const indexHtml = readFileSync(
      resolve(import.meta.dirname, '../Crash_Solution_Publicacion/index.html'),
      'utf8'
    )
    const stylesCss = readFileSync(
      resolve(import.meta.dirname, '../Crash_Solution_Publicacion/src/styles.css'),
      'utf8'
    )

    // Verifica soporte móvil (viewport, media queries para celulares y tablets, y respeto a prefers-reduced-motion)
    expect(indexHtml).toContain('width=device-width,initial-scale=1')
    expect(indexHtml).toContain('@media(max-width:680px)')
    expect(stylesCss).toContain('@media (max-width: 680px)')
    expect(stylesCss).toContain('prefers-reduced-motion: reduce')
  })

  it('2. Verifica flujo integrado: Auth/Roles -> Perfil/Logo -> Stock/RPC -> Presupuesto WhatsApp/PDF -> Offline/Cierre de sesión seguro', async () => {
    await explicitPurgeLocalWorkshopData({ confirmUnsyncedDeletion: true })

    // A. Registro, contraseña y roles (DEV-20)
    const reg = validateRegistration({
      displayName: 'Taller Integral Demo',
      email: 'owner@crashsolution.com.ar',
      password: 'PasswordSegura2026!',
      confirmPassword: 'PasswordSegura2026!'
    })
    expect(reg.valid).toBe(true)
    expect(validatePasswordUpdate('NuevaClave2026!', 'NuevaClave2026!').valid).toBe(true)
    expect(VALID_WORKSHOP_ROLES).toEqual(['owner', 'admin', 'staff'])
    expect(canAccessAdminPanel('owner')).toBe(true)
    expect(canAccessAdminPanel('staff')).toBe(false)
    expect(
      preventSelfPrivilegeEscalation({
        callerId: 'u-admin',
        callerRole: 'admin',
        targetUserId: 'u-admin',
        requestedRole: 'owner'
      }).allowed
    ).toBe(false)
    expect(
      validateWorkshopInput({ name: 'Crash Solution Central' }).valid
    ).toBe(true)
    expect(
      validateMemberAssignment({
        callerId: '11111111-1111-1111-1111-111111111111',
        callerRole: 'owner',
        workshopId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        targetUserId: '22222222-2222-2222-2222-222222222222',
        role: 'staff',
        currentOwnerCount: 1
      }).valid
    ).toBe(true)
    expect(
      validateMemberRemoval({
        callerId: '11111111-1111-1111-1111-111111111111',
        callerRole: 'owner',
        targetUserId: '11111111-1111-1111-1111-111111111111',
        targetCurrentRole: 'owner',
        currentOwnerCount: 1
      }).valid
    ).toBe(false)
    expect(sanitizeAdminErrorMessage(new Error('PGRST116 internal'))).not.toContain('PGRST116')

    // B. Perfil completo del taller y logo (DEV-19)
    expect(validateCuit('30-71234567-1').valid).toBe(true)
    expect(formatCuit('30712345671')).toBe('30-71234567-1')
    expect(validateLogoFile({ type: 'image/png', size: 150000 }).valid).toBe(true)
    expect(validateLogoFile({ type: 'image/svg+xml', size: 15000 }).valid).toBe(false)

    const profileCheck = validateWorkshopProfileForm({
      name: 'Crash Solution Central',
      legal_name: 'Crash Solution S.R.L.',
      tax_id: '30-71234567-1',
      phone: '011 4555-1234',
      whatsapp: '+54 9 11 5555-1234',
      email: 'info@crashsolution.com.ar',
      address: 'Av. Warnes 1234, CABA'
    })
    expect(profileCheck.valid).toBe(true)
    const headerHtml = buildBudgetWorkshopHeaderHtml(
      profileCheck.values,
      'OT-00900',
      '03/11/2026',
      '18/11/2026'
    )
    expect(headerHtml).toContain('Crash Solution Central')
    expect(headerHtml).toContain('30-71234567-1')

    // C. Stock, compatibilidad y movimientos (DEV-22)
    const stockCheck = validateStockItemInput({
      name: 'Paragolpes delantero Corolla',
      category: 'Repuestos',
      brand: 'Toyota Original',
      sku: 'TOY-COR-22',
      location: 'Pasillo A - Estante 2',
      initial_quantity: 2,
      minimum_quantity: 3,
      purchase_price: 95000,
      sale_price: 145000
    })
    expect(stockCheck.valid).toBe(true)
    const compatCheck = validateCompatibilityEntries([
      { vehicle_make: 'Toyota', vehicle_model: 'Corolla', year_from: 2020, year_to: 2024 }
    ])
    expect(compatCheck.valid).toBe(true)

    const persistedStockRow = {
      ...stockCheck.values,
      quantity: stockCheck.initialQuantity,
      archived_at: null,
      compatibilities: compatCheck.entries
    }
    expect(isLowStock(persistedStockRow)).toBe(true)
    expect(
      filterStockItems(
        [persistedStockRow],
        { vehicleMake: 'Toyota', vehicleModel: 'Corolla', vehicleYear: 2022 }
      )
    ).toHaveLength(1)
    expect(
      validateStockMovementInput({
        itemId: 'item-1',
        quantityChange: -1,
        currentQuantity: 2,
        reason: 'Asignado a OT-00900'
      }).valid
    ).toBe(true)

    // D. Presupuestos por WhatsApp y PDF descargable/compartible (DEV-25)
    const job = {
      id: 'job-e2e-900',
      number: 'OT-00900',
      status: 'Enviado',
      rec: {
        cliente: 'Valeria Gómez',
        telefono: '11 4444 8888',
        patente: 'AF 900 VG',
        marca: 'Toyota',
        modelo: 'Corolla',
        anio: '2022'
      },
      inspection: {},
      quote: [{ id: 'q1', description: 'Paragolpes delantero Corolla · Reemplazar', qty: 1, price: 145000 }],
      discount: 0,
      tax: 21,
      document: { date: '2026-11-03', validDays: 15, terms: 'Garantía escrita de pintura.' }
    }
    const totals = computeBudgetTotals(job)
    expect(totals.total).toBe(175450)

    const waMsg = buildBudgetWhatsappMessage(job, profileCheck.values)
    expect(waMsg).toContain('Crash Solution Central')
    expect(waMsg).toContain('175.450')

    const waOpen = openWhatsappWithBudgetText(job, profileCheck.values, { open: () => {} })
    expect(waOpen.sentConfirmed).toBe(false)

    const pdfBytes = generateBudgetPdfBytes(job, profileCheck.values)
    expect(pdfBytes.byteLength).toBeGreaterThan(1500)

    const shareRes = await shareBudgetPdf(job, profileCheck.values, {
      navigatorObj: { canShare: () => true, share: async () => {} },
      windowObj: {},
      documentObj: {}
    })
    expect(shareRes.mode).toBe('web-share-file')

    // E. Persistencia Offline, Aislamiento entre Talleres y Protección al Cerrar Sesión (DEV-26)
    const ownerUser = '11111111-1111-1111-1111-111111111111'
    const otherUser = '99999999-9999-9999-9999-999999999999'
    const wsA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const wsB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

    setOfflineSessionOwner(ownerUser)
    await enqueueJobSyncOperation({ userId: ownerUser, workshopId: wsA, job })

    // Aislamiento entre talleres del mismo usuario
    expect(await getOfflineJobsForScope(ownerUser, wsA)).toHaveLength(1)
    expect(await getOfflineJobsForScope(ownerUser, wsB)).toHaveLength(0)

    // Cierre de sesión con trabajo pendiente: no se borra, se bloquea para otros usuarios
    await lockOfflineDataOnLogout({ userId: ownerUser, workshopId: wsA })
    await unlockOfflineDataForAuthenticatedOwner(otherUser)
    expect(await getOfflineJobsForScope(ownerUser, wsA)).toHaveLength(0)

    // Al volver el propietario original, recupera su trabajo pendiente intacto
    await unlockOfflineDataForAuthenticatedOwner(ownerUser)
    expect(await getOfflineJobsForScope(ownerUser, wsA)).toHaveLength(1)
    expect(isSessionExpired({ access_token: 't', user: { id: ownerUser }, expires_at: 100 })).toBe(true)
  })
})
