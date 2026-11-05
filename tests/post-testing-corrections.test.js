import { describe, it, expect, vi, beforeEach } from 'vitest'
// The registration helper also attempts a global profile upsert. Keep it local
// even when the auth client passed by this test is already mocked.
vi.mock('../Crash_Solution_Publicacion/src/lib/supabase.js', () => ({
  supabase: null,
  isSupabaseConfigured: false
}))
import fs from 'node:fs'
import path from 'node:path'
import { signUpWithEmail } from '../Crash_Solution_Publicacion/src/lib/auth.js'
import {
  buildNavigationSnapshot,
  saveNavigationState,
  loadNavigationState,
  clearNavigationState,
  shouldReinitializeOnAuthEvent
} from '../Crash_Solution_Publicacion/src/lib/navigation-state.js'
import {
  getVehicleYear,
  formatArsCurrency,
  buildBudgetWhatsappMessage,
  buildWhatsappShareUrl,
  generateBudgetPdfBytes
} from '../Crash_Solution_Publicacion/src/lib/budget-delivery.js'

const SAMPLE_SHOP = {
  id: 'ws-test-01',
  name: 'Crash Solution',
  legal_name: 'Crash Solution S.R.L.',
  tax_id: '30-71234567-9',
  phone: '011 4555-1234',
  whatsapp: '+54 9 11 5555-1234',
  email: 'presupuestos@crashsolution.com.ar',
  address: 'Av. Warnes 1234, CABA'
}

const SAMPLE_JOB = {
  id: 'job-2026-test-01',
  number: 'OT-00199',
  status: 'En progreso',
  rec: {
    cliente: 'Valeria Sosa',
    telefono: '11 5555 9876',
    patente: 'AF 901 CD',
    marca: 'Toyota',
    modelo: 'Corolla',
    anio: '2020',
    km: '42500',
    localidad: 'Vicente López',
    direccion: 'Av. Maipú 1500'
  },
  quote: [
    {
      id: 'q-1',
      description: 'Paragolpes delantero · Reparación y pintura bicapa',
      qty: 1,
      price: 145000
    },
    {
      id: 'q-2',
      description: 'Óptica delantera derecha · Reemplazo y alineación',
      qty: 1,
      price: 85000
    }
  ],
  discount: 10,
  tax: 21,
  document: {
    date: '2026-11-03',
    validDays: 15,
    terms: 'Garantía escrita de 12 meses en pintura.'
  }
}

describe('Correcciones Post-Pruebas Manuales (Correcciones 1 a 6)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('CORRECCIÓN 1: permite registrar usuario e iniciar sesión inmediatamente sin confirmación obligatoria de email', async () => {
    const fakeUser = {
      id: 'user-immediate-01',
      email: 'taller.nuevo@example.com',
      user_metadata: { full_name: 'Carlos Taller', phone: '11 4444 5555' }
    }
    const fakeSession = {
      access_token: 'jwt-token-immediate',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: fakeUser
    }

    const upsertMock = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => ({
          data: { id: fakeUser.id, full_name: 'Carlos Taller', phone: '11 4444 5555' },
          error: null
        })
      })
    })

    // Caso A: signUp devuelve user pero session=null y signInWithPassword abre sesión inmediatamente
    const mockClientImmediateFallback = {
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: fakeUser, session: null },
          error: null
        }),
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { user: fakeUser, session: fakeSession },
          error: null
        })
      },
      from: vi.fn().mockReturnValue({ upsert: upsertMock })
    }

    const res = await signUpWithEmail(
      {
        email: 'Taller.Nuevo@Example.com ',
        password: 'password123',
        confirmPassword: 'password123',
        displayName: 'Carlos Taller',
        phone: '11 4444 5555'
      },
      mockClientImmediateFallback
    )

    expect(mockClientImmediateFallback.auth.signUp).toHaveBeenCalledTimes(1)
    expect(mockClientImmediateFallback.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'taller.nuevo@example.com',
      password: 'password123'
    })
    expect(res.session).toEqual(fakeSession)
    expect(res.user.id).toBe('user-immediate-01')
    expect(res.requiresEmailConfirmation).toBe(false)
  })

  it('CORRECCIÓN 2: persiste y restaura exactamente trabajo abierto, sección, paso, zona, pieza, página y scroll, e ignora eventos de foco de pestaña', () => {
    const saved = saveNavigationState({
      userId: 'user-nav-01',
      workshopId: 'ws-nav-01',
      screen: 'work',
      activeJobId: 'job-abc-123',
      step: 'inspection',
      area: 'Lateral izquierdo',
      page: 2,
      activePieceKey: 'Lateral izquierdo::Puerta delantera izquierda',
      openPieceDetailsKeys: ['Lateral izquierdo::Puerta delantera izquierda'],
      mapOpen: false,
      scrollY: 340
    })

    expect(saved).toBeTruthy()
    expect(saved.screen).toBe('work')
    expect(saved.activeJobId).toBe('job-abc-123')
    expect(saved.step).toBe('inspection')
    expect(saved.area).toBe('Lateral izquierdo')
    expect(saved.page).toBe(2)
    expect(saved.activePieceKey).toBe('Lateral izquierdo::Puerta delantera izquierda')
    expect(saved.openPieceDetailsKeys).toEqual(['Lateral izquierdo::Puerta delantera izquierda'])
    expect(saved.mapOpen).toBe(false)
    expect(saved.scrollY).toBe(340)

    // Recupera el estado exacto para el mismo usuario y taller
    const restored = loadNavigationState({
      userId: 'user-nav-01',
      workshopId: 'ws-nav-01'
    })
    expect(restored).toEqual(saved)

    // No filtra el estado de navegación a otro usuario distinto
    expect(
      loadNavigationState({
        userId: 'otro-usuario-99',
        workshopId: 'ws-nav-01'
      })
    ).toBeNull()

    // Al volver de otra pestaña de Chrome, Supabase dispara TOKEN_REFRESHED o SIGNED_IN para el mismo usuario:
    // NO debe reinicializar la pantalla ni sacar al usuario de la pieza que estaba inspeccionando
    expect(
      shouldReinitializeOnAuthEvent({
        event: 'TOKEN_REFRESHED',
        previousUserId: 'user-nav-01',
        nextUserId: 'user-nav-01',
        isInitialized: true
      })
    ).toBe(false)

    expect(
      shouldReinitializeOnAuthEvent({
        event: 'SIGNED_IN',
        previousUserId: 'user-nav-01',
        nextUserId: 'user-nav-01',
        isInitialized: true
      })
    ).toBe(false)

    // Pero sí debe inicializar cuando no estaba inicializado o cuando cambia de usuario
    expect(
      shouldReinitializeOnAuthEvent({
        event: 'SIGNED_IN',
        previousUserId: null,
        nextUserId: 'user-nav-01',
        isInitialized: false
      })
    ).toBe(true)

    expect(
      shouldReinitializeOnAuthEvent({
        event: 'SIGNED_IN',
        previousUserId: 'user-nav-01',
        nextUserId: 'user-nav-02',
        isInitialized: true
      })
    ).toBe(true)

    clearNavigationState()
    expect(loadNavigationState({ userId: 'user-nav-01', workshopId: 'ws-nav-01' })).toBeNull()
  })

  it('CORRECCIÓN 3: incluye el Año del vehículo en el formulario principal y en el PDF generado sin truncarse', () => {
    expect(getVehicleYear({ anio: 2020 })).toBe('2020')
    expect(getVehicleYear({ año: '2019' })).toBe('2019')
    expect(getVehicleYear({ year: 2022 })).toBe('2022')

    const pdfBytes = generateBudgetPdfBytes(SAMPLE_JOB, SAMPLE_SHOP)
    const rawPdfText = new TextDecoder('latin1').decode(pdfBytes)

    // Verifica presencia de Cliente, Marca y modelo, Año, Patente, Kilometraje, Trabajos y Total en el PDF
    expect(rawPdfText).toContain('Valeria Sosa')
    expect(rawPdfText).toContain('Toyota Corolla')
    expect(rawPdfText).toContain('Patente: AF 901 CD')
    expect(rawPdfText).toContain('2020')
    expect(rawPdfText).toContain('42500 km')
    expect(rawPdfText).toContain('Paragolpes delantero')

    // Verifica que index.html tenga el campo Año en la grilla principal de Recepción
    const indexHtmlPath = path.resolve(process.cwd(), 'Crash_Solution_Publicacion/index.html')
    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8')
    const mainGridSnippet = indexHtml.slice(
      indexHtml.indexOf('<section id="receptionStep"'),
      indexHtml.indexOf('<details class="optional-fields">')
    )
    expect(mainGridSnippet).toContain('data-rec="anio"')
  })

  it('CORRECCIÓN 4: genera el mensaje de WhatsApp con codificación UTF-8 limpia, sin emojis sustitutos ni espacios de no separación (NBSP) ni signos matemáticos que produzcan rombos ()', () => {
    const formattedMoney = formatArsCurrency(255915)
    expect(formattedMoney).not.toMatch(/[\u00A0\u202F]/)
    expect(formattedMoney).toContain('$ 255.915')

    const msg = buildBudgetWhatsappMessage(SAMPLE_JOB, SAMPLE_SHOP)

    // No debe contener pares sustitutos UTF-16 (emojis fuera del BMP), ni U+FFFD (), ni NBSP, ni signo menos matemático U+2212
    expect(msg).not.toMatch(/[\uD800-\uDFFF]/)
    expect(msg).not.toContain('\uFFFD')
    expect(msg).not.toMatch(/[\u00A0\u202F\t]/)
    expect(msg).not.toContain('\u2212')

    // Debe incluir todos los datos clave incluyendo el Año del vehículo
    expect(msg).toContain('*Crash Solution - Presupuesto OT-00199*')
    expect(msg).toContain('*Cliente:* Valeria Sosa')
    expect(msg).toContain('*Vehículo:* Toyota Corolla 2020 (AF 901 CD)')
    expect(msg).toContain('*Año:* 2020')
    expect(msg).toContain('*Patente:* AF 901 CD')
    expect(msg).toContain('*Kilometraje:* 42500 km')
    expect(msg).toContain('- Paragolpes delantero · Reparación y pintura bicapa')
    expect(msg).toContain('Descuento (10%): - $')
    expect(msg).toContain('*TOTAL PRESUPUESTADO: $')

    // Verifica ida y vuelta de URL encoding para WhatsApp Web y móvil
    const shareUrl = buildWhatsappShareUrl(SAMPLE_JOB, SAMPLE_SHOP)
    const encodedQuery = shareUrl.split('?text=')[1]
    const decodedText = decodeURIComponent(encodedQuery)
    expect(decodedText).toBe(msg)
    expect(decodedText).not.toContain('\uFFFD')
  })

  it('CORRECCIÓN 5 y 6: el código de interfaz está libre de textos técnicos de desarrollo y protege la sincronización manual contra ejecuciones duplicadas', () => {
    const mainJsPath = path.resolve(process.cwd(), 'Crash_Solution_Publicacion/src/main.js')
    const mainJs = fs.readFileSync(mainJsPath, 'utf8')

    // Verifica que la función de sincronización manual controle concurrencia y limpie el aviso al llegar a 0 pendientes
    expect(mainJs).toContain('appAuthState.isSyncingOfflineQueue = true')
    expect(mainJs).toContain('Sincronizando…')
    expect(mainJs).toContain("noticeEl.hidden = true")
    expect(mainJs).toContain("noticeEl.innerHTML = ''")

    // Verifica que los textos visibles de las pantallas no expongan identificadores internos de desarrollo
    expect(mainJs).not.toContain('<p class="eyebrow">DEV-19')
    expect(mainJs).not.toContain('<p class="eyebrow">DEV-22')
    expect(mainJs).not.toContain('RPC <code>record_stock_movement</code>')
    expect(mainJs).not.toContain('public.stock_movements')
    expect(mainJs).not.toContain('Row Level Security (RLS)')
  })
})
