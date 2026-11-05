# Correcciones de navegación y logo — 5 de noviembre de 2026

## Causas confirmadas en código

- El encabezado HTML dejaba visibles ajustes y estado de guardado antes de autenticar. Administración se dibujaba para todos los roles.
- `uploadWorkshopLogo` devolvía el registro con `logo_path`/`logo_url`. Su consumidor esperaba `logoPath`/`logoUrl` y volvía a guardar `logo_path: undefined`, convertido en NULL por `updateWorkshopProfile`. La primera escritura se deshacía y el éxito era engañoso. La vista previa usaba el archivo local, sin comprobar lectura del objeto remoto. La ruta fija también permitía reutilizar contenido cacheado.
- Cancelar contraseña no restablecía `authMode`. La protección de rutas mantenía el formulario abierto. Navegar a otra sección tampoco restablecía la visibilidad del contenedor principal.

## Cambios

Encabezado oculto por defecto hasta validar sesión. Menú principal Trabajos, Stock y Administración según owner/admin; cuenta circular con desplegable, identidad, perfil personal de consulta, datos del taller con permisos existentes, contraseña, configuración y salida. Menú móvil plegable, cierre exterior y Escape. No cambian las validaciones del servidor.

Salir de contraseña limpia su estado y formulario y vuelve a mostrar el contenido que estaba abierto, conservando el DOM y el trabajo en memoria. Las rutas y eventos PASSWORD_RECOVERY siguen abriendo el formulario. Cerrar sesión conserva el bloqueo de datos offline existente.

La subida utiliza un objeto nuevo, verifica URL firmada y descarga desde el bucket privado, compara tamaño, actualiza el registro una sola vez y relee la ruta persistida. Solo entonces informa éxito. El logo anterior se limpia después; si la escritura de base falla de forma ambigua, el objeto nuevo se conserva para evitar borrar un objeto que el servidor pudo haber confirmado. Un fallo al limpiar se registra en consola sin invalidar el logo nuevo. Se preservan los campos del perfil pendientes al subir o quitar el logo.

No se modificaron políticas, migraciones, funciones ni configuración de Supabase. No hubo despliegue ni push.

## Pruebas y límites

Resultados finales tras la corrección de la primera prueba manual: `npm test`, 56 aprobadas y 6 remotas omitidas; `npm run build`, correcto con aviso de chunks mayores de 500 kB. `git diff --check` sin errores de espacios. La prueba existente de registro también sustituye el cliente global de perfil para evitar una llamada indirecta a producción.

Se añadieron pruebas de interfaz con DOM simulado para ingreso, expiración, owner/admin/staff, desplegables, salida de contraseña, conservación del trabajo, recuperación y cierre de sesión. Se probaron la subida y su consumidor real con backend simulado: ruta persistida, recarga del perfil, reemplazo, URL firmada, descarga y errores de Storage/base.

`npm test` queda sin pruebas remotas por defecto: las seis pruebas existentes que llamaban Supabase se omiten. Antes de esta separación, esas pruebas existentes pasaron contra el proyecto configurado; los intentos no autorizados de escritura fueron rechazados. Eso no demuestra las políticas autenticadas owner/admin/staff ni la persistencia de un logo real.

El control del navegador falló al intentar navegar al servidor local (`timeoutMs` en el conector). No se completó inspección visual en navegador, comprobación de desbordamiento real ni pruebas manuales autenticadas. Las pruebas DOM no sustituyen esas verificaciones.

## Archivos modificados o agregados

- `Crash_Solution_Publicacion/index.html`
- `Crash_Solution_Publicacion/src/main.js`
- `Crash_Solution_Publicacion/src/styles.css`
- `Crash_Solution_Publicacion/src/lib/workshop-profile.js`
- `tests/navigation-logo-regressions.test.js`
- `tests/live-supabase.js`
- `tests/dev20-auth-and-admin.test.js`
- `tests/dev22-stock.test.js`
- `tests/supabase-schema-and-rls.test.js`
- `tests/post-testing-corrections.test.js`
- `docs/verificacion-navegacion-logo.md`
- `vite.config.js`
- `Crash_Solution_Publicacion/src/pwa.js`
- `Crash_Solution_Publicacion/src/lib/pwa-lifecycle.js`
- `tests/pwa-lifecycle.test.js`

## Seguimiento de la primera prueba manual: localhost mostraba el encabezado anterior

Al comenzar la investigación, las peticiones HTTP a localhost:5173 y 127.0.0.1:5173 fueron rechazadas y la consulta de listeners no encontró servidor. El Service Worker se registraba también en desarrollo; el worker v3 tenía fallback al HTML offline y estrategia cache-first para scripts de Vite sin hash. Esa combinación permitía seguir viendo la aplicación anterior sin un servidor actualizado. No se pudo consultar directamente el controlador de la pestaña por un fallo del conector de Chrome; la atribución a esa copia offline se basa en los fallos de conexión y el comportamiento del worker comprobado en el código.

Se eliminó el indicador del HTML inicial y se hizo tolerante a su ausencia el arranque clásico. El estado autenticado crea el indicador; el estado sin sesión elimina los controles del DOM, incluso si encuentra markup heredado. No depende exclusivamente de CSS.

Vite usa una raíz absoluta y puerto 5173 estricto. En desarrollo las respuestas llevan `Cache-Control: no-store`, `/sw.js` responde un worker que retira el registro anterior sin interceptar fetch, y el arranque PWA elimina únicamente caches de app shell de esta aplicación. Si el documento seguía controlado, lo recarga para liberarlo. No se borran trabajos, IndexedDB ni localStorage. La compilación de producción conserva el worker offline real.

Se dejó iniciado Vite mediante un proceso independiente oculto, con logs `.vite-dev.stdout.log` y `.vite-dev.stderr.log` (ignorados por Git). Se comprobaron HTTP 200, el HTML actual sin ambos controles, el módulo principal con eliminación del DOM y el worker de retirada. El intento de abrir un segundo Vite en 5173 terminó con `Port 5173 is already in use`, sin crear un servidor en otro puerto.

Pruebas nuevas: HTML real con ejecución del arranque clásico; ausencia de engranaje e indicador antes de autenticar; eliminación de markup heredado; ausencia tras logout y protección repetida; retirada selectiva del worker/caches en desarrollo sin borrar datos; mantenimiento del registro PWA de producción. Queda por repetir la comprobación visual en la pestaña del usuario.

## Preparar el entorno separado (manualmente)

1. Crear un proyecto Supabase de pruebas con otro ID. Replicar el esquema, funciones y políticas revisadas del proyecto MiTaller; no importar clientes, trabajos ni usuarios de producción. El repositorio no contiene el esquema completo ni las políticas de Storage: deberán revisarse y obtenerse manualmente desde Supabase antes de replicarlas.
2. Crear el bucket privado `workshop-logos`. Revisar políticas efectivas sobre `storage.objects` para INSERT, SELECT y DELETE y sobre `public.workshops` para SELECT/UPDATE. Las rutas comienzan por el ID del taller. La lectura debe permitir resolver/descargar logos a los miembros autorizados; la escritura y eliminación deben respetar owner/admin. Revisar también aislamiento entre talleres. No ampliar permisos para ocultar un error.
3. Registrar tres cuentas de prueba con correos controlados. Cada persona establece su contraseña mediante el flujo de registro/invitación; no compartir contraseñas ni claves privadas por chat. Si la invitación necesita la función administrativa, desplegarla manualmente solo en el entorno separado después de revisar su configuración.
4. Con Owner, crear un taller desechable e incorporar las otras dos cuentas con roles Admin y Staff mediante Administración. Comprobar las membresías efectivas. Crear un segundo taller desechable para probar aislamiento.
5. Ejecutar una copia local de la aplicación apuntando al proyecto separado mediante las variables públicas de Vite en un archivo local no versionado. No usar service-role en el navegador. No cambiar la configuración de producción.

Las pruebas remotas existentes solo se habilitan con `MITALLER_LIVE_TESTS=1`, `MITALLER_TEST_SUPABASE_URL` y `MITALLER_TEST_SUPABASE_PUBLISHABLE_KEY`. El helper rechaza el hostname de producción y no usa las variables de la aplicación como alternativa. Estas pruebas comprueban acceso anónimo; la matriz autenticada sigue siendo una tarea manual pendiente.

## Sesión manual conjunta pendiente

- Sin sesión y al recargar: solo identidad y autenticación; sin ajustes, guardado ni administración.
- Owner/Admin/Staff: ingresar y salir; verificar menús y permisos efectivos del servidor. Staff consulta taller sin modificar datos/logo; owner/admin editan según políticas existentes.
- Abrir una inspección con un cambio pendiente; entrar a contraseña, cancelar y navegar a Trabajos, Stock, Perfil y Administración. Verificar que no queda el formulario superpuesto y que los datos continúan. Probar también salida de sesión desde contraseña y recuperación mediante correo auténtico del entorno de pruebas.
- Subir PNG, JPEG y WEBP; comprobar objeto real en `workshop-logos` y `public.workshops.logo_path`, URL firmada/lectura autenticada, reemplazo y limpieza. F5, cerrar/reabrir sesión y volver a comprobar. Forzar un error de permisos en el entorno desechable y verificar que no aparece éxito falso.
- Anchos 320, 375, 768 y 1280 px: abrir/cerrar ambos menús, Escape, clic exterior, teclado y nombres largos; verificar ausencia de scroll horizontal.
- Con un trabajo de prueba, cortar conexión, editar, volver a contraseña y regresar; reconectar, comprobar cola/sincronización y conservación tras cerrar/reabrir sesión. Revisar PDF, WhatsApp, stock e inspecciones con datos ficticios.
