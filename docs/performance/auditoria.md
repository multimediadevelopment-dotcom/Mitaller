# Rendimiento: auditoría previa a la optimización

Línea base tomada después de corregir navegación y contraste, antes de modificar rendimiento. Datos reproducibles: `before-bundle.json`, `before-requests.json`. No se consultaron ni modificaron datos reales de Supabase.

## Mediciones de base

- Recursos iniciales: **1.117.705 bytes sin comprimir / 353.175 bytes gzip**. JS inicial: **232.245 bytes gzip**. HTML: aproximadamente 247 KB; CSS: 88 KB. Vite avisa sobre el bundle principal de 782 KB.
- Mayores módulos por código renderizado (antes de minificar): html2canvas 409 KB (diferido por jsPDF), jsPDF 342 KB, Supabase Auth 272 KB, canvg 169 KB, main.js 140 KB, Supabase Storage 115 KB. No confundir tamaños renderizados con transferencia minificada.
- HTTP local de recursos iniciales: mediana **14,74 ms**, TTFB HTML **1,05 ms**, diez muestras tras dos calentamientos, gzip, sin ejecutar JavaScript. Es una medición de transporte local; no es FCP, LCP ni tiempo hasta pantalla utilizable. No permite prometer una mejora móvil equivalente.
- Flujo real de orquestación con backend **simulado a 20 ms/solicitud**, tres muestras: login mediano **246,57 ms**, siete solicitudes (auth, perfil dos veces, membresías, taller, descarga logo, trabajos). Dos visitas al perfil: **172,04 ms**, cuatro solicitudes (taller/logo dos veces).
- El conector de Chrome falla al leer la pestaña. No se dispone de FCP/LCP, perfil de CPU, viewport móvil medido ni tiempos de un login contra Supabase real. No se recargó la pestaña con un trabajo abierto ni se forzó una sincronización contra producción.

## Causas identificadas

1. main.js importa estáticamente budget-delivery, que importa jsPDF. Su dependencia canvg también incrementa la descarga inicial. html2canvas y otros módulos ya eran diferidos; no se atribuyen al JS inicial si no forman parte del grafo estático.
2. animate.css se importa completa aunque solo se usa fadeIn. Las ilustraciones de vehículos están embebidas en base64 en el HTML; la misma imagen aparece repetida y viaja antes de autenticar.
3. signInWithEmail consulta el perfil y el callback de sesión vuelve a consultarlo. Perfil y membresías se solicitan secuencialmente. La membresía incluye todos los campos comerciales, pero syncActiveWorkshopToLegacyStore vuelve a leer workshops.
4. Cada visita al perfil vuelve a leer taller y logo. Falta deduplicación de solicitudes concurrentes y caché privada con invalidación al guardar/cambiar de cuenta o taller.
5. Jobs, stock y compatibilidades no usan rangos. Una respuesta grande puede ser costosa y el límite por defecto del servidor puede truncar el listado, comprometiendo la copia offline. Los movimientos sí tienen límite 60; perfiles administrativos límite 100. No hay SELECT * en las consultas revisadas.
6. El encabezado se reconstruye repetidamente durante sincronización, aun sin cambios visibles. Los listados renderizan todas sus tarjetas. La restauración de navegación requiere conservar los snapshots por entrada y usuario/taller.
7. El worker de producción devuelve caché de recursos estáticos pero inicia igualmente una actualización de red, incluso para bundles con hash. Desarrollo ya retira el worker. La caché privada de Storage no debe entrar al app shell.

## Plan y límites

Separar el código de entrega de presupuestos del inicio; conservar WhatsApp síncrono y el PDF offline. Reducir CSS e imágenes embebidas. Deduplicar inicialización y usar caché en memoria con claves de usuario/taller, TTL e invalidación; no persistir datos privados en caches compartidas. Paginar las lecturas completas requeridas para la copia offline sin eliminar trabajos. Revisar índices como propuesta SQL solamente: sin EXPLAIN ni catálogo real no se afirma que falte un índice o que el servidor sea más rápido.

Las comparaciones posteriores usarán los mismos scripts y distinguirán bytes reales, transporte HTTP local y latencia simulada. La comprobación real en escritorio/celular y login autenticado queda para la sesión manual.
