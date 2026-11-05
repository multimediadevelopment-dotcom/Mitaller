# Navegación y contraste: correcciones implementadas para comprobar juntos

Después del rediseño de Mi perfil se implementaron las dos correcciones solicitadas:

- **Atrás/Adelante:** controlador único de rutas; Trabajos y contraseña tienen URL propia; snapshot por usuario/taller en cada entrada; popstate/hashchange deduplicados; selección del menú derivada de la URL; protección de respuestas antiguas y restauración de inspección/recarga. Causa: escrituras independientes pushState/replaceState y cambio de contraseña sin URL, más listener incompleto de hashchange.
- **En línea/Sin internet:** fondos verde/naranja claro con textos e indicadores oscuros. Causa: colores claros diseñados para el encabezado oscuro heredados sobre el desplegable blanco. Pruebas calculan contraste mínimo 4.5:1 para texto y 3:1 para el punto; se elimina transparencia/opacidad del estado.

Pruebas locales al cerrar estas correcciones: 83 aprobadas, 6 remotas omitidas; build correcto (aviso de bundle mayor de 500 kB). Pendiente comprobar juntos la experiencia real en Chrome y dispositivos móviles; la extensión de control del navegador sigue fallando al leer la pestaña.

Archivos de esta corrección: `src/main.js`, `src/styles.css`, nuevo `src/lib/app-router.js`, `tests/navigation-logo-regressions.test.js`, nuevos `tests/history-navigation.test.js` y `tests/connectivity-contrast.test.js`, y este documento.

Mi perfil permite consultar nombre, correo, rol y taller activo; editar nombre y teléfono existentes; y volver a la sección subyacente sin reconstruirla. El cambio de contraseña sigue en su sección. Las pruebas de guardado usan un cliente simulado; no se guardaron perfiles reales, ni se cambió el esquema o las políticas de Supabase.
