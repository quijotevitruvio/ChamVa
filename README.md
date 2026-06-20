# ChamVa

Editor de diseño, imagen y video **libre, sin restricciones y 100 % offline** — una alternativa propia a Canva.
Instalable en **Windows** y **Android**. Todo el procesamiento (incluida la IA) ocurre en el dispositivo: sin cuentas,
sin nube, sin marcas de agua.

## Características

### 🖼 Editor de imagen / diseño
- Lienzo por capas (imágenes, texto, formas, iconos, QR) con modelo de documento en JSON.
- **Pantalla de inicio** para elegir entre editar imágenes o video.
- Subir imágenes (quedan en la galería para reutilizar), crear lienzos de distintos tamaños y **redimensionar**
  (Magic Resize).
- **Quitar fondo** inteligente con varios motores locales (@imgly/background-removal y RMBG-1.4 vía transformers.js),
  más **borrador mágico** (pincel para borrar/restaurar) e inpaint con OpenCV.
- **Upscale** ×2 (Swin2SR), filtros y duotono, ajustes (brillo/contraste/saturación), recorte con **relación de
  aspecto** fija, recorte a forma (máscara), volteo, sombras, modos de fusión, opacidad y transparencia en todos los
  colores.
- **Texto**: tipografías (incluida la carga de fuentes propias), mayúsculas/negrita/cursiva, alineación, espaciado,
  **interlineado**, curvado, contorno, sombra, efecto **neón / eco / fondo** y **listas** (viñetas / numeradas).
- **Iconos** (Iconify) recolorables, **panel de color** estilo Canva (hex/nombre, cuentagotas, kit de marca,
  degradados), plantillas de fábrica y plantillas guardadas.
- Multi-página con **miniaturas y reordenar**, multiselección con **alinear/distribuir**, snapping y **guías de
  distancia** en px, animaciones de entrada/salida y modo presentación.
- **Autoguardado** (IndexedDB) y recuperación al reabrir.
- Exportar a **PNG, JPG, WebP, AVIF, SVG, PDF, GIF, GIF animado, MP4, ICO** y copiar al portapapeles.

### 🎬 Editor de video / audio
- Importar video/audio, **línea de tiempo con cabezal arrastrable** (scrubbing global), recorte por sliders o
  **arrastrando los bordes**, dividir, reordenar y **miniaturas** de clip.
- **Velocidad** por clip, **fundidos** de entrada/salida (transición a negro).
- Capas de texto/imagen superpuestas con tiempos de aparición.
- Audio: grabación de micrófono, **filtros de voz**, EQ, normalizado, **efectos por pista simultáneos**,
  **reducción de ruido** (compuerta) y **forma de onda**.
- Exportar a **WebM / MP4** (ffmpeg.wasm) con **resolución (720/1080), fps** y barra de progreso.

## Stack
- **Tauri 2** (Rust) para empaquetar Windows (.exe/.msi) y Android (APK).
- **React 19 + TypeScript + Vite 7**, estado con **Zustand**.
- **Konva / react-konva** para el lienzo; render y exportación comparten funciones puras sobre el documento.
- IA local: **@huggingface/transformers** (ONNX Runtime) y **@imgly/background-removal**.
- Otros: ffmpeg.wasm, jsPDF, gifenc, qrcode, OpenCV.js, Iconify.

## Requisitos de desarrollo
- Node 18+ y **pnpm**.
- **Rust** (toolchain estable) + dependencias de Tauri.
- Para Android: Android SDK + NDK, JDK, y **Modo de desarrollador** de Windows activado (Tauri usa enlaces simbólicos).

## Comandos

```bash
pnpm install            # instalar dependencias
pnpm dev                # frontend en el navegador (Vite)
pnpm tauri dev          # app de escritorio con recarga en caliente
pnpm build              # type-check + build de producción del frontend
pnpm tauri build        # instalador de Windows (NSIS .exe + MSI)
pnpm tauri android build --debug --target aarch64 --apk   # APK de Android
```

Los instaladores quedan en `src-tauri/target/release/bundle/` y la APK en
`src-tauri/gen/android/app/build/outputs/apk/`.

## Estructura

```
src/
  App.tsx                 UI principal (riel, paneles, descarga, páginas)
  editor/
    core/                 modelo (types), filtros, formas, animaciones,
                          texto curvo/estilizado, fuentes, paletas, plantillas
    state/store.ts        store Zustand (capas, páginas, historial, recorte…)
    canvas/               EditorCanvas + nodos Konva (imagen/texto/forma)
  io/                     exportación (png/svg/gif/pdf/mp4/ico), iconify, idb, proyecto
  ui/                     ColorPanel, FiltersPanel, MaskEditor, VideoEditor, Presentation…
src-tauri/                proyecto Rust/Tauri (config, gen/android)
```

## Estado y pendientes
Funciona el flujo completo de imagen y video, y compilan tanto el **instalador de Windows** como la **APK**.
Pendiente: estilo de texto **por palabra** (editor inline), **crossfade real** y **RNNoise** auténtico,
**fotos de stock** (requiere clave de Unsplash/Pexels), **gráficas/tablas**, y probar la APK en un dispositivo real.

## Autor y apoyo

Hecho por **Andrés Valencia Tobón**. ChamVa es gratis y sin restricciones — si te resulta útil, considera apoyarlo:

- 💳 **Donar (PayPal):** https://paypal.me/bibliotecologo
- 🐙 **GitHub:** https://github.com/quijotevitruvio
- 💼 **LinkedIn:** https://www.linkedin.com/in/andr%C3%A9s-valencia-tob%C3%B3n/

### Licencia de apoyo (1 año)
Quien quiera apoyar puede obtener una **clave de licencia válida 1 año**. La app la verifica **offline** (firma
criptográfica ECDSA P-256), sin servidores ni conexión. Para conseguirla, dona y solicita tu clave desde el botón
«Solicitar clave de licencia» dentro de la app.

**Cómo emite el autor las claves** (necesita la clave privada, guardada en `tools/private-key.txt`, fuera de git):

```bash
pnpm license "Nombre del cliente" 12   # 12 = meses de validez
```

Copia la clave que imprime y entrégasela al cliente; él la pega en «Activar» dentro de la app. La app solo lleva la
**clave pública** (`src/branding.ts`), así que cualquiera puede verificar pero solo tú puedes emitir.

## Licencia (código)
Proyecto personal de uso libre. Sin garantías.
