import './styles.css'
import { supabase, isSupabaseConfigured } from './lib/supabase.js'
import {
  ROLE_LABELS,
  isSessionExpired,
  canAccessAdminPanel,
  ensureUserProfile,
  fetchUserWorkshops,
  signInWithEmail,
  signUpWithEmail,
  signOutUser,
  sendPasswordReset,
  updateUserPassword,
  translateAuthError
} from './lib/auth.js'
import {
  ALLOWED_MEMBER_ROLES,
  fetchAdminWorkshopMembers,
  fetchKnownUserProfiles,
  createNewWorkshop,
  upsertWorkshopMember,
  removeMemberFromWorkshop,
  inviteOrCreateWorkshopUser
} from './lib/admin.js'
import {
  fetchWorkshopProfile,
  updateWorkshopProfile,
  uploadWorkshopLogo,
  resolveWorkshopLogoUrl,
  buildBudgetWorkshopHeaderHtml,
  formatCuit
} from './lib/workshop-profile.js'
import {
  STOCK_CATEGORIES,
  STOCK_UNITS,
  PART_POSITIONS,
  isLowStock,
  formatCompatibilityLabel,
  filterStockItems,
  fetchWorkshopStock,
  createStockItem,
  updateStockItem,
  archiveStockItem,
  recordStockMovement,
  fetchStockMovements
} from './lib/stock.js'
import {
  openWhatsappWithBudgetText,
  downloadBudgetPdf,
  shareBudgetPdf
} from './lib/budget-delivery.js'
import {
  saveOfflineJob,
  getOfflineJobsForScope,
  migrateLegacyLocalStorageJobs,
  enqueueJobSyncOperation,
  getPendingSyncOperations,
  getUnresolvedConflicts,
  processSyncQueue,
  resolveSyncConflict,
  getUnsyncedSummaryForUser,
  lockOfflineDataOnLogout,
  unlockOfflineDataForAuthenticatedOwner
} from './lib/offline-sync.js'

const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export const appAuthState = {
  session: null,
  user: null,
  profile: null,
  memberships: [],
  activeWorkshopId: localStorage.getItem('mitaller_active_workshop_id') || null,
  activeWorkshopProfile: null,
  authMode: 'login', // 'login' | 'register' | 'reset' | 'update-password'
  loading: false,
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
  isSyncingOfflineQueue: false,
  pendingSyncCount: 0,
  unresolvedConflicts: [],
  adminMembers: [],
  knownProfiles: [],
  stockItems: [],
  stockMovements: [],
  stockFilters: {
    search: '',
    category: '',
    brand: '',
    status: 'active',
    vehicleMake: '',
    vehicleModel: '',
    vehicleYear: ''
  },
  editingStockItem: null,
  draftCompatibilities: [],
  movementTargetItem: null
}

function getActiveMembership() {
  if (!appAuthState.memberships.length) return null
  return (
    appAuthState.memberships.find(m => m.workshop_id === appAuthState.activeWorkshopId) ||
    appAuthState.memberships[0]
  )
}

function setAuthAlert(type, message) {
  const box = document.getElementById('authAlertBox')
  if (!box) return
  if (!message) {
    box.hidden = true
    box.textContent = ''
    return
  }
  box.hidden = false
  box.className = `auth-alert ${type} animate__animated animate__fadeIn`
  box.textContent = message
}

function setAdminAlert(type, message) {
  const box = document.getElementById('adminAlertBox')
  if (!box) return
  if (!message) {
    box.hidden = true
    box.textContent = ''
    return
  }
  box.hidden = false
  box.className = `auth-alert ${type} animate__animated animate__fadeIn`
  box.textContent = message
}

function setProfileAlert(type, message) {
  const box = document.getElementById('profileAlertBox')
  if (!box) return
  if (!message) {
    box.hidden = true
    box.textContent = ''
    return
  }
  box.hidden = false
  box.className = `auth-alert ${type} animate__animated animate__fadeIn`
  box.textContent = message
}

function setStockAlert(type, message) {
  const box = document.getElementById('stockAlertBox')
  if (!box) return
  if (!message) {
    box.hidden = true
    box.textContent = ''
    return
  }
  box.hidden = false
  box.className = `auth-alert ${type} animate__animated animate__fadeIn`
  box.textContent = message
}

export function switchAuthMode(mode, alertMsg = '') {
  appAuthState.authMode = mode
  renderAuthScreen()
  if (alertMsg) setAuthAlert('info', alertMsg)
}

function renderAuthScreen() {
  const authScreen = document.getElementById('authScreen')
  if (!authScreen) return

  const mode = appAuthState.authMode
  const isLogin = mode === 'login'
  const isRegister = mode === 'register'
  const isReset = mode === 'reset'
  const isUpdatePass = mode === 'update-password'

  authScreen.innerHTML = `
    <div class="auth-wrapper animate__animated animate__fadeIn">
      <div class="auth-card">
        <div class="section-heading" style="margin-bottom:16px">
          <p class="eyebrow">MITALLERAPP · CRASH SOLUTION</p>
          <h1 style="font-size:24px;margin-bottom:6px">
            ${
              isLogin
                ? 'Ingresar al taller'
                : isRegister
                  ? 'Crear cuenta de usuario'
                  : isReset
                    ? 'Recuperar contraseña'
                    : 'Actualizar contraseña'
            }
          </h1>
          <p class="subtitle">
            ${
              isLogin
                ? 'Accedé con tu cuenta para gestionar inspecciones, presupuestos y stock de tu taller.'
                : isRegister
                  ? 'Registrá tus datos para crear tu taller o sumarte a un equipo existente.'
                  : isReset
                    ? 'Te enviaremos un enlace seguro a tu correo electrónico para restablecer tu clave.'
                    : 'Ingresá tu nueva contraseña segura (mínimo 8 caracteres).'
            }
          </p>
        </div>

        ${
          isLogin || isRegister
            ? `<div class="auth-tabs" role="tablist">
                <button type="button" class="auth-tab ${isLogin ? 'active' : ''}" id="tabLoginBtn">Iniciar sesión</button>
                <button type="button" class="auth-tab ${isRegister ? 'active' : ''}" id="tabRegisterBtn">Crear cuenta</button>
              </div>`
            : ''
        }

        <div id="authAlertBox" class="auth-alert" role="alert" hidden></div>

        ${
          isLogin
            ? `<form id="loginForm" class="auth-form">
                <label>Correo electrónico <span class="required">*</span>
                  <input id="loginEmail" type="email" required autocomplete="email" placeholder="nombre@taller.com">
                </label>
                <label>Contraseña <span class="required">*</span>
                  <input id="loginPassword" type="password" required autocomplete="current-password" placeholder="••••••••">
                </label>
                <button type="submit" class="button primary" id="loginSubmitBtn">Iniciar sesión →</button>
                <div class="auth-links">
                  <button type="button" class="text-button" id="goToResetBtn">¿Olvidaste tu contraseña?</button>
                </div>
              </form>`
            : ''
        }

        ${
          isRegister
            ? `<form id="registerForm" class="auth-form">
                <label>Nombre y apellido <span class="required">*</span>
                  <input id="regName" type="text" required autocomplete="name" placeholder="Ej. Juan Morales">
                </label>
                <label>Teléfono / WhatsApp
                  <input id="regPhone" type="tel" autocomplete="tel" placeholder="Ej. 11 5555 1234">
                </label>
                <label>Correo electrónico <span class="required">*</span>
                  <input id="regEmail" type="email" required autocomplete="email" placeholder="nombre@taller.com">
                </label>
                <label>Contraseña (mínimo 8 caracteres) <span class="required">*</span>
                  <input id="regPassword" type="password" required minlength="8" autocomplete="new-password" placeholder="Mínimo 8 caracteres">
                </label>
                <label>Confirmar contraseña <span class="required">*</span>
                  <input id="regConfirm" type="password" required minlength="8" autocomplete="new-password" placeholder="Repetí tu contraseña">
                </label>
                <button type="submit" class="button primary" id="regSubmitBtn">Registrarme →</button>
              </form>`
            : ''
        }

        ${
          isReset
            ? `<form id="resetForm" class="auth-form">
                <label>Correo electrónico de tu cuenta <span class="required">*</span>
                  <input id="resetEmail" type="email" required autocomplete="email" placeholder="nombre@taller.com">
                </label>
                <button type="submit" class="button primary" id="resetSubmitBtn">Enviar enlace de recuperación</button>
                <div class="auth-links">
                  <button type="button" class="text-button" id="backToLoginBtn">← Volver a iniciar sesión</button>
                </div>
              </form>`
            : ''
        }

        ${
          isUpdatePass
            ? `<form id="updatePassForm" class="auth-form">
                <label>Nueva contraseña (mínimo 8 caracteres) <span class="required">*</span>
                  <input id="newPasswordInput" type="password" required minlength="8" autocomplete="new-password" placeholder="Nueva contraseña">
                </label>
                <label>Confirmar nueva contraseña <span class="required">*</span>
                  <input id="confirmNewPasswordInput" type="password" required minlength="8" autocomplete="new-password" placeholder="Repetí la nueva contraseña">
                </label>
                <button type="submit" class="button primary" id="updatePassSubmitBtn">Guardar nueva contraseña</button>
                ${
                  appAuthState.user
                    ? `<div class="auth-links">
                        <button type="button" class="text-button" id="cancelUpdatePassBtn">← Volver al taller</button>
                      </div>`
                    : ''
                }
              </form>`
            : ''
        }
      </div>
    </div>
  `

  document.getElementById('tabLoginBtn')?.addEventListener('click', () => switchAuthMode('login'))
  document.getElementById('tabRegisterBtn')?.addEventListener('click', () => switchAuthMode('register'))
  document.getElementById('goToResetBtn')?.addEventListener('click', () => switchAuthMode('reset'))
  document.getElementById('backToLoginBtn')?.addEventListener('click', () => switchAuthMode('login'))
  document.getElementById('cancelUpdatePassBtn')?.addEventListener('click', () => {
    if (window.location.hash === '#update-password') history.replaceState(null, '', window.location.pathname)
    enforceRouteProtection()
  })

  document.getElementById('loginForm')?.addEventListener('submit', handleLoginSubmit)
  document.getElementById('registerForm')?.addEventListener('submit', handleRegisterSubmit)
  document.getElementById('resetForm')?.addEventListener('submit', handleResetSubmit)
  document.getElementById('updatePassForm')?.addEventListener('submit', handleUpdatePasswordSubmit)
}

async function handleLoginSubmit(e) {
  e.preventDefault()
  const btn = document.getElementById('loginSubmitBtn')
  const email = document.getElementById('loginEmail')?.value
  const password = document.getElementById('loginPassword')?.value
  setAuthAlert('', '')
  if (btn) {
    btn.disabled = true
    btn.textContent = 'Verificando credenciales…'
  }
  try {
    await signInWithEmail(email, password)
    window.toast?.('Sesión iniciada correctamente.')
  } catch (err) {
    setAuthAlert('error', err.message || 'No se pudo iniciar sesión.')
  } finally {
    if (btn) {
      btn.disabled = false
      btn.textContent = 'Iniciar sesión →'
    }
  }
}

async function handleRegisterSubmit(e) {
  e.preventDefault()
  const btn = document.getElementById('regSubmitBtn')
  const displayName = document.getElementById('regName')?.value
  const phone = document.getElementById('regPhone')?.value
  const email = document.getElementById('regEmail')?.value
  const password = document.getElementById('regPassword')?.value
  const confirmPassword = document.getElementById('regConfirm')?.value
  setAuthAlert('', '')
  if (btn) {
    btn.disabled = true
    btn.textContent = 'Creando cuenta…'
  }
  try {
    const res = await signUpWithEmail({ email, password, confirmPassword, displayName, phone })
    if (res.requiresEmailConfirmation) {
      switchAuthMode(
        'login',
        '¡Cuenta creada! Revisá tu correo electrónico y hacé clic en el enlace de confirmación antes de iniciar sesión.'
      )
    } else {
      window.toast?.('Cuenta creada y sesión iniciada.')
    }
  } catch (err) {
    setAuthAlert('error', err.message || 'No se pudo completar el registro.')
  } finally {
    if (btn) {
      btn.disabled = false
      btn.textContent = 'Registrarme →'
    }
  }
}

async function handleResetSubmit(e) {
  e.preventDefault()
  const btn = document.getElementById('resetSubmitBtn')
  const email = document.getElementById('resetEmail')?.value
  setAuthAlert('', '')
  if (btn) {
    btn.disabled = true
    btn.textContent = 'Enviando correo…'
  }
  try {
    await sendPasswordReset(email)
    setAuthAlert(
      'success',
      'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña en unos instantes.'
    )
  } catch (err) {
    setAuthAlert('error', err.message || 'No se pudo enviar el correo de recuperación.')
  } finally {
    if (btn) {
      btn.disabled = false
      btn.textContent = 'Enviar enlace de recuperación'
    }
  }
}

async function handleUpdatePasswordSubmit(e) {
  e.preventDefault()
  const btn = document.getElementById('updatePassSubmitBtn')
  const newPass = document.getElementById('newPasswordInput')?.value
  const confirmPass = document.getElementById('confirmNewPasswordInput')?.value
  setAuthAlert('', '')
  if (btn) {
    btn.disabled = true
    btn.textContent = 'Actualizando contraseña…'
  }
  try {
    await updateUserPassword(newPass, confirmPass)
    if (window.location.hash === '#update-password') {
      history.replaceState(null, '', window.location.pathname)
    }
    appAuthState.authMode = 'login'
    window.toast?.('Contraseña actualizada con éxito.')
    await enforceRouteProtection()
  } catch (err) {
    setAuthAlert('error', err.message || 'No se pudo actualizar la contraseña.')
  } finally {
    if (btn) {
      btn.disabled = false
      btn.textContent = 'Guardar nueva contraseña'
    }
  }
}

export async function handleLogout() {
  const prevUserId = appAuthState.user?.id || null
  const activeMembership = getActiveMembership()
  try {
    if (prevUserId) {
      const unsynced = await getUnsyncedSummaryForUser(prevUserId)
      if (unsynced.totalUnsynced > 0 && typeof window.confirm === 'function') {
        const proceed = window.confirm(
          `Tenés ${unsynced.totalUnsynced} cambio(s) pendiente(s) de sincronizar con el servidor.\n\n` +
            `Si cerrás sesión ahora, tus trabajos pendientes NO se eliminarán: quedarán protegidos y bloqueados en este dispositivo bajo tu cuenta y se sincronizarán automáticamente cuando vuelvas a iniciar sesión.\n\n` +
            `¿Deseás cerrar sesión igualmente?`
        )
        if (!proceed) return
      }
    }

    await lockOfflineDataOnLogout({
      userId: prevUserId,
      workshopId: activeMembership?.workshop_id || null
    })
    if (window.store) {
      window.store.jobs = []
      window.store.activeId = null
    }
    window.active = null
    await signOutUser()
    appAuthState.session = null
    appAuthState.user = null
    appAuthState.profile = null
    appAuthState.memberships = []
    appAuthState.activeWorkshopProfile = null
    appAuthState.pendingSyncCount = 0
    appAuthState.unresolvedConflicts = []
    window.toast?.('Sesión cerrada. Los cambios pendientes quedaron resguardados y bloqueados hasta tu próximo ingreso.')
    enforceRouteProtection()
  } catch (err) {
    window.toast?.(err.message || 'Error al cerrar sesión.')
  }
}

async function refreshOfflineQueueStatus() {
  const activeMembership = getActiveMembership()
  if (!appAuthState.user?.id || !activeMembership?.workshop_id) {
    appAuthState.pendingSyncCount = 0
    appAuthState.unresolvedConflicts = []
    return
  }
  const [pending, conflicts] = await Promise.all([
    getPendingSyncOperations(appAuthState.user.id, activeMembership.workshop_id),
    getUnresolvedConflicts(appAuthState.user.id, activeMembership.workshop_id)
  ])
  appAuthState.pendingSyncCount = pending.length
  appAuthState.unresolvedConflicts = conflicts
  renderConflictResolutionNotice()
}

function renderConflictResolutionNotice() {
  const noticeEl = document.getElementById('notice')
  if (!noticeEl) return

  const conflicts = appAuthState.unresolvedConflicts || []
  if (!conflicts.length) {
    if (appAuthState.pendingSyncCount > 0) {
      noticeEl.hidden = false
      noticeEl.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <span>
            <b>⏳ Tenés ${appAuthState.pendingSyncCount} trabajo(s) modificado(s) localmente pendiente(s) de sincronizar.</b>
            ${
              appAuthState.isOnline
                ? 'Podés sincronizarlos ahora con el servidor.'
                : 'Se sincronizarán automáticamente en cuanto recuperes la conexión a Internet.'
            }
          </span>
          ${
            appAuthState.isOnline
              ? `<button type="button" class="button primary small-btn" id="manualSyncPendingBtn" style="text-decoration:none;color:#fff">Sincronizar ahora</button>`
              : ''
          }
        </div>
      `
      document.getElementById('manualSyncPendingBtn')?.addEventListener('click', () => {
        syncPendingJobsWithSupabase()
      })
    }
    return
  }

  const c = conflicts[0]
  const plate = c.localJob?.rec?.patente || c.remoteJob?.rec?.patente || 'Vehículo'
  const client = c.localJob?.rec?.cliente || c.remoteJob?.rec?.cliente || ''

  noticeEl.hidden = false
  noticeEl.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div>
        <b>⚠️ Conflicto de sincronización detectado en ${esc(plate)} (${esc(client)})</b><br>
        <span>Otro dispositivo guardó una versión más reciente (rev. ${esc(c.remoteRevision)}) mientras editabas la revisión ${esc(c.baseRevision)}. Elegí cómo resolverlo para no perder información:</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="button primary small-btn" id="resolveKeepLocalBtn" style="text-decoration:none;color:#fff">Conservar mi edición local</button>
        <button type="button" class="button secondary small-btn" id="resolveKeepRemoteBtn" style="text-decoration:none">Usar versión del servidor</button>
        <button type="button" class="button secondary small-btn" id="resolveKeepBothBtn" style="text-decoration:none">Conservar ambas (crear copia)</button>
      </div>
    </div>
  `

  const handleResolve = async strategy => {
    const activeMembership = getActiveMembership()
    if (!appAuthState.user?.id || !activeMembership?.workshop_id) return
    try {
      await resolveSyncConflict({
        userId: appAuthState.user.id,
        workshopId: activeMembership.workshop_id,
        jobId: c.jobId,
        strategy
      })
      noticeEl.hidden = true
      await syncPendingJobsWithSupabase()
      await loadWorkshopJobsFromSupabase()
      window.toast?.('Conflicto resuelto correctamente.')
    } catch (err) {
      window.toast?.(err.message || 'No se pudo resolver el conflicto.')
    }
  }

  document.getElementById('resolveKeepLocalBtn')?.addEventListener('click', () => handleResolve('keep_local'))
  document.getElementById('resolveKeepRemoteBtn')?.addEventListener('click', () => handleResolve('keep_remote'))
  document.getElementById('resolveKeepBothBtn')?.addEventListener('click', () => handleResolve('keep_both'))
}

function renderHeaderNavigation() {
  const navContainer = document.getElementById('headerAuthNav')
  if (!navContainer) return

  if (!appAuthState.user || isSessionExpired(appAuthState.session)) {
    navContainer.innerHTML = `<span class="small muted" style="color:#c7d6e4">Autenticación requerida</span>`
    return
  }

  const activeMembership = getActiveMembership()
  const role = activeMembership?.role || 'sin taller'
  const roleLabel = ROLE_LABELS[role] || role
  const displayName =
    appAuthState.profile?.display_name ||
    appAuthState.user.user_metadata?.display_name ||
    appAuthState.user.email

  const workshopOptions = appAuthState.memberships
    .map(
      m =>
        `<option value="${esc(m.workshop_id)}" ${
          m.workshop_id === activeMembership?.workshop_id ? 'selected' : ''
        }>${esc(m.workshop.name)} (${esc(ROLE_LABELS[m.role] || m.role)})</option>`
    )
    .join('')

  const isAdminView = !document.getElementById('adminScreen')?.hidden
  const isProfileView = !document.getElementById('profileScreen')?.hidden
  const isStockView = !document.getElementById('stockScreen')?.hidden

  const connClass = !appAuthState.isOnline
    ? 'offline'
    : appAuthState.unresolvedConflicts.length > 0
      ? 'conflict'
      : appAuthState.pendingSyncCount > 0
        ? 'pending'
        : 'online'

  const connLabel = !appAuthState.isOnline
    ? `Sin internet${appAuthState.pendingSyncCount ? ` · ${appAuthState.pendingSyncCount} pend.` : ''}`
    : appAuthState.unresolvedConflicts.length > 0
      ? `Conflicto (${appAuthState.unresolvedConflicts.length})`
      : appAuthState.isSyncingOfflineQueue
        ? 'Sincronizando…'
        : appAuthState.pendingSyncCount > 0
          ? `En cola (${appAuthState.pendingSyncCount})`
          : 'En línea'

  navContainer.innerHTML = `
    <span id="connectivityBadge" class="conn-badge ${connClass}" role="status" aria-live="polite" title="Estado de conexión y sincronización">
      <span class="conn-dot"></span>
      <span>${esc(connLabel)}</span>
    </span>
    ${
      appAuthState.memberships.length > 0
        ? `<select id="activeWorkshopSelect" class="workshop-switcher" aria-label="Taller activo">
            ${workshopOptions}
          </select>`
        : ''
    }
    <button type="button" class="nav-pill ${!isAdminView && !isProfileView && !isStockView ? 'active' : ''}" id="navJobsBtn">Trabajos</button>
    ${
      activeMembership
        ? `<button type="button" class="nav-pill ${isStockView ? 'active' : ''}" id="navStockBtn">Stock / Depósito</button>
           <button type="button" class="nav-pill ${isProfileView ? 'active' : ''}" id="navProfileBtn">Perfil del taller</button>`
        : ''
    }
    <button type="button" class="nav-pill ${isAdminView ? 'active' : ''}" id="navAdminBtn">Admin (/admin)</button>
    <span class="user-badge" title="${esc(appAuthState.user.email)}">
      <span>${esc(displayName)}</span>
      <span class="role-chip ${esc(role)}">${esc(roleLabel)}</span>
    </span>
    <button type="button" class="nav-pill" id="navChangePassBtn" title="Actualizar contraseña">Clave</button>
    <button type="button" class="nav-pill" id="navLogoutBtn" title="Cerrar sesión">Salir</button>
  `

  document.getElementById('activeWorkshopSelect')?.addEventListener('change', async e => {
    appAuthState.activeWorkshopId = e.target.value
    localStorage.setItem('mitaller_active_workshop_id', appAuthState.activeWorkshopId)
    await syncActiveWorkshopToLegacyStore()
    await loadWorkshopJobsFromSupabase()
    if (!document.getElementById('adminScreen')?.hidden) {
      await renderAdminScreen()
    } else if (!document.getElementById('profileScreen')?.hidden) {
      await renderProfileScreen()
    } else if (!document.getElementById('stockScreen')?.hidden) {
      await renderStockScreen()
    }
  })

  document.getElementById('navJobsBtn')?.addEventListener('click', () => {
    if (
      window.location.hash === '#/admin' ||
      window.location.hash === '#/perfil' ||
      window.location.hash === '#/stock' ||
      window.location.pathname.endsWith('/admin')
    ) {
      history.pushState(null, '', './')
    }
    const adminScreen = document.getElementById('adminScreen')
    const profileScreen = document.getElementById('profileScreen')
    const stockScreen = document.getElementById('stockScreen')
    if (adminScreen) adminScreen.hidden = true
    if (profileScreen) profileScreen.hidden = true
    if (stockScreen) stockScreen.hidden = true
    window.showJobs?.()
    renderHeaderNavigation()
  })

  document.getElementById('navStockBtn')?.addEventListener('click', () => {
    openStockScreen()
  })

  document.getElementById('navProfileBtn')?.addEventListener('click', () => {
    openProfileScreen()
  })

  document.getElementById('navAdminBtn')?.addEventListener('click', () => {
    openAdminScreen()
  })

  document.getElementById('navChangePassBtn')?.addEventListener('click', () => {
    appAuthState.authMode = 'update-password'
    const authScreen = document.getElementById('authScreen')
    const mainApp = document.getElementById('mainAppContainer')
    if (mainApp) mainApp.hidden = true
    if (authScreen) {
      authScreen.hidden = false
      renderAuthScreen()
    }
  })

  document.getElementById('navLogoutBtn')?.addEventListener('click', handleLogout)
}

export async function syncActiveWorkshopToLegacyStore() {
  const activeMembership = getActiveMembership()
  if (!activeMembership?.workshop || !window.store) return
  let ws = activeMembership.workshop

  try {
    const freshProfile = await fetchWorkshopProfile(ws.id)
    if (freshProfile) {
      ws = freshProfile
      activeMembership.workshop = freshProfile
      appAuthState.activeWorkshopProfile = freshProfile
    }
  } catch {
    const logoUrl = await resolveWorkshopLogoUrl(ws.logo_path)
    ws = { ...ws, logo_url: logoUrl }
    appAuthState.activeWorkshopProfile = ws
  }

  window.store.shop = {
    ...window.store.shop,
    id: ws.id,
    name: ws.name || 'Crash Solution',
    legal_name: ws.legal_name || '',
    tax_id: ws.tax_id || '',
    logo_path: ws.logo_path || '',
    logo_url: ws.logo_url || '',
    phone: ws.phone || '',
    whatsapp: ws.whatsapp || '',
    email: ws.email || '',
    address: ws.address || ''
  }

  // Actualizar marca en el header si hay nombre comercial del taller
  const brandTitleEl = document.querySelector('.brand span:nth-child(2)')
  if (brandTitleEl && ws.name) {
    brandTitleEl.innerHTML = `${esc(ws.name.toUpperCase())}<small>${esc(ws.legal_name || 'Gestión del taller')}</small>`
  }
}

export async function syncPendingJobsWithSupabase() {
  const activeMembership = getActiveMembership()
  if (!supabase || !appAuthState.user?.id || !activeMembership?.workshop_id) return null
  if (!appAuthState.isOnline) return null

  if (isSessionExpired(appAuthState.session)) {
    await handleExpiredSession()
    return null
  }

  appAuthState.isSyncingOfflineQueue = true
  renderHeaderNavigation()

  try {
    const result = await processSyncQueue({
      supabaseClient: supabase,
      session: appAuthState.session,
      userId: appAuthState.user.id,
      workshopId: activeMembership.workshop_id,
      isOnline: appAuthState.isOnline
    })

    await refreshOfflineQueueStatus()
    renderHeaderNavigation()

    const saveStateEl = document.getElementById('saveState')
    if (result.conflicts > 0) {
      if (saveStateEl) saveStateEl.textContent = 'Conflicto por resolver'
      window.toast?.('Se detectó un conflicto con cambios realizados en otro dispositivo.')
    } else if (result.synced > 0) {
      if (saveStateEl) saveStateEl.textContent = 'Sincronizado en Supabase'
    }

    return result
  } finally {
    appAuthState.isSyncingOfflineQueue = false
    renderHeaderNavigation()
  }
}

export async function loadWorkshopJobsFromSupabase() {
  const activeMembership = getActiveMembership()
  if (!appAuthState.user?.id || !activeMembership?.workshop_id || !window.store) return

  const userId = appAuthState.user.id
  const workshopId = activeMembership.workshop_id

  // 1. Migrar de forma verificada trabajos previos de localStorage a IndexedDB sin sobrescribir localStorage ni duplicar
  await migrateLegacyLocalStorageJobs({ userId, workshopId })

  // 2. Cargar inmediatamente los trabajos persistidos en IndexedDB para este usuario y taller (permite uso inmediato sin internet)
  const localIndexedDbJobs = await getOfflineJobsForScope(userId, workshopId)
  if (localIndexedDbJobs.length > 0) {
    window.store.jobs = localIndexedDbJobs.map(j => (window.adaptJob ? window.adaptJob(j) : j))
    window.renderJobs?.()
  }

  await refreshOfflineQueueStatus()
  renderHeaderNavigation()

  if (!appAuthState.isOnline || !supabase) {
    const saveStateEl = document.getElementById('saveState')
    if (saveStateEl) {
      saveStateEl.textContent = `Modo sin conexión · ${activeMembership.workshop.name}`
    }
    return
  }

  // 3. Si estamos en línea y con sesión válida, procesar primero la cola pendiente antes de traer el listado remoto
  await syncPendingJobsWithSupabase()

  try {
    const { data, error } = await supabase
      .from('jobs')
      .select('id, workshop_id, job_number, status, revision, payload, customer_name, vehicle_plate, created_at, updated_at')
      .eq('workshop_id', workshopId)
      .order('updated_at', { ascending: false })

    if (error) {
      if (String(error.message || '').toLowerCase().includes('jwt expired')) {
        await handleExpiredSession()
      }
      return
    }

    const remoteJobs = (data || []).map(row => {
      const payload = row.payload && typeof row.payload === 'object' ? row.payload : {}
      return {
        ...payload,
        id: row.id,
        number: row.job_number || payload.number || `OT-${String(row.id).slice(0, 6).toUpperCase()}`,
        status: row.status || payload.status || 'Borrador',
        createdAt: row.created_at || payload.createdAt || new Date().toISOString(),
        updatedAt: row.updated_at || payload.updatedAt || new Date().toISOString(),
        cloudRevision: row.revision || 1,
        rec: {
          ...(payload.rec || {}),
          cliente: row.customer_name || payload.rec?.cliente || '',
          patente: row.vehicle_plate || payload.rec?.patente || ''
        }
      }
    })

    // No sobrescribir trabajos locales que tengan operaciones pendientes o conflictos sin resolver
    const [pendingOps, unresolvedConflicts] = await Promise.all([
      getPendingSyncOperations(userId, workshopId),
      getUnresolvedConflicts(userId, workshopId)
    ])
    const protectedLocalIds = new Set([
      ...pendingOps.map(op => op.entityId),
      ...unresolvedConflicts.map(c => c.jobId)
    ])

    for (const rJob of remoteJobs) {
      if (!protectedLocalIds.has(rJob.id)) {
        await saveOfflineJob({
          userId,
          workshopId,
          job: rJob,
          syncStatus: 'synced'
        })
      }
    }

    const mergedJobs = await getOfflineJobsForScope(userId, workshopId)
    window.store.jobs = mergedJobs.map(j => (window.adaptJob ? window.adaptJob(j) : j))
    window.renderJobs?.()
    await refreshOfflineQueueStatus()
    renderHeaderNavigation()

    const saveStateEl = document.getElementById('saveState')
    if (saveStateEl && appAuthState.unresolvedConflicts.length === 0) {
      saveStateEl.textContent = `Taller: ${activeMembership.workshop.name}`
    }
  } catch (err) {
    console.warn('Error al cargar trabajos desde Supabase (usando copia local IndexedDB):', err)
  }
}

export async function saveActiveJobToSupabase(job) {
  const activeMembership = getActiveMembership()
  if (!appAuthState.user?.id || !activeMembership?.workshop_id || !job?.id) return
  if (!job.rec?.cliente?.trim() || !job.rec?.patente?.trim()) return

  const userId = appAuthState.user.id
  const workshopId = activeMembership.workshop_id

  try {
    // 1. Persistir siempre primero en IndexedDB y en la cola idempotente de sincronización
    await enqueueJobSyncOperation({
      userId,
      workshopId,
      job
    })
    await refreshOfflineQueueStatus()
    renderHeaderNavigation()

    // 2. Si no hay conexión, informar claramente que quedó guardado en la cola local
    if (!appAuthState.isOnline || !supabase) {
      const saveStateEl = document.getElementById('saveState')
      if (saveStateEl) {
        saveStateEl.textContent = `Guardado sin internet (${appAuthState.pendingSyncCount} pend.)`
      }
      return
    }

    // 3. Si hay conexión y sesión válida, ejecutar la cola idempotente
    await syncPendingJobsWithSupabase()
  } catch (err) {
    console.warn('Trabajo resguardado en cola local IndexedDB tras error de red:', err)
  }
}

// ============================================================================
// DEV-19: Pantalla de Perfil del Taller + Logo en Supabase Storage + PDF
// ============================================================================
export async function openProfileScreen() {
  if (!appAuthState.user || isSessionExpired(appAuthState.session)) {
    await enforceRouteProtection()
    return
  }
  const activeMembership = getActiveMembership()
  if (!activeMembership) {
    await openAdminScreen()
    return
  }
  history.replaceState(null, '', '#/perfil')
  const jobsScreen = document.getElementById('jobsScreen')
  const workScreen = document.getElementById('workScreen')
  const adminScreen = document.getElementById('adminScreen')
  const stockScreen = document.getElementById('stockScreen')
  const profileScreen = document.getElementById('profileScreen')
  if (jobsScreen) jobsScreen.hidden = true
  if (workScreen) workScreen.hidden = true
  if (adminScreen) adminScreen.hidden = true
  if (stockScreen) stockScreen.hidden = true
  if (profileScreen) profileScreen.hidden = false
  renderHeaderNavigation()
  await renderProfileScreen()
}

export async function renderProfileScreen() {
  const profileScreen = document.getElementById('profileScreen')
  if (!profileScreen) return

  const activeMembership = getActiveMembership()
  if (!activeMembership?.workshop) {
    profileScreen.innerHTML = `<div class="notice">Seleccioná o creá un taller desde el panel <b>Admin (/admin)</b> para configurar su perfil.</div>`
    return
  }

  let ws = appAuthState.activeWorkshopProfile || activeMembership.workshop
  try {
    ws = await fetchWorkshopProfile(activeMembership.workshop.id)
    appAuthState.activeWorkshopProfile = ws
    activeMembership.workshop = ws
  } catch (err) {
    console.warn('Usando datos en caché del taller:', err)
  }

  const canEdit = canAccessAdminPanel(activeMembership.role)
  const previewHeaderHtml = buildBudgetWorkshopHeaderHtml(ws, 'OT-DEMO01', '03/11/2026', '18/11/2026')

  profileScreen.innerHTML = `
    <div class="page-heading">
      <div>
        <p class="eyebrow">IDENTIDAD COMERCIAL Y PRESUPUESTOS · DEV-19</p>
        <h1>Perfil del Taller</h1>
        <p class="subtitle">Configurá los datos fiscales, de contacto y el logo oficial que se incluyen automáticamente en todos los presupuestos PDF y envíos por WhatsApp.</p>
      </div>
      <button type="button" class="button secondary" id="backFromProfileBtn">← Volver a Trabajos</button>
    </div>

    <div id="profileAlertBox" class="auth-alert" role="alert" hidden></div>

    ${
      !canEdit
        ? `<div class="notice">Tu rol actual en este taller es <b>${esc(ROLE_LABELS[activeMembership.role] || activeMembership.role)}</b>. Podés visualizar los datos del taller, pero solo el Propietario (Owner) o Administrador pueden modificarlos.</div>`
        : ''
    }

    <div class="admin-grid">
      <!-- Columna 1: Formulario de Datos del Taller + Logo -->
      <div class="admin-card">
        <span class="eyebrow">DATOS DEL TALLER EN SUPABASE</span>
        <h2>Información comercial y de contacto</h2>
        <p class="subtitle">Asociado al taller ID <code>${esc(ws.id.slice(0, 8))}…</code></p>

        <div class="logo-uploader" style="margin:16px 0">
          <div class="logo-preview-box" id="logoPreviewContainer">
            ${
              ws.logo_url
                ? `<img src="${esc(ws.logo_url)}" alt="Logo de ${esc(ws.name)}" id="workshopLogoImg">`
                : `<span class="logo-placeholder">Sin logo<br>cargado</span>`
            }
          </div>
          <div style="flex:1;min-width:210px">
            <h3 style="margin-bottom:4px">Logo del taller</h3>
            <p class="small muted" style="margin:0 0 10px">Bucket privado <code>workshop-logos</code> en Supabase Storage. Formatos PNG, JPEG o WEBP (máx. 2 MB).</p>
            ${
              canEdit
                ? `<div style="display:flex;gap:8px;flex-wrap:wrap">
                    <label class="button secondary small-btn" style="cursor:pointer">
                      Subir / actualizar logo
                      <input type="file" id="workshopLogoInput" accept="image/png,image/jpeg,image/webp" hidden>
                    </label>
                    ${
                      ws.logo_path
                        ? `<button type="button" class="button danger small-btn" id="removeLogoBtn">Quitar logo</button>`
                        : ''
                    }
                  </div>`
                : ''
            }
          </div>
        </div>

        <form id="workshopProfileForm" class="form-grid">
          <label class="span-two">Nombre comercial <span class="required">*</span>
            <input id="profName" required maxlength="80" value="${esc(ws.name || '')}" ${!canEdit ? 'disabled' : ''} placeholder="Ej. Crash Solution">
          </label>
          <label>Razón social
            <input id="profLegalName" maxlength="120" value="${esc(ws.legal_name || '')}" ${!canEdit ? 'disabled' : ''} placeholder="Ej. Crash Solution S.R.L.">
          </label>
          <label>CUIT (con validación Módulo 11)
            <input id="profTaxId" maxlength="15" value="${esc(ws.tax_id || '')}" ${!canEdit ? 'disabled' : ''} placeholder="Ej. 30-71234567-9">
          </label>
          <label>Teléfono fijo / principal
            <input id="profPhone" type="tel" maxlength="40" value="${esc(ws.phone || '')}" ${!canEdit ? 'disabled' : ''} placeholder="Ej. 011 4555-1234">
          </label>
          <label>WhatsApp de contacto (presupuestos)
            <input id="profWhatsapp" type="tel" maxlength="40" value="${esc(ws.whatsapp || '')}" ${!canEdit ? 'disabled' : ''} placeholder="Ej. +54 9 11 5555-1234">
          </label>
          <label class="span-two">Correo electrónico comercial
            <input id="profEmail" type="email" maxlength="120" value="${esc(ws.email || '')}" ${!canEdit ? 'disabled' : ''} placeholder="presupuestos@crashsolution.com.ar">
          </label>
          <label class="span-two">Dirección física del taller
            <input id="profAddress" maxlength="160" value="${esc(ws.address || '')}" ${!canEdit ? 'disabled' : ''} placeholder="Av. Warnes 1234, CABA">
          </label>
          ${
            canEdit
              ? `<div class="span-two" style="margin-top:6px">
                  <button type="submit" class="button primary" id="saveProfileBtn" style="width:100%">Guardar perfil del taller en Supabase</button>
                </div>`
              : ''
          }
        </form>
      </div>

      <!-- Columna 2: Vista previa en tiempo real para PDF + Respaldo -->
      <div class="admin-card">
        <span class="eyebrow">VISTA PREVIA EN DOCUMENTOS PDF</span>
        <h2>Encabezado automático de presupuestos</h2>
        <p class="subtitle">Así se verá el encabezado en todos los PDF emitidos por la aplicación para este taller.</p>

        <div class="budget-header-preview" id="liveBudgetHeaderPreview" style="margin:16px 0">
          ${previewHeaderHtml}
        </div>

        <details class="quiet-details" open>
          <summary>Datos utilizados automáticamente en presupuestos</summary>
          <ul class="small muted" style="line-height:1.7;padding-left:18px;margin:8px 0">
            <li><b>Nombre comercial y Razón social:</b> encabezan el PDF y el mensaje de WhatsApp.</li>
            <li><b>CUIT:</b> se imprime debajo de la razón social con formato oficial <code>XX-XXXXXXXX-X</code>.</li>
            <li><b>Logo del taller:</b> se descarga de forma segura desde el bucket privado <code>workshop-logos</code> y se incrusta en el PDF.</li>
            <li><b>Teléfono, WhatsApp, Correo y Dirección:</b> figuran como canales de contacto directo del taller en el presupuesto.</li>
          </ul>
        </details>

        <details class="quiet-details">
          <summary>Respaldo local JSON (Exportar / Importar)</summary>
          <p class="muted small">Descargá una copia de respaldo de los trabajos o importá un archivo JSON existente.</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
            <button type="button" class="button secondary small-btn" id="profExportBackupBtn">Descargar respaldo JSON</button>
            <label class="button secondary small-btn" style="cursor:pointer">
              Importar respaldo JSON
              <input type="file" id="profImportBackupInput" accept=".json,application/json" hidden>
            </label>
          </div>
        </details>
      </div>
    </div>
  `

  document.getElementById('backFromProfileBtn')?.addEventListener('click', () => {
    history.pushState(null, '', './')
    profileScreen.hidden = true
    window.showJobs?.()
    renderHeaderNavigation()
  })

  // Formateo automático de CUIT al salir del campo y actualización de vista previa en vivo
  const cuitInput = document.getElementById('profTaxId')
  cuitInput?.addEventListener('blur', () => {
    if (cuitInput.value.trim()) {
      cuitInput.value = formatCuit(cuitInput.value)
      updateLivePreview()
    }
  })

  const updateLivePreview = () => {
    const previewBox = document.getElementById('liveBudgetHeaderPreview')
    if (!previewBox) return
    const draftWorkshop = {
      ...ws,
      name: document.getElementById('profName')?.value || ws.name,
      legal_name: document.getElementById('profLegalName')?.value || '',
      tax_id: document.getElementById('profTaxId')?.value || '',
      phone: document.getElementById('profPhone')?.value || '',
      whatsapp: document.getElementById('profWhatsapp')?.value || '',
      email: document.getElementById('profEmail')?.value || '',
      address: document.getElementById('profAddress')?.value || ''
    }
    previewBox.innerHTML = buildBudgetWorkshopHeaderHtml(draftWorkshop, 'OT-DEMO01', '03/11/2026', '18/11/2026')
  }

  ;['profName', 'profLegalName', 'profTaxId', 'profPhone', 'profWhatsapp', 'profEmail', 'profAddress'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateLivePreview)
  })

  document.getElementById('workshopLogoInput')?.addEventListener('change', async e => {
    const file = e.target.files?.[0]
    if (!file) return
    setProfileAlert('info', 'Subiendo y procesando logo del taller…')
    try {
      const { logoPath, logoUrl } = await uploadWorkshopLogo(ws.id, file)
      const updated = await updateWorkshopProfile(ws.id, {
        name: document.getElementById('profName')?.value || ws.name,
        legal_name: document.getElementById('profLegalName')?.value ?? ws.legal_name,
        tax_id: document.getElementById('profTaxId')?.value ?? ws.tax_id,
        phone: document.getElementById('profPhone')?.value ?? ws.phone,
        whatsapp: document.getElementById('profWhatsapp')?.value ?? ws.whatsapp,
        email: document.getElementById('profEmail')?.value ?? ws.email,
        address: document.getElementById('profAddress')?.value ?? ws.address,
        logo_path: logoPath
      })
      ws = { ...updated, logo_url: logoUrl || updated.logo_url }
      appAuthState.activeWorkshopProfile = ws
      activeMembership.workshop = ws
      await syncActiveWorkshopToLegacyStore()
      await renderProfileScreen()
      setProfileAlert('success', 'Logo del taller actualizado y guardado en Supabase.')
    } catch (err) {
      setProfileAlert('error', err.message || 'No se pudo subir el logo del taller.')
    } finally {
      e.target.value = ''
    }
  })

  document.getElementById('removeLogoBtn')?.addEventListener('click', async () => {
    setProfileAlert('', '')
    try {
      const updated = await updateWorkshopProfile(ws.id, {
        ...ws,
        logo_path: null
      })
      ws = updated
      appAuthState.activeWorkshopProfile = ws
      activeMembership.workshop = ws
      await syncActiveWorkshopToLegacyStore()
      await renderProfileScreen()
      setProfileAlert('success', 'Logo quitado del perfil del taller.')
    } catch (err) {
      setProfileAlert('error', err.message || 'No se pudo quitar el logo.')
    }
  })

  document.getElementById('workshopProfileForm')?.addEventListener('submit', async e => {
    e.preventDefault()
    if (!canEdit) return
    const btn = document.getElementById('saveProfileBtn')
    setProfileAlert('', '')
    if (btn) {
      btn.disabled = true
      btn.textContent = 'Guardando cambios en Supabase…'
    }
    try {
      const updated = await updateWorkshopProfile(ws.id, {
        name: document.getElementById('profName')?.value,
        legal_name: document.getElementById('profLegalName')?.value,
        tax_id: document.getElementById('profTaxId')?.value,
        phone: document.getElementById('profPhone')?.value,
        whatsapp: document.getElementById('profWhatsapp')?.value,
        email: document.getElementById('profEmail')?.value,
        address: document.getElementById('profAddress')?.value,
        logo_path: ws.logo_path
      })
      ws = updated
      appAuthState.activeWorkshopProfile = updated
      activeMembership.workshop = updated
      await syncActiveWorkshopToLegacyStore()
      renderHeaderNavigation()
      updateLivePreview()
      setProfileAlert('success', 'Perfil del taller actualizado en Supabase correctamente.')
      window.toast?.('Perfil del taller guardado en Supabase.')
    } catch (err) {
      setProfileAlert('error', err.message || 'No se pudo guardar el perfil del taller.')
    } finally {
      if (btn) {
        btn.disabled = false
        btn.textContent = 'Guardar perfil del taller en Supabase'
      }
    }
  })

  document.getElementById('profExportBackupBtn')?.addEventListener('click', () => {
    window.exportBackup?.()
  })

  document.getElementById('profImportBackupInput')?.addEventListener('change', e => {
    const file = e.target.files?.[0]
    if (file && document.getElementById('importBackup')) {
      const dt = new DataTransfer()
      dt.items.add(file)
      const legacyInput = document.getElementById('importBackup')
      legacyInput.files = dt.files
      legacyInput.dispatchEvent(new Event('change'))
    }
    e.target.value = ''
  })
}

// ============================================================================
// DEV-22: Sistema de Stock / Inventario de Taller
// ============================================================================
export async function openStockScreen() {
  if (!appAuthState.user || isSessionExpired(appAuthState.session)) {
    await enforceRouteProtection()
    return
  }
  const activeMembership = getActiveMembership()
  if (!activeMembership) {
    await openAdminScreen()
    return
  }
  history.replaceState(null, '', '#/stock')
  const jobsScreen = document.getElementById('jobsScreen')
  const workScreen = document.getElementById('workScreen')
  const profileScreen = document.getElementById('profileScreen')
  const adminScreen = document.getElementById('adminScreen')
  const stockScreen = document.getElementById('stockScreen')
  if (jobsScreen) jobsScreen.hidden = true
  if (workScreen) workScreen.hidden = true
  if (profileScreen) profileScreen.hidden = true
  if (adminScreen) adminScreen.hidden = true
  if (stockScreen) stockScreen.hidden = false
  renderHeaderNavigation()
  await renderStockScreen()
}

export async function renderStockScreen() {
  const stockScreen = document.getElementById('stockScreen')
  if (!stockScreen) return

  const activeMembership = getActiveMembership()
  if (!activeMembership?.workshop) {
    stockScreen.innerHTML = `<div class="notice">Seleccioná o creá un taller desde el panel <b>Admin (/admin)</b> para gestionar su stock.</div>`
    return
  }

  const ws = activeMembership.workshop
  try {
    const [items, movements] = await Promise.all([
      fetchWorkshopStock(ws.id),
      fetchStockMovements(ws.id, null, 60)
    ])
    appAuthState.stockItems = items
    appAuthState.stockMovements = movements
  } catch (err) {
    console.warn('Error cargando stock desde Supabase:', err)
  }

  const activeItems = appAuthState.stockItems.filter(i => !i.archived_at)
  const lowStockItems = activeItems.filter(i => isLowStock(i))
  const totalStockValue = activeItems.reduce(
    (acc, i) => acc + (Number(i.quantity) || 0) * (Number(i.sale_price) || 0),
    0
  )

  const editing = appAuthState.editingStockItem
  const movItem = appAuthState.movementTargetItem
  const f = appAuthState.stockFilters

  stockScreen.innerHTML = `
    <div class="page-heading">
      <div>
        <p class="eyebrow">INVENTARIO Y DEPÓSITO · DEV-22</p>
        <h1>Stock de ${esc(ws.name)}</h1>
        <p class="subtitle">Pinturas, materiales, insumos y repuestos con compatibilidad vehicular, alertas de stock mínimo y movimientos auditados vía RPC <code>record_stock_movement</code>.</p>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button type="button" class="button primary" id="openNewStockItemBtn">+ Nuevo producto / repuesto</button>
        <button type="button" class="button secondary" id="backFromStockBtn">← Volver a Trabajos</button>
      </div>
    </div>

    <div id="stockAlertBox" class="auth-alert" role="alert" hidden></div>

    <!-- Estadísticas rápidas del depósito -->
    <div class="dashboard-stats">
      <div class="dashboard-stat">
        <span>Productos activos</span>
        <b>${activeItems.length}</b>
      </div>
      <div class="dashboard-stat" style="cursor:pointer" id="filterLowStockStatBtn" title="Filtrar productos con alerta de stock bajo">
        <span>Alertas de stock mínimo</span>
        <b style="color:${lowStockItems.length > 0 ? '#a95312' : 'inherit'}">${lowStockItems.length}</b>
      </div>
      <div class="dashboard-stat">
        <span>Valorizado (precio venta)</span>
        <b>${window.money ? window.money(totalStockValue) : `$${totalStockValue.toLocaleString('es-AR')}`}</b>
      </div>
    </div>

    ${
      lowStockItems.length > 0
        ? `<div class="notice" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <span><b>⚠ Atención depósito:</b> Hay <b>${lowStockItems.length}</b> producto(s) en o por debajo del stock mínimo (${esc(
              lowStockItems
                .slice(0, 3)
                .map(i => `${i.name} (${i.quantity} ${i.unit || 'un.'})`)
                .join(', ')
            )}${lowStockItems.length > 3 ? '…' : ''}).</span>
            <button type="button" id="quickFilterLowBtn">Ver faltantes</button>
          </div>`
        : ''
    }

    <!-- Panel de Registro de Movimiento de Stock (Exclusivo vía RPC record_stock_movement) -->
    <div id="stockMovementPanel" class="panel animate__animated animate__fadeIn" style="margin-bottom:22px;border-color:var(--blue)" ${
      movItem ? '' : 'hidden'
    }>
      ${
        movItem
          ? `
            <div class="piece-heading" style="margin-bottom:14px">
              <div>
                <span class="eyebrow">MOVIMIENTO DE INVENTARIO (RPC RECORD_STOCK_MOVEMENT)</span>
                <h2>${esc(movItem.name)} ${movItem.sku ? `<small class="muted">· SKU ${esc(movItem.sku)}</small>` : ''}</h2>
                <p class="subtitle">Stock disponible actual: <b>${movItem.quantity} ${esc(movItem.unit || 'un.')}</b> · Stock mínimo: ${movItem.minimum_quantity} ${esc(movItem.unit || 'un.')}</p>
              </div>
              <button type="button" class="text-button" id="closeMovementPanelBtn">✕ Cerrar</button>
            </div>
            <form id="stockMovementForm" class="form-grid">
              <label>Tipo de operación <span class="required">*</span>
                <select id="movDirection">
                  <option value="in">+ Ingreso a depósito (compra / devolución / ajuste +)</option>
                  <option value="out">− Salida de depósito (consumo en OT / merma / ajuste −)</option>
                </select>
              </label>
              <label>Cantidad (${esc(movItem.unit || 'un.')}) <span class="required">*</span>
                <input id="movQuantity" type="number" min="0.01" step="0.01" required placeholder="Ej. 2">
              </label>
              <label class="span-two">Motivo / Referencia de trabajo o proveedor <span class="required">*</span>
                <input id="movReason" required maxlength="160" placeholder="Ej. Consumo en OT patente AB 123 CD / Factura Proveedor #0042">
              </label>
              <div class="span-two" style="display:flex;justify-content:flex-end;gap:10px">
                <button type="button" class="button secondary" id="cancelMovementBtn">Cancelar</button>
                <button type="submit" class="button primary" id="submitMovementBtn">Confirmar movimiento en Supabase</button>
              </div>
            </form>
          `
          : ''
      }
    </div>

    <!-- Formulario de Alta / Edición de Producto y Compatibilidad -->
    <details id="stockFormDetails" class="panel" style="margin-bottom:22px" ${editing ? 'open' : ''}>
      <summary style="cursor:pointer;font-weight:800;font-size:15px">
        ${
          editing?.id
            ? `✎ Editando producto: ${esc(editing.name)}`
            : '+ Dar de alta nuevo producto, insumo, pintura o repuesto'
        }
      </summary>
      <form id="stockItemForm" style="margin-top:18px">
        <div class="form-grid">
          <label>Nombre del producto <span class="required">*</span>
            <input id="stName" required maxlength="120" value="${esc(editing?.name || '')}" placeholder="Ej. Espejo retrovisor exterior derecho / Barniz bicapa 2K">
          </label>
          <label>Categoría <span class="required">*</span>
            <select id="stCategory">
              ${STOCK_CATEGORIES.map(
                cat => `<option value="${esc(cat)}" ${(editing?.category || 'Repuestos') === cat ? 'selected' : ''}>${esc(cat)}</option>`
              ).join('')}
            </select>
          </label>
          <label>Marca del producto
            <input id="stBrand" maxlength="80" value="${esc(editing?.brand || '')}" placeholder="Ej. PPG, 3M, Valeo, Fitam">
          </label>
          <label>Código o SKU
            <input id="stSku" maxlength="60" class="plate-input" value="${esc(editing?.sku || '')}" placeholder="Ej. ESP-VW-204R">
          </label>
          <label>Unidad de medida
            <select id="stUnit">
              ${STOCK_UNITS.map(
                u => `<option value="${esc(u)}" ${(editing?.unit || 'un.') === u ? 'selected' : ''}>${esc(u)}</option>`
              ).join('')}
            </select>
          </label>
          <label>Ubicación física en depósito
            <input id="stLocation" maxlength="100" value="${esc(editing?.location || '')}" placeholder="Ej. Pasillo 2 · Estante B · Caja 4">
          </label>
          <label>Precio de compra (ARS)
            <input id="stPurchasePrice" type="number" min="0" step="0.01" value="${editing?.purchase_price ?? 0}">
          </label>
          <label>Precio de venta (ARS)
            <input id="stSalePrice" type="number" min="0" step="0.01" value="${editing?.sale_price ?? 0}">
          </label>
          <label>Stock mínimo (alerta)
            <input id="stMinQty" type="number" min="0" step="0.01" value="${editing?.minimum_quantity ?? 1}">
          </label>
          ${
            !editing?.id
              ? `<label>Cantidad inicial (se registra vía <code>record_stock_movement</code>)
                  <input id="stInitialQty" type="number" min="0" step="0.01" value="0">
                </label>`
              : `<label>Cantidad disponible actual (modificar vía botón "± Movimiento")
                  <input value="${editing.quantity} ${esc(editing.unit || 'un.')}" disabled>
                </label>`
          }
          <label class="span-two">Descripción técnica
            <input id="stDescription" maxlength="240" value="${esc(editing?.description || '')}" placeholder="Ej. Espejo eléctrico con desempañador y luz de giro">
          </label>
          <label class="span-two">Observaciones
            <textarea id="stNotes" rows="2" placeholder="Notas adicionales de almacenamiento o proveedor">${esc(editing?.notes || '')}</textarea>
          </label>
        </div>

        <!-- Sub-sección de Compatibilidad de Vehículos para Repuestos -->
        <div class="quiet-details" style="margin-top:18px;padding-top:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
            <div>
              <h3 style="margin:0">Compatibilidad con vehículos (para repuestos y autopartes)</h3>
              <p class="small muted" style="margin:2px 0 0">Indicá marca, modelo, año o rango de años, versión y lado/posición cuando corresponda.</p>
            </div>
            <button type="button" class="button secondary small-btn" id="addCompatRowBtn">+ Agregar vehículo compatible</button>
          </div>
          <div id="compatRowsContainer"></div>
        </div>

        <div class="form-footer">
          <small>Las cantidades de inventario se auditan mediante <code>record_stock_movement</code>.</small>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            ${
              editing
                ? `<button type="button" class="button secondary" id="cancelEditStockBtn">Cancelar edición</button>`
                : ''
            }
            <button type="submit" class="button primary" id="saveStockItemBtn">
              ${editing?.id ? 'Guardar cambios del producto' : 'Registrar producto en stock'}
            </button>
          </div>
        </div>
      </form>
    </details>

    <!-- Barra de Búsqueda rápida y Filtros combinados -->
    <div class="stock-filters-panel">
      <div class="stock-filters-row">
        <label>Búsqueda rápida (nombre, código SKU, ubicación, descripción)
          <input id="stockSearchInput" type="search" value="${esc(f.search)}" placeholder="Buscar pintura, repuesto, SKU o estante…">
        </label>
        <label>Categoría
          <select id="stockCategoryFilter">
            <option value="">Todas las categorías</option>
            ${STOCK_CATEGORIES.map(
              cat => `<option value="${esc(cat)}" ${f.category === cat ? 'selected' : ''}>${esc(cat)}</option>`
            ).join('')}
          </select>
        </label>
        <label>Marca de producto
          <input id="stockBrandFilter" type="search" value="${esc(f.brand)}" placeholder="Ej. PPG, Valeo…">
        </label>
        <label>Estado en depósito
          <select id="stockStatusFilter">
            <option value="active" ${f.status === 'active' ? 'selected' : ''}>Activos</option>
            <option value="low" ${f.status === 'low' ? 'selected' : ''}>⚠ Con stock bajo</option>
            <option value="archived" ${f.status === 'archived' ? 'selected' : ''}>Archivados</option>
            <option value="all" ${f.status === 'all' ? 'selected' : ''}>Todos</option>
          </select>
        </label>
      </div>

      <div class="stock-compat-filters">
        <label>Compatibilidad: Marca del vehículo
          <input id="stockVehMakeFilter" type="search" value="${esc(f.vehicleMake)}" placeholder="Ej. Volkswagen, Toyota">
        </label>
        <label>Compatibilidad: Modelo del vehículo
          <input id="stockVehModelFilter" type="search" value="${esc(f.vehicleModel)}" placeholder="Ej. Vento, Hilux">
        </label>
        <label>Compatibilidad: Año del vehículo
          <input id="stockVehYearFilter" type="number" min="1900" max="2100" value="${esc(f.vehicleYear)}" placeholder="Ej. 2018">
        </label>
        <button type="button" class="button secondary small-btn" id="clearStockFiltersBtn">Limpiar filtros</button>
      </div>
    </div>

    <!-- Grilla de Productos del Inventario -->
    <div id="stockItemsGrid" class="stock-grid"></div>

    <!-- Historial de Movimientos del Depósito -->
    <div class="panel" style="margin-top:26px">
      <div class="piece-heading">
        <div>
          <span class="eyebrow">TRAZABILIDAD DE INVENTARIO</span>
          <h2>Historial de movimientos de stock (${appAuthState.stockMovements.length})</h2>
          <p class="subtitle">Registro inmutable en <code>public.stock_movements</code> generado por <code>record_stock_movement</code>.</p>
        </div>
      </div>
      <div id="stockMovementsContainer" class="movement-history-list"></div>
    </div>
  `

  renderCompatibilityDraftRows()
  renderStockItemsGrid()
  renderMovementHistorySection()

  document.getElementById('backFromStockBtn')?.addEventListener('click', () => {
    history.pushState(null, '', './')
    stockScreen.hidden = true
    window.showJobs?.()
    renderHeaderNavigation()
  })

  document.getElementById('openNewStockItemBtn')?.addEventListener('click', () => {
    appAuthState.editingStockItem = null
    appAuthState.draftCompatibilities = []
    renderStockScreen().then(() => {
      const details = document.getElementById('stockFormDetails')
      if (details) {
        details.open = true
        details.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      document.getElementById('stName')?.focus()
    })
  })

  const filterLowStockHandler = () => {
    appAuthState.stockFilters.status = 'low'
    const sel = document.getElementById('stockStatusFilter')
    if (sel) sel.value = 'low'
    renderStockItemsGrid()
  }
  document.getElementById('filterLowStockStatBtn')?.addEventListener('click', filterLowStockHandler)
  document.getElementById('quickFilterLowBtn')?.addEventListener('click', filterLowStockHandler)

  document.getElementById('closeMovementPanelBtn')?.addEventListener('click', () => {
    appAuthState.movementTargetItem = null
    renderStockScreen()
  })
  document.getElementById('cancelMovementBtn')?.addEventListener('click', () => {
    appAuthState.movementTargetItem = null
    renderStockScreen()
  })

  document.getElementById('stockMovementForm')?.addEventListener('submit', async e => {
    e.preventDefault()
    if (!movItem) return
    const btn = document.getElementById('submitMovementBtn')
    const direction = document.getElementById('movDirection')?.value
    const rawQty = Number(document.getElementById('movQuantity')?.value || 0)
    const quantityChange = direction === 'out' ? -Math.abs(rawQty) : Math.abs(rawQty)
    const reason = document.getElementById('movReason')?.value

    setStockAlert('', '')
    if (btn) {
      btn.disabled = true
      btn.textContent = 'Ejecutando record_stock_movement…'
    }
    try {
      await recordStockMovement({
        itemId: movItem.id,
        currentQuantity: movItem.quantity,
        quantityChange,
        reason
      })
      appAuthState.movementTargetItem = null
      await renderStockScreen()
      setStockAlert('success', `Movimiento registrado (${quantityChange > 0 ? `+${quantityChange}` : quantityChange} ${movItem.unit || 'un.'}) para "${movItem.name}".`)
      window.toast?.('Stock actualizado correctamente.')
    } catch (err) {
      setStockAlert('error', err.message || 'No se pudo registrar el movimiento de stock.')
    } finally {
      if (btn) {
        btn.disabled = false
        btn.textContent = 'Confirmar movimiento en Supabase'
      }
    }
  })

  document.getElementById('addCompatRowBtn')?.addEventListener('click', () => {
    syncDraftCompatibilitiesFromDom()
    appAuthState.draftCompatibilities.push({
      vehicle_make: '',
      vehicle_model: '',
      year_from: '',
      year_to: '',
      version: '',
      position: ''
    })
    renderCompatibilityDraftRows()
  })

  document.getElementById('cancelEditStockBtn')?.addEventListener('click', () => {
    appAuthState.editingStockItem = null
    appAuthState.draftCompatibilities = []
    renderStockScreen()
  })

  document.getElementById('stockItemForm')?.addEventListener('submit', async e => {
    e.preventDefault()
    syncDraftCompatibilitiesFromDom()
    const btn = document.getElementById('saveStockItemBtn')
    setStockAlert('', '')
    if (btn) btn.disabled = true

    const payload = {
      name: document.getElementById('stName')?.value,
      category: document.getElementById('stCategory')?.value,
      brand: document.getElementById('stBrand')?.value,
      sku: document.getElementById('stSku')?.value,
      unit: document.getElementById('stUnit')?.value,
      location: document.getElementById('stLocation')?.value,
      purchase_price: document.getElementById('stPurchasePrice')?.value,
      sale_price: document.getElementById('stSalePrice')?.value,
      minimum_quantity: document.getElementById('stMinQty')?.value,
      initial_quantity: document.getElementById('stInitialQty')?.value ?? 0,
      description: document.getElementById('stDescription')?.value,
      notes: document.getElementById('stNotes')?.value
    }

    try {
      if (editing?.id) {
        await updateStockItem(ws.id, editing.id, payload, appAuthState.draftCompatibilities)
        appAuthState.editingStockItem = null
        appAuthState.draftCompatibilities = []
        await renderStockScreen()
        setStockAlert('success', 'Producto y compatibilidad actualizados en Supabase.')
      } else {
        await createStockItem(ws.id, payload, appAuthState.draftCompatibilities)
        appAuthState.editingStockItem = null
        appAuthState.draftCompatibilities = []
        await renderStockScreen()
        setStockAlert('success', 'Producto dado de alta en el inventario del taller.')
      }
    } catch (err) {
      setStockAlert('error', err.message || 'No se pudo guardar el producto en el inventario.')
    } finally {
      if (btn) btn.disabled = false
    }
  })

  // Filtros en vivo
  const bindFilter = (id, key, eventName = 'input') => {
    document.getElementById(id)?.addEventListener(eventName, e => {
      appAuthState.stockFilters[key] = e.target.value
      renderStockItemsGrid()
    })
  }
  bindFilter('stockSearchInput', 'search', 'input')
  bindFilter('stockCategoryFilter', 'category', 'change')
  bindFilter('stockBrandFilter', 'brand', 'input')
  bindFilter('stockStatusFilter', 'status', 'change')
  bindFilter('stockVehMakeFilter', 'vehicleMake', 'input')
  bindFilter('stockVehModelFilter', 'vehicleModel', 'input')
  bindFilter('stockVehYearFilter', 'vehicleYear', 'input')

  document.getElementById('clearStockFiltersBtn')?.addEventListener('click', () => {
    appAuthState.stockFilters = {
      search: '',
      category: '',
      brand: '',
      status: 'active',
      vehicleMake: '',
      vehicleModel: '',
      vehicleYear: ''
    }
    renderStockScreen()
  })
}

function syncDraftCompatibilitiesFromDom() {
  const rows = document.querySelectorAll('[data-compat-row]')
  if (!rows.length) return
  const list = []
  rows.forEach(row => {
    list.push({
      vehicle_make: row.querySelector('[data-c-make]')?.value || '',
      vehicle_model: row.querySelector('[data-c-model]')?.value || '',
      year_from: row.querySelector('[data-c-yfrom]')?.value || '',
      year_to: row.querySelector('[data-c-yto]')?.value || '',
      version: row.querySelector('[data-c-version]')?.value || '',
      position: row.querySelector('[data-c-pos]')?.value || ''
    })
  })
  appAuthState.draftCompatibilities = list
}

function renderCompatibilityDraftRows() {
  const container = document.getElementById('compatRowsContainer')
  if (!container) return

  if (!appAuthState.draftCompatibilities.length) {
    container.innerHTML = `<p class="small muted" style="margin:6px 0">Sin restricciones de modelo cargadas (aplicable a pinturas, materiales universales o insumos generales).</p>`
    return
  }

  container.innerHTML = appAuthState.draftCompatibilities
    .map(
      (c, idx) => `
      <div class="compat-row-item" data-compat-row="${idx}">
        <label>Marca vehículo *
          <input data-c-make value="${esc(c.vehicle_make || '')}" placeholder="Ej. Volkswagen">
        </label>
        <label>Modelo
          <input data-c-model value="${esc(c.vehicle_model || '')}" placeholder="Ej. Amarok / Vento">
        </label>
        <label>Año desde
          <input data-c-yfrom type="number" min="1900" max="2100" value="${esc(c.year_from ?? '')}" placeholder="2016">
        </label>
        <label>Año hasta
          <input data-c-yto type="number" min="1900" max="2100" value="${esc(c.year_to ?? '')}" placeholder="2022">
        </label>
        <label>Versión
          <input data-c-version value="${esc(c.version || '')}" placeholder="Ej. Highline 2.0">
        </label>
        <label>Lado / Posición
          <select data-c-pos>
            ${PART_POSITIONS.map(
              pos => `<option value="${esc(pos)}" ${(c.position || '') === pos ? 'selected' : ''}>${esc(pos || '— Sin especificar —')}</option>`
            ).join('')}
          </select>
        </label>
        <button type="button" class="button danger small-btn" data-remove-compat="${idx}" aria-label="Quitar fila de compatibilidad">×</button>
      </div>
    `
    )
    .join('')

  container.querySelectorAll('[data-remove-compat]').forEach(btn => {
    btn.addEventListener('click', () => {
      syncDraftCompatibilitiesFromDom()
      appAuthState.draftCompatibilities.splice(Number(btn.dataset.removeCompat), 1)
      renderCompatibilityDraftRows()
    })
  })
}

function renderStockItemsGrid() {
  const grid = document.getElementById('stockItemsGrid')
  if (!grid) return

  const filtered = filterStockItems(appAuthState.stockItems, appAuthState.stockFilters)

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📦</span>
        <h2>No se encontraron productos con estos filtros</h2>
        <p>Podés limpiar los filtros de búsqueda o registrar un nuevo material, insumo o repuesto en el depósito.</p>
      </div>
    `
    return
  }

  const fmtMoney = v => (window.money ? window.money(v) : `$${Number(v || 0).toLocaleString('es-AR')}`)

  grid.innerHTML = filtered
    .map(item => {
      const low = isLowStock(item)
      const archived = Boolean(item.archived_at)
      const compatList = item.compatibilities || []

      return `
        <article class="stock-card ${low ? 'low-stock' : ''} ${archived ? 'archived-stock' : ''}">
          <div>
            <div class="stock-card-top">
              <span class="stock-category-tag">${esc(item.category || 'Materiales')}</span>
              ${
                archived
                  ? `<span class="status-tag rejected">Archivado</span>`
                  : low
                    ? `<span class="stock-alert-tag">⚠ Stock bajo (mín. ${item.minimum_quantity})</span>`
                    : `<span class="stock-ok-tag">✓ Disponible</span>`
              }
            </div>

            <h3 style="font-size:16px;margin:10px 0 4px">${esc(item.name)}</h3>
            <p class="small muted" style="margin:0 0 8px">
              ${esc([item.brand ? `Marca: ${item.brand}` : '', item.sku ? `SKU: ${item.sku}` : ''].filter(Boolean).join(' · ') || 'Sin marca / SKU')}
            </p>

            <div class="stock-qty-box">
              <div>
                <span class="small muted" style="display:block">Disponible</span>
                <span class="stock-qty-value">${item.quantity} <small style="font-size:13px;font-weight:700">${esc(item.unit || 'un.')}</small></span>
              </div>
              <div style="text-align:right">
                <span class="small muted" style="display:block">Precio venta</span>
                <b style="font-size:14px">${fmtMoney(item.sale_price)}</b>
                <small class="muted" style="display:block;font-size:10px">Compra: ${fmtMoney(item.purchase_price)}</small>
              </div>
            </div>

            <div class="stock-meta-list">
              ${item.location ? `<div>📍 <b>Ubicación:</b> ${esc(item.location)}</div>` : ''}
              ${item.description ? `<div>${esc(item.description)}</div>` : ''}
              ${item.notes ? `<div class="small">Nota: ${esc(item.notes)}</div>` : ''}
            </div>

            ${
              compatList.length > 0
                ? `<div class="compat-chips">
                    ${compatList.map(c => `<span class="compat-chip">🚗 ${esc(formatCompatibilityLabel(c))}</span>`).join('')}
                  </div>`
                : ''
            }
          </div>

          <div class="stock-card-actions">
            <button type="button" class="button primary small-btn" data-mov-item="${esc(item.id)}" ${archived ? 'disabled' : ''}>± Movimiento</button>
            <button type="button" class="button secondary small-btn" data-edit-item="${esc(item.id)}">Editar</button>
            <button type="button" class="button ${archived ? 'secondary' : 'danger'} small-btn" data-archive-item="${esc(item.id)}" data-archived="${archived ? '1' : '0'}">
              ${archived ? 'Restaurar' : 'Archivar'}
            </button>
          </div>
        </article>
      `
    })
    .join('')

  grid.querySelectorAll('[data-mov-item]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = appAuthState.stockItems.find(i => i.id === btn.dataset.movItem)
      if (!item) return
      appAuthState.movementTargetItem = item
      renderStockScreen().then(() => {
        document.getElementById('stockMovementPanel')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        document.getElementById('movQuantity')?.focus()
      })
    })
  })

  grid.querySelectorAll('[data-edit-item]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = appAuthState.stockItems.find(i => i.id === btn.dataset.editItem)
      if (!item) return
      appAuthState.editingStockItem = item
      appAuthState.draftCompatibilities = (item.compatibilities || []).map(c => ({ ...c }))
      renderStockScreen().then(() => {
        const details = document.getElementById('stockFormDetails')
        if (details) {
          details.open = true
          details.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      })
    })
  })

  grid.querySelectorAll('[data-archive-item]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const activeMembership = getActiveMembership()
      if (!activeMembership?.workshop) return
      const itemId = btn.dataset.archiveItem
      const isCurrentlyArchived = btn.dataset.archived === '1'
      try {
        await archiveStockItem(activeMembership.workshop.id, itemId, !isCurrentlyArchived)
        await renderStockScreen()
        setStockAlert(
          'success',
          isCurrentlyArchived ? 'Producto restaurado al inventario activo.' : 'Producto archivado correctamente.'
        )
      } catch (err) {
        setStockAlert('error', err.message || 'No se pudo cambiar el estado de archivo del producto.')
      }
    })
  })
}

function renderMovementHistorySection() {
  const container = document.getElementById('stockMovementsContainer')
  if (!container) return

  if (!appAuthState.stockMovements.length) {
    container.innerHTML = `<p class="small muted">Todavía no hay movimientos de inventario registrados en este taller.</p>`
    return
  }

  const itemById = new Map(appAuthState.stockItems.map(i => [i.id, i]))

  container.innerHTML = appAuthState.stockMovements
    .map(mov => {
      const item = itemById.get(mov.stock_item_id)
      const delta = Number(mov.quantity_change || 0)
      const isPos = delta > 0
      const dateStr = mov.created_at
        ? new Date(mov.created_at).toLocaleString('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })
        : ''

      return `
        <div class="movement-row">
          <div>
            <b>${esc(item ? item.name : `Producto ${String(mov.stock_item_id).slice(0, 8)}`)}</b>
            ${item?.sku ? `<small class="muted">· SKU ${esc(item.sku)}</small>` : ''}
            <div class="small muted">${esc(mov.reason || 'Sin motivo especificado')} · ${esc(dateStr)}</div>
          </div>
          <span class="movement-delta ${isPos ? 'positive' : 'negative'}">
            ${isPos ? `+${delta}` : delta} ${esc(item?.unit || 'un.')}
          </span>
        </div>
      `
    })
    .join('')
}

// ============================================================================
// DEV-20: Panel de Administración (/admin) con roles owner | admin | staff
// ============================================================================
export async function openAdminScreen() {
  if (!appAuthState.user || isSessionExpired(appAuthState.session)) {
    await enforceRouteProtection()
    return
  }
  history.replaceState(null, '', '#/admin')
  const jobsScreen = document.getElementById('jobsScreen')
  const workScreen = document.getElementById('workScreen')
  const profileScreen = document.getElementById('profileScreen')
  const stockScreen = document.getElementById('stockScreen')
  const adminScreen = document.getElementById('adminScreen')
  if (jobsScreen) jobsScreen.hidden = true
  if (workScreen) workScreen.hidden = true
  if (profileScreen) profileScreen.hidden = true
  if (stockScreen) stockScreen.hidden = true
  if (adminScreen) adminScreen.hidden = false
  renderHeaderNavigation()
  await renderAdminScreen()
}

export async function renderAdminScreen() {
  const adminScreen = document.getElementById('adminScreen')
  if (!adminScreen) return

  const activeMembership = getActiveMembership()
  const activeWorkshop = activeMembership?.workshop || null
  const callerRole = activeMembership?.role || null
  const isWorkshopAdmin = canAccessAdminPanel(callerRole)
  const isCallerOwner = callerRole === 'owner'

  if (activeWorkshop) {
    try {
      const [members, profiles] = await Promise.all([
        fetchAdminWorkshopMembers(activeWorkshop.id),
        fetchKnownUserProfiles()
      ])
      appAuthState.adminMembers = members
      appAuthState.knownProfiles = profiles
    } catch (err) {
      console.warn('Error cargando miembros del taller:', err)
    }
  } else {
    appAuthState.adminMembers = []
  }

  const ownerCount = appAuthState.adminMembers.filter(m => m.role === 'owner').length

  adminScreen.innerHTML = `
    <div class="page-heading">
      <div>
        <p class="eyebrow">ADMINISTRACIÓN Y ACCESOS · /ADMIN</p>
        <h1>Gestión de Talleres y Usuarios</h1>
        <p class="subtitle">Controlá los talleres autorizados, sus miembros y sus roles (<code>owner</code>, <code>admin</code>, <code>staff</code>) validados en el servidor mediante Edge Function y políticas RLS.</p>
      </div>
      ${
        appAuthState.memberships.length > 0
          ? `<div style="display:flex;gap:10px;flex-wrap:wrap">
              <button type="button" class="button secondary" id="goToProfileFromAdminBtn">Perfil y Logo del Taller</button>
              <button type="button" class="button secondary" id="backFromAdminBtn">← Volver a Trabajos</button>
            </div>`
          : ''
      }
    </div>

    <div id="adminAlertBox" class="auth-alert" role="alert" hidden></div>

    ${
      !appAuthState.memberships.length
        ? `<div class="notice">
            <b>Bienvenido/a a MiTallerApp.</b> Aún no tenés un taller asignado. Podés registrar tu primer taller a continuación (se te asignará automáticamente el rol <b>Propietario / Owner</b>) o compartir tu ID de usuario con el propietario/administrador de un taller existente.
          </div>`
        : ''
    }

    <div class="admin-grid">
      <!-- Columna 1: Mis Talleres Autorizados + Alta de Taller -->
      <div class="admin-card">
        <span class="eyebrow">TALLERES</span>
        <h2>Talleres autorizados (${appAuthState.memberships.length})</h2>
        <p class="subtitle">Aislamiento por taller garantizado por Row Level Security (RLS).</p>

        <div class="admin-list">
          ${
            appAuthState.memberships.length
              ? appAuthState.memberships
                  .map(
                    m => `
                  <div class="admin-item ${m.workshop_id === activeWorkshop?.id ? 'active-workshop' : ''}">
                    <div class="admin-item-info">
                      <h4>${esc(m.workshop.name)}</h4>
                      <p>${esc([m.workshop.legal_name, m.workshop.tax_id ? `CUIT ${m.workshop.tax_id}` : ''].filter(Boolean).join(' · ') || 'Sin razón social / CUIT cargados')}</p>
                      <p>${esc([m.workshop.phone, m.workshop.address].filter(Boolean).join(' · ') || 'Sin teléfono o dirección')}</p>
                    </div>
                    <div class="admin-item-actions">
                      <span class="role-chip ${esc(m.role)}">${esc(ROLE_LABELS[m.role] || m.role)}</span>
                      ${
                        m.workshop_id !== activeWorkshop?.id
                          ? `<button type="button" class="button secondary small-btn" data-select-ws="${esc(m.workshop_id)}">Seleccionar</button>`
                          : `<span class="small muted" style="font-weight:700">Activo</span>`
                      }
                    </div>
                  </div>
                `
                  )
                  .join('')
              : `<p class="muted small" style="margin:12px 0">No tenés talleres asociados todavía.</p>`
          }
        </div>

        <details class="quiet-details" ${!appAuthState.memberships.length ? 'open' : ''}>
          <summary>+ Dar de alta un nuevo taller</summary>
          <form id="createWorkshopForm" class="form-grid" style="margin-top:12px">
            <label class="span-two">Nombre comercial del taller <span class="required">*</span>
              <input id="newWsName" required maxlength="80" placeholder="Ej. Crash Solution Chapa y Pintura">
            </label>
            <label>Razón social
              <input id="newWsLegal" maxlength="120" placeholder="Ej. Crash Solution S.R.L.">
            </label>
            <label>CUIT
              <input id="newWsCuit" maxlength="20" placeholder="Ej. 30-71234567-9">
            </label>
            <label>Teléfono
              <input id="newWsPhone" type="tel" maxlength="40" placeholder="Ej. 11 4444 5555">
            </label>
            <label>WhatsApp
              <input id="newWsWhatsapp" type="tel" maxlength="40" placeholder="Ej. 5491155551234">
            </label>
            <label>Correo electrónico
              <input id="newWsEmail" type="email" maxlength="120" placeholder="contacto@taller.com">
            </label>
            <label>Dirección
              <input id="newWsAddress" maxlength="160" placeholder="Av. Warnes 1234, CABA">
            </label>
            <div class="span-two">
              <button type="submit" class="button primary" id="createWsSubmitBtn" style="width:100%">Registrar taller y asignarme como Propietario (Owner)</button>
            </div>
          </form>
        </details>

        <div class="quiet-details">
          <p class="small muted" style="margin:6px 0 4px"><b>Tu ID de usuario (UUID)</b> para que un propietario/administrador te asocie a su taller:</p>
          <div class="uuid-box">
            <span id="myUserUuidText">${esc(appAuthState.user?.id || '')}</span>
            <button type="button" class="button secondary small-btn" id="copyMyUuidBtn">Copiar ID</button>
          </div>
        </div>
      </div>

      <!-- Columna 2: Miembros y Roles del Taller Activo -->
      <div class="admin-card">
        <span class="eyebrow">USUARIOS Y ROLES (OWNER · ADMIN · STAFF)</span>
        <h2>${activeWorkshop ? `Equipo de ${esc(activeWorkshop.name)}` : 'Seleccioná o creá un taller'}</h2>
        <p class="subtitle">
          ${
            !activeWorkshop
              ? 'Una vez creado o seleccionado un taller podrás ver y administrar sus usuarios.'
              : isWorkshopAdmin
                ? `Tu rol activo es "${esc(ROLE_LABELS[callerRole] || callerRole)}". Las altas, cambios de rol y bajas se ejecutan mediante la Edge Function segura "admin-management".`
                : `Tu rol actual en este taller es "${esc(ROLE_LABELS[callerRole] || callerRole)}". Solo el Propietario (Owner) o Administrador pueden modificar miembros o roles.`
          }
        </p>

        ${
          activeWorkshop
            ? `
              <div class="admin-list">
                ${appAuthState.adminMembers
                  .map(mem => {
                    const canModifyThisMember = isWorkshopAdmin && (isCallerOwner || mem.role !== 'owner')
                    return `
                    <div class="admin-item">
                      <div class="admin-item-info">
                        <h4>${esc(mem.display_name)} ${mem.user_id === appAuthState.user?.id ? '<small class="muted">(Vos)</small>' : ''}</h4>
                        <p>UUID: <code>${esc(mem.user_id)}</code></p>
                        ${mem.phone ? `<p>Tel: ${esc(mem.phone)}</p>` : ''}
                      </div>
                      <div class="admin-item-actions">
                        ${
                          canModifyThisMember
                            ? `
                              <select data-role-user="${esc(mem.user_id)}" data-current-role="${esc(mem.role)}" aria-label="Rol de ${esc(mem.display_name)}">
                                ${ALLOWED_MEMBER_ROLES.map(
                                  r =>
                                    `<option value="${r}" ${mem.role === r ? 'selected' : ''} ${
                                      r === 'owner' && !isCallerOwner ? 'disabled' : ''
                                    }>${esc(ROLE_LABELS[r] || r)}</option>`
                                ).join('')}
                              </select>
                              ${
                                mem.user_id !== appAuthState.user?.id
                                  ? `<button type="button" class="button danger small-btn" data-remove-user="${esc(mem.user_id)}" data-remove-role="${esc(mem.role)}">Quitar</button>`
                                  : ''
                              }
                            `
                            : `<span class="role-chip ${esc(mem.role)}">${esc(ROLE_LABELS[mem.role] || mem.role)}</span>`
                        }
                      </div>
                    </div>
                  `
                  })
                  .join('')}
              </div>

              ${
                isWorkshopAdmin
                  ? `
                    <details class="quiet-details" open>
                      <summary>+ Asociar usuario existente al taller (vía Edge Function)</summary>
                      <form id="assignMemberForm" class="form-grid" style="margin-top:12px">
                        ${
                          appAuthState.knownProfiles.length
                            ? `<label class="span-two">Seleccionar de perfiles registrados (opcional)
                                <select id="knownProfileSelect">
                                  <option value="">— Elegir usuario registrado o ingresar UUID abajo —</option>
                                  ${appAuthState.knownProfiles
                                    .map(
                                      p =>
                                        `<option value="${esc(p.user_id)}">${esc(p.display_name || 'Sin nombre')} (${esc(p.user_id.slice(0, 8))}…)</option>`
                                    )
                                    .join('')}
                                </select>
                              </label>`
                            : ''
                        }
                        <label>ID de Usuario (UUID) <span class="required">*</span>
                          <input id="assignUserUuid" required placeholder="00000000-0000-0000-0000-000000000000">
                        </label>
                        <label>Rol en el taller <span class="required">*</span>
                          <select id="assignUserRole">
                            <option value="staff">Personal / Staff (staff)</option>
                            <option value="admin">Administrador (admin)</option>
                            ${isCallerOwner ? `<option value="owner">Propietario (owner)</option>` : ''}
                          </select>
                        </label>
                        <div class="span-two">
                          <button type="submit" class="button secondary" id="assignMemberBtn" style="width:100%">Asociar usuario a ${esc(activeWorkshop.name)}</button>
                        </div>
                      </form>
                    </details>

                    <details class="quiet-details">
                      <summary>+ Invitar nuevo usuario por correo electrónico (vía Edge Function)</summary>
                      <form id="inviteUserForm" class="form-grid" style="margin-top:12px">
                        <label>Nombre y apellido <span class="required">*</span>
                          <input id="invName" required placeholder="Ej. Carlos Gómez">
                        </label>
                        <label>Teléfono
                          <input id="invPhone" type="tel" placeholder="Opcional">
                        </label>
                        <label>Correo electrónico <span class="required">*</span>
                          <input id="invEmail" type="email" required placeholder="carlos@taller.com">
                        </label>
                        <label>Rol asignado <span class="required">*</span>
                          <select id="invRole">
                            <option value="staff">Personal / Staff (staff)</option>
                            <option value="admin">Administrador (admin)</option>
                            ${isCallerOwner ? `<option value="owner">Propietario (owner)</option>` : ''}
                          </select>
                        </label>
                        <p class="small muted span-two" style="margin:0">
                          Por seguridad, no se ingresan contraseñas de terceros: el usuario recibirá un correo de invitación oficial de Supabase para definir su propia contraseña.
                        </p>
                        <div class="span-two">
                          <button type="submit" class="button primary" id="inviteUserBtn" style="width:100%">Enviar invitación por correo y vincular al taller</button>
                        </div>
                      </form>
                    </details>
                  `
                  : ''
              }
            `
            : ''
        }
      </div>
    </div>
  `

  document.getElementById('goToProfileFromAdminBtn')?.addEventListener('click', () => {
    openProfileScreen()
  })

  document.getElementById('backFromAdminBtn')?.addEventListener('click', () => {
    history.pushState(null, '', './')
    adminScreen.hidden = true
    window.showJobs?.()
    renderHeaderNavigation()
  })

  document.getElementById('copyMyUuidBtn')?.addEventListener('click', () => {
    if (appAuthState.user?.id) {
      navigator.clipboard?.writeText(appAuthState.user.id)
      window.toast?.('ID de usuario copiado al portapapeles.')
    }
  })

  document.querySelectorAll('[data-select-ws]').forEach(btn => {
    btn.addEventListener('click', async () => {
      appAuthState.activeWorkshopId = btn.dataset.selectWs
      localStorage.setItem('mitaller_active_workshop_id', appAuthState.activeWorkshopId)
      await syncActiveWorkshopToLegacyStore()
      await loadWorkshopJobsFromSupabase()
      renderHeaderNavigation()
      await renderAdminScreen()
      window.toast?.('Taller activo cambiado.')
    })
  })

  document.getElementById('createWorkshopForm')?.addEventListener('submit', async e => {
    e.preventDefault()
    const btn = document.getElementById('createWsSubmitBtn')
    setAdminAlert('', '')
    if (btn) btn.disabled = true
    try {
      const ws = await createNewWorkshop({
        userId: appAuthState.user.id,
        name: document.getElementById('newWsName')?.value,
        legal_name: document.getElementById('newWsLegal')?.value,
        tax_id: document.getElementById('newWsCuit')?.value,
        phone: document.getElementById('newWsPhone')?.value,
        whatsapp: document.getElementById('newWsWhatsapp')?.value,
        email: document.getElementById('newWsEmail')?.value,
        address: document.getElementById('newWsAddress')?.value
      })
      appAuthState.memberships = await fetchUserWorkshops(appAuthState.user.id)
      appAuthState.activeWorkshopId = ws.id
      localStorage.setItem('mitaller_active_workshop_id', ws.id)
      await syncActiveWorkshopToLegacyStore()
      await loadWorkshopJobsFromSupabase()
      renderHeaderNavigation()
      await renderAdminScreen()
      setAdminAlert('success', `Taller "${ws.name}" creado y asociado a tu cuenta como Propietario (Owner).`)
    } catch (err) {
      setAdminAlert('error', err.message || 'No se pudo crear el taller.')
    } finally {
      if (btn) btn.disabled = false
    }
  })

  document.getElementById('knownProfileSelect')?.addEventListener('change', e => {
    const uuidInput = document.getElementById('assignUserUuid')
    if (uuidInput && e.target.value) uuidInput.value = e.target.value
  })

  document.getElementById('assignMemberForm')?.addEventListener('submit', async e => {
    e.preventDefault()
    if (!activeWorkshop) return
    const btn = document.getElementById('assignMemberBtn')
    setAdminAlert('', '')
    if (btn) btn.disabled = true
    try {
      const targetUserId = document.getElementById('assignUserUuid')?.value
      const existingMember = appAuthState.adminMembers.find(m => m.user_id === targetUserId)
      await upsertWorkshopMember({
        callerId: appAuthState.user.id,
        callerRole,
        workshopId: activeWorkshop.id,
        targetUserId,
        targetCurrentRole: existingMember?.role || null,
        role: document.getElementById('assignUserRole')?.value,
        currentOwnerCount: ownerCount
      })
      await renderAdminScreen()
      setAdminAlert('success', 'Usuario asociado al taller correctamente.')
    } catch (err) {
      setAdminAlert('error', err.message || 'No se pudo asociar el usuario al taller.')
    } finally {
      if (btn) btn.disabled = false
    }
  })

  document.querySelectorAll('[data-role-user]').forEach(sel => {
    sel.addEventListener('change', async () => {
      if (!activeWorkshop) return
      const targetUserId = sel.dataset.roleUser
      const targetCurrentRole = sel.dataset.currentRole
      const newRole = sel.value
      setAdminAlert('', '')
      try {
        await upsertWorkshopMember({
          callerId: appAuthState.user.id,
          callerRole,
          workshopId: activeWorkshop.id,
          targetUserId,
          targetCurrentRole,
          role: newRole,
          currentOwnerCount: ownerCount
        })
        appAuthState.memberships = await fetchUserWorkshops(appAuthState.user.id)
        renderHeaderNavigation()
        await renderAdminScreen()
        setAdminAlert('success', 'Rol actualizado correctamente.')
      } catch (err) {
        await renderAdminScreen()
        setAdminAlert('error', err.message || 'No se pudo actualizar el rol.')
      }
    })
  })

  document.querySelectorAll('[data-remove-user]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!activeWorkshop) return
      const targetUserId = btn.dataset.removeUser
      const targetCurrentRole = btn.dataset.removeRole
      if (!confirm('¿Confirmás que querés revocar el acceso de este usuario al taller?')) return
      setAdminAlert('', '')
      try {
        await removeMemberFromWorkshop({
          callerId: appAuthState.user.id,
          callerRole,
          workshopId: activeWorkshop.id,
          targetUserId,
          targetCurrentRole,
          currentOwnerCount: ownerCount
        })
        await renderAdminScreen()
        setAdminAlert('success', 'Acceso revocado para el usuario seleccionado.')
      } catch (err) {
        setAdminAlert('error', err.message || 'No se pudo revocar el acceso.')
      }
    })
  })

  document.getElementById('inviteUserForm')?.addEventListener('submit', async e => {
    e.preventDefault()
    if (!activeWorkshop) return
    const btn = document.getElementById('inviteUserBtn')
    setAdminAlert('', '')
    if (btn) btn.disabled = true
    try {
      await inviteOrCreateWorkshopUser({
        callerId: appAuthState.user?.id,
        callerRole,
        workshopId: activeWorkshop.id,
        displayName: document.getElementById('invName')?.value,
        phone: document.getElementById('invPhone')?.value,
        email: document.getElementById('invEmail')?.value,
        role: document.getElementById('invRole')?.value
      })
      await renderAdminScreen()
      setAdminAlert('success', 'Invitación enviada por correo electrónico y usuario vinculado al taller.')
    } catch (err) {
      setAdminAlert('error', err.message || 'No se pudo enviar la invitación.')
    } finally {
      if (btn) btn.disabled = false
    }
  })
}

async function handleExpiredSession() {
  appAuthState.session = null
  appAuthState.user = null
  appAuthState.profile = null
  appAuthState.memberships = []
  appAuthState.activeWorkshopProfile = null
  await enforceRouteProtection('Tu sesión expiró por seguridad. Volvé a iniciar sesión para continuar.')
}

export async function enforceRouteProtection(expiredMessage = '') {
  const authScreen = document.getElementById('authScreen')
  const mainApp = document.getElementById('mainAppContainer')
  const adminScreen = document.getElementById('adminScreen')
  const profileScreen = document.getElementById('profileScreen')
  const stockScreen = document.getElementById('stockScreen')

  if (window.location.hash === '#update-password') {
    appAuthState.authMode = 'update-password'
  }

  const hasValidSession = appAuthState.session && !isSessionExpired(appAuthState.session)

  if (!hasValidSession || appAuthState.authMode === 'update-password') {
    if (mainApp) mainApp.hidden = true
    if (authScreen) {
      authScreen.hidden = false
      renderAuthScreen()
      if (expiredMessage) setAuthAlert('error', expiredMessage)
    }
    renderHeaderNavigation()
    return
  }

  if (authScreen) authScreen.hidden = true
  if (mainApp) mainApp.hidden = false

  const wantsAdmin =
    window.location.pathname.endsWith('/admin') ||
    window.location.hash === '#/admin' ||
    appAuthState.memberships.length === 0

  const wantsProfile = window.location.hash === '#/perfil'
  const wantsStock = window.location.hash === '#/stock'

  if (wantsAdmin) {
    await openAdminScreen()
  } else if (wantsProfile) {
    await openProfileScreen()
  } else if (wantsStock) {
    await openStockScreen()
  } else {
    if (adminScreen) adminScreen.hidden = true
    if (profileScreen) profileScreen.hidden = true
    if (stockScreen) stockScreen.hidden = true
    window.showJobs?.()
    renderHeaderNavigation()
  }
}

async function onSessionEstablished(session) {
  appAuthState.session = session
  appAuthState.user = session?.user || null

  if (!appAuthState.user) {
    await enforceRouteProtection()
    return
  }

  try {
    // Desbloquear únicamente los datos locales asociados a este propietario autenticado
    await unlockOfflineDataForAuthenticatedOwner(appAuthState.user.id)

    appAuthState.profile = await ensureUserProfile(appAuthState.user)
    appAuthState.memberships = await fetchUserWorkshops(appAuthState.user.id)

    if (
      appAuthState.memberships.length > 0 &&
      !appAuthState.memberships.some(m => m.workshop_id === appAuthState.activeWorkshopId)
    ) {
      appAuthState.activeWorkshopId = appAuthState.memberships[0].workshop_id
      localStorage.setItem('mitaller_active_workshop_id', appAuthState.activeWorkshopId)
    }

    await syncActiveWorkshopToLegacyStore()
    await loadWorkshopJobsFromSupabase()
  } catch (err) {
    console.warn('Error inicializando perfil y talleres del usuario:', err)
  }

  await enforceRouteProtection()
}

function setBudgetDeliveryFeedback(type, message) {
  const box = document.getElementById('budgetDeliveryFeedback')
  if (!box) return
  if (!message) {
    box.hidden = true
    box.textContent = ''
    return
  }
  box.className = `auth-alert ${type || 'info'}`
  box.textContent = message
  box.hidden = false
}

function getCurrentWorkshopForBudget() {
  return {
    ...(window.store?.shop || {}),
    ...(appAuthState.activeWorkshopProfile || {})
  }
}

function wireEnhancedBudgetAndSettings() {
  // DEV-25: Opción A — Compartir presupuesto como mensaje de texto por WhatsApp (sin afirmar que fue enviado si solo se abrió WhatsApp)
  if (!window.__dev25WhatsappWrapped) {
    window.__dev25WhatsappWrapped = true
    window.shareWhatsapp = function () {
      if (!window.quoteValid?.()) return
      const j = window.active
      if (!j) return
      const shop = getCurrentWorkshopForBudget()
      j.document.shop = JSON.parse(JSON.stringify(shop))
      window.saveLocal?.()

      try {
        const res = openWhatsappWithBudgetText(j, shop, window)
        setBudgetDeliveryFeedback('info', res.userMessage)
        window.toast?.(res.userMessage)
      } catch (err) {
        setBudgetDeliveryFeedback('error', err.message || 'No se pudo preparar el mensaje de WhatsApp.')
      }
    }

    // DEV-25: Opción B.1 — Generar y descargar archivo PDF real (.pdf) con logo, CUIT, taller, cliente, vehículo, trabajos y total
    window.downloadBudgetPdfAction = function () {
      if (!window.quoteValid?.()) return
      const j = window.active
      if (!j) return
      const shop = getCurrentWorkshopForBudget()
      j.document.shop = JSON.parse(JSON.stringify(shop))
      window.saveLocal?.()

      try {
        const res = downloadBudgetPdf(j, shop, document)
        setBudgetDeliveryFeedback('success', res.userMessage)
        window.toast?.(res.userMessage)
      } catch (err) {
        setBudgetDeliveryFeedback('error', err.message || 'No se pudo generar el archivo PDF.')
      }
    }

    // DEV-25: Opción B.2 — Compartir el archivo PDF mediante las opciones compatibles del dispositivo (Web Share API o descarga + apertura de WhatsApp)
    window.shareBudgetPdfAction = async function () {
      if (!window.quoteValid?.()) return
      const j = window.active
      if (!j) return
      const shop = getCurrentWorkshopForBudget()
      j.document.shop = JSON.parse(JSON.stringify(shop))
      window.saveLocal?.()

      try {
        const res = await shareBudgetPdf(j, shop, {
          navigatorObj: window.navigator,
          windowObj: window,
          documentObj: document
        })
        setBudgetDeliveryFeedback('info', res.userMessage)
        window.toast?.(res.userMessage)
      } catch (err) {
        setBudgetDeliveryFeedback('error', err.message || 'No se pudo compartir el archivo PDF.')
      }
    }
  }

  // DEV-19: Conectar la emisión de PDF / Impresión A4 para que use automáticamente todos los datos y el logo del taller desde Supabase
  if (typeof window.printBudget === 'function' && !window.__dev19PrintWrapped) {
    window.__dev19PrintWrapped = true
    window.printBudget = function () {
      if (!window.quoteValid?.()) return
      const j = window.active
      if (!j) return
      const shop = { ...(window.store?.shop || {}), ...(appAuthState.activeWorkshopProfile || {}) }
      j.document.shop = JSON.parse(JSON.stringify(shop))
      window.saveLocal?.()

      const t = window.totals(j)
      const d = j.document
      const quoteRef = j.number?.startsWith('LOCAL-') ? `Referencia ${j.id.slice(0, 8)}` : j.number
      const headerHtml = buildBudgetWorkshopHeaderHtml(
        shop,
        quoteRef,
        window.safeDate(d.date),
        window.safeDate(window.expiry(d))
      )

      const printDoc = document.getElementById('printDocument')
      if (printDoc) {
        printDoc.innerHTML = `
          ${headerHtml}
          <div class="pdf-client">
            <div>
              <h3>Cliente</h3>
              <p><b>${esc(j.rec.cliente)}</b></p>
              <p>${esc(j.rec.telefono || '')}</p>
              <p>${esc([j.rec.direccion, j.rec.localidad].filter(Boolean).join(', '))}</p>
            </div>
            <div>
              <h3>Vehículo</h3>
              <p><b>${esc((j.rec.patente || '').toUpperCase())}</b></p>
              <p>${esc([j.rec.marca, j.rec.modelo, j.rec.anio].filter(Boolean).join(' '))}</p>
              <p>${j.rec.km ? `Kilometraje: ${esc(j.rec.km)} km` : ''}</p>
            </div>
          </div>
          <table class="pdf-table">
            <thead>
              <tr><th>Trabajo o repuesto</th><th>Cant.</th><th>Precio unit.</th><th>Importe</th></tr>
            </thead>
            <tbody>
              ${j.quote
                .map(
                  q =>
                    `<tr><td>${esc(q.description)}</td><td>${Number(q.qty) || 0}</td><td>${window.money(
                      q.price
                    )}</td><td>${window.money((Number(q.qty) || 0) * (Number(q.price) || 0))}</td></tr>`
                )
                .join('')}
            </tbody>
          </table>
          <div class="pdf-total">
            <div><span>Subtotal</span><b>${window.money(t.subtotal)}</b></div>
            ${t.discount ? `<div><span>Descuento</span><b>− ${window.money(t.discount)}</b></div>` : ''}
            ${t.tax ? `<div><span>Impuesto</span><b>${window.money(t.tax)}</b></div>` : ''}
            <div class="pdf-grand"><span>Total</span><b>${window.money(t.total)}</b></div>
          </div>
          ${d.terms ? `<div class="pdf-terms"><b>Condiciones y observaciones</b><p>${esc(d.terms)}</p></div>` : ''}
          <p class="pdf-footer">
            ${esc(
              [
                shop.name,
                shop.legal_name,
                shop.tax_id ? `CUIT ${shop.tax_id}` : '',
                shop.address,
                shop.phone ? `Tel: ${shop.phone}` : '',
                shop.whatsapp ? `WhatsApp: ${shop.whatsapp}` : '',
                shop.email
              ]
                .filter(Boolean)
                .join(' · ')
            )}<br>
            Presupuesto estimativo sujeto al alcance indicado. Este documento no es una factura.
          </p>
        `
      }
      const prevTitle = document.title
      document.title = `Presupuesto ${j.rec.patente || ''} · ${shop.name || 'Crash Solution'}`
      window.print()
      document.title = prevTitle
    }
  }

  // Conectar el botón ⚙ del header para abrir directamente el Perfil Completo del Taller (DEV-19)
  window.openSettings = function () {
    if (appAuthState.user && getActiveMembership()) {
      openProfileScreen()
    } else {
      const dlg = document.getElementById('settingsDialog')
      if (dlg) dlg.showModal()
    }
  }
}

export async function initAuthAndAdmin() {
  wireEnhancedBudgetAndSettings()

  if (!isSupabaseConfigured || !supabase) {
    await enforceRouteProtection('Faltan configurar las variables de entorno de Supabase.')
    return
  }

  const originalSaveLocal = window.saveLocal
  if (typeof originalSaveLocal === 'function' && !window.__supabaseSaveWrapped) {
    window.__supabaseSaveWrapped = true
    window.saveLocal = function (schedule = true) {
      const ok = originalSaveLocal(schedule)
      if (schedule && window.active && appAuthState.user) {
        clearTimeout(window.__jobCloudTimer)
        window.__jobCloudTimer = setTimeout(() => {
          saveActiveJobToSupabase(window.active)
        }, 800)
      }
      return ok
    }
  }

  const { data, error } = await supabase.auth.getSession()
  if (error) {
    await enforceRouteProtection(translateAuthError(error))
  } else if (data?.session) {
    if (isSessionExpired(data.session)) {
      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession()
      if (refreshErr || !refreshed?.session) {
        await handleExpiredSession()
      } else {
        await onSessionEstablished(refreshed.session)
      }
    } else {
      await onSessionEstablished(data.session)
    }
  } else {
    await enforceRouteProtection()
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      appAuthState.session = session
      appAuthState.user = session?.user || null
      appAuthState.authMode = 'update-password'
      await enforceRouteProtection()
      return
    }
    if (event === 'SIGNED_OUT') {
      const prevUserId = appAuthState.user?.id || null
      const activeMembership = getActiveMembership()
      await lockOfflineDataOnLogout({
        userId: prevUserId,
        workshopId: activeMembership?.workshop_id || null
      })
      if (window.store) {
        window.store.jobs = []
        window.store.activeId = null
      }
      window.active = null
      appAuthState.session = null
      appAuthState.user = null
      appAuthState.profile = null
      appAuthState.memberships = []
      appAuthState.activeWorkshopProfile = null
      appAuthState.pendingSyncCount = 0
      appAuthState.unresolvedConflicts = []
      await enforceRouteProtection()
      return
    }
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      await onSessionEstablished(session)
    }
  })

  if (!window.__dev26OfflineListenersBound) {
    window.__dev26OfflineListenersBound = true

    window.addEventListener('offline', async () => {
      appAuthState.isOnline = false
      await refreshOfflineQueueStatus()
      renderHeaderNavigation()
      const saveStateEl = document.getElementById('saveState')
      if (saveStateEl) {
        saveStateEl.textContent = 'Sin internet · Guardando localmente'
      }
      window.toast?.('Se perdió la conexión a Internet. Podés seguir trabajando; los cambios se guardan en este dispositivo.')
    })

    window.addEventListener('online', async () => {
      appAuthState.isOnline = true
      renderHeaderNavigation()
      window.toast?.('Conexión a Internet recuperada. Sincronizando cambios pendientes…')
      await loadWorkshopJobsFromSupabase()
    })
  }

  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#/admin') openAdminScreen()
    else if (window.location.hash === '#/perfil') openProfileScreen()
    else if (window.location.hash === '#/stock') openStockScreen()
    else if (window.location.hash === '#update-password') {
      appAuthState.authMode = 'update-password'
      enforceRouteProtection()
    }
  })
}

if (typeof window !== 'undefined' && document.getElementById('authScreen')) {
  initAuthAndAdmin()
}
