import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'

const backend = vi.hoisted(() => ({ from: vi.fn(), storage: { from: vi.fn() }, auth: { signOut: vi.fn(async () => ({ error: null })) } }))
vi.mock('../Crash_Solution_Publicacion/src/lib/supabase.js', () => ({ supabase: backend, isSupabaseConfigured: true }))
import { appAuthState, enforceRouteProtection, renderHeaderNavigation, leavePasswordScreen, renderProfileScreen, resetAppRouter } from '../Crash_Solution_Publicacion/src/main.js'
import { uploadWorkshopLogo, fetchWorkshopProfile } from '../Crash_Solution_Publicacion/src/lib/workshop-profile.js'
import { privateReadCache } from '../Crash_Solution_Publicacion/src/lib/scoped-cache.js'

function mount(role = 'owner') {
  document.body.innerHTML = `<header><div id="headerAuthNav"></div><div class="header-tools"><span id="saveState">Guardado en este dispositivo</span></div></header>
    <section id="authScreen" hidden></section><main id="mainAppContainer"><section id="jobsScreen"></section><section id="workScreen" hidden></section><section id="adminScreen" hidden></section><section id="profileScreen" hidden></section><section id="stockScreen" hidden></section></main>`
  Object.assign(appAuthState, {
    authMode: 'login', user: { id: 'u1', email: 'test@example.com' },
    session: { access_token: 'test', user: { id: 'u1' }, expires_at: Math.floor(Date.now() / 1000) + 3600 },
    profile: { display_name: 'Ana Pérez' }, activeWorkshopId: 'w1',
    memberships: [{ workshop_id: 'w1', role, workshop: { id: 'w1', name: 'Taller' } }],
    unresolvedConflicts: [], pendingSyncCount: 0
  })
  window.showJobs = vi.fn(() => { document.getElementById('jobsScreen').hidden = false })
}

beforeEach(() => { resetAppRouter(); privateReadCache.clear(); vi.clearAllMocks(); localStorage.clear(); history.replaceState(null, '', '/'); mount() })

describe('Navegación de sesión', () => {
  it('el HTML real y su arranque clásico no incluyen engranaje ni indicador antes de autenticar', () => {
    const html = readFileSync(resolve(process.cwd(), 'Crash_Solution_Publicacion/index.html'), 'utf8')
    const page = new JSDOM(html, {
      url: 'http://localhost:5173/', runScripts: 'dangerously',
      beforeParse(win) { win.scrollTo = () => {} }
    })
    const header = page.window.document.querySelector('.app-header')
    expect(header.querySelector('[onclick*="openSettings"], [aria-label="Abrir ajustes"]')).toBeNull()
    expect(header.querySelector('#saveState')).toBeNull()
    expect(header.textContent).not.toContain('Guardado en este dispositivo')
    expect(header.textContent).not.toContain('⚙')
    // The legacy setup still runs; its save message is kept outside the DOM.
    expect(page.window.__saveStateMessage).toBe('Guardado en este dispositivo')
    page.window.setSaveState('Guardado en este dispositivo')
    expect(header.querySelector('#saveState')).toBeNull()
    page.window.close()
  })

  it('elimina controles heredados del DOM sin sesión, también al repetir la protección tras recargar', async () => {
    document.querySelector('.header-tools').insertAdjacentHTML('beforeend', '<button aria-label="Abrir ajustes">⚙</button>')
    appAuthState.user = null
    appAuthState.session = null
    for (let attempt = 0; attempt < 2; attempt++) {
      await enforceRouteProtection()
      expect(document.querySelector('.header-tools').childElementCount).toBe(0)
      expect(document.querySelector('#saveState, [aria-label="Abrir ajustes"]')).toBeNull()
      expect(document.querySelector('header').textContent).not.toContain('Guardado en este dispositivo')
      expect(document.getElementById('navSettingsBtn')).toBeNull()
      expect(document.getElementById('loginForm')).not.toBeNull()
    }
  })

  it('oculta todos los controles de sesión antes del ingreso y al expirar', async () => {
    appAuthState.session.expires_at = 1
    await enforceRouteProtection()
    expect(document.querySelector('.header-tools').hidden).toBe(true)
    expect(document.getElementById('headerAuthNav').innerHTML).toBe('')
    expect(document.getElementById('mainAppContainer').hidden).toBe(true)
    expect(document.getElementById('loginForm')).not.toBeNull()
  })

  it.each(['owner', 'admin', 'staff'])('respeta opciones para %s y mantiene identidad en el desplegable', role => {
    mount(role); renderHeaderNavigation()
    expect(!!document.getElementById('navAdminBtn')).toBe(role !== 'staff')
    expect(document.getElementById('navStockBtn')).not.toBeNull()
    expect(document.getElementById('userMenu').hidden).toBe(true)
    document.getElementById('profileMenuToggle').click()
    expect(document.getElementById('userMenu').textContent).toContain('Ana Pérez')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.getElementById('userMenu').hidden).toBe(true)
    document.getElementById('mobileNavToggle').click()
    expect(document.getElementById('primaryNavigation').classList.contains('is-open')).toBe(true)
    document.body.click()
    expect(document.getElementById('mobileNavToggle').getAttribute('aria-expanded')).toBe('false')
  })

  it('vuelve desde contraseña sin reemplazar el trabajo ni los campos pendientes', async () => {
    renderHeaderNavigation()
    const draft = { id: 'draft', rec: { cliente: 'Sin sincronizar' }, area: 'Parte delantera' }
    window.store = { jobs: [draft], activeId: draft.id }
    window.active = draft
    window.step = 'reception'
    window.page = 0
    appAuthState.activePieceKey = null
    history.replaceState(null, '', '#/trabajos/draft/reception')
    document.getElementById('workScreen').innerHTML = '<input value="Dato pendiente">'
    document.getElementById('workScreen').hidden = false
    document.getElementById('jobsScreen').hidden = true
    document.getElementById('navChangePassBtn').click()
    document.getElementById('cancelUpdatePassBtn').click()
    await vi.waitFor(() => expect(appAuthState.authMode).toBe('login'))
    expect(appAuthState.authMode).toBe('login')
    expect(document.getElementById('authScreen').hidden).toBe(true)
    expect(document.getElementById('mainAppContainer').hidden).toBe(false)
    expect(window.active).toBe(draft)
    expect(document.querySelector('#workScreen input').value).toBe('Dato pendiente')
    expect(document.getElementById('workScreen').hidden).toBe(false)
  })

  it('permite navegar a trabajos desde contraseña y cerrar el cuadro', () => {
    renderHeaderNavigation()
    document.getElementById('navChangePassBtn').click()
    document.getElementById('navJobsBtn').click()
    expect(window.showJobs).toHaveBeenCalled()
    expect(document.getElementById('updatePassForm')).toBeNull()
    expect(appAuthState.authMode).toBe('login')
  })

  it('conserva la ruta auténtica de recuperación y permite salir de ella', async () => {
    history.replaceState(null, '', '#update-password')
    await enforceRouteProtection()
    expect(document.getElementById('updatePassForm')).not.toBeNull()
    await leavePasswordScreen()
    expect(location.hash).toBe('#/trabajos')
    expect(document.getElementById('authScreen').hidden).toBe(true)
  })

  it('permite cerrar sesión desde contraseña y vuelve al ingreso', async () => {
    renderHeaderNavigation()
    document.getElementById('navChangePassBtn').click()
    document.getElementById('navLogoutBtn').click()
    await vi.waitFor(() => expect(appAuthState.user).toBeNull())
    expect(backend.auth.signOut).toHaveBeenCalled()
    expect(document.getElementById('loginForm')).not.toBeNull()
    expect(document.getElementById('updatePassForm')).toBeNull()
    expect(document.getElementById('headerAuthNav').hidden).toBe(true)
    expect(document.querySelector('#saveState, #navSettingsBtn, [aria-label="Abrir ajustes"]')).toBeNull()
    await enforceRouteProtection()
    expect(document.querySelector('#saveState, #navSettingsBtn')).toBeNull()
  })
})

describe('Persistencia verificada del logo privado', () => {
  let row, bucket, file, operations
  beforeEach(() => {
    operations = []
    row = { id: 'w1', name: 'Taller', logo_path: 'w1/old.png' }
    file = new File(['image'], 'test.png', { type: 'image/png' })
    bucket = {
      upload: vi.fn(async path => { operations.push('upload'); return { data: { path }, error: null } }),
      createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://example.com/signed' } })),
      download: vi.fn(async () => ({ data: file })),
      remove: vi.fn(async () => ({ error: null }))
    }
    backend.storage.from.mockReturnValue(bucket)
    backend.from.mockImplementation(() => {
      let payload
      const query = {
        select: vi.fn(() => query), eq: vi.fn(() => query),
        update: vi.fn(value => { operations.push('update'); payload = value; return query }),
        single: vi.fn(async () => { if (payload) row = { ...row, ...payload }; return { data: { ...row } } }),
        maybeSingle: vi.fn(async () => ({ data: { ...row } }))
      }
      return query
    })
  })

  it('sube, verifica, guarda una sola vez, relee y persiste al recargar el perfil', async () => {
    const saved = await uploadWorkshopLogo('w1', file)
    expect(saved.logo_path).toMatch(/^w1\/logo-.+\.png$/)
    expect(saved.logo_url).toContain('data:image/png')
    expect(backend.storage.from).toHaveBeenCalledWith('workshop-logos')
    expect(bucket.upload.mock.calls[0][2].upsert).toBe(false)
    expect(bucket.createSignedUrl).toHaveBeenCalledWith(saved.logo_path, 3600)
    expect(bucket.download).toHaveBeenCalledWith(saved.logo_path)
    expect(operations).toEqual(['upload', 'update'])
    expect(bucket.remove).toHaveBeenCalledWith(['w1/old.png'])
    const reloaded = await fetchWorkshopProfile('w1')
    expect(reloaded.logo_path).toBe(saved.logo_path)
    expect(reloaded.logo_url).toContain('data:image/png')
    const replaced = await uploadWorkshopLogo('w1', file)
    expect(replaced.logo_path).not.toBe(saved.logo_path)
  })

  it('deduplica la lectura privada del perfil/logo y vuelve a consultar al cambiar de usuario', async () => {
    privateReadCache.activate({ userId: 'u1', workshopId: 'w1' })
    const [first, second] = await Promise.all([fetchWorkshopProfile('w1'), fetchWorkshopProfile('w1')])
    expect(first.logo_path).toBe(second.logo_path)
    expect(bucket.download).toHaveBeenCalledOnce()
    expect(backend.from).toHaveBeenCalledOnce()
    await fetchWorkshopProfile('w1')
    expect(bucket.download).toHaveBeenCalledOnce()
    privateReadCache.activate({ userId: 'u2', workshopId: 'w1' })
    await fetchWorkshopProfile('w1')
    expect(bucket.download).toHaveBeenCalledTimes(2)
  })

  it('el formulario usa la respuesta real sin una segunda escritura que borre la ruta', async () => {
    window.store = { shop: {}, jobs: [] }
    await renderProfileScreen()
    const name = document.getElementById('profName')
    name.value = 'Edición pendiente'
    const input = document.getElementById('workshopLogoInput')
    Object.defineProperty(input, 'files', { value: [file] })
    input.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(document.getElementById('profileAlertBox').textContent).toBe('Logo guardado correctamente'))
    expect(row.logo_path).toMatch(/^w1\/logo-/)
    expect(operations).toEqual(['upload', 'update'])
    expect(name.value).toBe('Edición pendiente')
    expect(document.getElementById('workshopLogoImg').getAttribute('src')).toContain('data:image/png')
  })

  it('staff puede consultar el perfil pero no subir logos ni editar datos', async () => {
    mount('staff')
    await renderProfileScreen()
    expect(document.getElementById('workshopLogoInput')).toBeNull()
    expect(document.getElementById('profName').disabled).toBe(true)
    expect(bucket.upload).not.toHaveBeenCalled()
  })

  it.each(['upload', 'createSignedUrl', 'download'])('no confirma ni borra el logo anterior si falla %s (RLS/red)', async stage => {
    bucket[stage].mockResolvedValue({ error: new Error('Permiso denegado') })
    await expect(uploadWorkshopLogo('w1', file)).rejects.toThrow('Permiso denegado')
    expect(row.logo_path).toBe('w1/old.png')
    expect(operations).not.toContain('update')
    expect(bucket.remove).not.toHaveBeenCalledWith(['w1/old.png'])
  })

  it('no informa éxito si la base rechaza la escritura', async () => {
    backend.from.mockImplementation(() => {
      let updating = false
      const query = { select: () => query, eq: () => query,
        update: () => { updating = true; return query },
        single: async () => updating ? { error: new Error('RLS workshops') } : { data: row } }
      return query
    })
    await expect(uploadWorkshopLogo('w1', file)).rejects.toThrow('RLS workshops')
    expect(bucket.remove).not.toHaveBeenCalledWith(['w1/old.png'])
  })
})
