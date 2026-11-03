const NAV_STORAGE_KEY = 'mitaller_nav_state_v1'

const VALID_SCREENS = ['jobs', 'work', 'stock', 'profile', 'admin']
const VALID_STEPS = ['reception', 'inspection', 'budget']

export function buildNavigationSnapshot({
  userId = null,
  workshopId = null,
  screen = 'jobs',
  activeJobId = null,
  step = 'reception',
  area = 'Parte delantera',
  page = 0,
  activePieceKey = null,
  openPieceDetailsKeys = [],
  mapOpen = true,
  scrollY = 0,
  updatedAt = null
} = {}) {
  const normalizedScreen = VALID_SCREENS.includes(screen) ? screen : 'jobs'
  const normalizedStep = VALID_STEPS.includes(step) ? step : 'reception'
  const normalizedPage = Number.isFinite(Number(page)) ? Math.max(0, Math.floor(Number(page))) : 0
  const normalizedScrollY = Number.isFinite(Number(scrollY)) ? Math.max(0, Math.round(Number(scrollY))) : 0

  return {
    userId: userId ? String(userId) : null,
    workshopId: workshopId ? String(workshopId) : null,
    screen: normalizedScreen,
    activeJobId: activeJobId ? String(activeJobId) : null,
    step: normalizedStep,
    area: area ? String(area) : 'Parte delantera',
    page: normalizedPage,
    activePieceKey: activePieceKey ? String(activePieceKey) : null,
    openPieceDetailsKeys: Array.isArray(openPieceDetailsKeys)
      ? [...new Set(openPieceDetailsKeys.filter(Boolean).map(String))]
      : [],
    mapOpen: Boolean(mapOpen),
    scrollY: normalizedScrollY,
    updatedAt: updatedAt ? String(updatedAt) : new Date().toISOString()
  }
}

export function saveNavigationState(snapshotInput = {}, storage = globalThis.localStorage) {
  if (!storage || typeof storage.setItem !== 'function') return null
  const snapshot = buildNavigationSnapshot(snapshotInput)
  try {
    storage.setItem(NAV_STORAGE_KEY, JSON.stringify(snapshot))
    return snapshot
  } catch {
    return null
  }
}

export function loadNavigationState({ userId = null, workshopId = null } = {}, storage = globalThis.localStorage) {
  if (!storage || typeof storage.getItem !== 'function') return null
  try {
    const raw = storage.getItem(NAV_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null

    if (userId && parsed.userId && String(parsed.userId) !== String(userId)) {
      return null
    }
    if (workshopId && parsed.workshopId && String(parsed.workshopId) !== String(workshopId)) {
      return null
    }

    return buildNavigationSnapshot(parsed)
  } catch {
    return null
  }
}

export function clearNavigationState(storage = globalThis.localStorage) {
  if (!storage || typeof storage.removeItem !== 'function') return
  try {
    storage.removeItem(NAV_STORAGE_KEY)
  } catch {
    // Ignore storage removal errors
  }
}

/**
 * Determina si un evento de Supabase Auth debe reinicializar la pantalla activa.
 * Cuando Chrome vuelve de otra pestaña, Supabase emite SIGNED_IN o TOKEN_REFRESHED
 * para el mismo usuario que ya tiene la pantalla abierta. En ese caso NO debe
 * reiniciarse la pantalla ni cerrarse la inspección activa.
 */
export function shouldReinitializeOnAuthEvent({
  event,
  previousUserId = null,
  nextUserId = null,
  isInitialized = false
} = {}) {
  if (!nextUserId) return true
  if (!isInitialized) return true
  if (!previousUserId || String(previousUserId) !== String(nextUserId)) return true
  if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
    return false
  }
  return true
}
