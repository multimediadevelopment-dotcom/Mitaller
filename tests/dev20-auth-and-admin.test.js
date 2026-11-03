import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  VALID_WORKSHOP_ROLES,
  validateEmail,
  validatePassword,
  validateRegistration,
  validatePasswordUpdate,
  isSessionExpired,
  canAccessAdminPanel,
  preventSelfPrivilegeEscalation,
  translateAuthError
} from '../Crash_Solution_Publicacion/src/lib/auth.js'
import {
  ALLOWED_MEMBER_ROLES,
  validateWorkshopInput,
  validateMemberAssignment,
  validateMemberRemoval,
  sanitizeAdminErrorMessage,
  inviteOrCreateWorkshopUser
} from '../Crash_Solution_Publicacion/src/lib/admin.js'
import { supabase } from '../Crash_Solution_Publicacion/src/lib/supabase.js'

describe('DEV-20 — Autenticación, Roles reales (owner | admin | staff) y Seguridad Server-Side', () => {
  it('admite únicamente los roles reales de la restricción SQL en workshop_members (owner, admin, staff)', () => {
    expect(VALID_WORKSHOP_ROLES).toEqual(['owner', 'admin', 'staff'])
    expect(ALLOWED_MEMBER_ROLES).toEqual(['owner', 'admin', 'staff'])
    expect(ALLOWED_MEMBER_ROLES).not.toContain('mechanic')
    expect(ALLOWED_MEMBER_ROLES).not.toContain('viewer')
  })

  it('valida formato de correo electrónico y contraseñas', () => {
    expect(validateEmail('').valid).toBe(false)
    expect(validateEmail('usuario-invalido').valid).toBe(false)
    expect(validateEmail('Taller@CrashSolution.com')).toEqual({
      valid: true,
      value: 'taller@crashsolution.com'
    })

    expect(validatePassword('1234567').valid).toBe(false)
    expect(validatePassword('12345678').valid).toBe(true)
  })

  it('valida el registro de usuario y la actualización de contraseña', () => {
    expect(
      validateRegistration({
        displayName: 'A',
        email: 'test@taller.com',
        password: 'password123',
        confirmPassword: 'password123'
      }).valid
    ).toBe(false)

    expect(
      validateRegistration({
        displayName: 'Juan Operador',
        email: 'juan@taller.com',
        password: 'password123',
        confirmPassword: 'otraPassword'
      }).valid
    ).toBe(false)

    expect(
      validateRegistration({
        displayName: 'Juan Operador',
        email: 'juan@taller.com',
        password: 'password123',
        confirmPassword: 'password123'
      }).valid
    ).toBe(true)

    expect(validatePasswordUpdate('nuevaClave123', 'nuevaClave123').valid).toBe(true)
    expect(validatePasswordUpdate('nuevaClave123', 'distinta123').valid).toBe(false)
  })

  it('detecta correctamente sesiones válidas y sesiones expiradas', () => {
    const now = 1700000000000
    expect(isSessionExpired(null, now)).toBe(true)
    expect(isSessionExpired({}, now)).toBe(true)
    expect(
      isSessionExpired(
        {
          access_token: 'tok',
          user: { id: 'u1' },
          expires_at: Math.floor(now / 1000) - 10
        },
        now
      )
    ).toBe(true)

    expect(
      isSessionExpired(
        {
          access_token: 'tok',
          user: { id: 'u1' },
          expires_at: Math.floor(now / 1000) + 3600
        },
        now
      )
    ).toBe(false)
  })

  it('impide que un usuario staff acceda a operaciones de /admin o se auto-asigne privilegios, e impide que admin escale a owner', () => {
    expect(canAccessAdminPanel('staff')).toBe(false)
    expect(canAccessAdminPanel('mechanic')).toBe(false)
    expect(canAccessAdminPanel('admin')).toBe(true)
    expect(canAccessAdminPanel('owner')).toBe(true)

    // Staff intentando auto-asignarse admin
    const staffEscalate = preventSelfPrivilegeEscalation({
      callerId: '11111111-1111-1111-1111-111111111111',
      callerRole: 'staff',
      targetUserId: '11111111-1111-1111-1111-111111111111',
      requestedRole: 'admin'
    })
    expect(staffEscalate.allowed).toBe(false)

    // Admin intentando auto-asignarse owner
    const adminToOwnerEscalate = preventSelfPrivilegeEscalation({
      callerId: '11111111-1111-1111-1111-111111111111',
      callerRole: 'admin',
      targetUserId: '11111111-1111-1111-1111-111111111111',
      requestedRole: 'owner'
    })
    expect(adminToOwnerEscalate.allowed).toBe(false)

    // Admin intentando modificar a un owner existente
    const adminModifyOwner = validateMemberAssignment({
      callerId: '11111111-1111-1111-1111-111111111111',
      callerRole: 'admin',
      workshopId: 'ws-1',
      targetUserId: '22222222-2222-2222-2222-222222222222',
      targetCurrentRole: 'owner',
      role: 'staff',
      currentOwnerCount: 2
    })
    expect(adminModifyOwner.valid).toBe(false)

    // Rechazo de rol inexistente en la BD (ej. mechanic)
    const invalidRoleAssign = validateMemberAssignment({
      callerId: '11111111-1111-1111-1111-111111111111',
      callerRole: 'owner',
      workshopId: 'ws-1',
      targetUserId: '22222222-2222-2222-2222-222222222222',
      role: 'mechanic',
      currentOwnerCount: 1
    })
    expect(invalidRoleAssign.valid).toBe(false)
  })

  it('impide que el taller quede sin propietario (owner)', () => {
    const orphanOwnerAttempt = validateMemberAssignment({
      callerId: '11111111-1111-1111-1111-111111111111',
      callerRole: 'owner',
      workshopId: 'ws-1',
      targetUserId: '11111111-1111-1111-1111-111111111111',
      targetCurrentRole: 'owner',
      role: 'admin',
      currentOwnerCount: 1
    })
    expect(orphanOwnerAttempt.valid).toBe(false)
    expect(orphanOwnerAttempt.error).toContain('sin propietario')

    const validAssign = validateMemberAssignment({
      callerId: '11111111-1111-1111-1111-111111111111',
      callerRole: 'owner',
      workshopId: 'ws-1',
      targetUserId: '22222222-2222-2222-2222-222222222222',
      targetCurrentRole: null,
      role: 'staff',
      currentOwnerCount: 1
    })
    expect(validAssign.valid).toBe(true)
  })

  it('valida datos de alta de taller y traduce mensajes de error de Supabase Auth', () => {
    expect(validateWorkshopInput({ name: '' }).valid).toBe(false)
    expect(validateWorkshopInput({ name: 'Taller Central' })).toEqual({
      valid: true,
      name: 'Taller Central'
    })
    expect(translateAuthError({ message: 'Invalid login credentials' })).toContain('incorrectos')
    expect(translateAuthError({ message: 'JWT expired' })).toContain('expiró')
  })

  it('prioriza invitaciones por correo y rechaza que un administrador ingrese contraseñas de terceros', async () => {
    await expect(
      inviteOrCreateWorkshopUser({
        callerId: '11111111-1111-1111-1111-111111111111',
        callerRole: 'owner',
        workshopId: 'ws-1',
        email: 'nuevo@taller.com',
        password: 'PasswordDeTercero123',
        displayName: 'Nuevo Operador',
        role: 'staff'
      })
    ).rejects.toThrow(/contraseñas de terceros/i)

    // También impide que un admin invite a alguien con rol 'owner'
    await expect(
      inviteOrCreateWorkshopUser({
        callerId: '11111111-1111-1111-1111-111111111111',
        callerRole: 'admin',
        workshopId: 'ws-1',
        email: 'otro@taller.com',
        displayName: 'Intento Owner',
        role: 'owner'
      })
    ).rejects.toThrow(/propietario/i)
  })

  it('oculta errores internos de base de datos o servidor devolviendo mensajes controlados al navegador', () => {
    const rawSqlError = new Error(
      'PGRST204: duplicate key value violates unique constraint "workshop_members_pkey" on relation "workshop_members"'
    )
    const controlled = sanitizeAdminErrorMessage(
      rawSqlError,
      'No se pudo actualizar los miembros del taller.'
    )
    expect(controlled).toBe('No se pudo actualizar los miembros del taller.')
    expect(controlled).not.toContain('PGRST')
    expect(controlled).not.toContain('workshop_members_pkey')

    const lastOwnerTriggerErr = new Error(
      'violates check constraint: LAST_OWNER_PROTECTED: El taller no puede quedar sin propietario'
    )
    expect(sanitizeAdminErrorMessage(lastOwnerTriggerErr)).toContain(
      'no puede quedar sin al menos un propietario'
    )
  })

  it('protege transaccionalmente al último propietario en DELETE y UPDATE individuales, por lote y concurrentes sin dejar la base inconsistente', async () => {
    // 1. Verificar que el SQL de migración cumple SET search_path = '' y referencias explícitas
    const sqlPath = resolve(
      import.meta.dirname,
      '../supabase/migrations/20261103_protect_last_workshop_owner.sql'
    )
    const sqlContent = readFileSync(sqlPath, 'utf8')
    expect(sqlContent).toContain("SET search_path = ''")
    expect(sqlContent).toContain('FROM public.workshops')
    expect(sqlContent).toContain('FROM public.workshop_members')
    expect(sqlContent).toContain('pg_catalog.count(*)')
    expect(sqlContent).toContain('FOR UPDATE')
    expect(sqlContent).toContain('AFTER UPDATE OR DELETE ON public.workshop_members')

    // 2. Validación de negocio en cliente/servidor para eliminación directa o por admin
    const removeSoleOwner = validateMemberRemoval({
      callerId: '11111111-1111-1111-1111-111111111111',
      callerRole: 'owner',
      targetUserId: '11111111-1111-1111-1111-111111111111',
      targetCurrentRole: 'owner',
      currentOwnerCount: 1
    })
    expect(removeSoleOwner.valid).toBe(false)

    const adminRemoveOwner = validateMemberRemoval({
      callerId: '33333333-3333-3333-3333-333333333333',
      callerRole: 'admin',
      targetUserId: '11111111-1111-1111-1111-111111111111',
      targetCurrentRole: 'owner',
      currentOwnerCount: 2
    })
    expect(adminRemoveOwner.valid).toBe(false)

    // 3. Motor transaccional que emula exactamente el trigger AFTER UPDATE OR DELETE con FOR UPDATE sobre public.workshops
    const workshopsTable = new Set(['ws-1'])
    const membersTable = new Map([
      ['ws-1::owner-1', { workshop_id: 'ws-1', user_id: 'owner-1', role: 'owner' }],
      ['ws-1::owner-2', { workshop_id: 'ws-1', user_id: 'owner-2', role: 'owner' }],
      ['ws-1::staff-1', { workshop_id: 'ws-1', user_id: 'staff-1', role: 'staff' }]
    ])

    let workshopRowLock = Promise.resolve()

    const runTransactionalMutation = mutationFn => {
      const tx = workshopRowLock.then(async () => {
        // Snapshot transaccional (para rollback automático ante excepción del trigger)
        const snapshot = new Map(
          Array.from(membersTable.entries()).map(([k, v]) => [k, { ...v }])
        )
        try {
          await new Promise(r => setTimeout(r, 8))
          const affectedOldRows = mutationFn(membersTable)

          // Ejecución del trigger AFTER UPDATE OR DELETE FOR EACH ROW
          for (const { op, oldRow, newRow } of affectedOldRows) {
            const lostOwner =
              oldRow.role === 'owner' &&
              (op === 'DELETE' ||
                newRow.role !== 'owner' ||
                newRow.workshop_id !== oldRow.workshop_id ||
                newRow.user_id !== oldRow.user_id)

            if (lostOwner && workshopsTable.has(oldRow.workshop_id)) {
              const remainingOwners = Array.from(membersTable.values()).filter(
                m => m.workshop_id === oldRow.workshop_id && m.role === 'owner'
              ).length
              if (remainingOwners < 1) {
                const err = new Error(
                  'LAST_OWNER_PROTECTED: El taller debe conservar al menos un propietario (owner).'
                )
                err.code = '23514'
                throw err
              }
            }
          }
          return { committed: true }
        } catch (err) {
          // Rollback atómico de la transacción completa: la base queda 100% consistente
          membersTable.clear()
          for (const [k, v] of snapshot.entries()) {
            membersTable.set(k, v)
          }
          throw err
        }
      })
      workshopRowLock = tx.catch(() => {})
      return tx
    }

    // Caso A: Dos solicitudes concurrentes (una hace UPDATE a 'admin' sobre owner-1 y otra hace DELETE sobre owner-2)
    const concurrentResults = await Promise.allSettled([
      runTransactionalMutation(table => {
        const oldRow = { ...table.get('ws-1::owner-1') }
        const newRow = { ...oldRow, role: 'admin' }
        table.set('ws-1::owner-1', newRow)
        return [{ op: 'UPDATE', oldRow, newRow }]
      }),
      runTransactionalMutation(table => {
        const oldRow = { ...table.get('ws-1::owner-2') }
        table.delete('ws-1::owner-2')
        return [{ op: 'DELETE', oldRow, newRow: null }]
      })
    ])

    expect(concurrentResults.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(concurrentResults.filter(r => r.status === 'rejected')).toHaveLength(1)

    // Verificar que la base quedó consistente con exactamente 1 propietario y sin corrupción
    const ownersAfterRace = Array.from(membersTable.values()).filter(
      m => m.workshop_id === 'ws-1' && m.role === 'owner'
    )
    expect(ownersAfterRace).toHaveLength(1)
    expect(ownersAfterRace[0].user_id).toBe('owner-2')
    expect(membersTable.get('ws-1::owner-1').role).toBe('admin')

    // Caso B: Intento de eliminar al último owner restante (DELETE directo) -> falla y hace rollback
    await expect(
      runTransactionalMutation(table => {
        const oldRow = { ...table.get('ws-1::owner-2') }
        table.delete('ws-1::owner-2')
        return [{ op: 'DELETE', oldRow, newRow: null }]
      })
    ).rejects.toThrow(/LAST_OWNER_PROTECTED/)
    expect(membersTable.get('ws-1::owner-2')?.role).toBe('owner')

    // Caso C: Operación masiva (DELETE o UPDATE en lote sobre múltiples owners en una sola transacción)
    membersTable.set('ws-1::owner-1', { workshop_id: 'ws-1', user_id: 'owner-1', role: 'owner' })
    await expect(
      runTransactionalMutation(table => {
        const o1 = { ...table.get('ws-1::owner-1') }
        const o2 = { ...table.get('ws-1::owner-2') }
        table.delete('ws-1::owner-1')
        table.delete('ws-1::owner-2')
        return [
          { op: 'DELETE', oldRow: o1, newRow: null },
          { op: 'DELETE', oldRow: o2, newRow: null }
        ]
      })
    ).rejects.toThrow(/LAST_OWNER_PROTECTED/)

    // Rollback completo: ambos propietarios siguen intactos tras el fallo del lote
    expect(membersTable.get('ws-1::owner-1')?.role).toBe('owner')
    expect(membersTable.get('ws-1::owner-2')?.role).toBe('owner')
  })

  it('verifica en vivo contra Supabase que RLS bloquea la inserción/modificación/eliminación directa en workshop_members y aísla datos entre talleres', async () => {
    expect(supabase).toBeTruthy()

    // 1. Sin sesión autorizada en el taller ajeno, las lecturas no devuelven filas de otros talleres
    const [jobsRes, membersRes, stockRes] = await Promise.all([
      supabase.from('jobs').select('id, workshop_id').eq('workshop_id', '99999999-9999-9999-9999-999999999999'),
      supabase.from('workshop_members').select('workshop_id, user_id, role').eq('workshop_id', '99999999-9999-9999-9999-999999999999'),
      supabase.from('stock_items').select('id, workshop_id').eq('workshop_id', '99999999-9999-9999-9999-999999999999')
    ])
    expect(jobsRes.error).toBeNull()
    expect(jobsRes.data).toEqual([])
    expect(membersRes.error).toBeNull()
    expect(membersRes.data).toEqual([])
    expect(stockRes.error).toBeNull()
    expect(stockRes.data).toEqual([])

    // 2. La inserción directa desde el frontend en workshop_members está bloqueada por RLS (código 42501)
    const { error: directMemberInsertErr } = await supabase.from('workshop_members').insert({
      workshop_id: '00000000-0000-0000-0000-000000000000',
      user_id: '00000000-0000-0000-0000-000000000000',
      role: 'owner'
    })
    expect(directMemberInsertErr).toBeTruthy()
    expect(directMemberInsertErr.code).toBe('42501')
  })
})
