# Invitaciones por correo: diagnóstico y cambio preparado

**Actualización posterior:** el redespliegue fue autorizado y realizado; versión 2 ACTIVE y `verify_jwt: true` conservado. Ver [acta de despliegue](despliegue-admin-management.md). El resto de este documento conserva el diagnóstico y las condiciones previas al despliegue. La invitación real sigue pendiente de prueba manual.

Proyecto comprobado: `lqaedtoaukhefuibrcww`. Fecha: 5 de noviembre de 2026.

## Conclusión comprobada y límite acordado

La causa comprobada del **mensaje engañoso de conexión** es el tratamiento de errores del frontend: cualquier `FunctionsHttpError` con el texto genérico `non-2xx` se convertía en «No se pudo conectar…», sin leer el estado ni el JSON de la respuesta. Por tanto, el mismo mensaje podía corresponder a autenticación, permisos, duplicado, límite de correo o fallo del proveedor.

La **causa remota de la invitación original no está comprobada**: la solicitud anterior ya no figura en Network. El usuario confirmó que no volvió a enviarla y dejó esa comprobación para la sesión conjunta. No se atribuye ese fallo a CORS, JWT, SMTP ni a una función ausente sin su respuesta autenticada.

Otros defectos confirmados en el código local: `redirectTo` llegaba al frontend pero no se pasaba a `inviteUserByEmail`; el arranque reconocía `type=recovery` pero no `type=invite`; el nombre era obligatorio aunque debe ser opcional; y el submit no tenía una guarda explícita frente a eventos repetidos. Ninguno de esos hallazgos demuestra por sí solo la causa del fallo remoto al enviar correo.

## Respuestas reales de solo diagnóstico

Se usó la clave **publicable** del proyecto en `apikey`, sin imprimirla. No se usó la cuenta Owner ni se enviaron acciones de invitación.

| Solicitud | HTTP | Respuesta comprobada |
|---|---:|---|
| OPTIONS `/functions/v1/admin-management` desde localhost:5173 | 200 | `ok`, Allow-Origin `*`; permite `authorization, x-client-info, apikey, content-type` y POST/OPTIONS |
| GET a la misma función | 405 | `{"error":"Método HTTP no permitido. Usá POST."}` |
| POST `{}` sin Authorization | 401 | `{"error":"No autorizado: sesión requerida."}` |
| POST `{}` con un bearer de diagnóstico malformado | 401 | `{"code":"UNAUTHORIZED_INVALID_JWT_FORMAT","message":"Invalid JWT"}` |
| GET `/auth/v1/settings` | 200 | `external.email=true`, `mailer_autoconfirm=true`, `disable_signup=false` |

El token malformado solo demuestra rechazo de formato; no se lo presenta como una prueba de firma con el JWT real del Owner. Las pruebas no crearon usuarios, enviaron correo ni escribieron registros. Las respuestas demuestran disponibilidad del endpoint durante el diagnóstico y no identifican la revisión exacta desplegada.

## Revisión de los doce puntos pedidos

1. **Invocación:** `functions.invoke('admin-management', { body })` usa el nombre correcto. La llamada corregida incluye Authorization explícito y lee la respuesta HTTP real.
2. **Despliegue activo:** el endpoint devuelve respuestas específicas del servicio (GET 405 y POST sin sesión 401). No es un endpoint ausente. No se consultaron metadatos administrativos de su versión.
3. **Proyecto:** la URL local configurada coincide con `https://lqaedtoaukhefuibrcww.supabase.co`; la clave pública permite leer los settings públicos. La configuración privada de Vercel no fue modificada ni inspeccionada.
4. **JWT:** el SDK instalado ya puede enviar el JWT de sesión automáticamente; no había evidencia de su ausencia en la solicitud original. Ahora se comprueba que exista sesión, se renueva si vence en 30 segundos y se envía el token actual explícitamente. No hay reintento automático del POST de invitación. El servidor sigue validando con `auth.getUser(jwt)` antes de crear el cliente privilegiado o consultar permisos.
5. **CORS:** el preflight para los encabezados realmente utilizados por este cliente responde correctamente. No se cambió Allow-Origin ni se desactivó autenticación. Solo se expone el identificador seguro de solicitud de la nueva versión.
6. **Permisos:** el handler consulta `workshop_members` por taller seleccionado y por el usuario derivado del JWT; solo owner/admin pueden invitar. Admin no puede asignar owner. Las comprobaciones con la sesión real del Owner quedan pendientes; los tests del handler verifican owner/admin/staff y aislamiento.
7. **Parámetros:** action `invite_user`, workshopId, correo normalizado, nombre/teléfono opcionales, rol válido y redirectTo. No se envían contraseñas ni se usa callerRole del cliente como autorización del servidor.
8. **API de correo:** se conserva `adminClient.auth.admin.inviteUserByEmail`, exclusivamente en el servidor. El parche añade redirectTo y clasifica los errores. Su ejecución real con un destinatario está pendiente de autorización.
9. **Envío Auth:** el endpoint público no expone el SMTP privado, las cuotas ni las plantillas. No está comprobado si este proyecto usa SMTP propio ni si permite el destinatario que falló.
10. **Email vs Confirm email:** Email está habilitado y hay confirmación automática. No hay fundamento para activar/desactivar ese proveedor o cambiar Confirm email para solucionar este incidente.
11. **Redirecciones:** se genera una URL limpia para localhost o el dominio de la aplicación y se pasa al SDK de Auth. El handler valida protocolo, mismo origen, ausencia de credenciales/query y destino de contraseña. Supabase Auth conserva la allow-list autoritativa. Las entradas privadas de esa lista y el Site URL no fueron verificadas ni cambiadas.
12. **Errores:** el cliente conserva status, code y requestId, y muestra mensajes controlados diferentes para red, JWT, permisos, duplicados, cuota, destinatario no autorizado, proveedor deshabilitado, envío y operación parcial. Ni los mensajes ni los logs del frontend incluyen tokens, payloads o errores SQL crudos.

## Correcciones preparadas

- Formulario: nombre/teléfono opcionales; correo y rol obligatorios; indicador de operación y bloqueo de doble submit. Se conservan los datos ante un error.
- Cliente: JWT vigente explícito; códigos HTTP y cuerpo JSON interpretados sin revelar información sensible; confirmación solo con respuesta `ok`, `invitedByEmail` y usuario. La confirmación habla de una operación procesada, no de entrega garantizada al buzón.
- Duplicados: exclusión concurrente y reutilización de la operación reciente por usuario/taller/correo durante cinco minutos. Se limpia al cambiar de sesión/taller. Tras un error de red ambiguo, resultado parcial o respuesta sin confirmación se impide el reenvío inmediato automático.
- Función: handler separado y testeable, manteniendo las acciones existentes. Preserva validación de JWT, permisos, aislamiento y protección del último propietario; pasa redirectTo a Auth; devuelve códigos y referencias seguras. Una acción `diagnose`, autenticada y de solo lectura, permite verificar acceso después del despliegue sin mandar correo.
- Estado parcial: si el correo fue procesado pero falla perfil o membresía, se devuelve `INVITE_PARTIAL`, nunca éxito. Auth y PostgreSQL no forman una transacción atómica; no se borran usuarios ni se hacen rollbacks destructivos para ocultar ese caso.
- Aceptación: los callbacks `invite` y `recovery` abren la sección de contraseña de la cuenta autenticada. El empleado define su propia contraseña; el Owner nunca la pide ni la conoce.

La deduplicación del servidor es adicional y vive por isolate. No constituye una garantía global de envío exactamente una vez entre varios workers, reinicios o navegadores. Una garantía distribuida requeriría almacenamiento durable adicional y otra revisión/autorización; no se agregó una tabla ni se modificó RLS.

## ¿Qué requiere autorización?

**Sí requiere volver a desplegar `admin-management` para aplicar el backend preparado.** El frontend local ya está actualizado, pero la función de producción permanece como estaba.

Autorización a solicitar: «Desplegar únicamente el código revisado de `supabase/functions/admin-management/index.ts` y `handler.ts` en el proyecto `lqaedtoaukhefuibrcww`, preservando la configuración de verificación JWT existente, las variables, Auth y RLS; sin enviar correos ni crear usuarios durante el despliegue». Antes de ejecutarlo, verificar que el mecanismo elegido no cambie implícitamente la configuración actual. No usar flags de desactivación de JWT como solución especulativa.

**No se comprobó que haga falta cambiar Supabase Auth.** Email ya está habilitado. Revisar, sin modificar inicialmente:

- Authentication → URL Configuration: Site URL de la aplicación publicada; destinos locales realmente utilizados y destino publicado de contraseña. Ejemplos para revisar: `http://localhost:5173/#update-password`, `http://127.0.0.1:5173/#update-password` si se usa, y `https://<dominio-real>/#update-password` (con el subdirectorio real si existe). Autorizar por separado cualquier entrada que falte; no añadir comodines globales indiscriminadamente.
- Authentication → Emails/SMTP: si el error real resulta ser `email_address_not_authorized`, revisar SMTP. El SMTP predeterminado restringe destinatarios al equipo de la organización; no equivale a los miembros del taller. No otorgar acceso al proyecto al empleado para evitar esa restricción: revisar un proveedor SMTP adecuado con autorización separada. [Documentación oficial de SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
- Plantilla Invite user: comprobar que conserve el enlace de confirmación real, no un enlace fijo a Site URL. Los redirects no admitidos pueden terminar en Site URL sin devolver un error; no asumir que pasar redirectTo basta. [Invitaciones y redirecciones](https://supabase.com/docs/guides/auth/users), [URL Configuration](https://supabase.com/docs/guides/auth/redirect-urls).

No se requieren claves privadas nuevas para el parche: se mantienen las tres variables existentes en el servidor. Nunca colocar service_role ni credenciales SMTP en Vite, el navegador o el chat.

## Pruebas ejecutadas

- `npm test`: **142 aprobadas, 7 omitidas** (seis remotas y la auditoría de rendimiento opt-in). No ejecuta invitaciones reales.
- `npm run build`: **correcto**. El handler TS se ejecuta directamente en las pruebas con Auth/DB/correo simulados; el build Vite no despliega ni empaqueta el backend para el navegador.
- Cobertura añadida: invitación válida owner/admin; sin sesión; JWT rechazado y renovado; staff/otro taller/admin intentando owner; correo/rol inválidos; duplicados concurrentes; error SMTP/destinatario/proveedor/cuota; respuesta HTTP y confirmación inválida; fallos parciales; contraseñas de terceros; redirecciones; CORS; diagnóstico de solo lectura; último propietario; doble submit de interfaz; aceptación `type=invite` y regresión recovery.

## Archivos de esta corrección

- `Crash_Solution_Publicacion/src/lib/admin.js`
- Nuevo `Crash_Solution_Publicacion/src/lib/admin-service.js`
- `Crash_Solution_Publicacion/src/main.js`
- `supabase/functions/admin-management/index.ts`
- Nuevo `supabase/functions/admin-management/handler.ts`
- Nuevos `tests/invitations-client.test.js`, `tests/invitations-edge.test.js`, `tests/invitations-ui.test.js`
- `tests/history-navigation.test.js`
- Este documento.

## Prueba conjunta exacta con una cuenta de prueba

1. Revisar los dos archivos de la función y autorizar su despliegue limitado si corresponde. Confirmar aparte si se autoriza enviar **una** invitación real a un correo de prueba controlado y no registrado, dentro del taller de prueba. No reutilizar datos de clientes.
2. Revisar URL Configuration y SMTP como lectura. Si se necesita modificar algo, solicitar esa autorización separada antes de hacerlo.
3. Mantener Owner en su sesión habitual y usar una ventana privada o perfil separado para el empleado. Así el enlace del empleado no reemplaza la sesión del Owner.
4. Abrir localhost:5173, Administración, taller correcto e invitación. Dejar opcionalmente nombre/teléfono en blanco, escribir el correo autorizado y seleccionar staff.
5. Abrir DevTools → Network con Preserve log, filtrar `admin-management` y enviar una sola operación. Para comprobar el bloqueo, pulsar repetidamente mientras el botón indica Procesando; no debe crearse un nuevo envío.
6. Registrar únicamente estado HTTP, JSON de Response y referencia segura. No copiar Authorization, cookies ni tokens. Si falla, detenerse y revisar el código del error y los logs del servidor/Auth; no reenviar para intentar ocultarlo.
7. Si responde 200 con la confirmación completa, comprobar el integrante en el taller. La aceptación por el proveedor no garantiza entrega: revisar bandeja/Spam y, si hace falta, registros del correo.
8. El empleado abre el enlace en su sesión separada, configura personalmente su contraseña, entra al taller correcto y verifica que staff no recibe Administración. El Owner no escribe ni recibe esa contraseña.
9. Comprobar F5, cierre e inicio de sesión con la cuenta de prueba; verificar que persisten la membresía y el rol. Repetir producción solo con la URL exacta autorizada y sin una segunda invitación innecesaria.
10. No borrar cuentas, membresías ni datos de prueba automáticamente. Acordar cualquier limpieza por separado.

Estado final: frontend y cambio de función preparados, sin push, despliegue, envío real, creación de usuarios ni modificación de Auth/RLS/datos de producción. Sigue pendiente, por acuerdo expreso, el HTTP/JSON de la operación autenticada original o de una prueba futura autorizada.
