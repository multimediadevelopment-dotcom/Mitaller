import { describe, expect, it, vi } from 'vitest'
import { createScopedCache } from '../Crash_Solution_Publicacion/src/lib/scoped-cache.js'
import { fetchAllPages } from '../Crash_Solution_Publicacion/src/lib/paged-query.js'

describe('Caché privada en memoria', () => {
  it('deduplica solicitudes concurrentes, copia resultados y respeta TTL', async () => {
    let now = 0
    const cache = createScopedCache({ now: () => now })
    cache.activate({ userId: 'a', workshopId: 'one' })
    const load = vi.fn(async () => ({ name: 'Privado' }))
    const [one, two] = await Promise.all([cache.read('profile', load, 100), cache.read('profile', load, 100)])
    one.name = 'Editado'
    expect(two.name).toBe('Privado')
    expect((await cache.read('profile', load, 100)).name).toBe('Privado')
    expect(load).toHaveBeenCalledOnce()
    now = 101
    await cache.read('profile', load, 100)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('no comparte datos entre usuarios/talleres y borra todo al cerrar sesión', async () => {
    const cache = createScopedCache()
    const load = vi.fn(async () => 'Solo mi ámbito')
    cache.activate({ userId: 'a', workshopId: 'one' }); await cache.read('logo', load)
    cache.activate({ userId: 'b', workshopId: 'one' }); await cache.read('logo', load)
    cache.activate({ userId: 'b', workshopId: 'two' }); await cache.read('logo', load)
    cache.clear(); await cache.read('logo', load); await cache.read('logo', load)
    expect(load).toHaveBeenCalledTimes(5)
  })

  it('un resultado pendiente de la sesión anterior no llena la nueva caché', async () => {
    const cache = createScopedCache()
    cache.activate({ userId: 'a', workshopId: 'one' })
    let finish
    const pending = cache.read('profile', () => new Promise(resolve => { finish = resolve }))
    await Promise.resolve()
    cache.activate({ userId: 'b', workshopId: 'one' })
    finish('Antiguo'); await pending
    expect(await cache.read('profile', async () => 'Nuevo')).toBe('Nuevo')
  })

  it('una mutación iniciada en otra sesión tampoco puede sembrar datos al finalizar', async () => {
    const cache = createScopedCache()
    cache.activate({ userId: 'a', workshopId: 'one' })
    const oldToken = cache.token()
    cache.activate({ userId: 'b', workshopId: 'one' })
    cache.seed('profile', 'Usuario anterior', 30000, oldToken)
    expect(await cache.read('profile', async () => 'Usuario actual')).toBe('Usuario actual')
  })

  it('guardar o invalidar impide que una lectura vieja vuelva a introducir datos obsoletos', async () => {
    const cache = createScopedCache()
    cache.activate({ userId: 'a', workshopId: 'one' })
    let finish
    const pending = cache.read('profile', () => new Promise(resolve => { finish = resolve }))
    await Promise.resolve()
    cache.seed('profile', 'Guardado')
    finish('Viejo'); await pending
    expect(await cache.read('profile', async () => 'No debería cargar')).toBe('Guardado')
    cache.invalidate('profile')
    expect(await cache.read('profile', async () => 'Actualizado')).toBe('Actualizado')
  })

  it('no guarda errores y permite reintentar', async () => {
    const cache = createScopedCache()
    cache.activate({ userId: 'a', workshopId: 'one' })
    await expect(cache.read('logo', async () => { throw new Error('offline') })).rejects.toThrow('offline')
    expect(await cache.read('logo', async () => 'Logo recuperado')).toBe('Logo recuperado')
  })
})

describe('Lectura paginada sin truncar datos offline', () => {
  it('recupera todas las páginas con rangos consecutivos y termina en la página parcial', async () => {
    const ranges = []
    const rows = Array.from({ length: 405 }, (_, id) => ({ id }))
    const loaded = await fetchAllPages(() => ({ range: async (from, to) => {
      ranges.push([from, to]); return { data: rows.slice(from, to + 1), error: null }
    } }))
    expect(loaded).toEqual(rows)
    expect(ranges).toEqual([[0, 199], [200, 399], [400, 599]])
  })

  it('no devuelve un listado parcial si falla una página', async () => {
    let page = 0
    await expect(fetchAllPages(() => ({ range: async () => ++page === 1
      ? { data: [1, 2], error: null } : { error: new Error('red') }
    }), 2)).rejects.toThrow('red')
    await expect(fetchAllPages(() => {}, 0)).rejects.toThrow('página inválido')
  })
})
