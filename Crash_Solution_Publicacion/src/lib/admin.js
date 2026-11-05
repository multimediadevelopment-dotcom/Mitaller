import { supabase } from './supabase.js'
import { VALID_WORKSHOP_ROLES, canAccessAdminPanel, preventSelfPrivilegeEscalation } from './auth.js'
import { invokeAdministrativeAction, sendWorkshopInvitation, buildInvitationRedirect } from './admin-service.js'

// Únicos roles admitidos por la restricción de base de datos en workshop_members
export const ALLOWED_MEMBER_ROLES = VALID_WORKSHOP_ROLES // ['owner', 'admin', 'staff']

export function validateWorkshopInput({ name }) {
  const cleanName = String(name || '').trim()
  if (!cleanName || cleanName.length < 2) {
    return { valid: false, error: 'El nombre comercial del taller es obligatorio (mínimo 2 caracteres).' }
  }
  return { valid: true, name: cleanName }
}

export function validateMemberAssignment({
  callerId,
  callerRole,
  workshopId,
  targetUserId,
  targetCurrentRole = null,
  role,
  currentOwnerCount = 1
}) {
  if (!workshopId) {
    return { valid: false, error: 'Seleccioná un taller válido.' }
  }
  const cleanUserId = String(targetUserId || '').trim()
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(cleanUserId)) {
    return { valid: false, error: 'El código de usuario ingresado no tiene un formato válido.' }
  }
  const normalizedRole = String(role || '').toLowerCase()
  if (!ALLOWED_MEMBER_ROLES.includes(normalizedRole)) {
    return { valid: false, error: 'Seleccioná un rol válido (Propietario, Administrador o Personal del taller).' }
  }

  const secCheck = preventSelfPrivilegeEscalation({
    callerId,
    callerRole,
    targetUserId: cleanUserId,
    targetCurrentRole,
    requestedRole: normalizedRole
  })
  if (!secCheck.allowed) {
    return { valid: false, error: secCheck.error }
  }

  // Impedir que el taller quede sin propietario ('owner')
  const isTargetCurrentlyOwner =
    String(targetCurrentRole || '').toLowerCase() === 'owner' ||
    (callerId === cleanUserId && String(callerRole || '').toLowerCase() === 'owner')

  if (isTargetCurrentlyOwner && normalizedRole !== 'owner' && currentOwnerCount <= 1) {
    return {
      valid: false,
      error: 'El taller no puede quedar sin propietario. Asigná otro propietario antes de cambiar este rol.'
    }
  }

  return { valid: true, targetUserId: cleanUserId, role: normalizedRole }
}

export function validateMemberRemoval({
  callerId,
  callerRole,
  targetUserId,
  targetCurrentRole,
  currentOwnerCount = 1
}) {
  if (!canAccessAdminPanel(callerRole)) {
    return { valid: false, error: 'Operación rechazada: se requiere rol de propietario o administrador.' }
  }
  if (String(targetCurrentRole || '').toLowerCase() === 'owner') {
    if (String(callerRole || '').toLowerCase() !== 'owner') {
      return { valid: false, error: 'Un administrador no puede eliminar a un propietario del taller.' }
    }
    if (currentOwnerCount <= 1) {
      return { valid: false, error: 'No se puede eliminar al único propietario del taller.' }
    }
  }
  if (callerId === targetUserId && currentOwnerCount <= 1 && String(callerRole || '').toLowerCase() === 'owner') {
    return { valid: false, error: 'No podés eliminar tu propio acceso siendo el único propietario del taller.' }
  }
  return { valid: true }
}

export async function fetchAdminWorkshopMembers(workshopId) {
  if (!supabase || !workshopId) return []

  const { data: members, error: memErr } = await supabase
    .from('workshop_members')
    .select('workshop_id, user_id, role')
    .eq('workshop_id', workshopId)

  if (memErr) throw memErr
  if (!members?.length) return []

  const userIds = [...new Set(members.map(m => m.user_id))]
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('user_id, display_name, phone, created_at')
    .in('user_id', userIds)

  const profileMap = new Map((profiles || []).map(p => [p.user_id, p]))

  return members.map(m => {
    const prof = profileMap.get(m.user_id)
    return {
      workshop_id: m.workshop_id,
      user_id: m.user_id,
      role: m.role,
      display_name: prof?.display_name || `Usuario ${m.user_id.slice(0, 8)}`,
      phone: prof?.phone || '',
      created_at: prof?.created_at || null
    }
  })
}

export async function fetchKnownUserProfiles() {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, display_name, phone, created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return []
  return data || []
}

// Mensajes controlados para evitar exponer detalles internos de base de datos o servidor en el navegador
export function sanitizeAdminErrorMessage(
  err,
  fallback = 'No se pudo completar la operación administrativa. Intentá nuevamente.'
) {
  const raw = String(err?.message || err || '').trim()
  if (!raw) return fallback

  // Detectar trazas internas de Postgres, PostgREST o stack traces y reemplazarlas por mensaje controlado
  const internalPatterns = [
    /PGRST\d+/i,
    /violates (foreign key|check|unique|row-level security)/i,
    /relation ".*" does not exist/i,
    /syntax error at or near/i,
    /deadlock detected/i,
    /stack trace/i,
    /supabase_service_role/i
  ]
  if (internalPatterns.some(rx => rx.test(raw))) {
    if (/LAST_OWNER_PROTECTED/i.test(raw)) {
      return 'Operación bloqueada: el taller no puede quedar sin al menos un propietario.'
    }
    return fallback
  }

  return raw
}

async function invokeAdminEdgeFunction(payload) {
  return invokeAdministrativeAction(payload)
}

export async function createNewWorkshop({ userId, name, legal_name, tax_id, phone, whatsapp, email, address }) {
  if (!supabase || !userId) throw new Error('Debés iniciar sesión para registrar un taller.')
  const v = validateWorkshopInput({ name })
  if (!v.valid) throw new Error(v.error)

  // 1. Intentar primero mediante la Edge Function segura (que crea el taller y asigna role = 'owner' en el servidor)
  try {
    const fnData = await invokeAdminEdgeFunction({
      action: 'create_workshop',
      name: v.name,
      legal_name: legal_name?.trim() || null,
      tax_id: tax_id?.trim() || null,
      phone: phone?.trim() || null,
      whatsapp: whatsapp?.trim() || null,
      email: email?.trim() || null,
      address: address?.trim() || null
    })
    if (fnData?.workshop) {
      return fnData.workshop
    }
  } catch (edgeErr) {
    // 2. Si la base de datos tiene un trigger AFTER INSERT en public.workshops que asigna automáticamente al creador como 'owner' en workshop_members,
    // permitimos insertar en public.workshops sin tocar jamás workshop_members desde el navegador.
    const { data: workshop, error: wsErr } = await supabase
      .from('workshops')
      .insert({
        name: v.name,
        legal_name: legal_name?.trim() || null,
        tax_id: tax_id?.trim() || null,
        phone: phone?.trim() || null,
        whatsapp: whatsapp?.trim() || null,
        email: email?.trim() || null,
        address: address?.trim() || null,
        created_by: userId
      })
      .select('id, name, legal_name, tax_id, logo_path, phone, whatsapp, email, address, created_by, created_at')
      .single()

    if (wsErr) {
      throw edgeErr
    }
    return workshop
  }
}

export async function upsertWorkshopMember({
  callerId,
  callerRole,
  workshopId,
  targetUserId,
  targetCurrentRole = null,
  role,
  currentOwnerCount = 1
}) {
  const check = validateMemberAssignment({
    callerId,
    callerRole,
    workshopId,
    targetUserId,
    targetCurrentRole,
    role,
    currentOwnerCount
  })
  if (!check.valid) throw new Error(check.error)

  // Ejecución exclusivamente mediante Edge Function del servidor (las políticas RLS bloquean escrituras directas en workshop_members desde el frontend)
  await invokeAdminEdgeFunction({
    action: 'assign_member',
    workshopId,
    targetUserId: check.targetUserId,
    role: check.role
  })

  return true
}

export async function removeMemberFromWorkshop({
  callerId,
  callerRole,
  workshopId,
  targetUserId,
  targetCurrentRole = null,
  currentOwnerCount = 1
}) {
  const check = validateMemberRemoval({
    callerId,
    callerRole,
    targetUserId,
    targetCurrentRole,
    currentOwnerCount
  })
  if (!check.valid) throw new Error(check.error)

  // Ejecución exclusivamente mediante Edge Function del servidor
  await invokeAdminEdgeFunction({
    action: 'remove_member',
    workshopId,
    targetUserId
  })

  return true
}

export async function inviteOrCreateWorkshopUser({
  callerId,
  callerRole,
  workshopId,
  email,
  password,
  displayName,
  phone,
  role
}, client = supabase) {
  if (password !== undefined) {
    throw new Error(
      'Por seguridad, los administradores no deben ingresar ni conocer contraseñas de terceros. Utilizá la invitación por correo electrónico.'
    )
  }

  const cleanEmail = String(email || '').trim().toLowerCase()
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('Ingresá un correo electrónico válido para enviar la invitación.')
  }

  const targetRole = role || 'staff'
  if (!ALLOWED_MEMBER_ROLES.includes(targetRole)) throw new Error('Seleccioná un rol válido.')
  const secCheck = preventSelfPrivilegeEscalation({
    callerId,
    callerRole,
    targetUserId: 'new-user',
    requestedRole: targetRole
  })
  if (!secCheck.allowed) {
    throw new Error(secCheck.error)
  }
  if (!workshopId) {
    throw new Error('Seleccioná un taller antes de invitar a un usuario.')
  }

  const redirectTo = buildInvitationRedirect()
  return await sendWorkshopInvitation({
    action: 'invite_user',
    callerId,
    workshopId,
    email: cleanEmail,
    displayName: String(displayName || '').trim(),
    phone: String(phone || '').trim() || null,
    role: targetRole,
    redirectTo
  }, client)
}
