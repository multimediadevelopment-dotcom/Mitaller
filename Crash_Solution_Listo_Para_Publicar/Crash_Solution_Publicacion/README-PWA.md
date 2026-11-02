# Crash Solution — PWA

## Publicación

Subí **todos** los archivos de esta carpeta a un hosting estático con **HTTPS** (por ejemplo, Netlify, Cloudflare Pages, GitHub Pages o tu servidor). El archivo de entrada es `index.html`; mantené `manifest.webmanifest`, `sw.js` y la carpeta `icons/` en el mismo nivel.

Para probar localmente, desde esta carpeta ejecutá `python3 -m http.server 8000` y abrí `http://localhost:8000/`. **No abras `index.html` mediante `file://`**, ya que los service workers necesitan HTTPS o localhost.

## Instalación

En Android/Chrome, abrí la URL y elegí **Instalar app** o **Agregar a la pantalla principal**. En iPhone/Safari, tocá **Compartir > Agregar a pantalla de inicio**. La disponibilidad depende del navegador y del sistema operativo.

## Datos y conexión

- Los trabajos se guardan en `localStorage` **de cada dispositivo/navegador**, como en el proyecto original. Instalarla no transforma el guardado en sincronización entre teléfonos.
- La aplicación abre sin conexión una vez que se ha visitado estando conectada y el service worker terminó de instalarse.
- Fotos y trabajos almacenados en el dispositivo pueden perderse si se borran los datos del sitio. Usá la opción de **exportar respaldo** desde los ajustes de la app.
- El proyecto original usa `HOSTED=false`: no hay backend habilitado. Las peticiones `/api/jobs` existentes en el código no se activan mientras siga así y el service worker deliberadamente no las intercepta.
- Para publicar cambios en el futuro, incrementá `CACHE_NAME` en `sw.js` y recargá la app conectada.
- Si antes abrías el HTML como archivo local o lo alojabas en otra dirección, los datos anteriores **no migran automáticamente** al nuevo origen. Exportá un respaldo desde la versión antigua e importalo en la versión publicada.
