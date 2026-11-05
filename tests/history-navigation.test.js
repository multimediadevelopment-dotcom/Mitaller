import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const backend = vi.hoisted(() => ({ auth: {
  getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
  onAuthStateChange: vi.fn(), updateUser: vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })),
  signOut: vi.fn(async () => ({ error: null }))
} }))
vi.mock('../Crash_Solution_Publicacion/src/lib/supabase.js', () => ({ supabase: backend, isSupabaseConfigured: true }))
vi.mock('../Crash_Solution_Publicacion/src/lib/stock.js', async importOriginal => ({
  ...await importOriginal(), fetchWorkshopStock: vi.fn(async () => []), fetchStockMovements: vi.fn(async () => [])
}))
vi.mock('../Crash_Solution_Publicacion/src/lib/admin.js', async importOriginal => ({
  ...await importOriginal(), fetchAdminWorkshopMembers: vi.fn(async () => []), fetchKnownUserProfiles: vi.fn(async () => [])
}))
vi.mock('../Crash_Solution_Publicacion/src/lib/workshop-profile.js', async importOriginal => ({
  ...await importOriginal(), fetchWorkshopProfile: vi.fn(async () => ({ id: 'w1', name: 'Taller de Prueba' }))
}))
vi.mock('../Crash_Solution_Publicacion/src/lib/auth.js', async importOriginal => ({
  ...await importOriginal(), ensureUserProfile: async () => ({ display_name: 'Invitado' }),
  fetchUserWorkshops: async () => [{ workshop_id: 'w1', role: 'staff', workshop: { id: 'w1', name: 'Taller de Prueba' } }]
}))
import { appAuthState, enforceRouteProtection, navigateAppRoute, persistCurrentNavigationState,
  resetAppRouter, wireNavigationPersistence, initAuthAndAdmin, renderConflictResolutionNotice } from '../Crash_Solution_Publicacion/src/main.js'
import { fetchWorkshopStock } from '../Crash_Solution_Publicacion/src/lib/stock.js'
import { routeHash, readAppRoute } from '../Crash_Solution_Publicacion/src/lib/app-router.js'

beforeAll(() => {
  window.scrollTo = vi.fn()
  window.showJobs = vi.fn(() => {
    window.screen = 'jobs'
    document.getElementById('jobsScreen').hidden = false
    document.getElementById('workScreen').hidden = true
  })
  window.openJob = vi.fn()
  window.fillReception = vi.fn()
  window.renderInspection = vi.fn()
  window.showStep = vi.fn(next => {
    window.step = next
    for (const step of ['reception', 'inspection', 'budget']) document.getElementById(`${step}Step`).hidden = step !== next
  })
  wireNavigationPersistence()
})
beforeEach(() => {
  resetAppRouter(); vi.clearAllMocks(); localStorage.clear()
  history.replaceState(null, '', '/')
  document.body.innerHTML = `<header><div id="headerAuthNav"></div><div class="header-tools"></div></header>
    <section id="authScreen" hidden></section><main id="mainAppContainer">
    <section id="jobsScreen"></section><section id="workScreen" hidden>
      <section id="receptionStep"><input value="Borrador conservado"></section><section id="inspectionStep" hidden></section><section id="budgetStep" hidden></section>
      <details id="mapDisclosure" open></details><details class="damage-details" data-piece-details="Motor|||Capó" open></details>
    </section><section id="adminScreen" hidden></section><section id="profileScreen" hidden></section><section id="stockScreen" hidden></section></main>`
  Object.assign(appAuthState, {
    user: { id: 'u1', email: 'ana@example.com' },
    session: { access_token: 'test', user: { id: 'u1' }, expires_at: Math.floor(Date.now() / 1000) + 3600 },
    profile: { display_name: 'Ana Pérez' }, activeWorkshopId: 'w1',
    memberships: [{ workshop_id: 'w1', role: 'owner', workshop: { id: 'w1', name: 'Taller de Prueba' } }],
    authMode: 'login', activePieceKey: null, openPieceDetailsKeys: [], unresolvedConflicts: [], stockItems: [], stockMovements: [], isOnline: true
  })
  window.store = { jobs: [{ id: 'job-1', area: 'Motor', rec: { cliente: 'Prueba', patente: 'TEST' }, quote: [] }], activeId: null }
  window.active = null; window.step = 'reception'; window.page = 0; window.screen = 'jobs'
})
afterEach(() => { resetAppRouter(); window.__headerMenuController?.abort() })

const click = id => document.getElementById(id).click()
async function at(hash, screen) {
  await vi.waitFor(() => {
    expect(location.hash).toBe(hash)
    expect(readAppRoute(location).name).toBe(screen)
    if (screen === 'password') {
      expect(document.getElementById('mainAppContainer').hidden).toBe(true)
      expect(document.getElementById('updatePassForm')).not.toBeNull()
      expect(document.querySelector('.primary-navigation [aria-current="page"]')).toBeNull()
      expect(document.getElementById('navChangePassBtn').getAttribute('aria-current')).toBe('page')
    } else {
      expect(document.getElementById('authScreen').hidden).toBe(true)
      expect(document.getElementById('updatePassForm')).toBeNull()
      expect(appAuthState.authMode).toBe('login')
      const id = { jobs: 'jobsScreen', stock: 'stockScreen', admin: 'adminScreen', profile: 'profileScreen', work: 'workScreen' }[screen]
      expect(document.getElementById(id).hidden).toBe(false)
      const selected = ['jobs', 'work'].includes(screen) ? 'navJobsBtn' : screen === 'admin' ? 'navAdminBtn' : screen === 'stock' ? 'navStockBtn' : null
      if (selected) expect(document.getElementById(selected).getAttribute('aria-current')).toBe('page')
    }
  })
}

describe('Historial integrado con URL, autenticación y sección visible', () => {
  it('separa los avisos de sincronización y conflictos de la validación del formulario', async () => {
    await enforceRouteProtection()
    document.getElementById('mainAppContainer').insertAdjacentHTML('afterbegin',
      '<div id="notice" data-validation="reception">Completá cliente y patente</div>')
    const formNotice = document.getElementById('notice')
    appAuthState.isSyncingOfflineQueue = false
    appAuthState.pendingSyncCount = 1
    renderConflictResolutionNotice()
    expect(formNotice.hidden).toBe(false)
    expect(formNotice.textContent).toBe('Completá cliente y patente')
    expect(document.getElementById('syncNotice').textContent).toContain('pendiente(s)')
    appAuthState.pendingSyncCount = 0
    renderConflictResolutionNotice()
    expect(document.getElementById('syncNotice').hidden).toBe(true)
    expect(formNotice.hidden).toBe(false)
    appAuthState.unresolvedConflicts = [{ jobId: 'job-1', localJob: window.store.jobs[0] }]
    renderConflictResolutionNotice()
    await navigateAppRoute({ name: 'stock' })
    expect(formNotice.hidden).toBe(true)
    expect(document.getElementById('syncNotice').hidden).toBe(false)
    expect(document.getElementById('resolveKeepBothBtn')).not.toBeNull()
    expect(appAuthState.unresolvedConflicts).toHaveLength(1)
  })

  it.each(['stock', 'admin', 'profile', 'password', 'jobs'])('limpia alertas al navegar a %s y no las restaura con Atrás', async section => {
    await enforceRouteProtection()
    await window.openJob('job-1', 'reception')
    const draft = window.active
    document.getElementById('mainAppContainer').insertAdjacentHTML('afterbegin',
      '<div id="notice" data-validation="reception">Completá cliente y patente</div><div id="syncNotice">Cambios pendientes</div>')
    document.getElementById('workScreen').insertAdjacentHTML('beforeend',
      '<div id="budgetDeliveryFeedback" class="auth-alert">Mensaje anterior</div>')
    await navigateAppRoute({ name: section })
    expect(document.getElementById('notice').hidden).toBe(true)
    expect(document.getElementById('notice').textContent).toBe('')
    expect(document.getElementById('budgetDeliveryFeedback').hidden).toBe(true)
    // A change of screen must not hide pending synchronization or modify its state.
    expect(document.getElementById('syncNotice').textContent).toBe('Cambios pendientes')
    history.back()
    await at('#/trabajos/job-1/reception', 'work')
    expect(document.getElementById('notice').hidden).toBe(true)
    expect(window.active).toBe(draft)
    expect(document.querySelector('#receptionStep input').value).toBe('Borrador conservado')
  })

  it('Atrás y Adelante reproducen Admin → contraseña → Trabajos sin encabezados desfasados', async () => {
    await enforceRouteProtection()
    click('navAdminBtn'); await at('#/admin', 'admin')
    click('navChangePassBtn'); await at('#update-password', 'password')
    click('navJobsBtn'); await at('#/trabajos', 'jobs')
    history.back(); await at('#update-password', 'password')
    history.back(); await at('#/admin', 'admin')
    history.forward(); await at('#update-password', 'password')
    history.forward(); await at('#/trabajos', 'jobs')
  })

  it('coalesce popstate y hashchange y no agrega entradas al renderizar ni al pulsar la sección actual', async () => {
    await enforceRouteProtection()
    const length = history.length
    await navigateAppRoute({ name: 'stock' })
    expect(history.length).toBe(length + 1)
    const calls = vi.mocked(fetchWorkshopStock).mock.calls.length
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await Promise.resolve(); await Promise.resolve()
    expect(fetchWorkshopStock).toHaveBeenCalledTimes(calls)
    click('navStockBtn'); await at('#/stock', 'stock')
    expect(history.length).toBe(length + 1)
    expect(fetchWorkshopStock).toHaveBeenCalledTimes(calls)
    history.back(); await at('#/trabajos', 'jobs')
    expect(history.length).toBe(length + 1)
  })

  it('una modificación directa del hash carga la sección una sola vez', async () => {
    await enforceRouteProtection()
    location.hash = '#/stock'
    await at('#/stock', 'stock')
    await vi.waitFor(() => expect(fetchWorkshopStock).toHaveBeenCalledTimes(1))
    location.hash = '#/trabajos'
    await at('#/trabajos', 'jobs')
  })

  it('conserva la inspección, pieza, página y mapa en cada entrada y al simular F5', async () => {
    await enforceRouteProtection()
    await window.openJob('job-1', 'inspection')
    window.page = 2
    appAuthState.activePieceKey = 'Motor|||Capó'
    document.getElementById('mapDisclosure').open = false
    persistCurrentNavigationState()
    const job = window.active
    click('navChangePassBtn'); await at('#update-password', 'password')
    click('navJobsBtn'); await at('#/trabajos', 'jobs')
    history.back(); await at('#update-password', 'password')
    history.back(); await at('#/trabajos/job-1/inspection', 'work')
    expect(window.active).toBe(job)
    expect(window.step).toBe('inspection')
    expect(window.page).toBe(2)
    expect(window.active.area).toBe('Motor')
    expect(appAuthState.activePieceKey).toBe('Motor|||Capó')
    expect(document.getElementById('mapDisclosure').open).toBe(false)
    expect(document.querySelector('[data-piece-details]').open).toBe(true)
    resetAppRouter(); window.active = null; window.step = 'reception'; window.page = 0
    await enforceRouteProtection()
    await at('#/trabajos/job-1/inspection', 'work')
    expect(window.step).toBe('inspection')
    expect(window.page).toBe(2)
    expect(window.fillReception).toHaveBeenCalled()
  })

  it('mantiene entradas distintas para los pasos del trabajo y vuelve sin recrear la ruta', async () => {
    await enforceRouteProtection()
    await window.openJob('job-1', 'reception')
    window.showStep('inspection')
    await at('#/trabajos/job-1/inspection', 'work')
    window.showStep('budget')
    await at('#/trabajos/job-1/budget', 'work')
    history.back(); await at('#/trabajos/job-1/inspection', 'work')
    expect(window.step).toBe('inspection')
    expect(document.getElementById('inspectionStep').hidden).toBe(false)
    history.forward(); await at('#/trabajos/job-1/budget', 'work')
    expect(window.step).toBe('budget')
  })

  it('F5 en contraseña conserva la ruta y Volver regresa a la sección anterior sin crear entradas', async () => {
    await enforceRouteProtection()
    click('navStockBtn'); await at('#/stock', 'stock')
    click('navChangePassBtn'); await at('#update-password', 'password')
    const length = history.length
    resetAppRouter(); appAuthState.authMode = 'login'
    await enforceRouteProtection()
    await at('#update-password', 'password')
    click('cancelUpdatePassBtn'); await at('#/stock', 'stock')
    expect(history.length).toBe(length)
  })

  it('la ruta explícita Trabajos prevalece sobre un snapshot anterior de Stock al recargar', async () => {
    await enforceRouteProtection()
    await navigateAppRoute({ name: 'stock' })
    history.replaceState(null, '', '#/trabajos')
    resetAppRouter()
    await enforceRouteProtection()
    await at('#/trabajos', 'jobs')
  })

  it('restaura la navegación local anterior solo al iniciar en la raíz sin ruta explícita', async () => {
    await enforceRouteProtection()
    await window.openJob('job-1', 'inspection')
    persistCurrentNavigationState({ page: 3 })
    history.replaceState(null, '', '/')
    resetAppRouter(); window.active = null
    await enforceRouteProtection()
    await at('#/trabajos/job-1/inspection', 'work')
    expect(window.page).toBe(3)
  })

  it('logout desde contraseña limpia el formulario; Atrás no expone pantallas de sesión', async () => {
    await enforceRouteProtection()
    click('navChangePassBtn'); await at('#update-password', 'password')
    click('navLogoutBtn')
    await vi.waitFor(() => expect(appAuthState.user).toBeNull())
    expect(document.getElementById('loginForm')).not.toBeNull()
    history.back()
    await vi.waitFor(() => expect(document.getElementById('loginForm')).not.toBeNull())
    expect(document.getElementById('updatePassForm')).toBeNull()
    expect(document.getElementById('mainAppContainer').hidden).toBe(true)
  })

  it('un resultado de una navegación anterior no puede redirigir una sección posterior', async () => {
    await enforceRouteProtection()
    const unavailable = navigateAppRoute({ name: 'work', jobId: 'missing', step: 'inspection' })
    const stock = navigateAppRoute({ name: 'stock' })
    await Promise.all([unavailable, stock])
    await at('#/stock', 'stock')
  })

  it('PASSWORD_RECOVERY de Supabase abre la ruta propia y permite actualizar y regresar', async () => {
    appAuthState.user = null; appAuthState.session = null
    await initAuthAndAdmin()
    const callback = backend.auth.onAuthStateChange.mock.calls[0][0]
    const session = { access_token: 'fake-recovery-session', user: { id: 'u1' }, expires_at: Math.floor(Date.now() / 1000) + 3600 }
    await callback('PASSWORD_RECOVERY', session)
    await at('#update-password', 'password')
    document.getElementById('newPasswordInput').value = 'test-only-password'
    document.getElementById('confirmNewPasswordInput').value = 'test-only-password'
    document.getElementById('updatePassForm').dispatchEvent(new Event('submit', { cancelable: true }))
    await at('#/trabajos', 'jobs')
    expect(backend.auth.updateUser).toHaveBeenCalledWith({ password: 'test-only-password' })
  })

  it('codifica los identificadores de trabajos y conserva los enlaces existentes', () => {
    expect(routeHash({ name: 'work', jobId: 'job / á', step: 'inspection' })).toBe('#/trabajos/job%20%2F%20%C3%A1/inspection')
    expect(readAppRoute({ hash: '#update-password', pathname: '/' })).toEqual({ name: 'password' })
    expect(readAppRoute({ hash: '', pathname: '/admin' })).toEqual({ name: 'admin' })
    expect(readAppRoute({ hash: '#/trabajos/job%20%2F%20%C3%A1/inspection', pathname: '/' }).jobId).toBe('job / á')
  })

  it('el enlace de invitación type=invite abre configuración de contraseña también con SIGNED_IN', async () => {
    history.replaceState(null, '', '/#access_token=fake-invite&type=invite')
    appAuthState.user = null; appAuthState.session = null; appAuthState.isSessionBootstrapped = false
    appAuthState.isOnline = false
    await initAuthAndAdmin()
    const callback = backend.auth.onAuthStateChange.mock.calls[0][0]
    await callback('SIGNED_IN', { user: { id: 'u1' }, access_token: 'fake-invite', expires_at: Math.floor(Date.now() / 1000) + 3600 })
    await at('#update-password', 'password')
    document.getElementById('newPasswordInput').value = 'own-test-password'
    document.getElementById('confirmNewPasswordInput').value = 'own-test-password'
    document.getElementById('updatePassForm').dispatchEvent(new Event('submit', { cancelable: true }))
    await at('#/trabajos', 'jobs')
    expect(appAuthState.memberships[0].role).toBe('staff')
    expect(backend.auth.updateUser).toHaveBeenCalledWith({ password: 'own-test-password' })
  })
})
