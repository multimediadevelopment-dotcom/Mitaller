import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createAdminHandler } from '../supabase/functions/admin-management/handler.ts'

const callerId = '11111111-1111-4111-8111-111111111111'
const workshopId = '22222222-2222-4222-8222-222222222222'
const targetId = '33333333-3333-4333-8333-333333333333'
const origin = 'http://localhost:5173'
let config, admin, userClient, createClient, handler, writes
beforeEach(() => {
  config = { callerRole: 'owner', authError: null, inviteError: null, profileError: null, assignError: null, owners: 0 }
  writes = []
  userClient = { auth: { getUser: vi.fn(async () => ({ data: { user: config.authError ? null : { id: callerId } }, error: config.authError })) } }
  admin = {
    auth: { admin: { inviteUserByEmail: vi.fn(async () => ({ data: { user: config.inviteError ? null : { id: targetId } }, error: config.inviteError })) } },
    from: vi.fn(table => {
      const filters = {}
      let count = false
      const query = {
        select: (_columns, options) => { count = options?.head === true; return query },
        eq: (field, value) => { filters[field] = value; return query }, neq: () => query,
        maybeSingle: async () => ({ data: filters.workshop_id === workshopId && config.callerRole ? { role: config.callerRole } : null, error: null }),
        upsert: async value => { writes.push({ table, value }); return { error: table === 'user_profiles' ? config.profileError : config.assignError } },
        delete: () => { writes.push({ table, deleting: true }); return query },
        then: (yes, no) => Promise.resolve(count ? { count: config.owners, error: null } : { error: null }).then(yes, no)
      }
      return query
    })
  }
  createClient = vi.fn((_url, key) => key === 'server-private-test-key' ? admin : userClient)
  handler = createAdminHandler({ createClient, env: name => ({ SUPABASE_URL: 'https://project.example.invalid', SUPABASE_ANON_KEY: 'public-test-key', SUPABASE_SERVICE_ROLE_KEY: 'server-private-test-key' })[name] })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

function request(body = {}, headers = {}) {
  return new Request('https://project.example.invalid/functions/v1/admin-management', {
    method: 'POST', headers: { Authorization: 'Bearer verified-test-jwt', Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ action: 'invite_user', workshopId, email: 'empleado@example.invalid', role: 'staff', redirectTo: `${origin}/#update-password`, ...body })
  })
}

describe('Handler real de admin-management con Auth/DB/correo simulados', () => {
  it.each(['owner', 'admin'])('%s puede invitar a staff, con validación de JWT y redirección preservada', async role => {
    config.callerRole = role
    const response = await handler(request({ displayName: '', phone: null }))
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data).toMatchObject({ ok: true, userId: targetId, role: 'staff', invitedByEmail: true })
    expect(userClient.auth.getUser).toHaveBeenCalledWith('verified-test-jwt')
    expect(createClient.mock.calls[0][2].global.headers.Authorization).toBe('Bearer verified-test-jwt')
    expect(admin.auth.admin.inviteUserByEmail).toHaveBeenCalledWith('empleado@example.invalid', {
      redirectTo: `${origin}/#update-password`, data: { display_name: 'empleado', phone: null }
    })
    expect(writes).toContainEqual({ table: 'workshop_members', value: { workshop_id: workshopId, user_id: targetId, role: 'staff' } })
    expect(JSON.stringify(data)).not.toContain('server-private-test-key')
    expect(response.headers.get('x-request-id')).toBe(data.requestId)
  })

  it('conserva nombre y teléfono opcionales en metadata y perfil', async () => {
    await handler(request({ displayName: 'Ana Prueba', phone: '+54 11 5555 1234' }))
    expect(writes).toContainEqual({ table: 'user_profiles', value: { user_id: targetId, display_name: 'Ana Prueba', phone: '+54 11 5555 1234' } })
  })

  it('sin Authorization o con JWT rechazado no crea cliente privilegiado ni envía correos', async () => {
    const noSession = request()
    noSession.headers.delete('Authorization')
    expect((await handler(noSession)).status).toBe(401)
    expect(createClient).not.toHaveBeenCalled()
    config.authError = { message: 'invalid signature' }
    expect((await handler(request())).status).toBe(401)
    expect(admin.auth.admin.inviteUserByEmail).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
  })

  it.each(['staff', null])('rechaza el rol %s en el servidor', async role => {
    config.callerRole = role
    expect((await handler(request())).status).toBe(403)
    expect(admin.auth.admin.inviteUserByEmail).not.toHaveBeenCalled()
  })

  it('no usa el rol indicado por el cliente para autorizar otro taller o promover a admin', async () => {
    expect((await handler(request({ workshopId: '44444444-4444-4444-8444-444444444444', callerRole: 'owner' }))).status).toBe(403)
    config.callerRole = 'admin'
    expect((await handler(request({ role: 'owner' }))).status).toBe(403)
    expect(admin.auth.admin.inviteUserByEmail).not.toHaveBeenCalled()
  })

  it('correo o rol inválidos y cualquier campo password se rechazan antes de invitar', async () => {
    for (const body of [{ email: 'invalid' }, { role: 'superadmin' }, { password: 'third-party-password' }, { password: '' }, { password: null }]) {
      expect((await handler(request(body))).status).toBe(400)
    }
    expect(admin.auth.admin.inviteUserByEmail).not.toHaveBeenCalled()
  })

  it('peticiones duplicadas concurrentes no vuelven a ejecutar inviteUserByEmail en el mismo isolate', async () => {
    const responses = await Promise.all([handler(request()), handler(request()), handler(request())])
    expect(responses.map(response => response.status)).toEqual([200, 200, 200])
    for (const response of responses) expect((await response.json()).ok).toBe(true)
    expect(admin.auth.admin.inviteUserByEmail).toHaveBeenCalledOnce()
    expect(writes.filter(row => row.table === 'workshop_members')).toHaveLength(1)
  })

  it.each([
    ['email_exists', 409, 'INVITE_DUPLICATE'],
    ['email_address_not_authorized', 502, 'EMAIL_ADDRESS_NOT_AUTHORIZED'],
    ['email_provider_disabled', 503, 'EMAIL_PROVIDER_DISABLED'],
    ['over_email_send_rate_limit', 429, 'RATE_LIMIT'],
    ['unexpected_failure', 502, 'EMAIL_SEND_FAILED']
  ])('clasifica %s como HTTP %s sin revelar detalles', async (upstreamCode, status, code) => {
    config.inviteError = { code: upstreamCode, message: 'SMTP password private-email@example.invalid raw SQL internal trace' }
    const response = await handler(request())
    const data = await response.json()
    expect(response.status).toBe(status)
    expect(data.code).toBe(code)
    expect(data.ok).not.toBe(true)
    expect(JSON.stringify(data)).not.toMatch(/SMTP password|raw SQL|internal trace|private-email/)
    expect(writes).toHaveLength(0)
  })

  it.each(['profileError', 'assignError'])('si falla %s después del correo devuelve resultado parcial, sin un éxito falso ni reenvío inmediato', async field => {
    config[field] = { code: '23503', message: 'internal private SQL' }
    const response = await handler(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ code: 'INVITE_PARTIAL' })
    await handler(request())
    expect(admin.auth.admin.inviteUserByEmail).toHaveBeenCalledOnce()
  })

  it('valida redirecciones locales y publicadas y bloquea otros orígenes, tokens o protocolos', async () => {
    for (const redirectTo of ['https://evil.example/#update-password', `${origin}/?access_token=private#update-password`, 'javascript:alert(1)', `${origin}/#wrong`]) {
      expect((await handler(request({ redirectTo }))).status).toBe(400)
    }
    const response = await handler(request({ redirectTo: 'https://app.example.invalid/#update-password' }, { Origin: 'https://app.example.invalid' }))
    expect(response.status).toBe(200)
    expect(admin.auth.admin.inviteUserByEmail.mock.calls[0][1].redirectTo).toBe('https://app.example.invalid/#update-password')
  })

  it('preflight y diagnóstico son de solo lectura; no desactivan la comprobación de JWT o rol', async () => {
    const preflight = await handler(new Request('https://project.example.invalid', { method: 'OPTIONS' }))
    expect(preflight.status).toBe(200)
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('authorization')
    const response = await handler(request({ action: 'diagnose' }))
    expect(await response.json()).toMatchObject({ ok: true, canInvite: true })
    expect(userClient.auth.getUser).toHaveBeenCalledOnce()
    expect(admin.auth.admin.inviteUserByEmail).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
  })

  it.each(['remove_member', 'assign_member'])('mantiene la protección del último propietario para %s', async action => {
    const response = await handler(request({ action, targetUserId: targetId, role: 'staff' }))
    expect(response.status).toBe(409)
    expect(writes).toHaveLength(0)
  })
})
