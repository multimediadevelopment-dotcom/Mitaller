import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const audit = vi.hoisted(() => ({ requests: [], latency: 20, authCallback: null, user: { id: 'perf-user', email: 'performance@example.invalid' } }))
vi.mock('../Crash_Solution_Publicacion/src/lib/supabase.js', () => {
  const response = async (operation, value) => {
    audit.requests.push(operation)
    await new Promise(resolve => setTimeout(resolve, audit.latency))
    return value
  }
  const from = table => {
    const value = table === 'user_profiles' ? { user_id: audit.user.id, display_name: 'Perfil de prueba', phone: null }
      : table === 'workshop_members' ? [{ workshop_id: 'perf-workshop', role: 'owner', workshops: { id: 'perf-workshop', name: 'Taller ficticio', logo_path: 'perf-workshop/logo.png' } }]
      : table === 'workshops' ? { id: 'perf-workshop', name: 'Taller ficticio', logo_path: 'perf-workshop/logo.png' } : []
    const query = {
      select: () => query, eq: () => query, order: () => query, range: () => query,
      maybeSingle: () => response(`select:${table}`, { data: value, error: null }),
      single: () => response(`select:${table}`, { data: value, error: null }),
      then: (yes, no) => response(`select:${table}`, { data: value, error: null }).then(yes, no)
    }
    return query
  }
  return { isSupabaseConfigured: true, supabase: {
    from,
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: callback => { audit.authCallback = callback },
      signInWithPassword: async () => response('auth:signIn', { data: { user: audit.user }, error: null })
    },
    storage: { from: () => ({
      download: () => response('storage:download', { data: new Blob(['test-logo'], { type: 'image/png' }), error: null }),
      createSignedUrl: () => response('storage:signedUrl', { data: { signedUrl: 'https://example.invalid/test-logo' }, error: null })
    }) }
  } }
})
vi.mock('../Crash_Solution_Publicacion/src/lib/offline-sync.js', async importOriginal => ({
  ...await importOriginal(), migrateLegacyLocalStorageJobs: async () => {}, unlockOfflineDataForAuthenticatedOwner: async () => {},
  getOfflineJobsForScope: async () => [], getPendingSyncOperations: async () => [], getUnresolvedConflicts: async () => [],
  processSyncQueue: async () => ({ synced: 0, failed: 0, conflicts: 0 })
}))
import { appAuthState, initAuthAndAdmin, navigateAppRoute, resetAppRouter } from '../Crash_Solution_Publicacion/src/main.js'
import { signInWithEmail } from '../Crash_Solution_Publicacion/src/lib/auth.js'
import { privateReadCache } from '../Crash_Solution_Publicacion/src/lib/scoped-cache.js'

describe.skipIf(process.env.MITALLER_PERF_AUDIT !== '1')('Auditoría local repetible sin Supabase real', () => {
  it('registra llamadas y ruta crítica del inicio de sesión y dos visitas al perfil del taller', async () => {
    const samples = []
    for (let sample = 0; sample < 3; sample++) {
      resetAppRouter(); privateReadCache.clear(); localStorage.clear(); history.replaceState(null, '', '/')
      document.body.innerHTML = '<div id="headerAuthNav"></div><div class="header-tools"></div><section id="authScreen"></section><main id="mainAppContainer"><section id="jobsScreen"></section><section id="workScreen" hidden></section><section id="profileScreen" hidden></section><section id="stockScreen" hidden></section><section id="adminScreen" hidden></section></main>'
      window.showJobs = () => { document.getElementById('jobsScreen').hidden = false; document.getElementById('workScreen').hidden = true }
      window.store = { jobs: [], shop: {} }; window.active = null; window.__navPersistenceWrapped = true
      Object.assign(appAuthState, { user: null, session: null, profile: null, memberships: [], activeWorkshopId: null, isSessionBootstrapped: false, activeWorkshopProfile: null, authMode: 'login' })
      await initAuthAndAdmin()
      audit.requests = []
      const start = performance.now()
      await signInWithEmail('performance@example.invalid', 'mock-password')
      await audit.authCallback('SIGNED_IN', { user: audit.user, access_token: 'fake-perf-session', expires_at: Math.floor(Date.now() / 1000) + 3600 })
      const loginMs = performance.now() - start
      const loginRequests = [...audit.requests]
      audit.requests = []
      const visitsStart = performance.now()
      await navigateAppRoute({ name: 'profile' })
      await navigateAppRoute({ name: 'jobs' })
      await navigateAppRoute({ name: 'profile' })
      samples.push({ loginMs, loginRequests, twoProfileVisitsMs: performance.now() - visitsStart, profileVisitRequests: [...audit.requests] })
      window.__headerMenuController?.abort()
    }
    const stage = process.env.MITALLER_PERF_STAGE || 'before'
    expect(['before', 'after']).toContain(stage)
    const sorted = key => samples.map(sample => sample[key]).sort((a, b) => a - b)[1]
    mkdirSync(resolve('docs/performance'), { recursive: true })
    const result = { stage, method: 'Actual application orchestration, simulated Supabase with 20 ms per request, 3 samples. Not production latency.', medianLoginMs: sorted('loginMs'), medianTwoProfileVisitsMs: sorted('twoProfileVisitsMs'), samples }
    writeFileSync(resolve(`docs/performance/${stage}-requests.json`), JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify(result, null, 2))
    resetAppRouter()
    expect(samples).toHaveLength(3)
  })
})
