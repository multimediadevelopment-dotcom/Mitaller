# Resultados de rendimiento, navegación y contraste

## Comparación medida

KB decimales. Gzip real del build de producción. La línea base se registró antes de modificar rendimiento, después de corregir navegación/contraste.

| Apartado | Antes | Después | Reducción |
|---|---:|---:|---:|
| Recursos iniciales gzip (HTML + CSS + grafo JS estático) | 353.18 KB | 129.61 KB | 63.3% |
| JavaScript inicial gzip | 232.25 KB | 104.36 KB | 55.1% |
| HTML gzip | 111.88 KB | 21.47 KB | 80.8% |
| CSS gzip | 9.05 KB | 3.78 KB | 58.2% |
| Transferencia HTTP local de recursos, mediana | 14.74 ms | 5.11 ms | 65.3% |
| Login con backend simulado, mediana | 246.57 ms | 142.79 ms | 42.1% |
| Dos visitas al perfil con backend simulado, mediana | 172.04 ms | 59.52 ms | 65.4% |
| Solicitudes de login del fixture | 7 | 5 | 28,6% |
| Solicitudes de dos visitas al taller dentro del TTL | 4 | 0 | 100% en caché vigente |

## Qué significan las mediciones

Los tamaños son reproducibles y corresponden al grafo inicial real de Vite. La transferencia usa HTTP local, gzip y 10 muestras tras 2 calentamientos; no ejecuta JavaScript ni mide renderizado. TTFB HTML: 1.05 → 0.72 ms, sin una mejora significativa atribuible al servidor.

El fixture de login ejecuta la orquestación real, con Supabase simulado a 20 ms por solicitud, 3 muestras. Sus tiempos no son latencia de Supabase de producción. Las muestras intermedias conservadas muestran variación (por ejemplo, transferencia de 23,12 ms): los porcentajes de tiempos locales no garantizan una mejora equivalente en un celular o en Vercel. Los conteos de solicitudes fueron estables en todas las muestras.

El código total JS de todos los chunks gzip pasa de 345.62 KB a 349.85 KB: aumenta aproximadamente 1.2% por el particionado. La reducción principal es en el camino inicial; el PDF y sus dependencias se conservan y el worker los descarga en segundo plano para su uso offline. No se atribuye al lazy loading una eliminación de todo ese tráfico.

No se midieron FCP/LCP, CPU móvil ni consultas reales autenticadas: el conector de Chrome falla al leer la pestaña. No se cambió una cuenta ni se forzó una sincronización real para obtener números. Estas mediciones reales de escritorio/móvil y de Supabase quedan pendientes de la sesión manual; no se afirma una mejora porcentual en esos apartados.

## Cambios y causas

- **Carga inicial:** jsPDF llegaba desde un import estático en main. Se separó el texto de WhatsApp en un módulo ligero y se difiere el PDF hasta entrar al presupuesto. Sus botones indican carga y se habilitan cuando está listo; WhatsApp sigue abriéndose de forma síncrona desde el gesto del usuario.
- **CSS e imágenes:** animate.css completo fue sustituido por fadeIn y se conservó reduced-motion. Cuatro ilustraciones salieron de los base64 del HTML a recursos con hash, carga diferida y decodificación asíncrona. No se alteraron sus píxeles ni formas.
- **Consultas:** se eliminó la lectura duplicada del perfil durante login. Perfil/membresías se piden en paralelo y la inicialización concurrente se deduplica. Los datos comerciales ya incluidos en la membresía evitan otra lectura de workshops. Los SELECT ya eran explícitos y se mantienen así.
- **Caché privada:** solo memoria y un ámbito usuario/taller activo. Perfil del taller 30 s; stock/movimientos 20 s; logo/URL firmada 45 min (por debajo de la firma de una hora). Se limpia al cerrar sesión, expirar o cambiar de ámbito. Guardar invalida los datos afectados. Lecturas o mutaciones pendientes de otra sesión no rellenan la nueva caché; las vistas también comprueban el ámbito antes de publicar resultados. No se cachean permisos/membresías como sustituto del servidor.
- **Listados:** lecturas por rangos de 200 con orden estable; se recuperan todas las páginas antes de sustituir el resultado local. Jobs mantiene la protección de operaciones/conflictos locales. Las tarjetas se dibujan de a 60 trabajos o 40 productos; búsqueda y estadísticas conservan todos los datos. La prueba con 150 trabajos comprueba 60 tarjetas iniciales, 120 al ampliar, búsqueda del último registro y conservación de los 150 datos. Los límites visibles y el scroll se restauran junto con el snapshot.
- **Renderizado:** el encabezado no se reconstruye si no cambió su contenido, conservando el desplegable abierto. Perfiles/stock/admin tienen un indicador de carga discreto.
- **Offline:** IndexedDB, cola idempotente y resolución de conflictos permanecen. Un manifiesto de build precachea también los chunks PDF e ilustraciones. La revisión del worker depende del build, y los assets con hash no se revalidan en cada hit. Auth/REST/Storage y dominios externos nunca entran a ese caché. En desarrollo continúa retirándose el worker viejo.
- **Índices:** propuesta local en supabase/proposals/20261105_performance_indexes_review.sql. Requiere revisar índices equivalentes, cardinalidad y EXPLAIN antes de aprobar. No se ejecutó SQL ni se modificó Supabase.
- **Navegación y contraste:** controlador único para popstate/hashchange, sin entradas duplicadas al renderizar; contraseña con URL propia, restauración por entrada y limpieza de formularios. Indicadores con fondos claros verde/naranja y texto oscuro. Pruebas verifican contraste AA del texto y 3:1 del punto.

## Validación

- npm test: **100 aprobadas y 7 omitidas**. Son seis pruebas remotas de producción y una auditoría opt-in. La auditoría se ejecutó aparte y pasó con tres muestras.
- npm run build: **correcto**, sin aviso de chunks mayores de 500 KB. Entrada JS ~391 KB y PDF diferido ~397 KB sin comprimir.
- Cobertura local: login/logout, menú, Mi perfil, logo y su caché/persistencia simulada, trabajos/inspección/restauración, presupuestos PDF/WhatsApp, stock, aislamiento, expiración/invalidation, paginación y primer PDF offline mediante el manifiesto. No equivale a probar persistencia real del logo en producción.
- No se hicieron push, despliegues, migraciones, cambios de datos, configuración ni RLS en Supabase.

## Archivos de estas dos tareas

Aplicación: Crash_Solution_Publicacion/index.html; src/main.js; src/styles.css; src/lib/auth.js; src/lib/navigation-state.js; src/lib/stock.js; src/lib/workshop-profile.js; src/lib/budget-delivery.js; nuevos src/lib/budget-messages.js, src/lib/scoped-cache.js, src/lib/paged-query.js y src/lib/app-router.js; sw.js; vite.config.js; cuatro archivos public/vehicle-assets/vehicle-*.webp o .svg.

Pruebas nuevas: history-navigation.test.js, connectivity-contrast.test.js, performance-safety.test.js, offline-assets.test.js, list-rendering.test.js y performance-audit.test.js. Pruebas ampliadas: navigation-logo-regressions.test.js y personal-profile.test.js.

Auditoría/documentación: scripts/performance-audit.mjs, scripts/performance-summary.mjs, docs/performance/*.json, docs/performance/auditoria.md, este informe y docs/pendientes-prueba-conjunta.md. Propuesta SQL: supabase/proposals/20261105_performance_indexes_review.sql.

## Repetir y comprobar manualmente

1. Para medir la versión actual: node scripts/performance-audit.mjs after. Las mediciones before corresponden al código anterior a la optimización; repetir ese lado requiere esa versión, no volver a medir el código optimizado bajo el nombre before.
2. Para el fixture aislado en PowerShell: definir MITALLER_PERF_AUDIT='1' y MITALLER_PERF_STAGE='after' y ejecutar npm test -- tests/performance-audit.test.js. No usa claves ni cuentas reales.
3. Revisar localhost:5173 en escritorio y móvil: menú, Contraseña → Trabajos → Atrás/Adelante, F5 en inspección, scroll y contraste. Probar en un entorno separado la matriz owner/admin/staff y el guardado real del logo/perfil.
4. Para la primera apertura de PDF sin conexión, probar el build de producción con preview e instalar/completar el app shell antes de cortar la red. Vite dev no registra Service Worker. Comprobar cola y conflictos con datos ficticios del entorno de pruebas.
