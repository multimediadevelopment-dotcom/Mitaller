# Alertas transitorias y presentación de Stock

## Causas y cambios

La validación de recepción escribía en `#notice`, situado por encima de todas las secciones. El router cambiaba la sección visible sin limpiar ese contenido. Los eventos de edición tampoco retiraban el mensaje cuando cliente y patente ya estaban completos. Además, los avisos de sincronización compartían ese contenedor y podían reemplazar o borrar validaciones.

Los mensajes del formulario ahora se limpian al navegar, abrir Mi perfil y cambiar de trabajo. Se eliminan tanto el contenido como su estado de validación; no se guardan en el historial ni en el borrador. Completar cliente y patente elimina su validación pendiente; corregir descripción y cantidad hace lo mismo para el presupuesto. Las validaciones siguen bloqueando el avance y el guardado del trabajo no cambia. Los avisos de cola y conflictos tienen un contenedor independiente, conservando sus acciones y estado.

Stock conserva compra, cantidades, compatibilidades, movimientos, archivo y alertas. Se retiraron el campo y la visualización de venta y el cálculo/tarjeta de valorización. La validación de actualizaciones omite el precio de venta cuando el formulario no lo envía, para no convertir en cero los valores anteriores. Los productos nuevos conservan el valor predeterminado cero. No hay cambios de esquema, políticas ni datos remotos.

## Pruebas

Se agregaron pruebas del HTML real para bloqueo de pasos, corrección de datos, mensajes repetidos, reapertura del borrador y recarga conservando datos. Se ejecutan con anchos declarados de 390 y 1440 px; jsdom comprueba comportamiento y DOM, no calcula el diseño visual. Las pruebas del router cubren Stock, Administración, perfil del taller, contraseña, Trabajos y Atrás, conservando el borrador y los avisos de sincronización. Mi perfil tiene su prueba de limpieza al abrir y cerrar.

Las pruebas de Stock usan un backend simulado para crear, editar y consultar productos con compra y cantidad inicial por RPC, comprobando que la venta y cantidad previas no se sobrescriban al editar.

Resultado final: `npm test` terminó con 163 pruebas aprobadas y 7 omitidas (6 remotas y una auditoría de rendimiento opcional). `npm run build` terminó correctamente. El servidor local respondió HTTP 200 y sirvió las nuevas funciones de limpieza, el contenedor independiente de sincronización y la presentación actualizada de Stock.

La comprobación visual en navegador real quedó pendiente: la herramienta Computer Use devolvió `Computer Use native pipe is unavailable`. Las pruebas remotas de Supabase permanecen deshabilitadas.

## Comprobación manual pendiente en escritorio y celular

1. Abrir `http://localhost:5173/` y un trabajo de prueba. Anotar los datos ya cargados.
2. Dejar cliente o patente incompletos e intentar avanzar a Revisión y Presupuesto: debe aparecer un único aviso y mantenerse Recepción.
3. Completar ambos campos: el aviso debe desaparecer y debe poder avanzarse.
4. Repetir la validación y visitar Stock, Administración, Mi perfil, perfil del taller y contraseña. El aviso debe desaparecer. Regresar también con Atrás y Adelante: no debe recuperarse el aviso ni perderse el borrador.
5. Recargar con F5 y comprobar los datos conservados; una alerta nueva solo debe aparecer tras validar otra vez.
6. En un presupuesto de prueba, corregir descripción y cantidad faltantes: comprobar que se limpie su aviso y se mantenga el resto de los datos.
7. En Stock comprobar compra en formulario y tarjetas, ausencia de venta y valorización, cantidades, avisos y acceso a movimientos. Crear/editar únicamente registros de prueba autorizados.
8. Repetir en un ancho móvil y en escritorio. Si hay cambios offline o conflictos, confirmar que sus avisos y acciones sigan disponibles al navegar; no hace falta provocar conflictos en producción para revisar esta corrección.

No se enviaron invitaciones, no se alteró Supabase y no se hizo push ni despliegue.
