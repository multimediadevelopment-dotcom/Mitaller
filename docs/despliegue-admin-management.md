# Redespliegue autorizado de admin-management

Realizado el 5 de noviembre de 2026, después de recuperar los permisos de la CLI.

## Destino y configuración conservada

- Proyecto: MiTaller, `lqaedtoaukhefuibrcww`, producción.
- Única función desplegada: `admin-management`.
- Identificador de función conservado: `f2707b99-9312-455a-8a20-aab944dcea37`.
- Versión anterior: **1**, ACTIVE, `verify_jwt: true`.
- Versión posterior: **2**, ACTIVE, `verify_jwt: true`.
- La consulta remota se realizó antes y después del despliegue; el hash del bundle cambió.

Se copiaron exclusivamente `index.ts` y `handler.ts` a un directorio temporal ignorado por Git y se comprobó que sus SHA-256 coincidieran con los archivos revisados. La configuración temporal de despliegue fijó explícitamente `verify_jwt = true`; no se utilizó el flag de desactivación ni prune. El destino se indicó por su referencia exacta.

SHA-256 de los archivos desplegados:

- index.ts: `097fc9ef8fb10a293c7591389767ee5d9475fb7b845c9e51a721d024231ed638`
- handler.ts: `155f3cbfbf94c3c58294474780d6425aaaa7511e6551916cfdd97aaba417fa87`

Los metadatos y comprobaciones locales quedaron en `supabase/.temp/admin-management-deploy/`, sin claves ni tokens en los informes.

## Verificaciones posteriores sin escrituras

| Prueba real | Resultado |
|---|---|
| OPTIONS desde localhost:5173 | 200, `ok`, CORS Allow-Origin `*` |
| GET con clave pública | 405 y requestId de la nueva versión |
| POST vacío sin sesión | 401, sesión requerida, requestId de la nueva versión |
| POST vacío con bearer malformado de diagnóstico | 401, `UNAUTHORIZED_INVALID_JWT_FORMAT` |

Ninguna petición contenía `invite_user`, un correo ni datos de un empleado. La respuesta a un token malformado no sustituye la prueba con una sesión válida del Owner.

Pruebas automatizadas antes del despliegue: 51 aprobadas, una remota omitida. Suite completa después: **142 aprobadas y 7 omitidas** (seis remotas y auditoría opt-in). No se detectaron regresiones en esas verificaciones. La entrega real de correo, SMTP y aceptación con una cuenta real siguen pendientes de prueba manual.

No se modificaron RLS, tablas, usuarios, políticas/configuración de Auth, SMTP ni redirecciones globales. No se enviaron invitaciones, no se desplegó el frontend y no se hizo git push.

## Prueba manual guiada

1. Abrir `http://localhost:5173/` con la cuenta Owner y seleccionar el taller de prueba en Administración. Usar el frontend local actualizado; el publicado no se desplegó.
2. Abrir Network con Preserve log y filtrar `admin-management`. En el formulario, escribir un correo de prueba propio y no registrado, elegir staff y enviar manualmente una sola invitación. Nombre y teléfono pueden quedar vacíos.
3. Comprobar el estado HTTP y el JSON. Solo un 200 con `ok: true` e `invitedByEmail: true` confirma que el backend procesó la invitación y completó la vinculación. No garantiza entrega al buzón.
4. Si falla, detener los reenvíos y conservar únicamente HTTP, JSON y requestId para revisar juntos. No copiar Authorization, cookies ni tokens. No cambiar SMTP o allow-list por ensayo y error.
5. Abrir el enlace del empleado en una ventana privada o perfil separado, comprobar el destino y definir personalmente su contraseña. Si el enlace termina en una URL inesperada, registrar el destino sin parámetros/tokens y revisar la lista de redirecciones antes de cambiar nada.
6. Verificar acceso al taller correcto como staff, F5, cierre e inicio de sesión. La cuenta Owner debe seguir en su sesión original. Cualquier limpieza de usuarios o membresías se acordará aparte.
