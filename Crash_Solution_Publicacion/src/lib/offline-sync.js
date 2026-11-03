import { isSessionExpired } from './auth.js'

export const OFFLINE_DB_NAME = 'mitaller_offline_db_v1'
export const OFFLINE_DB_VERSION = 1

const STORES = {
  JOBS: 'workshop_jobs',
  QUEUE: 'sync_queue',
  CONFLICTS: 'conflicts',
  META: 'migration_meta'
}

const SENSITIVE_KEYS = new Set([
  'password',
  'confirmPassword',
  'access_token',
  'refresh_token',
  'service_role',
  'service_role_key',
  'secret'
])

/**
 * Estado del propietario autenticado actualmente en memoria.
 * Cuando se cierra la sesión, activeAuthenticatedUserId pasa a null (bloqueado),
 * impidiendo que la interfaz o un segundo usuario lean datos locales de otro usuario,
 * pero conservando intactos en IndexedDB todos los trabajos pendientes de sincronización.
 */
let activeAuthenticatedUserId = null

export function setOfflineSessionOwner(userId) {
  activeAuthenticatedUserId = userId ? String(userId).trim() : null
}

export function getOfflineSessionOwner() {
  return activeAuthenticatedUserId
}

/**
 * Verifica que el usuario que solicita acceder a los datos locales coincida con el propietario
 * de los registros cuando se controla el aislamiento entre sesiones.
 */
function canAccessUserScope(targetUserId, activeUserId = activeAuthenticatedUserId) {
  if (!targetUserId) return false
  // Si se estableció un usuario autenticado activo, solo puede acceder a su propio scope
  if (activeUserId !== null && String(activeUserId).trim() !== String(targetUserId).trim()) {
    return false
  }
  return true
}

/**
 * Elimina recursivamente cualquier campo sensible (contraseñas, tokens o claves secretas)
 * antes de persistir objetos en almacenamiento local / IndexedDB.
 */
export function stripSensitiveFields(input) {
  if (Array.isArray(input)) {
    return input.map(stripSensitiveFields)
  }
  if (input && typeof input === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(input)) {
      if (SENSITIVE_KEYS.has(k)) continue
      out[k] = stripSensitiveFields(v)
    }
    return out
  }
  return input
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(k => [k, canonicalize(value[k])])
    )
  }
  return value
}

export function computeJobContentHash(job) {
  if (!job || typeof job !== 'object') return ''
  const copy = JSON.parse(JSON.stringify(stripSensitiveFields(job)))
  delete copy.cloudRevision
  delete copy.cloudHash
  delete copy.updatedAt
  delete copy.number
  delete copy.syncStatus
  return JSON.stringify(canonicalize(copy))
}

export function buildScopePrefix(userId, workshopId) {
  if (!userId || !workshopId) {
    throw new Error('Se requieren userId y workshopId para aislar los datos locales.')
  }
  return `${String(userId).trim()}::${String(workshopId).trim()}`
}

export function buildScopedEntityKey(userId, workshopId, entityId) {
  return `${buildScopePrefix(userId, workshopId)}::${String(entityId).trim()}`
}

export function buildIdempotencyKey({ userId, workshopId, entityId, contentHash }) {
  return `${buildScopePrefix(userId, workshopId)}::job::${String(entityId).trim()}::${contentHash}`
}

// ============================================================================
// Adaptador IndexedDB con soporte nativo en navegador y respaldo en memoria
// ============================================================================
const memoryFallbackStores = {
  [STORES.JOBS]: new Map(),
  [STORES.QUEUE]: new Map(),
  [STORES.CONFLICTS]: new Map(),
  [STORES.META]: new Map()
}

let cachedDbPromise = null

function hasNativeIndexedDb() {
  return typeof globalThis !== 'undefined' && typeof globalThis.indexedDB !== 'undefined' && globalThis.indexedDB !== null
}

function openOfflineDatabase() {
  if (!hasNativeIndexedDb()) {
    return Promise.resolve(null)
  }
  if (cachedDbPromise) return cachedDbPromise

  cachedDbPromise = new Promise((resolve, reject) => {
    try {
      const req = globalThis.indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORES.JOBS)) {
          db.createObjectStore(STORES.JOBS, { keyPath: 'scopeKey' })
        }
        if (!db.objectStoreNames.contains(STORES.QUEUE)) {
          db.createObjectStore(STORES.QUEUE, { keyPath: 'operationKey' })
        }
        if (!db.objectStoreNames.contains(STORES.CONFLICTS)) {
          db.createObjectStore(STORES.CONFLICTS, { keyPath: 'conflictKey' })
        }
        if (!db.objectStoreNames.contains(STORES.META)) {
          db.createObjectStore(STORES.META, { keyPath: 'metaKey' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        cachedDbPromise = null
        reject(req.error)
      }
    } catch (err) {
      cachedDbPromise = null
      reject(err)
    }
  })

  return cachedDbPromise
}

async function dbPut(storeName, keyField, record) {
  const cleanRecord = JSON.parse(JSON.stringify(stripSensitiveFields(record)))
  memoryFallbackStores[storeName].set(cleanRecord[keyField], cleanRecord)

  const db = await openOfflineDatabase().catch(() => null)
  if (!db) return cleanRecord

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    store.put(cleanRecord)
    tx.oncomplete = () => resolve(cleanRecord)
    tx.onerror = () => reject(tx.error)
  })
}

async function dbGet(storeName, key) {
  const db = await openOfflineDatabase().catch(() => null)
  if (!db) {
    const item = memoryFallbackStores[storeName].get(key)
    return item ? JSON.parse(JSON.stringify(item)) : null
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const req = store.get(key)
    req.onsuccess = () => {
      const res = req.result || memoryFallbackStores[storeName].get(key) || null
      resolve(res ? JSON.parse(JSON.stringify(res)) : null)
    }
    req.onerror = () => reject(req.error)
  })
}

async function dbGetAll(storeName) {
  const db = await openOfflineDatabase().catch(() => null)
  if (!db) {
    return Array.from(memoryFallbackStores[storeName].values()).map(v => JSON.parse(JSON.stringify(v)))
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const req = store.getAll()
    req.onsuccess = () => {
      const idbValues = Array.isArray(req.result) ? req.result : []
      if (idbValues.length > 0) {
        resolve(idbValues.map(v => JSON.parse(JSON.stringify(v))))
      } else {
        resolve(Array.from(memoryFallbackStores[storeName].values()).map(v => JSON.parse(JSON.stringify(v))))
      }
    }
    req.onerror = () => reject(req.error)
  })
}

async function dbDelete(storeName, key) {
  memoryFallbackStores[storeName].delete(key)
  const db = await openOfflineDatabase().catch(() => null)
  if (!db) return true

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    store.delete(key)
    tx.oncomplete = () => resolve(true)
    tx.onerror = () => reject(tx.error)
  })
}

async function dbClearStore(storeName) {
  memoryFallbackStores[storeName].clear()
  const db = await openOfflineDatabase().catch(() => null)
  if (!db) return true

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    store.clear()
    tx.oncomplete = () => resolve(true)
    tx.onerror = () => reject(tx.error)
  })
}

// ============================================================================
// 1. Persistencia Local en IndexedDB aislada por Usuario y Taller + Migración
// ============================================================================

/**
 * Guarda un trabajo en IndexedDB diferenciando explícitamente su estado:
 * - syncStatus: 'synced' (sincronizado con Supabase) | 'pending' (modificado offline / pendiente) | 'conflict'
 */
export async function saveOfflineJob({ userId, workshopId, job, syncStatus = 'synced' }) {
  if (!job?.id) throw new Error('El trabajo debe tener un id válido.')
  if (!canAccessUserScope(userId)) {
    throw new Error('Acceso denegado: no podés modificar datos locales pertenecientes a otro usuario.')
  }

  const scopeKey = buildScopedEntityKey(userId, workshopId, job.id)
  const cleanJob = stripSensitiveFields(job)
  const contentHash = computeJobContentHash(cleanJob)

  const existing = await dbGet(STORES.JOBS, scopeKey)
  const baseRevision =
    syncStatus === 'synced'
      ? Number(cleanJob.cloudRevision) || 0
      : existing?.baseRevision ?? (Number(cleanJob.cloudRevision) || 0)

  const record = {
    scopeKey,
    userId: String(userId).trim(),
    workshopId: String(workshopId).trim(),
    jobId: cleanJob.id,
    job: {
      ...cleanJob,
      syncStatus,
      cloudHash: syncStatus === 'synced' ? contentHash : cleanJob.cloudHash || ''
    },
    contentHash,
    baseRevision,
    syncStatus, // 'synced' | 'pending' | 'conflict'
    sessionLocked: false,
    updatedAt: cleanJob.updatedAt || new Date().toISOString()
  }

  await dbPut(STORES.JOBS, 'scopeKey', record)
  return record
}

/**
 * Obtiene los trabajos almacenados en IndexedDB para el usuario y taller indicados.
 * Bloquea el acceso si la sesión está bloqueada por cierre de sesión o si otro usuario está activo.
 */
export async function getOfflineJobsForScope(
  userId,
  workshopId,
  { activeUserId = activeAuthenticatedUserId, includeMetadata = false } = {}
) {
  if (!userId || !workshopId) return []
  if (!canAccessUserScope(userId, activeUserId)) {
    return []
  }

  const prefix = `${buildScopePrefix(userId, workshopId)}::`
  const all = await dbGetAll(STORES.JOBS)
  const matching = all
    .filter(r => r.scopeKey && r.scopeKey.startsWith(prefix))
    // Si la sesión del propietario se cerró (sessionLocked === true) y aún no se re-autenticó, bloquear lectura
    .filter(r => !r.sessionLocked || (activeUserId && String(activeUserId).trim() === String(userId).trim()))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))

  if (includeMetadata) {
    return matching
  }

  return matching.map(r => ({
    ...r.job,
    syncStatus: r.syncStatus || 'synced'
  }))
}

/**
 * Permite diferenciar claramente los trabajos sincronizados ('synced') de los no sincronizados ('pending' | 'conflict')
 * para un usuario y taller.
 */
export async function getOfflineSyncBreakdown(userId, workshopId) {
  if (!userId || !workshopId) {
    return { syncedJobs: [], unsyncedJobs: [], pendingCount: 0, conflictCount: 0 }
  }
  const records = await getOfflineJobsForScope(userId, workshopId, { includeMetadata: true })
  const [pendingOps, conflicts] = await Promise.all([
    getPendingSyncOperations(userId, workshopId),
    getUnresolvedConflicts(userId, workshopId)
  ])

  const pendingIds = new Set(pendingOps.map(op => op.entityId))
  const conflictIds = new Set(conflicts.map(c => c.jobId))

  const syncedJobs = []
  const unsyncedJobs = []

  for (const r of records) {
    const isUnsynced =
      r.syncStatus !== 'synced' || pendingIds.has(r.jobId) || conflictIds.has(r.jobId)
    const enriched = {
      ...r.job,
      syncStatus: conflictIds.has(r.jobId)
        ? 'conflict'
        : pendingIds.has(r.jobId) || r.syncStatus === 'pending'
          ? 'pending'
          : 'synced'
    }
    if (isUnsynced) {
      unsyncedJobs.push(enriched)
    } else {
      syncedJobs.push(enriched)
    }
  }

  return {
    syncedJobs,
    unsyncedJobs,
    pendingCount: pendingOps.length,
    conflictCount: conflicts.length
  }
}

/**
 * Migra de forma verificada y sin duplicados los trabajos existentes en localStorage
 * hacia IndexedDB para el usuario y taller activos, SIN borrar ni sobrescribir localStorage.
 */
export async function migrateLegacyLocalStorageJobs({
  userId,
  workshopId,
  storageObj = globalThis.localStorage,
  storageKey = 'crash_solution_presentation_v1'
}) {
  if (!userId || !workshopId || !storageObj) {
    return { migratedCount: 0, skippedCount: 0, alreadyMigrated: false }
  }

  const metaKey = `legacy_migrated::${buildScopePrefix(userId, workshopId)}`
  const existingMeta = await dbGet(STORES.META, metaKey)

  let rawStr = null
  try {
    rawStr = storageObj.getItem(storageKey)
  } catch {
    return { migratedCount: 0, skippedCount: 0, alreadyMigrated: Boolean(existingMeta) }
  }

  if (!rawStr) {
    return { migratedCount: 0, skippedCount: 0, alreadyMigrated: Boolean(existingMeta) }
  }

  let parsed = null
  try {
    parsed = JSON.parse(rawStr)
  } catch {
    return { migratedCount: 0, skippedCount: 0, alreadyMigrated: Boolean(existingMeta) }
  }

  const legacyJobs = Array.isArray(parsed?.jobs) ? parsed.jobs : []
  let migratedCount = 0
  let skippedCount = 0

  for (const job of legacyJobs) {
    if (!job?.id || String(job.id).startsWith('seed-')) {
      skippedCount++
      continue
    }
    if (!job?.rec?.cliente?.trim() && !job?.rec?.patente?.trim()) {
      skippedCount++
      continue
    }
    const scopeKey = buildScopedEntityKey(userId, workshopId, job.id)
    const existingRecord = await dbGet(STORES.JOBS, scopeKey)
    if (existingRecord) {
      skippedCount++
      continue
    }
    const isSynced = Boolean(job.cloudRevision && Number(job.cloudRevision) > 0)
    await saveOfflineJob({
      userId,
      workshopId,
      job,
      syncStatus: isSynced ? 'synced' : 'pending'
    })
    if (!isSynced && job.rec?.cliente?.trim() && job.rec?.patente?.trim()) {
      await enqueueJobSyncOperation({ userId, workshopId, job })
    }
    migratedCount++
  }

  await dbPut(STORES.META, 'metaKey', {
    metaKey,
    userId,
    workshopId,
    migratedCount,
    migratedAt: new Date().toISOString()
  })

  return { migratedCount, skippedCount, alreadyMigrated: Boolean(existingMeta) }
}

// ============================================================================
// 2. Cola Persistente e Idempotente de Operaciones Pendientes
// ============================================================================

export async function enqueueJobSyncOperation({ userId, workshopId, job }) {
  if (!userId || !workshopId || !job?.id) {
    throw new Error('Datos insuficientes para encolar la sincronización del trabajo.')
  }
  if (!canAccessUserScope(userId)) {
    throw new Error('Acceso denegado: no podés encolar operaciones para otro usuario.')
  }
  if (!job?.rec?.cliente?.trim() || !job?.rec?.patente?.trim()) {
    return null
  }

  const cleanJob = stripSensitiveFields(job)
  const contentHash = computeJobContentHash(cleanJob)
  const operationKey = buildScopedEntityKey(userId, workshopId, cleanJob.id)
  const idempotencyKey = buildIdempotencyKey({
    userId,
    workshopId,
    entityId: cleanJob.id,
    contentHash
  })

  // Guardar primero el estado local actualizado en IndexedDB marcado como 'pending'
  const savedLocal = await saveOfflineJob({
    userId,
    workshopId,
    job: cleanJob,
    syncStatus: 'pending'
  })

  const existingOp = await dbGet(STORES.QUEUE, operationKey)

  // Idempotencia: conservar la baseRevision original del trabajo antes de las ediciones offline
  const baseRevision =
    existingOp && typeof existingOp.baseRevision === 'number'
      ? existingOp.baseRevision
      : savedLocal.baseRevision

  const queueRecord = {
    operationKey,
    idempotencyKey,
    userId: String(userId).trim(),
    workshopId: String(workshopId).trim(),
    entityType: 'job',
    entityId: cleanJob.id,
    action: 'UPSERT_JOB',
    payload: { ...cleanJob, syncStatus: 'pending' },
    contentHash,
    baseRevision,
    attempts: existingOp?.idempotencyKey === idempotencyKey ? existingOp.attempts || 0 : 0,
    status: 'pending',
    sessionLocked: false,
    lastError: null,
    createdAt: existingOp?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  await dbPut(STORES.QUEUE, 'operationKey', queueRecord)
  return queueRecord
}

export async function getPendingSyncOperations(
  userId,
  workshopId,
  { activeUserId = activeAuthenticatedUserId } = {}
) {
  if (!userId || !workshopId) return []
  if (!canAccessUserScope(userId, activeUserId)) {
    return []
  }

  const prefix = `${buildScopePrefix(userId, workshopId)}::`
  const all = await dbGetAll(STORES.QUEUE)
  return all
    .filter(op => op.operationKey?.startsWith(prefix) && op.status !== 'conflict')
    .filter(op => !op.sessionLocked || (activeUserId && String(activeUserId).trim() === String(userId).trim()))
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
}

export async function getUnresolvedConflicts(
  userId,
  workshopId,
  { activeUserId = activeAuthenticatedUserId } = {}
) {
  if (!userId || !workshopId) return []
  if (!canAccessUserScope(userId, activeUserId)) {
    return []
  }

  const prefix = `${buildScopePrefix(userId, workshopId)}::`
  const all = await dbGetAll(STORES.CONFLICTS)
  return all
    .filter(c => c.conflictKey?.startsWith(prefix))
    .filter(c => !c.sessionLocked || (activeUserId && String(activeUserId).trim() === String(userId).trim()))
}

// ============================================================================
// 3. Sincronización con Supabase, Idempotencia en Reintentos y Detección de Conflictos
// ============================================================================

const inFlightIdempotencyKeys = new Set()
const completedIdempotencyKeys = new Set()

export async function processSyncQueue({
  supabaseClient,
  session,
  userId,
  workshopId,
  isOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true
}) {
  if (!isOnline) {
    return {
      synced: 0,
      conflicts: 0,
      skipped: 0,
      abortedReason: 'offline'
    }
  }

  // Seguridad: Nunca sincronizar datos con una sesión expirada o inexistente
  if (!session || isSessionExpired(session)) {
    return {
      synced: 0,
      conflicts: 0,
      skipped: 0,
      abortedReason: 'session_expired'
    }
  }

  // Seguridad: Verificar que el usuario autenticado en el JWT coincida con el propietario de los datos locales
  if (session.user?.id && String(session.user.id).trim() !== String(userId || '').trim()) {
    return {
      synced: 0,
      conflicts: 0,
      skipped: 0,
      abortedReason: 'user_mismatch'
    }
  }

  if (!supabaseClient || !userId || !workshopId) {
    return {
      synced: 0,
      conflicts: 0,
      skipped: 0,
      abortedReason: 'missing_context'
    }
  }

  // Desbloquear la sesión para el propietario legítimo que acaba de autenticarse
  await unlockOfflineDataForAuthenticatedOwner(userId)

  const pendingOps = await getPendingSyncOperations(userId, workshopId, { activeUserId: userId })
  let synced = 0
  let conflicts = 0
  let skipped = 0
  const errors = []

  for (const op of pendingOps) {
    if (inFlightIdempotencyKeys.has(op.idempotencyKey)) {
      skipped++
      continue
    }

    inFlightIdempotencyKeys.add(op.idempotencyKey)

    try {
      const localJob = op.payload
      // 1. Consultar versión actual en Supabase para detectar conflictos entre dispositivos
      const { data: remoteRow, error: fetchErr } = await supabaseClient
        .from('jobs')
        .select('id, workshop_id, job_number, status, revision, payload, customer_name, vehicle_plate, created_at, updated_at')
        .eq('id', localJob.id)
        .eq('workshop_id', workshopId)
        .maybeSingle()

      if (fetchErr) {
        throw fetchErr
      }

      if (remoteRow) {
        const remoteRevision = Number(remoteRow.revision) || 0
        const remoteJobPayload = remoteRow.payload && typeof remoteRow.payload === 'object' ? remoteRow.payload : {}
        const remoteHash = computeJobContentHash(remoteJobPayload)

        // Si el contenido remoto ya es idéntico al que intentamos subir (reintento idempotente),
        // damos por sincronizada la operación sin volver a escribir ni duplicar.
        if (remoteHash === op.contentHash) {
          completedIdempotencyKeys.add(op.idempotencyKey)
          await dbDelete(STORES.QUEUE, op.operationKey)
          await saveOfflineJob({
            userId,
            workshopId,
            job: { ...localJob, cloudRevision: remoteRevision, cloudHash: remoteHash, syncStatus: 'synced' },
            syncStatus: 'synced'
          })
          synced++
          continue
        }

        // Conflicto real: el servidor tiene una revisión mayor a la baseRevision local
        // y el contenido difiere. NO sobrescribimos silenciosamente.
        if (remoteRevision > (Number(op.baseRevision) || 0)) {
          const conflictKey = buildScopedEntityKey(userId, workshopId, localJob.id)
          const remoteJobNormalized = {
            ...remoteJobPayload,
            id: remoteRow.id,
            number: remoteRow.job_number || remoteJobPayload.number || `OT-${String(remoteRow.id).slice(0, 6).toUpperCase()}`,
            status: remoteRow.status || remoteJobPayload.status || 'Borrador',
            cloudRevision: remoteRevision,
            updatedAt: remoteRow.updated_at || remoteJobPayload.updatedAt,
            rec: {
              ...(remoteJobPayload.rec || {}),
              cliente: remoteRow.customer_name || remoteJobPayload.rec?.cliente || '',
              patente: remoteRow.vehicle_plate || remoteJobPayload.rec?.patente || ''
            }
          }

          await dbPut(STORES.CONFLICTS, 'conflictKey', {
            conflictKey,
            userId: String(userId).trim(),
            workshopId: String(workshopId).trim(),
            jobId: localJob.id,
            localJob,
            remoteJob: remoteJobNormalized,
            baseRevision: op.baseRevision,
            remoteRevision,
            sessionLocked: false,
            detectedAt: new Date().toISOString()
          })

          await dbPut(STORES.QUEUE, 'operationKey', {
            ...op,
            status: 'conflict',
            updatedAt: new Date().toISOString()
          })

          await saveOfflineJob({
            userId,
            workshopId,
            job: localJob,
            syncStatus: 'conflict'
          })

          conflicts++
          continue
        }
      }

      // 2. Sin conflicto: persistir en Supabase incrementando la revisión
      const nextRevision = remoteRow ? (Number(remoteRow.revision) || 0) + 1 : (Number(op.baseRevision) || 0) + 1
      const updatedJob = {
        ...localJob,
        cloudRevision: nextRevision,
        cloudHash: op.contentHash,
        syncStatus: 'synced',
        updatedAt: new Date().toISOString()
      }

      const { error: upsertErr } = await supabaseClient.from('jobs').upsert(
        {
          id: updatedJob.id,
          workshop_id: workshopId,
          job_number: updatedJob.number || `OT-${String(updatedJob.id).slice(0, 6).toUpperCase()}`,
          status: updatedJob.status || 'Borrador',
          revision: nextRevision,
          customer_name: String(updatedJob.rec?.cliente || '').trim(),
          vehicle_plate: String(updatedJob.rec?.patente || '').trim().toUpperCase(),
          payload: updatedJob,
          updated_at: updatedJob.updatedAt
        },
        { onConflict: 'id' }
      )

      if (upsertErr) {
        throw upsertErr
      }

      completedIdempotencyKeys.add(op.idempotencyKey)
      await dbDelete(STORES.QUEUE, op.operationKey)
      await saveOfflineJob({
        userId,
        workshopId,
        job: updatedJob,
        syncStatus: 'synced'
      })
      synced++
    } catch (err) {
      errors.push(err?.message || 'Error de sincronización')
      await dbPut(STORES.QUEUE, 'operationKey', {
        ...op,
        attempts: (op.attempts || 0) + 1,
        status: 'pending',
        lastError: String(err?.message || 'Error de red'),
        updatedAt: new Date().toISOString()
      })
    } finally {
      inFlightIdempotencyKeys.delete(op.idempotencyKey)
    }
  }

  return {
    synced,
    conflicts,
    skipped,
    errors,
    abortedReason: null
  }
}

/**
 * Resolución explícita de conflictos por decisión del usuario:
 * - 'keep_local': conserva la edición local actualizando baseRevision a la versión remota y re-encolando.
 * - 'keep_remote': adopta la versión más reciente del servidor y descarta la operación en conflicto.
 * - 'keep_both': conserva la versión remota bajo el ID original y crea una copia nueva independiente con la edición local.
 */
export async function resolveSyncConflict({
  userId,
  workshopId,
  jobId,
  strategy,
  newJobIdGenerator = () => globalThis.crypto?.randomUUID?.() || `job-${Date.now()}`
}) {
  if (!canAccessUserScope(userId)) {
    throw new Error('Acceso denegado: solo el propietario autenticado puede resolver este conflicto.')
  }

  const conflictKey = buildScopedEntityKey(userId, workshopId, jobId)
  const conflict = await dbGet(STORES.CONFLICTS, conflictKey)
  if (!conflict) {
    throw new Error('No se encontró el conflicto especificado.')
  }

  const operationKey = buildScopedEntityKey(userId, workshopId, jobId)

  if (strategy === 'keep_remote') {
    await dbDelete(STORES.QUEUE, operationKey)
    await dbDelete(STORES.CONFLICTS, conflictKey)
    await saveOfflineJob({
      userId,
      workshopId,
      job: { ...conflict.remoteJob, syncStatus: 'synced' },
      syncStatus: 'synced'
    })
    return { resolvedJob: conflict.remoteJob, createdCopy: null }
  }

  if (strategy === 'keep_local') {
    await dbDelete(STORES.CONFLICTS, conflictKey)
    await dbDelete(STORES.QUEUE, operationKey)
    const rebasedLocal = {
      ...conflict.localJob,
      cloudRevision: conflict.remoteRevision,
      updatedAt: new Date().toISOString()
    }
    await saveOfflineJob({
      userId,
      workshopId,
      job: rebasedLocal,
      syncStatus: 'synced' // Fija baseRevision = conflict.remoteRevision
    })
    await enqueueJobSyncOperation({
      userId,
      workshopId,
      job: rebasedLocal
    })
    return { resolvedJob: rebasedLocal, createdCopy: null }
  }

  if (strategy === 'keep_both') {
    await dbDelete(STORES.QUEUE, operationKey)
    await dbDelete(STORES.CONFLICTS, conflictKey)
    await saveOfflineJob({
      userId,
      workshopId,
      job: { ...conflict.remoteJob, syncStatus: 'synced' },
      syncStatus: 'synced'
    })

    const newId = newJobIdGenerator()
    const copiedLocal = {
      ...JSON.parse(JSON.stringify(conflict.localJob)),
      id: newId,
      number: `OT-${String(newId).slice(0, 6).toUpperCase()}`,
      cloudRevision: 0,
      cloudHash: '',
      syncStatus: 'pending',
      updatedAt: new Date().toISOString()
    }
    await enqueueJobSyncOperation({
      userId,
      workshopId,
      job: copiedLocal
    })
    return { resolvedJob: conflict.remoteJob, createdCopy: copiedLocal }
  }

  throw new Error('Estrategia de resolución de conflicto no válida.')
}

// ============================================================================
// 4. Protección de Datos Offline al Cerrar Sesión (Sin Pérdida de Datos Pendientes)
// ============================================================================

/**
 * Devuelve cuántos trabajos/operaciones pendientes o en conflicto tiene un usuario
 * en todos sus talleres locales antes de cerrar sesión.
 */
export async function getUnsyncedSummaryForUser(userId) {
  if (!userId) return { pendingCount: 0, conflictCount: 0, totalUnsynced: 0 }
  const userPrefix = `${String(userId).trim()}::`
  const [queue, conflicts] = await Promise.all([
    dbGetAll(STORES.QUEUE),
    dbGetAll(STORES.CONFLICTS)
  ])
  const userQueue = queue.filter(q => q.operationKey?.startsWith(userPrefix) && q.status !== 'conflict')
  const userConflicts = conflicts.filter(c => c.conflictKey?.startsWith(userPrefix))
  return {
    pendingCount: userQueue.length,
    conflictCount: userConflicts.length,
    totalUnsynced: userQueue.length + userConflicts.length
  }
}

/**
 * Al cerrar sesión:
 * 1. NUNCA elimina trabajos pendientes de sincronización ('pending') ni conflictos ('conflict').
 * 2. Marca todos los registros del usuario en IndexedDB con `sessionLocked: true` para que
 *    queden bloqueados y ningún otro usuario ni sesión no autenticada pueda leerlos.
 * 3. Elimina de la caché rápida únicamente copias locales que YA estaban 100% sincronizadas ('synced')
 *    si no tienen operaciones pendientes, reduciendo la huella local sin perder ningún cambio.
 * 4. Limpia la memoria activa de la interfaz y el localStorage compartido (previa migración a IndexedDB).
 */
export async function lockOfflineDataOnLogout({
  userId = null,
  workshopId = null,
  storageObj = globalThis.localStorage
} = {}) {
  // Antes de limpiar localStorage compartido, asegurar que cualquier edición del usuario activo esté en IndexedDB
  if (userId && workshopId && storageObj) {
    await migrateLegacyLocalStorageJobs({ userId, workshopId, storageObj }).catch(() => {})
  }

  const [allJobs, allQueue, allConflicts] = await Promise.all([
    dbGetAll(STORES.JOBS),
    dbGetAll(STORES.QUEUE),
    dbGetAll(STORES.CONFLICTS)
  ])

  const targetPrefix = userId ? `${String(userId).trim()}::` : null
  const pendingJobKeys = new Set(allQueue.map(q => q.operationKey))
  const conflictJobKeys = new Set(allConflicts.map(c => c.conflictKey))

  let preservedUnsyncedCount = 0
  let clearedSyncedCacheCount = 0

  for (const jobRec of allJobs) {
    if (targetPrefix && !jobRec.scopeKey?.startsWith(targetPrefix)) continue

    const isUnsynced =
      jobRec.syncStatus !== 'synced' ||
      pendingJobKeys.has(jobRec.scopeKey) ||
      conflictJobKeys.has(jobRec.scopeKey)

    if (isUnsynced) {
      // Conservar intacto el trabajo pendiente y bloquear su acceso hasta que se re-autentique su propietario
      await dbPut(STORES.JOBS, 'scopeKey', {
        ...jobRec,
        sessionLocked: true,
        lockedAt: new Date().toISOString()
      })
      preservedUnsyncedCount++
    } else {
      // Los trabajos que ya fueron confirmados en el servidor pueden limpiarse de la caché local al salir
      await dbDelete(STORES.JOBS, jobRec.scopeKey)
      clearedSyncedCacheCount++
    }
  }

  for (const qRec of allQueue) {
    if (targetPrefix && !qRec.operationKey?.startsWith(targetPrefix)) continue
    await dbPut(STORES.QUEUE, 'operationKey', {
      ...qRec,
      sessionLocked: true,
      lockedAt: new Date().toISOString()
    })
  }

  for (const cRec of allConflicts) {
    if (targetPrefix && !cRec.conflictKey?.startsWith(targetPrefix)) continue
    await dbPut(STORES.CONFLICTS, 'conflictKey', {
      ...cRec,
      sessionLocked: true,
      lockedAt: new Date().toISOString()
    })
  }

  // Bloquear el propietario activo en memoria
  setOfflineSessionOwner(null)

  if (storageObj) {
    try {
      storageObj.removeItem('crash_solution_presentation_v1')
      storageObj.removeItem('mitaller_active_workshop_id')
    } catch {
      // Ignorar errores de acceso a storage
    }
  }

  return {
    preservedUnsyncedCount,
    clearedSyncedCacheCount
  }
}

/**
 * Desbloquea los registros locales pendientes en IndexedDB cuando el propietario original
 * vuelve a iniciar sesión válidamente.
 */
export async function unlockOfflineDataForAuthenticatedOwner(userId) {
  if (!userId) return { unlockedJobs: 0, unlockedQueue: 0 }
  const cleanUserId = String(userId).trim()
  setOfflineSessionOwner(cleanUserId)

  const userPrefix = `${cleanUserId}::`
  const [allJobs, allQueue, allConflicts] = await Promise.all([
    dbGetAll(STORES.JOBS),
    dbGetAll(STORES.QUEUE),
    dbGetAll(STORES.CONFLICTS)
  ])

  let unlockedJobs = 0
  let unlockedQueue = 0

  for (const jobRec of allJobs) {
    if (jobRec.scopeKey?.startsWith(userPrefix) && jobRec.sessionLocked) {
      await dbPut(STORES.JOBS, 'scopeKey', {
        ...jobRec,
        sessionLocked: false
      })
      unlockedJobs++
    }
  }

  for (const qRec of allQueue) {
    if (qRec.operationKey?.startsWith(userPrefix) && qRec.sessionLocked) {
      await dbPut(STORES.QUEUE, 'operationKey', {
        ...qRec,
        sessionLocked: false
      })
      unlockedQueue++
    }
  }

  for (const cRec of allConflicts) {
    if (cRec.conflictKey?.startsWith(userPrefix) && cRec.sessionLocked) {
      await dbPut(STORES.CONFLICTS, 'conflictKey', {
        ...cRec,
        sessionLocked: false
      })
    }
  }

  return { unlockedJobs, unlockedQueue }
}

/**
 * Mantiene compatibilidad con llamadas existentes redirigiendo a `lockOfflineDataOnLogout`,
 * garantizando que NUNCA se eliminen automáticamente trabajos pendientes al cerrar sesión.
 */
export async function purgePrivateOfflineDataOnLogout(options = {}) {
  return await lockOfflineDataOnLogout(options)
}

/**
 * Eliminación explícita de datos locales únicamente cuando el usuario lo solicita de forma expresa
 * (o para reiniciar el entorno en pruebas automatizadas con confirmUnsyncedDeletion = true).
 */
export async function explicitPurgeLocalWorkshopData({
  userId = null,
  workshopId = null,
  confirmUnsyncedDeletion = false
} = {}) {
  if (!confirmUnsyncedDeletion) {
    throw new Error(
      'No se pueden eliminar datos locales sin confirmación explícita del usuario (confirmUnsyncedDeletion: true).'
    )
  }

  if (!userId && !workshopId) {
    await Promise.all([
      dbClearStore(STORES.JOBS),
      dbClearStore(STORES.QUEUE),
      dbClearStore(STORES.CONFLICTS),
      dbClearStore(STORES.META)
    ])
    completedIdempotencyKeys.clear()
    inFlightIdempotencyKeys.clear()
    setOfflineSessionOwner(null)
    return true
  }

  const prefix = workshopId ? `${buildScopePrefix(userId, workshopId)}::` : `${String(userId).trim()}::`
  const [jobs, queue, conflicts] = await Promise.all([
    dbGetAll(STORES.JOBS),
    dbGetAll(STORES.QUEUE),
    dbGetAll(STORES.CONFLICTS)
  ])

  await Promise.all([
    ...jobs.filter(j => j.scopeKey?.startsWith(prefix)).map(j => dbDelete(STORES.JOBS, j.scopeKey)),
    ...queue.filter(q => q.operationKey?.startsWith(prefix)).map(q => dbDelete(STORES.QUEUE, q.operationKey)),
    ...conflicts.filter(c => c.conflictKey?.startsWith(prefix)).map(c => dbDelete(STORES.CONFLICTS, c.conflictKey))
  ])

  return true
}
