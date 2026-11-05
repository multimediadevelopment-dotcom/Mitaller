import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { inviteOrCreateWorkshopUser } from '../Crash_Solution_Publicacion/src/lib/admin.js'
import { invokeAdministrativeAction, resetInvitationRequests, isPasswordSetupCallback, buildInvitationRedirect } from '../Crash_Solution_Publicacion/src/lib/admin-service.js'

const callerId = '11111111-1111-4111-8111-111111111111'
const workshopId = '22222222-2222-4222-8222-222222222222'
const payload = { callerId, callerRole: 'owner', workshopId, email: ' EMPLEADO@example.invalid ', role: 'staff' }
let client
beforeEach(() => {
  resetInvitationRequests()
  client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: callerId }, access_token: 'test-current-jwt', expires_at: Math.floor(Date.now() / 1000) + 600 } }, error: null })),
      refreshSession: vi.fn()
    },
    functions: { invoke: vi.fn(async () => ({ data: { ok: true, invitedByEmail: true, userId: 'new-user', role: 'staff' }, error: null })) }
  }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

function httpError(status, body) {
  client.functions.invoke.mockResolvedValue({ data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) } })
}

describe('Invitaciones desde el frontend, sin Supabase real', () => {
  it('envía invite_user al endpoint correcto con JWT vigente, datos opcionales y sin contraseñas', async () => {
    const data = await inviteOrCreateWorkshopUser(payload, client)
    expect(data.ok).toBe(true)
    expect(client.functions.invoke).toHaveBeenCalledExactlyOnceWith('admin-management', {
      body: expect.objectContaining({ action: 'invite_user', workshopId, email: 'empleado@example.invalid', role: 'staff', displayName: '', phone: null }),
      headers: { Authorization: 'Bearer test-current-jwt' }
    })
    const body = client.functions.invoke.mock.calls[0][1].body
    expect(body).not.toHaveProperty('password')
    expect(body).not.toHaveProperty('callerId')
    expect(body.redirectTo).toMatch(/#update-password$/)
  })

  it('no invoca la función sin sesión ni reutiliza una confirmación de otra sesión', async () => {
    await inviteOrCreateWorkshopUser(payload, client)
    client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    await expect(inviteOrCreateWorkshopUser(payload, client)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(client.functions.invoke).toHaveBeenCalledOnce()
  })

  it('renueva un JWT próximo a expirar y envía el token actualizado', async () => {
    client.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'old-jwt', user: { id: callerId }, expires_at: 1 } } })
    client.auth.refreshSession.mockResolvedValue({ data: { session: { access_token: 'new-jwt', user: { id: callerId } } }, error: null })
    await inviteOrCreateWorkshopUser(payload, client)
    expect(client.auth.refreshSession).toHaveBeenCalledOnce()
    expect(client.functions.invoke.mock.calls[0][1].headers.Authorization).toBe('Bearer new-jwt')
  })

  it('no envía si falla la renovación o la cuenta cambió', async () => {
    client.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'old', user: { id: callerId }, expires_at: 1 } } })
    client.auth.refreshSession.mockResolvedValue({ data: {}, error: new Error('private refresh data') })
    await expect(inviteOrCreateWorkshopUser(payload, client)).rejects.toMatchObject({ code: 'AUTH_EXPIRED' })
    client.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'current', user: { id: 'another-user' } } } })
    await expect(inviteOrCreateWorkshopUser(payload, client)).rejects.toMatchObject({ code: 'AUTH_CHANGED' })
    expect(client.functions.invoke).not.toHaveBeenCalled()
  })

  it('rechaza staff, ascenso de admin a owner, rol inválido, correo inválido y contraseña de terceros', async () => {
    await expect(inviteOrCreateWorkshopUser({ ...payload, callerRole: 'staff' }, client)).rejects.toThrow('permisos')
    await expect(inviteOrCreateWorkshopUser({ ...payload, callerRole: 'admin', role: 'owner' }, client)).rejects.toThrow('propietario')
    await expect(inviteOrCreateWorkshopUser({ ...payload, role: 'superuser' }, client)).rejects.toThrow('rol válido')
    await expect(inviteOrCreateWorkshopUser({ ...payload, email: 'invalid' }, client)).rejects.toThrow('correo electrónico válido')
    await expect(inviteOrCreateWorkshopUser({ ...payload, password: 'do-not-send' }, client)).rejects.toThrow('contraseñas de terceros')
    expect(client.functions.invoke).not.toHaveBeenCalled()
  })

  it('suprime envíos concurrentes y reenvíos inmediatos de una invitación ya procesada', async () => {
    const [first, duplicate] = await Promise.all([inviteOrCreateWorkshopUser(payload, client), inviteOrCreateWorkshopUser(payload, client)])
    expect(first.ok).toBe(true)
    expect(duplicate.duplicateSuppressed).toBe(true)
    expect((await inviteOrCreateWorkshopUser(payload, client)).duplicateSuppressed).toBe(true)
    expect(client.functions.invoke).toHaveBeenCalledOnce()
  })

  it.each([
    [401, {}, 'AUTH_INVALID'], [403, {}, 'FORBIDDEN'], [404, {}, 'SERVICE_NOT_FOUND'],
    [409, {}, 'INVITE_DUPLICATE'], [429, {}, 'RATE_LIMIT'],
    [502, { code: 'EMAIL_SEND_FAILED' }, 'EMAIL_SEND_FAILED'],
    [502, { code: 'EMAIL_ADDRESS_NOT_AUTHORIZED' }, 'EMAIL_ADDRESS_NOT_AUTHORIZED'],
    [503, { code: 'EMAIL_PROVIDER_DISABLED' }, 'EMAIL_PROVIDER_DISABLED'],
    [500, { code: 'INVITE_PARTIAL' }, 'INVITE_PARTIAL']
  ])('conserva HTTP %s y distingue %s sin mostrar cuerpos internos', async (status, body, code) => {
    httpError(status, { ...body, error: 'internal SQL secret test-current-jwt smtp-password', requestId: 'safe-reference' })
    const error = await inviteOrCreateWorkshopUser(payload, client).catch(error => error)
    expect(error).toMatchObject({ status, code, requestId: 'safe-reference' })
    expect(error.message).not.toMatch(/SQL|secret|test-current-jwt|smtp-password/)
    expect(JSON.stringify(console.warn.mock.calls)).not.toMatch(/test-current-jwt|smtp-password/)
  })

  it('un error real de fetch se distingue de un HTTP 500 y no reenvía automáticamente', async () => {
    client.functions.invoke.mockResolvedValue({ error: { name: 'FunctionsFetchError', message: 'Failed to send a request' } })
    await expect(inviteOrCreateWorkshopUser(payload, client)).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: null })
    await expect(inviteOrCreateWorkshopUser(payload, client)).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(client.functions.invoke).toHaveBeenCalledOnce()
  })

  it('no acepta respuestas vacías, HTML ni falsas confirmaciones HTTP 200', async () => {
    client.functions.invoke.mockResolvedValue({ data: { invitedByEmail: true } })
    await expect(inviteOrCreateWorkshopUser(payload, client)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    httpError(500, { error: 'private trace' })
    resetInvitationRequests()
    await expect(inviteOrCreateWorkshopUser(payload, client)).rejects.toMatchObject({ status: 500, code: 'ADMIN_ERROR' })
  })

  it('mantiene la protección del último propietario para respuestas de la versión anterior', async () => {
    httpError(409, { error: 'El taller debe conservar al menos un propietario (owner).' })
    await expect(invokeAdministrativeAction({ action: 'remove_member' }, client)).rejects.toMatchObject({ code: 'LAST_OWNER_PROTECTED' })
  })

  it('reconoce enlaces invite y recovery y crea redirecciones limpias de localhost y producción', () => {
    expect(isPasswordSetupCallback({ hash: '#access_token=fake&type=invite' })).toBe(true)
    expect(isPasswordSetupCallback({ hash: '#type=recovery' })).toBe(true)
    expect(isPasswordSetupCallback({ hash: '#type=signup' })).toBe(false)
    expect(buildInvitationRedirect({ href: 'http://localhost:5173/admin?tracking=1#/admin' })).toBe('http://localhost:5173/#update-password')
    expect(buildInvitationRedirect({ href: 'https://app.example.invalid/taller/#/admin' })).toBe('https://app.example.invalid/taller/#update-password')
  })
})
