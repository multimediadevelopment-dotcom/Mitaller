// Supabase Edge Function: admin-management
// Operaciones privilegiadas de administración de talleres, invitaciones por correo y roles (DEV-20).
// Roles válidos en la base de datos (workshop_members_role_check): 'owner' | 'admin' | 'staff'.
// Nunca exponer SUPABASE_SERVICE_ROLE_KEY ni errores internos crudos al navegador.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const VALID_ROLES = ['owner', 'admin', 'staff'] as const
type WorkshopRole = (typeof VALID_ROLES)[number]
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

/**
 * Registra el error real en los logs del servidor y devuelve un mensaje controlado
 * sin filtrar detalles internos de SQL, tablas, restricciones ni trazas.
 */
function handleControlledServerError(context: string, err: unknown) {
  console.error(`[admin-management:${context}]`, err)

  const rawMsg = String((err as { message?: string })?.message || '')
  const rawCode = String((err as { code?: string })?.code || '')

  if (rawMsg.includes('LAST_OWNER_PROTECTED')) {
    return jsonResponse(
      { error: 'El taller debe conservar al menos un propietario (owner). Asigná otro propietario antes de realizar este cambio.' },
      409
    )
  }

  if (rawCode === '23505' || rawMsg.toLowerCase().includes('already been registered') || rawMsg.toLowerCase().includes('already exists')) {
    return jsonResponse(
      { error: 'El correo electrónico ya está registrado en la plataforma. Podés asociarlo mediante su ID de usuario (UUID).' },
      409
    )
  }

  if (rawCode === '23503') {
    return jsonResponse(
      { error: 'El usuario o taller indicado no existe o no es válido.' },
      400
    )
  }

  if (rawMsg.toLowerCase().includes('rate limit') || rawMsg.toLowerCase().includes('too many requests')) {
    return jsonResponse(
      { error: 'Se alcanzó el límite temporal de envíos de correo. Aguardá unos minutos antes de reintentar.' },
      429
    )
  }

  return jsonResponse(
    { error: 'No se pudo completar la operación administrativa en este momento. Intentá nuevamente.' },
    500
  )
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Método HTTP no permitido. Usá POST.' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      console.error('[admin-management:init] Faltan variables de entorno SUPABASE_URL, SUPABASE_ANON_KEY o SUPABASE_SERVICE_ROLE_KEY')
      return jsonResponse({ error: 'Servicio administrativo temporalmente no disponible.' }, 500)
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse({ error: 'No autorizado: sesión requerida.' }, 401)
    }

    const jwt = authHeader.slice('Bearer '.length).trim()
    if (!jwt) {
      return jsonResponse({ error: 'No autorizado: token vacío.' }, 401)
    }

    // 1. Validar siempre el JWT del usuario autenticado contra Supabase Auth en el servidor
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false }
    })

    const { data: authData, error: authError } = await userClient.auth.getUser(jwt)
    if (authError || !authData?.user) {
      return jsonResponse({ error: 'Sesión inválida o expirada. Volvé a iniciar sesión.' }, 401)
    }

    const caller = authData.user
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return jsonResponse({ error: 'Solicitud inválida.' }, 400)
    }

    const { action, workshopId } = body

    // 2. Acción: Crear taller y asignar automáticamente al creador autenticado como 'owner'
    if (action === 'create_workshop') {
      const { name, legal_name, tax_id, phone, whatsapp, email, address } = body
      if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
        return jsonResponse({ error: 'El nombre comercial del taller es obligatorio (entre 2 y 80 caracteres).' }, 400)
      }

      const { data: workshop, error: wsError } = await adminClient
        .from('workshops')
        .insert({
          name: name.trim(),
          legal_name: legal_name ? String(legal_name).trim().slice(0, 120) : null,
          tax_id: tax_id ? String(tax_id).trim().slice(0, 20) : null,
          phone: phone ? String(phone).trim().slice(0, 40) : null,
          whatsapp: whatsapp ? String(whatsapp).trim().slice(0, 40) : null,
          email: email ? String(email).trim().toLowerCase().slice(0, 120) : null,
          address: address ? String(address).trim().slice(0, 160) : null,
          created_by: caller.id
        })
        .select('id, name, legal_name, tax_id, logo_path, phone, whatsapp, email, address, created_by, created_at')
        .single()

      if (wsError) {
        return handleControlledServerError('create_workshop:insert_workshop', wsError)
      }

      const { error: memError } = await adminClient
        .from('workshop_members')
        .upsert(
          {
            workshop_id: workshop.id,
            user_id: caller.id,
            role: 'owner'
          },
          { onConflict: 'workshop_id,user_id' }
        )

      if (memError) {
        return handleControlledServerError('create_workshop:assign_owner', memError)
      }

      return jsonResponse({ ok: true, workshop, role: 'owner' }, 200)
    }

    // Validar que workshopId sea un UUID válido para todas las operaciones sobre un taller existente
    if (!workshopId || typeof workshopId !== 'string' || !UUID_RE.test(workshopId)) {
      return jsonResponse({ error: 'El identificador del taller no es válido.' }, 400)
    }

    // 3. Verificar en el servidor que el solicitante pertenezca al taller con rol 'owner' o 'admin'
    const { data: callerMembership, error: memberErr } = await adminClient
      .from('workshop_members')
      .select('role')
      .eq('workshop_id', workshopId)
      .eq('user_id', caller.id)
      .maybeSingle()

    if (memberErr) {
      return handleControlledServerError('verify_caller_membership', memberErr)
    }

    if (!callerMembership || !['owner', 'admin'].includes(callerMembership.role)) {
      return jsonResponse(
        { error: 'Permiso denegado: solo el propietario (owner) o un administrador (admin) de este taller pueden realizar esta operación.' },
        403
      )
    }

    const callerRole = callerMembership.role as WorkshopRole

    // 4. Acción: Invitar nuevo usuario exclusivamente por correo electrónico (sin contraseñas de terceros)
    if (action === 'invite_user' || action === 'invite_or_create_user') {
      const { email, displayName, phone, role, password } = body

      if (password !== undefined && password !== null && String(password).trim() !== '') {
        return jsonResponse(
          { error: 'Por seguridad, los administradores no deben ingresar contraseñas de terceros. Utilizá la invitación por correo electrónico.' },
          400
        )
      }

      if (!role || !VALID_ROLES.includes(role)) {
        return jsonResponse({ error: 'Rol inválido. Los únicos roles admitidos son: owner, admin, staff.' }, 400)
      }
      const requestedRole = role as WorkshopRole

      if (requestedRole === 'owner' && callerRole !== 'owner') {
        return jsonResponse(
          { error: 'Operación no permitida: solo un propietario (owner) puede asignar otro propietario.' },
          403
        )
      }

      const cleanEmail = String(email || '').trim().toLowerCase()
      if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) {
        return jsonResponse({ error: 'Correo electrónico inválido.' }, 400)
      }

      const cleanName = String(displayName || '').trim().slice(0, 100) || cleanEmail.split('@')[0]
      const cleanPhone = phone ? String(phone).trim().slice(0, 40) : null

      const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(cleanEmail, {
        data: {
          display_name: cleanName,
          phone: cleanPhone
        }
      })

      if (inviteErr || !invited?.user?.id) {
        return handleControlledServerError('invite_user:auth_invite', inviteErr)
      }

      const targetUserId = invited.user.id

      const { error: profileErr } = await adminClient.from('user_profiles').upsert(
        {
          user_id: targetUserId,
          display_name: cleanName,
          phone: cleanPhone
        },
        { onConflict: 'user_id' }
      )
      if (profileErr) {
        console.error('[admin-management:invite_user:upsert_profile]', profileErr)
      }

      const { error: assignErr } = await adminClient.from('workshop_members').upsert(
        {
          workshop_id: workshopId,
          user_id: targetUserId,
          role: requestedRole
        },
        { onConflict: 'workshop_id,user_id' }
      )
      if (assignErr) {
        return handleControlledServerError('invite_user:assign_member', assignErr)
      }

      return jsonResponse({ ok: true, userId: targetUserId, role: requestedRole, invitedByEmail: true }, 200)
    }

    // 5. Acción: Asociar usuario existente o modificar rol de miembro
    if (action === 'assign_member' || action === 'update_member_role') {
      const { targetUserId, role } = body
      if (!targetUserId || typeof targetUserId !== 'string' || !UUID_RE.test(targetUserId)) {
        return jsonResponse({ error: 'El identificador de usuario no tiene un formato UUID válido.' }, 400)
      }
      if (!role || !VALID_ROLES.includes(role)) {
        return jsonResponse({ error: 'Rol inválido. Los únicos roles admitidos son: owner, admin, staff.' }, 400)
      }

      const requestedRole = role as WorkshopRole

      const { data: existingTarget, error: targetLookupErr } = await adminClient
        .from('workshop_members')
        .select('role')
        .eq('workshop_id', workshopId)
        .eq('user_id', targetUserId)
        .maybeSingle()

      if (targetLookupErr) {
        return handleControlledServerError('update_member_role:lookup', targetLookupErr)
      }

      // Impedir escalación de privilegios por parte de un 'admin'
      if (callerRole !== 'owner') {
        if (requestedRole === 'owner') {
          return jsonResponse(
            { error: 'No tenés permisos para asignar el rol de propietario (owner).' },
            403
          )
        }
        if (existingTarget?.role === 'owner') {
          return jsonResponse(
            { error: 'Un administrador no puede modificar el rol de un propietario (owner).' },
            403
          )
        }
      }

      const wasOwner = existingTarget?.role === 'owner'
      const demotingOwner = wasOwner && requestedRole !== 'owner'

      if (demotingOwner) {
        const { count: otherOwnersCount, error: countErr } = await adminClient
          .from('workshop_members')
          .select('user_id', { count: 'exact', head: true })
          .eq('workshop_id', workshopId)
          .eq('role', 'owner')
          .neq('user_id', targetUserId)

        if (countErr) {
          return handleControlledServerError('update_member_role:count_owners', countErr)
        }

        if ((otherOwnersCount ?? 0) < 1) {
          return jsonResponse(
            { error: 'El taller no puede quedar sin propietario (owner). Asigná otro propietario antes de cambiar este rol.' },
            409
          )
        }
      }

      const { error: upsertErr } = await adminClient
        .from('workshop_members')
        .upsert(
          {
            workshop_id: workshopId,
            user_id: targetUserId,
            role: requestedRole
          },
          { onConflict: 'workshop_id,user_id' }
        )

      if (upsertErr) {
        return handleControlledServerError('update_member_role:upsert', upsertErr)
      }

      return jsonResponse({ ok: true, userId: targetUserId, role: requestedRole }, 200)
    }

    // 6. Acción: Revocar acceso de un miembro al taller
    if (action === 'remove_member') {
      const { targetUserId } = body
      if (!targetUserId || typeof targetUserId !== 'string' || !UUID_RE.test(targetUserId)) {
        return jsonResponse({ error: 'El identificador de usuario no tiene un formato UUID válido.' }, 400)
      }

      const { data: existingTarget, error: targetLookupErr } = await adminClient
        .from('workshop_members')
        .select('role')
        .eq('workshop_id', workshopId)
        .eq('user_id', targetUserId)
        .maybeSingle()

      if (targetLookupErr) {
        return handleControlledServerError('remove_member:lookup', targetLookupErr)
      }

      if (!existingTarget) {
        return jsonResponse({ error: 'El usuario no pertenece a este taller.' }, 404)
      }

      if (existingTarget.role === 'owner' && callerRole !== 'owner') {
        return jsonResponse(
          { error: 'Un administrador no puede eliminar a un propietario (owner) del taller.' },
          403
        )
      }

      const wasOwner = existingTarget.role === 'owner'
      if (wasOwner) {
        const { count: otherOwnersCount, error: countErr } = await adminClient
          .from('workshop_members')
          .select('user_id', { count: 'exact', head: true })
          .eq('workshop_id', workshopId)
          .eq('role', 'owner')
          .neq('user_id', targetUserId)

        if (countErr) {
          return handleControlledServerError('remove_member:count_owners', countErr)
        }

        if ((otherOwnersCount ?? 0) < 1) {
          return jsonResponse(
            { error: 'No se puede eliminar al único propietario (owner) del taller.' },
            409
          )
        }
      }

      const { error: delErr } = await adminClient
        .from('workshop_members')
        .delete()
        .eq('workshop_id', workshopId)
        .eq('user_id', targetUserId)

      if (delErr) {
        return handleControlledServerError('remove_member:delete', delErr)
      }

      return jsonResponse({ ok: true }, 200)
    }

    return jsonResponse({ error: 'Acción administrativa no reconocida.' }, 400)
  } catch (err: unknown) {
    return handleControlledServerError('unhandled', err)
  }
})
