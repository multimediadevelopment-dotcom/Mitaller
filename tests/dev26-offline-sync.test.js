import { describe, it, expect, beforeEach } from 'vitest'
import {
  stripSensitiveFields,
  setOfflineSessionOwner,
  saveOfflineJob,
  getOfflineJobsForScope,
  getOfflineSyncBreakdown,
  migrateLegacyLocalStorageJobs,
  enqueueJobSyncOperation,
  getPendingSyncOperations,
  getUnresolvedConflicts,
  processSyncQueue,
  resolveSyncConflict,
  getUnsyncedSummaryForUser,
  lockOfflineDataOnLogout,
  unlockOfflineDataForAuthenticatedOwner,
  explicitPurgeLocalWorkshopData
} from '../Crash_Solution_Publicacion/src/lib/offline-sync.js'
import { generateBudgetPdfBytes } from '../Crash_Solution_Publicacion/src/lib/budget-delivery.js'

const makeSession = (userId, expiresInSeconds = 3600) => ({
  access_token: `jwt-for-${userId}`,
  user: { id: userId },
  expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds
})

/**
 * Crea un servidor simulado de Supabase en memoria para verificar sincronización,
 * fallos transitorios de red, idempotencia y conflictos concurrentes entre dispositivos.
 */
function createMockSupabaseJobsServer(initialRows = []) {
  const rows = new Map(initialRows.map(r => [r.id, JSON.parse(JSON.stringify(r))]))
  let upsertCallCount = 0
  let failNextUpsert = false

  const client = {
    getRows: () => rows,
    getUpsertCallCount: () => upsertCallCount,
    setFailNextUpsert: val => {
      failNextUpsert = Boolean(val)
    },
    from(table) {
      if (table !== 'jobs') throw new Error(`Tabla inesperada: ${table}`)
      return {
        select() {
          const filters = {}
          const builder = {
            eq(col, val) {
              filters[col] = val
              return builder
            },
            async maybeSingle() {
              const row = rows.get(filters.id)
              if (!row || (filters.workshop_id && row.workshop_id !== filters.workshop_id)) {
                return { data: null, error: null }
              }
              return { data: JSON.parse(JSON.stringify(row)), error: null }
            }
          }
          return builder
        },
        async upsert(record) {
          if (failNextUpsert) {
            failNextUpsert = false
            return { data: null, error: new Error('Network timeout during upsert') }
          }
          upsertCallCount++
          rows.set(record.id, JSON.parse(JSON.stringify(record)))
          return { data: record, error: null }
        }
      }
    }
  }

  return client
}

describe('DEV-26 — Funcionamiento Offline, Protección al Cerrar Sesión, Concurrencia y Conflictos', () => {
  const userA = '11111111-1111-1111-1111-111111111111'
  const userB = '22222222-2222-2222-2222-222222222222'
  const workshop1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const workshop2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

  beforeEach(async () => {
    await explicitPurgeLocalWorkshopData({ confirmUnsyncedDeletion: true })
  })

  it('1. Crea y modifica un trabajo sin Internet, diferencia sincronizados vs no sincronizados, genera PDF local y mantiene datos al recargar', async () => {
    setOfflineSessionOwner(userA)

    // Trabajo 1: ya sincronizado previamente
    await saveOfflineJob({
      userId: userA,
      workshopId: workshop1,
      job: {
        id: 'job-synced-100',
        number: 'OT-00100',
        status: 'Aprobado',
        cloudRevision: 4,
        rec: { cliente: 'María López', patente: 'AA 100 AA', marca: 'VW', modelo: 'Gol' },
        inspection: {},
        quote: [{ id: 'q0', description: 'Pintura paragolpes', qty: 1, price: 80000 }],
        discount: 0,
        tax: 0,
        document: { date: '2026-11-01', validDays: 15, terms: '' }
      },
      syncStatus: 'synced'
    })

    // Trabajo 2: creado y editado sin Internet
    const offlineJob = {
      id: 'job-offline-101',
      number: 'LOCAL-00101',
      status: 'Borrador',
      cloudRevision: 0,
      rec: {
        cliente: 'Roberto Sánchez',
        telefono: '11 6666 7777',
        patente: 'AF 111 ZZ',
        marca: 'Toyota',
        modelo: 'Corolla',
        anio: '2022',
        km: '34000'
      },
      inspection: {
        'Parte delantera|||Paragolpes delantero': {
          status: 'danado',
          works: ['Reparar', 'Pintura'],
          note: 'Raspón lateral derecho',
          photos: []
        }
      },
      generalNote: 'Ingresado sin conexión a internet.',
      quote: [
        {
          id: 'q-off-1',
          description: 'Paragolpes delantero · Reparar y Pintura',
          qty: 1,
          price: 120000
        }
      ],
      discount: 0,
      tax: 21,
      document: {
        date: '2026-11-03',
        validDays: 15,
        terms: 'Entrega en 4 días hábiles.'
      }
    }

    await enqueueJobSyncOperation({
      userId: userA,
      workshopId: workshop1,
      job: offlineJob
    })

    // Diferencia claramente datos sincronizados ('synced') y no sincronizados ('pending')
    const breakdown = await getOfflineSyncBreakdown(userA, workshop1)
    expect(breakdown.syncedJobs).toHaveLength(1)
    expect(breakdown.syncedJobs[0].id).toBe('job-synced-100')
    expect(breakdown.syncedJobs[0].syncStatus).toBe('synced')

    expect(breakdown.unsyncedJobs).toHaveLength(1)
    expect(breakdown.unsyncedJobs[0].id).toBe('job-offline-101')
    expect(breakdown.unsyncedJobs[0].syncStatus).toBe('pending')
    expect(breakdown.pendingCount).toBe(1)

    // Genera PDF localmente estando 100% offline
    const pdfBytes = generateBudgetPdfBytes(offlineJob, {
      name: 'Crash Solution',
      tax_id: '30-71234567-9'
    })
    expect(pdfBytes.byteLength).toBeGreaterThan(1000)

    // Al recargar la página (mismo propietario), se mantienen todos los datos
    const afterReload = await getOfflineJobsForScope(userA, workshop1)
    expect(afterReload).toHaveLength(2)
  })

  it('2. Protege trabajos pendientes al cerrar sesión: no los elimina, bloquea el acceso a otros usuarios y permite sincronizarlos cuando vuelve a autenticarse el propietario', async () => {
    setOfflineSessionOwner(userA)

    // Usuario A tiene 1 trabajo sincronizado y 1 trabajo pendiente (sin internet)
    await saveOfflineJob({
      userId: userA,
      workshopId: workshop1,
      job: {
        id: 'job-already-synced',
        number: 'OT-00010',
        status: 'Enviado',
        cloudRevision: 2,
        rec: { cliente: 'Cliente Sincronizado', patente: 'AA 010 AA' },
        inspection: {},
        quote: [{ id: 'q1', description: 'Chapa', qty: 1, price: 50000 }],
        document: { date: '2026-11-03', validDays: 15, terms: '' }
      },
      syncStatus: 'synced'
    })

    await enqueueJobSyncOperation({
      userId: userA,
      workshopId: workshop1,
      job: {
        id: 'job-pending-offline',
        number: 'LOCAL-00099',
        status: 'Borrador',
        cloudRevision: 0,
        rec: { cliente: 'Cliente Offline Protegido', patente: 'AF 999 ZZ' },
        inspection: {},
        quote: [{ id: 'q2', description: 'Pintura capot', qty: 1, price: 140000 }],
        document: { date: '2026-11-03', validDays: 15, terms: 'Pendiente de subir' }
      }
    })

    // Antes de cerrar sesión, informa claramente que existe 1 cambio pendiente
    const summaryBeforeLogout = await getUnsyncedSummaryForUser(userA)
    expect(summaryBeforeLogout.pendingCount).toBe(1)
    expect(summaryBeforeLogout.totalUnsynced).toBe(1)

    // Usuario A cierra sesión estando sin internet
    const logoutResult = await lockOfflineDataOnLogout({
      userId: userA,
      workshopId: workshop1
    })

    // El trabajo pendiente NUNCA se elimina; el trabajo ya sincronizado sí se limpia de la caché
    expect(logoutResult.preservedUnsyncedCount).toBe(1)
    expect(logoutResult.clearedSyncedCacheCount).toBe(1)

    // Estando la sesión cerrada (activeUserId = null), el trabajo pendiente está bloqueado y no puede leerse
    expect(await getOfflineJobsForScope(userA, workshop1, { activeUserId: null })).toEqual([])
    expect(await getPendingSyncOperations(userA, workshop1, { activeUserId: null })).toEqual([])

    // Ahora inicia sesión OTRO usuario (Usuario B) en el mismo dispositivo
    await unlockOfflineDataForAuthenticatedOwner(userB)

    // Usuario B NO puede leer ni listar los trabajos ni la cola del Usuario A
    expect(await getOfflineJobsForScope(userA, workshop1)).toEqual([])
    expect(await getPendingSyncOperations(userA, workshop1)).toEqual([])
    await expect(
      saveOfflineJob({
        userId: userA,
        workshopId: workshop1,
        job: { id: 'intrusion', rec: { cliente: 'X', patente: 'X' } }
      })
    ).rejects.toThrow(/acceso denegado/i)

    // Tampoco puede forzar la sincronización de la cola del Usuario A con el JWT del Usuario B
    const mockServer = createMockSupabaseJobsServer()
    const crossUserSync = await processSyncQueue({
      supabaseClient: mockServer,
      session: makeSession(userB),
      userId: userA,
      workshopId: workshop1,
      isOnline: true
    })
    expect(crossUserSync.abortedReason).toBe('user_mismatch')
    expect(mockServer.getUpsertCallCount()).toBe(0)

    // Usuario B cierra sesión y vuelve a iniciar sesión el propietario original (Usuario A) con Internet
    await lockOfflineDataOnLogout({ userId: userB, workshopId: workshop2 })
    const unlockRes = await unlockOfflineDataForAuthenticatedOwner(userA)
    expect(unlockRes.unlockedJobs).toBe(1)
    expect(unlockRes.unlockedQueue).toBe(1)

    // El Usuario A recupera su trabajo pendiente intacto
    const recoveredJobs = await getOfflineJobsForScope(userA, workshop1)
    expect(recoveredJobs).toHaveLength(1)
    expect(recoveredJobs[0].id).toBe('job-pending-offline')
    expect(recoveredJobs[0].rec.cliente).toBe('Cliente Offline Protegido')

    // Y ahora puede sincronizarlo normalmente con Supabase
    const ownerSync = await processSyncQueue({
      supabaseClient: mockServer,
      session: makeSession(userA),
      userId: userA,
      workshopId: workshop1,
      isOnline: true
    })
    expect(ownerSync.synced).toBe(1)
    expect(mockServer.getRows().get('job-pending-offline').customer_name).toBe('Cliente Offline Protegido')
  })

  it('3. Recupera la conexión después de varias horas y reintenta tras un fallo de red sin duplicar el trabajo', async () => {
    setOfflineSessionOwner(userA)
    const mockServer = createMockSupabaseJobsServer()

    const job = {
      id: 'job-retry-500',
      number: 'OT-00500',
      status: 'Enviado',
      cloudRevision: 0,
      rec: { cliente: 'Sofía Castro', patente: 'AE 500 FF', marca: 'Fiat', modelo: 'Pulse' },
      inspection: {},
      quote: [{ id: 'q1', description: 'Óptica delantera derecha', qty: 1, price: 210000 }],
      discount: 5,
      tax: 21,
      document: { date: '2026-11-03', validDays: 15, terms: '' }
    }

    await enqueueJobSyncOperation({
      userId: userA,
      workshopId: workshop1,
      job
    })

    // Simular que el primer intento de sincronización (al volver internet tras varias horas) sufre un corte de red
    mockServer.setFailNextUpsert(true)
    const failedAttempt = await processSyncQueue({
      supabaseClient: mockServer,
      session: makeSession(userA, 7200),
      userId: userA,
      workshopId: workshop1,
      isOnline: true
    })
    expect(failedAttempt.synced).toBe(0)
    expect(failedAttempt.errors).toHaveLength(1)

    // El trabajo sigue en la cola con attempts = 1, sin duplicarse
    const pendingAfterFail = await getPendingSyncOperations(userA, workshop1)
    expect(pendingAfterFail).toHaveLength(1)
    expect(pendingAfterFail[0].attempts).toBe(1)

    // Segundo intento: la red responde bien y sincroniza
    const secondAttempt = await processSyncQueue({
      supabaseClient: mockServer,
      session: makeSession(userA, 7200),
      userId: userA,
      workshopId: workshop1,
      isOnline: true
    })
    expect(secondAttempt.synced).toBe(1)
    expect(mockServer.getUpsertCallCount()).toBe(1)
    expect(mockServer.getRows().size).toBe(1)

    // Reintento adicional con el mismo contenido: no vuelve a escribir ni duplica
    await enqueueJobSyncOperation({
      userId: userA,
      workshopId: workshop1,
      job: { ...job, cloudRevision: 1 }
    })
    const thirdAttempt = await processSyncQueue({
      supabaseClient: mockServer,
      session: makeSession(userA, 7200),
      userId: userA,
      workshopId: workshop1,
      isOnline: true
    })
    expect(thirdAttempt.synced).toBe(1)
    expect(mockServer.getUpsertCallCount()).toBe(1)
    expect(mockServer.getRows().size).toBe(1)
  })

  it('4. Dos dispositivos modificando el mismo presupuesto: detecta conflicto y verifica las 3 estrategias (keep_local, keep_remote, keep_both)', async () => {
    setOfflineSessionOwner(userA)
    const jobId = 'job-shared-777'

    const baseVersion = {
      id: jobId,
      number: 'OT-00777',
      status: 'Borrador',
      cloudRevision: 2,
      rec: { cliente: 'Diego Maradona', patente: 'AD 010 DM', marca: 'Ford', modelo: 'Ranger' },
      inspection: {},
      quote: [{ id: 'q1', description: 'Paragolpes delantero', qty: 1, price: 100000 }],
      discount: 0,
      tax: 0,
      document: { date: '2026-11-03', validDays: 15, terms: 'Base rev 2' }
    }

    // Dispositivo 2 actualizó en Supabase a revisión 3 mientras Dispositivo 1 estaba offline
    const device2RemotePayload = {
      ...baseVersion,
      status: 'Enviado',
      cloudRevision: 3,
      quote: [{ id: 'q1', description: 'Paragolpes delantero + pintura', qty: 1, price: 190000 }],
      document: { date: '2026-11-03', validDays: 15, terms: 'Editado en Dispositivo 2' }
    }

    const createConflictScenario = async () => {
      await explicitPurgeLocalWorkshopData({ confirmUnsyncedDeletion: true })
      setOfflineSessionOwner(userA)
      await saveOfflineJob({
        userId: userA,
        workshopId: workshop1,
        job: baseVersion,
        syncStatus: 'synced'
      })
      const device1OfflineEdit = {
        ...baseVersion,
        status: 'Aprobado',
        quote: [{ id: 'q1', description: 'Paragolpes delantero original', qty: 1, price: 225000 }],
        document: { date: '2026-11-03', validDays: 15, terms: 'Editado offline en Dispositivo 1' }
      }
      await enqueueJobSyncOperation({
        userId: userA,
        workshopId: workshop1,
        job: device1OfflineEdit
      })
      const server = createMockSupabaseJobsServer([
        {
          id: jobId,
          workshop_id: workshop1,
          job_number: 'OT-00777',
          status: 'Enviado',
          revision: 3,
          customer_name: 'Diego Maradona',
          vehicle_plate: 'AD 010 DM',
          payload: device2RemotePayload,
          updated_at: '2026-11-03T16:00:00.000Z'
        }
      ])
      const syncRes = await processSyncQueue({
        supabaseClient: server,
        session: makeSession(userA),
        userId: userA,
        workshopId: workshop1,
        isOnline: true
      })
      expect(syncRes.conflicts).toBe(1)
      expect(server.getUpsertCallCount()).toBe(0)
      return server
    }

    // Estrategia A: Conservar remoto ('keep_remote')
    await createConflictScenario()
    const resRemote = await resolveSyncConflict({
      userId: userA,
      workshopId: workshop1,
      jobId,
      strategy: 'keep_remote'
    })
    expect(resRemote.resolvedJob.cloudRevision).toBe(3)
    expect(resRemote.resolvedJob.quote[0].price).toBe(190000)
    expect(await getUnresolvedConflicts(userA, workshop1)).toHaveLength(0)
    expect(await getPendingSyncOperations(userA, workshop1)).toHaveLength(0)

    // Estrategia B: Conservar local ('keep_local') y sincronizar hacia Supabase como rev. 4
    const serverForLocal = await createConflictScenario()
    const resLocal = await resolveSyncConflict({
      userId: userA,
      workshopId: workshop1,
      jobId,
      strategy: 'keep_local'
    })
    expect(resLocal.resolvedJob.quote[0].price).toBe(225000)
    const syncAfterKeepLocal = await processSyncQueue({
      supabaseClient: serverForLocal,
      session: makeSession(userA),
      userId: userA,
      workshopId: workshop1,
      isOnline: true
    })
    expect(syncAfterKeepLocal.synced).toBe(1)
    expect(serverForLocal.getRows().get(jobId).revision).toBe(4)
    expect(serverForLocal.getRows().get(jobId).payload.quote[0].price).toBe(225000)

    // Estrategia C: Conservar ambas ('keep_both')
    const serverForBoth = await createConflictScenario()
    const resBoth = await resolveSyncConflict({
      userId: userA,
      workshopId: workshop1,
      jobId,
      strategy: 'keep_both',
      newJobIdGenerator: () => 'job-shared-777-copy'
    })
    expect(resBoth.resolvedJob.cloudRevision).toBe(3)
    expect(resBoth.createdCopy.id).toBe('job-shared-777-copy')
    const syncAfterKeepBoth = await processSyncQueue({
      supabaseClient: serverForBoth,
      session: makeSession(userA),
      userId: userA,
      workshopId: workshop1,
      isOnline: true
    })
    expect(syncAfterKeepBoth.synced).toBe(1)
    // Ambos trabajos existen en Supabase sin perder ni sobrescribir ninguno
    expect(serverForBoth.getRows().has(jobId)).toBe(true)
    expect(serverForBoth.getRows().has('job-shared-777-copy')).toBe(true)
  })

  it('5. Impide eliminar datos locales sin confirmación explícita, migra localStorage sin borrarlo y bloquea sesiones expiradas', async () => {
    setOfflineSessionOwner(userA)

    await expect(explicitPurgeLocalWorkshopData({ confirmUnsyncedDeletion: false })).rejects.toThrow(
      /confirmación explícita/i
    )

    const fakeLocalStorageData = JSON.stringify({
      schema: 4,
      jobs: [
        {
          id: 'legacy-job-01',
          number: 'LOCAL-00001',
          status: 'Borrador',
          rec: { cliente: 'Ana Torres', patente: 'AE 999 XX' },
          inspection: {},
          quote: [],
          document: { date: '2026-11-03', validDays: 15, terms: '' }
        }
      ]
    })

    const mockStorage = {
      store: { crash_solution_presentation_v1: fakeLocalStorageData },
      getItem(k) {
        return this.store[k] || null
      },
      removeItem(k) {
        delete this.store[k]
      }
    }

    const migration = await migrateLegacyLocalStorageJobs({
      userId: userA,
      workshopId: workshop1,
      storageObj: mockStorage
    })
    expect(migration.migratedCount).toBe(1)
    expect(mockStorage.getItem('crash_solution_presentation_v1')).toBe(fakeLocalStorageData)

    const sanitized = stripSensitiveFields({
      id: 'j1',
      password: 'secret-password',
      access_token: 'jwt',
      service_role_key: 'secret'
    })
    expect(sanitized.password).toBeUndefined()
    expect(sanitized.access_token).toBeUndefined()
    expect(sanitized.service_role_key).toBeUndefined()

    const mockServer = createMockSupabaseJobsServer()
    const expiredSync = await processSyncQueue({
      supabaseClient: mockServer,
      session: makeSession(userA, -120),
      userId: userA,
      workshopId: workshop1,
      isOnline: true
    })
    expect(expiredSync.abortedReason).toBe('session_expired')
  })
})
