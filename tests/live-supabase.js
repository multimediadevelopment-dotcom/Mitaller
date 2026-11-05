import { createClient } from '@supabase/supabase-js'

// Live tests are opt-in and use a separate, disposable project only.
// Never fall back to the application's .env or browser session.
export const liveTestsEnabled = process.env.MITALLER_LIVE_TESTS === '1'
const url = process.env.MITALLER_TEST_SUPABASE_URL || ''
const key = process.env.MITALLER_TEST_SUPABASE_PUBLISHABLE_KEY || ''
if (liveTestsEnabled && (!url || !key || new URL(url).hostname === 'lqaedtoaukhefuibrcww.supabase.co')) {
  throw new Error('Las pruebas remotas requieren URL y clave pública de un proyecto separado de pruebas. Producción está bloqueada.')
}
export const supabase = liveTestsEnabled
  ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null
