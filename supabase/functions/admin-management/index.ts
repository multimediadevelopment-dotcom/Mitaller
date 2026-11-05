// Entrypoint only. JWT/permissions and actions are implemented in the testable handler.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { createAdminHandler } from './handler.ts'

Deno.serve(createAdminHandler({ createClient, env: name => Deno.env.get(name) }))
