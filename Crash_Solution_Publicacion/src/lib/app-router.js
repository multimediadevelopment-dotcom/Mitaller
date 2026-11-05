const STEPS = ['reception', 'inspection', 'budget']
const HASHES = { jobs: '#/trabajos', stock: '#/stock', profile: '#/perfil', admin: '#/admin', password: '#update-password' }

export function routeHash(route) {
  if (route.name === 'work' && route.jobId) {
    return `#/trabajos/${encodeURIComponent(route.jobId)}/${STEPS.includes(route.step) ? route.step : 'reception'}`
  }
  return HASHES[route.name] || HASHES.jobs
}

export function readAppRoute(location) {
  for (const [name, hash] of Object.entries(HASHES)) if (location.hash === hash) return { name }
  const match = /^#\/trabajos\/([^/]+)\/(reception|inspection|budget)$/.exec(location.hash)
  if (match) {
    try { return { name: 'work', jobId: decodeURIComponent(match[1]), step: match[2] } } catch { /* Invalid URL */ }
  }
  return { name: !location.hash && location.pathname.endsWith('/admin') ? 'admin' : 'jobs' }
}

export function routeForSnapshot(snapshot) {
  if (snapshot?.screen === 'work' && snapshot.activeJobId) {
    return { name: 'work', jobId: snapshot.activeJobId, step: snapshot.step }
  }
  return { name: HASHES[snapshot?.screen] ? snapshot.screen : 'jobs' }
}

// One history entry per user navigation. Rendering never pushes history.
export function createAppRouter({ window: win, render, scope, onError = () => {} }) {
  let lastKey = ''
  let scheduled = false
  let sequence = 0
  let waiters = []
  const state = () => win.history.state?.mitallerNav?.scope === scope() ? win.history.state.mitallerNav : null
  const url = route => `${win.location.pathname}${win.location.search}${routeHash(route)}`
  const write = (entry, replace, route) => {
    win.history[replace ? 'replaceState' : 'pushState']({ ...win.history.state, mitallerNav: entry }, '', url(route))
  }
  const makeEntry = extra => ({ id: `${Date.now()}-${++sequence}`, scope: scope(), ...extra })
  const ensureEntry = () => {
    if (!state()) write(makeEntry({}), true, readAppRoute(win.location))
    else if (win.location.hash !== routeHash(readAppRoute(win.location))) write(state(), true, readAppRoute(win.location))
    return state()
  }
  async function sync({ force = false } = {}) {
    const entry = ensureEntry()
    const key = `${win.location.href}|${entry.id}|${entry.scope}`
    if (!force && key === lastKey) return
    lastKey = key
    const pending = waiters
    waiters = []
    try { await render(readAppRoute(win.location), entry) }
    finally { pending.forEach(resolve => resolve()) }
  }
  const onLocationChange = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      sync().catch(onError)
    })
  }
  win.addEventListener('popstate', onLocationChange)
  win.addEventListener('hashchange', onLocationChange)
  return {
    state,
    sync,
    capture(snapshot) {
      const entry = ensureEntry()
      // Password has its own route, but retains the underlying return snapshot.
      write({ ...entry, snapshot }, true, readAppRoute(win.location))
    },
    async navigate(route, { replace = false, snapshot, returnRoute, force = false } = {}) {
      const previous = ensureEntry()
      if (routeHash(route) === win.location.hash && !replace) return sync({ force })
      const password = route.name === 'password'
      write(makeEntry({
        snapshot: snapshot ?? (password ? previous.snapshot : undefined),
        returnRoute: password ? (returnRoute || readAppRoute(win.location)) : undefined,
        backToApp: password && !replace
      }), replace, route)
      return sync({ force: true })
    },
    returnFromPassword() {
      const entry = state()
      if (entry?.backToApp) {
        const done = new Promise(resolve => waiters.push(resolve))
        win.history.back()
        return done
      }
      return this.navigate(entry?.returnRoute || routeForSnapshot(entry?.snapshot), {
        replace: true, snapshot: entry?.snapshot
      })
    },
    dispose() {
      win.removeEventListener('popstate', onLocationChange)
      win.removeEventListener('hashchange', onLocationChange)
      waiters.forEach(resolve => resolve())
      waiters = []
    }
  }
}
