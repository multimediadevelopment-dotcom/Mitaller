// Private read cache: memory only, one authenticated user/workshop at a time.
export function createScopedCache({ now = () => Date.now() } = {}) {
  let scope = null
  let epoch = 0
  const values = new Map()
  const pending = new Map()
  const revisions = new Map()
  const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value))
  function clear() { epoch++; values.clear(); pending.clear(); revisions.clear(); scope = null }
  return {
    activate({ userId, workshopId }) {
      const next = userId && workshopId ? JSON.stringify([userId, workshopId]) : null
      if (scope !== next) { clear(); scope = next }
    },
    clear,
    token: () => epoch,
    seed(key, value, ttl = 30000, expectedEpoch = epoch) {
      if (scope && expectedEpoch === epoch) {
        pending.delete(key)
        revisions.set(key, (revisions.get(key) || 0) + 1)
        values.set(key, { data: clone(value), until: now() + ttl })
      }
    },
    invalidate(prefix) {
      for (const key of new Set([...values.keys(), ...pending.keys()])) if (key.startsWith(prefix)) {
        values.delete(key); pending.delete(key); revisions.set(key, (revisions.get(key) || 0) + 1)
      }
    },
    async read(key, load, ttl = 30000) {
      if (!scope) return load()
      const cached = values.get(key)
      if (cached && cached.until > now()) return clone(cached.data)
      if (pending.has(key)) return pending.get(key).then(clone)
      const startedEpoch = epoch
      const revision = revisions.get(key) || 0
      const promise = Promise.resolve().then(load).then(data => {
        if (epoch === startedEpoch && (revisions.get(key) || 0) === revision) {
          values.set(key, { data: clone(data), until: now() + ttl })
        }
        return data
      }).finally(() => { if (pending.get(key) === promise) pending.delete(key) })
      pending.set(key, promise)
      return promise.then(clone)
    }
  }
}
export const privateReadCache = createScopedCache()
