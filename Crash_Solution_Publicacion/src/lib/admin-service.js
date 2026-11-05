import { supabase } from './supabase.js'

const messages = {
  AUTH_REQUIRED: 'Iniciá sesión para realizar esta operación.',
  AUTH_EXPIRED: 'Tu sesión expiró o no pudo renovarse. Volvé a iniciar sesión.',
  AUTH_INVALID: 'No se pudo validar tu sesión. Volvé a iniciar sesión.',
  AUTH_CHANGED: 'La cuenta activa cambió. Volvé a abrir Administración antes de continuar.',
  FORBIDDEN: 'No tenés permisos para esta operación en el taller seleccionado.',
  SERVICE_NOT_FOUND: 'El servicio de administración no está disponible en este proyecto. Contactá al administrador.',
  NETWORK_ERROR: 'No se pudo contactar al servicio. Revisá tu conexión. Antes de reenviar una invitación, comprobá si fue procesada.',
  RELAY_ERROR: 'El servicio de administración no pudo atender la solicitud. Intentá nuevamente más tarde.',
  INVALID_REQUEST: 'Revisá el correo, el rol y los datos de la solicitud.',
  INVITE_DUPLICATE: 'Ya existe una invitación o una cuenta para ese correo. Revisá el equipo antes de reenviar.',
  RATE_LIMIT: 'Se alcanzó el límite temporal de envíos. Aguardá unos minutos antes de reintentar.',
  EMAIL_ADDRESS_NOT_AUTHORIZED: 'El servicio de correo no permite enviar a ese destinatario. El administrador debe revisar el proveedor SMTP.',
  EMAIL_PROVIDER_DISABLED: 'El proveedor Email no está habilitado para esta operación. Contactá al administrador.',
  EMAIL_SEND_FAILED: 'El servicio no pudo procesar el envío del correo. El administrador debe revisar los registros de correo.',
  INVITE_PARTIAL: 'El correo de invitación fue procesado, pero no se completó la vinculación del integrante. No lo reenvíes; solicitá una revisión administrativa.',
  REDIRECT_INVALID: 'No se pudo validar la dirección de regreso a la aplicación. Contactá al administrador.',
  LAST_OWNER_PROTECTED: 'El taller debe conservar al menos un propietario.',
  INVALID_RESPONSE: 'El servidor no confirmó que la operación se completara. Comprobá su estado antes de repetirla.',
  ADMIN_ERROR: 'El servicio de administración devolvió un error. Contactá al administrador.'
}

export class AdminServiceError extends Error {
  constructor(code, { status = null, requestId = null } = {}) {
    super(messages[code] || messages.ADMIN_ERROR)
    this.name = 'AdminServiceError'
    this.code = code
    this.status = status
    this.requestId = typeof requestId === 'string' && /^[a-z0-9-]{1,80}$/i.test(requestId) ? requestId : null
  }
}

function classify(status, body = {}, errorName = '') {
  if (messages[body.code]) return body.code
  const upstream = String(body.code || '').toLowerCase()
  if (upstream === 'email_address_not_authorized') return 'EMAIL_ADDRESS_NOT_AUTHORIZED'
  if (upstream === 'email_provider_disabled') return 'EMAIL_PROVIDER_DISABLED'
  if (['email_exists', 'user_already_exists'].includes(upstream)) return 'INVITE_DUPLICATE'
  if (/conservar.*propietario|único propietario|sin (al menos un|un) propietario/i.test(String(body.error || ''))) return 'LAST_OWNER_PROTECTED'
  if (errorName === 'FunctionsFetchError' || (!status && errorName !== 'FunctionsRelayError')) return 'NETWORK_ERROR'
  if (errorName === 'FunctionsRelayError') return 'RELAY_ERROR'
  if (status === 401) return 'AUTH_INVALID'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'SERVICE_NOT_FOUND'
  if (status === 409) return 'INVITE_DUPLICATE'
  if (status === 429) return 'RATE_LIMIT'
  if ([400, 422].includes(status)) return 'INVALID_REQUEST'
  return 'ADMIN_ERROR'
}

async function currentSession(client, callerId) {
  if (!client) throw new AdminServiceError('AUTH_REQUIRED')
  let session
  try {
    const { data, error } = await client.auth.getSession()
    if (error) throw new AdminServiceError('AUTH_INVALID')
    session = data?.session
    if (!session?.access_token || !session?.user?.id) throw new AdminServiceError('AUTH_REQUIRED')
    if (session.expires_at && session.expires_at <= Date.now() / 1000 + 30) {
      const { data: refreshed, error: refreshError } = await client.auth.refreshSession()
      if (refreshError || !refreshed?.session?.access_token) throw new AdminServiceError('AUTH_EXPIRED')
      session = refreshed.session
    }
  } catch (error) {
    throw error instanceof AdminServiceError ? error : new AdminServiceError('AUTH_EXPIRED')
  }
  if (callerId && callerId !== session.user.id) throw new AdminServiceError('AUTH_CHANGED')
  return session
}

export async function invokeAdministrativeAction(payload, client = supabase) {
  return invokeWithSession(payload, client, await currentSession(client, payload.callerId))
}

async function invokeWithSession(payload, client, session) {
  const { callerId: _ignored, ...body } = payload
  let result
  try {
    result = await client.functions.invoke('admin-management', {
      body, headers: { Authorization: `Bearer ${session.access_token}` }
    })
  } catch { throw new AdminServiceError('NETWORK_ERROR') }
  if (!result || typeof result !== 'object') throw new AdminServiceError('INVALID_RESPONSE')

  if (result.error) {
    const response = result.response || result.error.context
    const status = response?.status || null
    let errorBody = {}
    try {
      const parsed = await (response.clone ? response.clone() : response).json()
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) errorBody = parsed
    } catch { /* Never display raw HTML or internal text */ }
    const error = new AdminServiceError(classify(status, errorBody, result.error.name), { status, requestId: errorBody?.requestId })
    // Safe diagnostics only: never log Authorization, payload, email or raw errors.
    console.warn('[admin-service]', { status: error.status, code: error.code, requestId: error.requestId })
    throw error
  }
  if (result.data?.error || result.data?.ok !== true) {
    throw new AdminServiceError(result.data?.error ? classify(result.response?.status, result.data) : 'INVALID_RESPONSE', { status: result.response?.status })
  }
  return result.data
}

const invitations = new Map()
export function resetInvitationRequests() { invitations.clear() }

export async function sendWorkshopInvitation(payload, client = supabase) {
  const session = await currentSession(client, payload.callerId)
  const key = JSON.stringify([session.user.id, payload.workshopId, payload.email])
  const existing = invitations.get(key)
  if (existing && existing.until > Date.now()) return existing.promise.then(data => ({ ...data, duplicateSuppressed: true }))
  const record = { until: Date.now() + 5 * 60 * 1000, promise: null }
  record.promise = invokeWithSession(payload, client, session).then(data => {
    if (data.invitedByEmail !== true || !data.userId) throw new AdminServiceError('INVALID_RESPONSE')
    return data
  }).catch(error => {
    if (!['INVITE_PARTIAL', 'NETWORK_ERROR', 'INVALID_RESPONSE'].includes(error.code) && invitations.get(key) === record) invitations.delete(key)
    throw error
  })
  invitations.set(key, record)
  return record.promise
}

export function buildInvitationRedirect(location = globalThis.window?.location) {
  if (!location) return undefined
  const url = new URL('./', location.href)
  url.search = ''
  url.hash = 'update-password'
  return url.href
}

export function isPasswordSetupCallback(location) {
  return ['invite', 'recovery'].includes(new URLSearchParams(location.hash.slice(1)).get('type'))
}
