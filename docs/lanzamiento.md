# Kit de lanzamiento de ChamVa

Textos listos para copiar y pegar. Repo: https://github.com/quijotevitruvio/ChamVa , descargas:
https://github.com/quijotevitruvio/ChamVa/releases/latest

Consejos: publica entre martes y jueves, responde todos los comentarios las primeras horas, no pidas votos y ten a mano
las capturas (`docs/screenshots/`) y un GIF corto de quitar fondo.

---

## 1. Show HN (inglés)

**Título:** Show HN: ChamVa – An offline, open-source Canva alternative with on-device AI

**Cuerpo:**

I built ChamVa, a design editor for desktop and Android that runs fully offline. No accounts, no cloud, no watermarks. MIT licensed.

It is built with Tauri 2 and React, with Konva for the canvas. Background removal runs locally (MODNet via transformers.js/ONNX in a Web Worker). There are photo frames you drop an image onto, rich text with per-word bold/italic/color, charts, multi-page documents, and export to PNG/JPG/WebP/SVG/PDF/GIF/MP4. Video editing uses ffmpeg.wasm.

Installers for Windows, Linux, macOS and Android. The app is fully functional without a license; donors can get an offline-verified key (ECDSA P-256, no server) that removes the support reminders.

Repo: https://github.com/quijotevitruvio/ChamVa

I would love feedback on the AI model choices and on performance on low-end machines.

---

## 2. Reddit (inglés)

### r/opensource
**Título:** ChamVa: a free, MIT-licensed, offline alternative to Canva (Tauri + React)

I am a solo developer and I wanted a design tool that does not need an account or a subscription. ChamVa is MIT licensed, runs on Windows, Linux, macOS and Android, and all processing (including AI background removal) happens on your device. Code: https://github.com/quijotevitruvio/ChamVa . Contributions and bug reports are welcome, especially for Linux and macOS, which I test less.

### r/software
**Título:** I made a free offline Canva-style editor with local AI background removal

ChamVa is a free design editor for Windows, Linux, macOS and Android. No sign-up, no watermark, nothing uploaded anywhere. Features: background remover, photo frames, per-word text styling, charts, multi-page designs, PDF/PNG/GIF/MP4 export. It is open source (MIT). Download: https://github.com/quijotevitruvio/ChamVa/releases/latest . Honest note: the Windows installer is not code-signed yet, so SmartScreen will warn you. Happy to answer questions.

### r/selfhosted
(Lee las reglas del sub antes de publicar: es para servicios autoalojados. Si no admiten apps de escritorio, omítelo.)

**Título:** Local-first design editor with no cloud dependency (Canva alternative), open source

Not a server you host, but relevant if you like software that never phones home: ChamVa runs entirely on your machine, stores projects locally, downloads AI models only on demand, and verifies licenses offline. No accounts. MIT: https://github.com/quijotevitruvio/ChamVa

---

## 3. Product Hunt

**Tagline (≤60):** Canva alternative: free, offline, AI on your device  (53 caracteres)

**Descripción:**
ChamVa is a free, open-source design editor that works 100% offline. Remove backgrounds with on-device AI, drop photos into frames, style text word by word, build charts, and export to PNG, PDF, GIF or MP4. No account, no cloud, no watermark. For Windows, Linux, macOS and Android.

**Primer comentario del maker:**
Hi, I am Andrés, the maker. I got tired of paying for design tools and uploading my files to someone else's servers, so I built ChamVa. It is fully usable for free; if you like it you can support the project and get a license that removes the donation reminders. I would really like to know which feature you miss most coming from Canva. Thanks for trying it!

---

## 4. AlternativeTo

- **Nombre:** ChamVa
- **Alternativa a:** Canva (secundarias: Photopea, GIMP)
- **Descripción corta:** Free, open-source, offline design and image/video editor with on-device AI.
- **Descripción:** ChamVa is a Canva alternative that runs entirely on your device. Features include AI background removal, photo frames, per-word rich text, charts and tables, multi-page designs, brand kit, a video/audio editor and export to PNG, JPG, WebP, SVG, PDF, GIF and MP4. No account or internet required.
- **Etiquetas:** graphic design, image editor, video editor, offline, open source, background remover, AI, poster maker, social media
- **Plataformas:** Windows, Linux, Mac, Android
- **Licencia:** Open Source (MIT), Free
- **Sitio web:** https://github.com/quijotevitruvio/ChamVa

---

## 5. LinkedIn (español)

Durante meses usé herramientas de diseño que exigen cuenta, suscripción y subir mis archivos a la nube. Así que construí la mía.

ChamVa es un editor de diseño, imagen y video, gratis y de código abierto, que funciona 100 % offline. La IA (como quitar fondos) corre en tu propio equipo. Sin cuentas, sin marcas de agua.

Hecho con Tauri 2, React y Konva. Disponible para Windows, Linux, macOS y Android.

Descárgalo y cuéntame qué te falta: https://github.com/quijotevitruvio/ChamVa

#OpenSource #Diseño #IA #Tauri #React

---

## 6. Artículo técnico (dev.to / LinkedIn)

**Título:** Cómo hice un Canva offline con Tauri, React e IA en el dispositivo

Esquema:

1. **Por qué.** Canva exige cuenta y nube; objetivo: un editor local, gratis y sin marca de agua.
2. **Tauri 2 en vez de Electron.** Instaladores pequeños, backend Rust, una base de código para Windows, Linux, macOS y Android; diferencias de empaquetado por plataforma.
3. **Lienzo con Konva.** El documento es JSON; render y exportación comparten funciones puras, así lo exportado es igual a lo que ves.
4. **IA en el dispositivo.** transformers.js/ONNX Runtime dentro de un Web Worker para no bloquear la interfaz; MODNet como motor por defecto (Apache-2.0) y por qué RMBG-1.4 (no comercial) nunca es el predeterminado; descarga de modelos bajo demanda; refinado de bordes y descontaminación de color contra el halo.
5. **Texto enriquecido por tramos.** Modelo de runs con estilo por palabra, edición directa sobre el lienzo, medición y dibujo con Konva.
6. **Auto-actualizador firmado.** Plugin updater de Tauri, par de claves, manifiesto en las releases de GitHub, verificación de firma antes de instalar.
7. **Licencias offline con ECDSA P-256.** Clave pública embebida, firma del payload (nombre, tipo, caducidad), verificación sin servidor; límites honestos (no es DRM) y por qué basta en un modelo de donación.
8. **Modelo de apoyo.** App 100 % funcional, apoyo voluntario, licencia que quita recordatorios.
9. **Lecciones y siguientes pasos.** Rendimiento en equipos modestos, pruebas con Vitest, firma de código, tiendas.

Cierra con enlace al repo y una invitación a contribuir.

---

## 7. Guiones de video corto (15 a 30 s)

**Video 1: Quitar fondo offline (20 s)**
- 0-3 s: texto "Quita fondos SIN internet". Mostrar modo avión activado.
- 3-12 s: arrastrar una foto, clic en Quitar fondo, antes/después.
- 12-18 s: poner un fondo de color y exportar PNG.
- 18-20 s: "ChamVa. Gratis. Link en la bio."

**Video 2: Marcos de fotos (15 s)**
- 0-3 s: "Arrastra y se recorta solo".
- 3-12 s: elegir marco de corazón, estrella y hexágono; soltar una foto en cada uno.
- 12-15 s: resultado final y logo.

**Video 3: Texto por palabra (20 s)**
- 0-3 s: "Un título con estilo en 10 segundos".
- 3-15 s: doble clic en el texto, una palabra en negrita, otra en color, otra en cursiva.
- 15-20 s: exportar y mostrar el resultado. "Canva gratis y offline: ChamVa."

---

## 8. Repo de GitHub

**Descripción (About):** Editor de diseño, imagen y video offline, gratis y de código abierto: alternativa a Canva con IA en tu equipo. Windows, Linux, macOS y Android.

**Topics sugeridos:** `canva-alternative`, `design-editor`, `image-editor`, `video-editor`, `offline-first`, `tauri`, `tauri-app`, `react`, `typescript`, `konva`, `onnx`, `transformers-js`, `background-removal`, `local-ai`, `open-source`, `desktop-app`, `android`, `spanish`

---

## 9. Checklist de tiendas

Los requisitos de las tiendas cambian: verifica la documentación oficial antes de enviar.

### winget (Windows)
- [ ] Manifiesto ya preparado en `packaging/winget/` (ver su README).
- [ ] `winget validate --manifest packaging\winget` y prueba de instalación local.
- [ ] Fork de microsoft/winget-pkgs, copiar a `manifests/q/quijotevitruvio/ChamVa/0.4.0/` y abrir PR (o `wingetcreate submit`). Un bot valida y un moderador aprueba.
- [ ] En cada versión nueva: `wingetcreate update`.

### Flathub (Linux)
- [ ] Crear el manifiesto Flatpak (`com.chamva.editor.yml`; el ID debe ser coherente con el `identifier` de Tauri y cumplir las reglas de Flathub sobre dominios), el `.metainfo.xml` (capturas, licencia, releases) y el `.desktop`.
- [ ] Flathub prefiere compilar desde fuente sin red: las dependencias de Node y Rust se declaran con flatpak-node-generator y flatpak-cargo-generator. Empaquetar el binario de la release es posible pero más discutido.
- [ ] Probar con `flatpak-builder` y `flatpak-builder-lint`.
- [ ] Abrir PR contra flathub/flathub (rama `new-pr`) siguiendo su guía de envío; revisión humana.

### F-Droid (Android)
- [ ] F-Droid exige **compilar desde código fuente** con licencias libres: no acepta subir el APK. Se envía un YAML de metadatos como merge request a gitlab.com/fdroid/fdroiddata.
- [ ] El build debe funcionar en su servidor: Tauri Android necesita Rust, NDK y Node/pnpm; hay que escribir las órdenes de `build:` en el YAML.
- [ ] Revisar anti-características: descarga de modelos de IA bajo demanda y cualquier dependencia no libre (RMBG-1.4 es no comercial: excluirlo de ese build).
- [ ] Decidir firma (clave de F-Droid o builds reproducibles) y gestionar `versionCode`.
