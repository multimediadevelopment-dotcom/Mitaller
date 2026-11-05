import { supabase } from './supabase.js'

export function getProfileInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean)
  return words.length ? [words[0], ...(words.length > 1 ? [words.at(-1)] : [])]
    .map(word => Array.from(word)[0]).join('').toLocaleUpperCase('es') : 'U'
}

export function validatePersonalProfile(input = {}) {
  const display_name = String(input.display_name || '').trim()
  const phone = String(input.phone || '').trim()
  if (display_name.length < 2) {
    throw new Error('Ingresá tu nombre y apellido (mínimo 2 caracteres).')
  }
  if (phone && (!/^[+\d\s()-]{6,30}$/.test(phone) || phone.replace(/\D/g, '').length < 6)) {
    throw new Error('Ingresá un teléfono válido con al menos 6 dígitos, o dejá el campo vacío.')
  }
  // Only fields already supported by user_profiles. Never accept role or email.
  return { display_name, phone: phone || null }
}

export async function updatePersonalProfile(input, client = supabase) {
  const values = validatePersonalProfile(input)
  if (!client) throw new Error('No se pudo conectar. Intentá nuevamente cuando tengas conexión.')
  let result
  try {
    const { data, error } = await client.auth.getUser()
    if (error || !data?.user) throw new Error('session')
    result = await client.from('user_profiles').update(values)
      .eq('user_id', data.user.id)
      .select('user_id, display_name, phone, created_at').single()
  } catch {
    throw new Error('No se pudieron guardar tus datos. Revisá tu conexión y que la sesión siga activa.')
  }
  if (result.error || !result.data) {
    throw new Error('No se pudieron guardar tus datos. Verificá tus permisos o intentá nuevamente.')
  }
  return result.data
}
