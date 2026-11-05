import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ invite: vi.fn() }))
vi.mock('../Crash_Solution_Publicacion/src/lib/supabase.js', () => ({ supabase: null, isSupabaseConfigured: false }))
vi.mock('../Crash_Solution_Publicacion/src/lib/admin.js', async importOriginal => ({
  ...await importOriginal(), inviteOrCreateWorkshopUser: mocks.invite,
  fetchAdminWorkshopMembers: async () => [], fetchKnownUserProfiles: async () => []
}))
import { appAuthState, renderAdminScreen } from '../Crash_Solution_Publicacion/src/main.js'

beforeEach(() => {
  mocks.invite.mockReset()
  document.body.innerHTML = '<section id="adminScreen"></section>'
  Object.assign(appAuthState, {
    user: { id: 'owner' }, profile: { display_name: 'Owner' }, activeWorkshopId: 'workshop',
    memberships: [{ workshop_id: 'workshop', role: 'owner', workshop: { id: 'workshop', name: 'Taller ficticio' } }],
    adminMembers: [], knownProfiles: []
  })
})
afterEach(() => vi.restoreAllMocks())

it('nombre y teléfono son opcionales, no pide contraseña y bloquea doble submit durante el envío', async () => {
  let finish
  mocks.invite.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await renderAdminScreen()
  expect(document.getElementById('invName').required).toBe(false)
  expect(document.getElementById('invPhone').required).toBe(false)
  expect(document.querySelector('#inviteUserForm input[type="password"]')).toBeNull()
  document.getElementById('invEmail').value = 'test@example.invalid'
  const form = document.getElementById('inviteUserForm')
  form.dispatchEvent(new Event('submit', { cancelable: true }))
  form.dispatchEvent(new Event('submit', { cancelable: true }))
  expect(mocks.invite).toHaveBeenCalledOnce()
  expect(document.getElementById('inviteUserBtn').disabled).toBe(true)
  expect(document.getElementById('inviteUserBtn').textContent).toContain('Procesando')
  finish({ ok: true, invitedByEmail: true, userId: 'invited' })
  await vi.waitFor(() => expect(document.getElementById('adminAlertBox').textContent).toContain('Invitación procesada'))
  expect(document.getElementById('adminAlertBox').textContent).not.toContain('entregado')
})

it('ante un error conserva el formulario y permite revisar el correo sin perder datos', async () => {
  mocks.invite.mockRejectedValue(new Error('El servicio de correo no permite enviar a ese destinatario.'))
  await renderAdminScreen()
  document.getElementById('invEmail').value = 'test@example.invalid'
  document.getElementById('inviteUserForm').dispatchEvent(new Event('submit', { cancelable: true }))
  await vi.waitFor(() => expect(document.getElementById('inviteUserBtn').disabled).toBe(false))
  expect(document.getElementById('invEmail').value).toBe('test@example.invalid')
  expect(document.getElementById('adminAlertBox').textContent).toContain('servicio de correo')
})
