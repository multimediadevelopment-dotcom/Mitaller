# Crash Solution — versión para publicar (PWA local)

## Publicar en Netlify (opción sencilla)
1. Extraé el ZIP en una carpeta. **No subas el ZIP con una carpeta superior innecesaria**: `index.html` debe estar en la raíz del sitio.
2. Ingresá a https://app.netlify.com/drop e iniciá sesión si es necesario.
3. Arrastrá la carpeta extraída `Crash_Solution_Publicacion` a Netlify Drop.
4. Abrí la dirección `https://...netlify.app` que te asignen y probá las pantallas, imágenes y un trabajo de prueba.
5. En el celular, abrí esa dirección: Android/Chrome → menú → Instalar aplicación (si está disponible); iPhone/Safari → Compartir → Agregar a pantalla de inicio.
6. Para probar sin conexión: abrí la app conectado, esperá a que cargue, cerrala, desactivá internet y volvé a abrirla. Probá también los esquemas de vehículos.

## Antes de usarla con datos reales
- Los trabajos, fotos y configuraciones se guardan **solo en el almacenamiento de ese navegador y ese dispositivo** (`localStorage`). No se crea cuenta ni se sincroniza entre dispositivos.
- **Hacé exportaciones de respaldo frecuentes desde Ajustes.** Borrar datos del navegador/sitio, usar navegación privada, cambiar de navegador o dispositivo o algunas limpiezas del sistema pueden eliminar la información.
- Los datos existentes en otra dirección web o en un archivo HTML abierto desde el disco **no se copian automáticamente**. Exportá desde la versión anterior e importá el respaldo en la publicada antes de trabajar.
- Compartir presupuestos mediante WhatsApp sí requiere acceso a internet. Abrir la app y consultar/editar trabajos guardados puede hacerse offline.
- La instalación sin conexión requiere que la primera visita y la instalación del service worker hayan terminado con internet. La disponibilidad de la instalación depende del navegador.
- No se incluye servicio backend ni base de datos remota (`HOSTED=false`).

## Mantenimiento
- Para futuras actualizaciones reemplazá los archivos publicados y cambiá la versión `CACHE_NAME` de `sw.js` (actualmente `v2`).
- Conservá el mismo dominio para no cambiar el origen del almacenamiento local.
- La configuración `_headers` sirve para Netlify. Otros proveedores pueden ignorarla; no impide publicar el proyecto.
- Para una prueba desde computadora: dentro de la carpeta ejecutá `python3 -m http.server 8000` y abrí `http://localhost:8000`. No abras `index.html` con `file://` para probar la instalación.
