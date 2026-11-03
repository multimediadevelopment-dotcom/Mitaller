import { supabase, isSupabaseConfigured } from './supabase.js'

// Roles estrictamente admitidos por la restricción de base de datos en public.workshop_members
export const VALID_WORKSHOP_ROLES = ['owner', 'admin', 'staff']

export const ROLE_LABELS = {
  owner: 'Propietario',
  admin: 'Administrador',
  staff: 'Personal del taller'
}

export function validateEmail(email) {
  const value = String(email || '').trim().toLowerCase()
  if (!value) return { valid: false, error: 'Ingresá tu correo electrónico.' }
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!re.test(value)) return { valid: false, error: 'El formato del correo electrónico no es válido.' }
  return { valid: true, value }
}

export function validatePassword(password, minLength = 8) {
  const value = String(password || '')
  if (!value) return { valid: false, error: 'Ingresá tu contraseña.' }
  if (value.length < minLength) {
    return { valid: false, error: `La contraseña debe tener al menos ${minLength} caracteres.` }
  }
  return { valid: true, value }
}

export function validateRegistration({ email, password, confirmPassword, displayName }) {
  const name = String(displayName || '').trim()
  if (!name || name.length < 2) {
    return { valid: false, error: 'Ingresá tu nombre y apellido (mínimo 2 caracteres).' }
  }
  const emailCheck = validateEmail(email)
  if (!emailCheck.valid) return emailCheck

  const passCheck = validatePassword(password, 8)
  if (!passCheck.valid) return passCheck

  if (password !== confirmPassword) {
    return { valid: false, error: 'Las contraseñas no coinciden.' }
  }
  return { valid: true }
}

export function validatePasswordUpdate(newPassword, confirmPassword) {
  const passCheck = validatePassword(newPassword, 8)
  if (!passCheck.valid) return passCheck
  if (newPassword !== confirmPassword) {
    return { valid: false, error: 'La confirmación de contraseña no coincide.' }
  }
  return { valid: true }
}

export function isSessionExpired(session, nowMs = Date.now()) {
  if (!session || typeof session !== 'object') return true
  if (!session.access_token || !session.user?.id) return true
  if (session.expires_at) {
    const expiresAtMs = Number(session.expires_at) * 1000
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
      return true
    }
  }
  return false
}

export function canAccessAdminPanel(membershipRole) {
  return ['owner', 'admin'].includes(String(membershipRole || '').toLowerCase())
}

export function preventSelfPrivilegeEscalation({
  callerId,
  callerRole,
  targetUserId,
  targetCurrentRole = null,
  requestedRole
}) {
  const normalizedCaller = String(callerRole || '').toLowerCase()
  const normalizedRequested = String(requestedRole || '').toLowerCase()
  const normalizedTargetCurrent = targetCurrentRole ? String(targetCurrentRole).toLowerCase() : null

  if (!VALID_WORKSHOP_ROLES.includes(normalizedRequested)) {
    return {
      allowed: false,
      error: 'Rol inválido. Seleccioná Propietario, Administrador o Personal del taller.'
    }
  }

  if (!canAccessAdminPanel(normalizedCaller)) {
    return {
      allowed: false,
      error: 'Operación rechazada: no tenés permisos de administrador o propietario en este taller.'
    }
  }

  // Un admin no puede autoasignarse ni asignar a otros el rol de propietario (owner)
  if (normalizedCaller !== 'owner' && normalizedRequested === 'owner') {
    return {
      allowed: false,
      error: 'No está permitido asignarse u otorgar el rol de propietario sin ser propietario del taller.'
    }
  }

  // Un admin no puede modificar ni degradar a un propietario (owner)
  if (normalizedCaller !== 'owner' && normalizedTargetCurrent === 'owner') {
    return {
      allowed: false,
      error: 'Un administrador no puede modificar los permisos de un propietario del taller.'
    }
  }

  // Nadie sin rol administrativo puede auto-escalarse
  if (callerId === targetUserId && !canAccessAdminPanel(normalizedCaller)) {
    return {
      allowed: false,
      error: 'No está permitido auto-otorgarse permisos administrativos.'
    }
  }

  return { allowed: true }
}

export function translateAuthError(error) {
  const msg = String(error?.message || error || '').toLowerCase()
  if (msg.includes('invalid login credentials')) {
    return 'Correo o contraseña incorrectos. Verificá tus datos e intentá nuevamente.'
  }
  if (msg.includes('email not confirmed')) {
    return 'Tu correo electrónico aún no fue confirmado. Revisá tu bandeja de entrada o spam.'
  }
  if (msg.includes('user already registered') || msg.includes('already been registered')) {
    return 'Ya existe una cuenta registrada con ese correo electrónico.'
  }
  if (msg.includes('password should be at least')) {
    return 'La contraseña debe tener al menos 8 caracteres.'
  }
  if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('security purposes')) {
    return 'Por seguridad, aguardá unos segundos antes de volver a solicitar el envío.'
  }
  if (msg.includes('jwt expired') || msg.includes('session_not_found') || msg.includes('refresh_token_not_found')) {
    return 'Tu sesión expiró por seguridad. Volvé a iniciar sesión.'
  }
  return error?.message || 'Ocurrió un error de autenticación.'
}

export async function ensureUserProfile(user, extra = {}) {
  if (!supabase || !user?.id) return null
  const displayName =
    extra.displayName ||
    user.user_metadata?.display_name ||
    user.user_metadata?.full_name ||
    user.email?.split('@')[0] ||
    'Usuario'
  const phone = extra.phone ?? user.user_metadata?.phone ?? null

  const { data: existing } = await supabase
    .from('user_profiles')
    .select('user_id, display_name, phone, created_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing) {
    if ((extra.displayName && extra.displayName !== existing.display_name) || (extra.phone && extra.phone !== existing.phone)) {
      const { data: updated } = await supabase
        .from('user_profiles')
        .update({
          display_name: extra.displayName || existing.display_name,
          phone: extra.phone ?? existing.phone
        })
        .eq('user_id', user.id)
        .select('user_id, display_name, phone, created_at')
        .maybeSingle()
      return updated || existing
    }
    return existing
  }

  const { data: inserted } = await supabase
    .from('user_profiles')
    .upsert(
      {
        user_id: user.id,
        display_name: displayName,
        phone
      },
      { onConflict: 'user_id' }
    )
    .select('user_id, display_name, phone, created_at')
    .maybeSingle()

  return inserted || { user_id: user.id, display_name: displayName, phone }
}

export async function fetchUserWorkshops(userId) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase
    .from('workshop_members')
    .select('workshop_id, user_id, role, workshops(id, name, legal_name, tax_id, logo_path, phone, whatsapp, email, address, created_by, created_at)')
    .eq('user_id', userId)

  if (error) throw error
  return (data || [])
    .filter(row => row.workshops)
    .map(row => ({
      workshop_id: row.workshop_id,
      role: row.role,
      workshop: row.workshops
    }))
}

export async function signInWithEmail(email, password) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase no está configurado. Verificá las variables VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.')
  }
  const emailCheck = validateEmail(email)
  if (!emailCheck.valid) throw new Error(emailCheck.error)
  if (!password) throw new Error('Ingresá tu contraseña.')

  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailCheck.value,
    password: String(password)
  })
  if (error) throw new Error(translateAuthError(error))

  if (data.user) {
    await ensureUserProfile(data.user).catch(() => null)
  }
  return data
}

export async function signUpWithEmail(
  { email, password, confirmPassword, displayName, phone },
  client = supabase
) {
  if (!client) {
    throw new Error('El servicio de autenticación no está configurado.')
  }
  const check = validateRegistration({ email, password, confirmPassword, displayName })
  if (!check.valid) throw new Error(check.error)

  const cleanEmail = String(email).trim().toLowerCase()
  const cleanName = String(displayName).trim()
  const cleanPhone = String(phone || '').trim() || null

  const redirectTo =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : undefined

  const { data, error } = await client.auth.signUp({
    email: cleanEmail,
    password: String(password),
    options: {
      emailRedirectTo: redirectTo,
      data: {
        display_name: cleanName,
        phone: cleanPhone
      }
    }
  })

  if (error) throw new Error(translateAuthError(error))

  let user = data?.user || null
  let session = data?.session || null

  // Si Supabase creó el usuario pero aún no adjuntó la sesión en la respuesta de signUp,
  // intentamos iniciar sesión de inmediato con las credenciales recién registradas.
  if (user && !session && typeof client.auth.signInWithPassword === 'function') {
    const signInAttempt = await client.auth
      .signInWithPassword({
        email: cleanEmail,
        password: String(password)
      })
      .catch(() => null)

    if (signInAttempt?.data?.session) {
      session = signInAttempt.data.session
      user = signInAttempt.data.user || user
    }
  }

  if (user && session) {
    await ensureUserProfile(user, {
      displayName: cleanName,
      phone: cleanPhone
    }).catch(() => null)
  }

  return {
    user,
    session,
    requiresEmailConfirmation: Boolean(user && !session)
  }
}

export async function signOutUser() {
  if (!supabase) return
  const { error } = await supabase.auth.signOut()
  if (error) throw new Error(translateAuthError(error))
}

export async function sendPasswordReset(email) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
  const emailCheck = validateEmail(email)
  if (!emailCheck.valid) throw new Error(emailCheck.error)

  const redirectTo =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}#update-password`
      : undefined

  const { error } = await supabase.auth.resetPasswordForEmail(emailCheck.value, {
    redirectTo
  })
  if (error) throw new Error(translateAuthError(error))
  return true
}

export async function updateUserPassword(newPassword, confirmPassword) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase no está configurado.')
  }
  const check = validatePasswordUpdate(newPassword, confirmPassword)
  if (!check.valid) throw new Error(check.error)

  const { data, error } = await supabase.auth.updateUser({
    password: String(newPassword)
  })
  if (error) throw new Error(translateAuthError(error))
  return data.user
}
