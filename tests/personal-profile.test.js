import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const backend = vi.hoisted(() => ({ from: vi.fn(), auth: { getUser: vi.fn() } }))
vi.mock('../Crash_Solution_Publicacion/src/lib/supabase.js', () => ({ supabase: backend, isSupabaseConfigured: true }))
import { getProfileInitials, updatePersonalProfile } from '../Crash_Solution_Publicacion/src/lib/personal-profile.js'
import { appAuthState, openMyProfile, renderHeaderNavigation } from '../Crash_Solution_Publicacion/src/main.js'

let update, eq, single
beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = '<div id="headerAuthNav"></div><div class="header-tools"></div><section id="authScreen" hidden></section><main id="mainAppContainer"><section id="workScreen"><input id="pendingWork" value="Trabajo pendiente"></section><section id="jobsScreen" hidden></section><section id="stockScreen" hidden></section><section id="profileScreen" hidden></section><section id="adminScreen" hidden></section></main>'
  history.replaceState(null, '', '/#/stock')
  Object.assign(appAuthState, {
    user: { id: 'own-user', email: 'ana@example.com', user_metadata: {} },
    session: { access_token: 'local-test', user: { id: 'own-user' }, expires_at: Math.floor(Date.now() / 1000) + 3600 },
    profile: { display_name: 'Ana María Pérez', phone: '11 4567 1234' },
    activeWorkshopId: 'workshop-private-id',
    memberships: [{ workshop_id: 'workshop-private-id', role: 'owner', workshop: { name: 'Taller de Prueba' } }],
    authMode: 'login', unresolvedConflicts: []
  })
  backend.auth.getUser.mockResolvedValue({ data: { user: { id: 'own-user' } }, error: null })
  single = vi.fn(async () => ({ data: { user_id: 'own-user', display_name: 'Ana Actualizada', phone: null }, error: null }))
  const query = { update: value => update(value), eq: (...args) => eq(...args), select: () => query, single: () => single() }
  update = vi.fn(() => query)
  eq = vi.fn(() => query)
  backend.from.mockReturnValue(query)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function () { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function () { this.removeAttribute('open') } })
})
afterEach(() => {
  vi.restoreAllMocks()
  window.__headerMenuController?.abort()
  delete HTMLDialogElement.prototype.showModal
  delete HTMLDialogElement.prototype.close
})

function submit() { document.getElementById('personalProfileForm').dispatchEvent(new Event('submit', { cancelable: true })) }

describe('Mi perfil: tarjeta y edición del perfil propio', () => {
  it('limpia la validación del trabajo al abrir y cerrar Mi perfil conservando el formulario', () => {
    document.getElementById('mainAppContainer').insertAdjacentHTML('afterbegin', '<div id="notice" data-validation="reception">Completá los datos</div>')
    openMyProfile()
    expect(document.getElementById('notice').hidden).toBe(true)
    expect(document.getElementById('notice').textContent).toBe('')
    document.getElementById('myProfileDialog').close()
    expect(document.getElementById('pendingWork').value).toBe('Trabajo pendiente')
    expect(document.getElementById('notice').hidden).toBe(true)
  })
  it('no reconstruye el encabezado ni cierra el desplegable cuando no cambia su contenido', () => {
    appAuthState.isOnline = true
    renderHeaderNavigation()
    const toggle = document.getElementById('profileMenuToggle')
    toggle.click()
    renderHeaderNavigation()
    expect(document.getElementById('profileMenuToggle')).toBe(toggle)
    expect(document.getElementById('userMenu').hidden).toBe(false)
    appAuthState.isOnline = false
    renderHeaderNavigation()
    expect(document.getElementById('connectivityBadge').textContent).toContain('Sin internet')
    appAuthState.isOnline = true
  })
  it('genera iniciales legibles con nombres compuestos y sin foto', () => {
    expect(getProfileInitials(' Ana María Pérez ')).toBe('AP')
    expect(getProfileInitials('Ángela')).toBe('Á')
    expect(getProfileInitials('')).toBe('U')
  })

  it.each([['owner', 'Propietario'], ['admin', 'Administrador'], ['staff', 'Personal del taller']])('muestra datos propios para %s sin ofrecer edición de permisos', (role, label) => {
    appAuthState.memberships[0].role = role
    renderHeaderNavigation()
    document.getElementById('navMyProfileBtn').click()
    const dialog = document.getElementById('myProfileDialog')
    expect(dialog.getAttribute('aria-labelledby')).toBe('personalProfileTitle')
    expect(dialog.textContent).toContain('Ana María Pérez')
    expect(dialog.textContent).toContain('ana@example.com')
    expect(dialog.textContent).toContain(label)
    expect(dialog.textContent).toContain('Taller de Prueba')
    expect(dialog.textContent).not.toContain('workshop-private-id')
    expect(dialog.textContent).not.toContain('own-user')
    expect(dialog.querySelectorAll('input')).toHaveLength(2)
    expect(dialog.querySelector('input[type="password"], input[type="email"], select')).toBeNull()
    expect(document.getElementById('personalName').readOnly).toBe(true)
    expect(document.getElementById('personalProfileInitials').textContent).toBe('AP')
    expect(backend.from).not.toHaveBeenCalled()
  })

  it('volver cierra la tarjeta y conserva la sección y sus datos sin cambiar la URL', () => {
    openMyProfile()
    document.getElementById('backFromMyProfileBtn').click()
    expect(document.getElementById('myProfileDialog')).toBeNull()
    expect(document.getElementById('pendingWork').value).toBe('Trabajo pendiente')
    expect(document.getElementById('workScreen').hidden).toBe(false)
    expect(location.hash).toBe('#/stock')
  })

  it('guarda solo nombre y teléfono del usuario autenticado y actualiza tarjeta y menú', async () => {
    renderHeaderNavigation(); openMyProfile()
    document.getElementById('editPersonalProfileBtn').click()
    document.getElementById('personalName').value = 'Ana Actualizada'
    document.getElementById('personalPhone').value = ''
    submit()
    await vi.waitFor(() => expect(document.getElementById('personalProfileAlert').textContent).toContain('guardaron correctamente'))
    expect(backend.from).toHaveBeenCalledWith('user_profiles')
    expect(update).toHaveBeenCalledExactlyOnceWith({ display_name: 'Ana Actualizada', phone: null })
    expect(eq).toHaveBeenCalledWith('user_id', 'own-user')
    expect(appAuthState.profile.display_name).toBe('Ana Actualizada')
    expect(document.getElementById('personalProfileName').textContent).toBe('Ana Actualizada')
    expect(document.querySelector('.profile-identity').textContent).toContain('Ana Actualizada')
    expect(document.getElementById('personalName').readOnly).toBe(true)
  })

  it('conserva la edición y oculta detalles internos si el servidor rechaza guardar', async () => {
    single.mockResolvedValue({ data: null, error: { message: '42501 internal table private_schema' } })
    openMyProfile()
    document.getElementById('editPersonalProfileBtn').click()
    document.getElementById('personalName').value = 'Nombre sin guardar'
    submit()
    await vi.waitFor(() => expect(document.getElementById('personalProfileAlert').textContent).toContain('No se pudieron guardar'))
    expect(document.getElementById('personalProfileAlert').textContent).not.toContain('private_schema')
    expect(document.getElementById('personalName').value).toBe('Nombre sin guardar')
    expect(document.getElementById('personalName').readOnly).toBe(false)
    expect(appAuthState.profile.display_name).toBe('Ana María Pérez')
  })

  it('cancelar restaura los datos y protege la edición al volver o usar Escape', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    openMyProfile()
    document.getElementById('editPersonalProfileBtn').click()
    document.getElementById('personalName').value = 'Borrador'
    document.getElementById('myProfileDialog').dispatchEvent(new Event('cancel', { cancelable: true }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(document.getElementById('myProfileDialog')).not.toBeNull()
    document.getElementById('cancelPersonalProfileBtn').click()
    expect(document.getElementById('personalName').value).toBe('Ana María Pérez')
    document.getElementById('backFromMyProfileBtn').click()
    expect(document.getElementById('myProfileDialog')).toBeNull()
  })

  it('valida datos antes de contactar al servidor y descarta campos no admitidos', async () => {
    await expect(updatePersonalProfile({ display_name: 'A', phone: '' })).rejects.toThrow('nombre y apellido')
    await expect(updatePersonalProfile({ display_name: 'Ana', phone: 'abc' })).rejects.toThrow('teléfono válido')
    expect(backend.auth.getUser).not.toHaveBeenCalled()
    await updatePersonalProfile({ display_name: 'Ana', phone: '', role: 'owner', user_id: 'other-user', email: 'other@example.com' })
    expect(update).toHaveBeenCalledWith({ display_name: 'Ana', phone: null })
    expect(eq).toHaveBeenCalledWith('user_id', 'own-user')
  })

  it('no escribe si no existe sesión verificada', async () => {
    backend.auth.getUser.mockResolvedValue({ data: { user: null }, error: new Error('expired') })
    await expect(updatePersonalProfile({ display_name: 'Ana' })).rejects.toThrow('sesión siga activa')
    expect(update).not.toHaveBeenCalled()
  })

  it('recupera las iniciales si falla la foto existente y admite cuentas sin taller', () => {
    appAuthState.memberships = []
    appAuthState.user.user_metadata.avatar_url = 'https://example.com/existing-photo.png'
    openMyProfile()
    expect(document.querySelector('.personal-profile-workshop').textContent).toContain('Sin taller asignado')
    document.getElementById('personalProfilePhoto').dispatchEvent(new Event('error'))
    expect(document.getElementById('personalProfilePhoto')).toBeNull()
    expect(document.getElementById('personalProfileInitials').textContent).toBe('AP')
  })
})
