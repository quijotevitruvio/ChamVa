<div align="center">

# ChamVa

**Como Canva, pero gratis, offline y con IA en tu equipo.**

Editor de diseño, imagen y video libre, sin cuentas, sin nube y sin marcas de agua.

[![Última release](https://img.shields.io/github/v/release/quijotevitruvio/ChamVa?style=for-the-badge&color=7c3aed)](https://github.com/quijotevitruvio/ChamVa/releases/latest)
[![Descargas](https://img.shields.io/github/downloads/quijotevitruvio/ChamVa/total?style=for-the-badge&color=16a34a)](https://github.com/quijotevitruvio/ChamVa/releases)
[![Licencia MIT](https://img.shields.io/github/license/quijotevitruvio/ChamVa?style=for-the-badge)](LICENSE)
![Plataformas](https://img.shields.io/badge/plataformas-Windows%20%7C%20Linux%20%7C%20macOS%20%7C%20Android-2563eb?style=for-the-badge)

[**Windows**](https://github.com/quijotevitruvio/ChamVa/releases/latest) ·
[**Linux**](https://github.com/quijotevitruvio/ChamVa/releases/latest) ·
[**macOS**](https://github.com/quijotevitruvio/ChamVa/releases/latest) ·
[**Android**](https://github.com/quijotevitruvio/ChamVa/releases/latest)

</div>

Instalable en **4 plataformas**: **Windows** (.exe / .msi), **Linux** (.AppImage / .deb / .rpm), **macOS** (.dmg universal)
y **Android** (.apk). Todo el procesamiento, incluida la IA, ocurre en el dispositivo: sin cuentas, sin nube, sin marcas de agua.

## Descarga

Ve a la [última release](https://github.com/quijotevitruvio/ChamVa/releases/latest) y elige tu instalador:

| Sistema | Archivo |
|---|---|
| Windows | `ChamVa_x.y.z_x64-setup.exe` o `.msi` |
| Linux | `.AppImage`, `.deb` o `.rpm` |
| macOS | `.dmg` (universal: Intel y Apple Silicon) |
| Android | `ChamVa_x.y.z_arm64.apk` |

## Capturas

<!-- TODO (autor): guarda las capturas en docs/screenshots/inicio.png y docs/screenshots/editor.png
     y descomenta estas dos líneas.
![Pantalla de inicio de ChamVa](docs/screenshots/inicio.png)
![Editor de ChamVa](docs/screenshots/editor.png)
-->

## Características

### 🖼 Editor de imagen / diseño
- Lienzo por capas (imágenes, texto, formas, iconos, QR) con modelo de documento en JSON.
- **Inicio "¿Qué vas a crear?"** con tamaños por caso de uso (post, historia, volante, tarjeta, póster, CV…),
  diseños recientes y acceso al editor de video.
- Subir imágenes (quedan en la galería para reutilizar), crear lienzos de distintos tamaños y **redimensionar**
  (Magic Resize).
- **Quitar fondo** inteligente con varios motores locales (MODNet, BiRefNet-lite y RMBG-1.4 vía transformers.js),
  con vista previa antes/después, modos de borde (foto / logo) y descontaminación de color para eliminar el halo,
  más **borrador mágico** (pincel para borrar/restaurar) e inpaint con OpenCV.
- **Ajustes tipo "Photoshop para dummies"**: auto-mejorar, estilos de un clic, luces/sombras, temperatura, tinte,
  intensidad, nitidez, desenfoque, grano, viñeta, pixelado, posterizar y contorno de sticker; **desenfocar fondo
  (retrato)** con un clic.
- **Upscale** ×2 (Swin2SR), filtros y duotono, recorte con **relación de aspecto** fija, recorte a forma, volteo,
  sombras, modos de fusión, opacidad y transparencia en todos los colores.
- **Marcos para fotos**: suelta una foto encima de un marco (corazón, hexágono, estrella…) y se recorta sola.
- **22 formas** (polígonos, corazón, nube, bocadillo, flechas de bloque, luna, anillo…) y **gráficas y tablas**
  editables (barras, líneas, área, torta, dona; pegar datos desde Excel).
- **Texto**: se edita **directamente sobre el diseño** (doble clic) y admite **negrita, cursiva, subrayado y color
  por palabra**; tipografías (incluida la carga de fuentes propias), alineación, espaciado, **interlineado**, curvado,
  contorno, sombra, efecto **neón / eco / fondo** y **listas** (viñetas / numeradas).
- **Kit de marca** con logos, colores y fuentes (el color se aplica al elemento seleccionado).
- **Iconos** (Iconify) recolorables, **panel de color** estilo Canva (hex/nombre, cuentagotas, degradados),
  plantillas de fábrica y plantillas guardadas.
- Multi-página con **miniaturas y reordenar**, **grupos** (Ctrl+G), multiselección con **alinear/distribuir**,
  snapping y **guías de distancia** en px, animaciones de entrada/salida y modo presentación.
- Panel de propiedades en **secciones plegables** y **versión móvil** (riel abajo, propiedades como hoja inferior).
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
- **Tauri 2** (Rust) para empaquetar Windows (.exe/.msi), Linux (.AppImage/.deb/.rpm), macOS (.dmg universal) y Android (APK).
- **React 19 + TypeScript + Vite 7**, estado con **Zustand**.
- **Konva / react-konva** para el lienzo; render y exportación comparten funciones puras sobre el documento.
- IA local: **@huggingface/transformers** (ONNX Runtime, en Web Worker) y **@techstark/opencv-js** (empaquetado).
- **Auto-actualizador** en la app instalada de escritorio: avisa, descarga e instala la nueva versión.
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
pnpm tauri build        # instalador de tu sistema (Windows NSIS/MSI, Linux, macOS)
pnpm tauri android build --debug --target aarch64 --apk   # APK de Android
```

Los instaladores quedan en `src-tauri/target/release/bundle/` y la APK en
`src-tauri/gen/android/app/build/outputs/apk/`.

> **Aviso de Windows SmartScreen:** el instalador no está firmado con un certificado de pago, así que Windows puede
> mostrar "Windows protegió tu PC / editor desconocido". Es normal: pulsa **Más información → Ejecutar de todas
> formas**. La firma de código requiere un certificado comercial.

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
Funciona el flujo completo de imagen y video, y hay instaladores para **Windows, Linux, macOS y Android**.
Pendiente: **crossfade real** y **RNNoise** auténtico, **fotos de stock** (requiere clave de Unsplash/Pexels),
y probar la APK en un dispositivo real.

## Apoya ChamVa

ChamVa es **100 % funcional sin licencia**: nada está bloqueado. Si te sirve, puedes apoyar el proyecto:

- ☕ **GitHub Sponsors:** https://github.com/sponsors/quijotevitruvio
- 📱 **Nequi (Colombia):** 3003000958
- 💳 **PayPal:** https://paypal.me/bibliotecologo

Con una donación puedes pedir una **clave de licencia** (botón «Solicitar clave de licencia» dentro de la app).
La licencia **quita los recordatorios de apoyo** (como en WinRAR) y te pone en el **muro de donantes**.

| Licencia | Precio |
|---|---|
| Personal, 1 año | $20.000 COP |
| Personal, permanente | $60.000 COP |
| Institución educativa, permanente | $150.000 COP, o **GRATIS** |

**Colegios e instituciones educativas:** la licencia es gratuita si la institución la solicita formalmente por correo a
**andres@librosmedellin.com** justificando su uso educativo.

## Sobre el autor

Hecho por **Andrés Valencia Tobón**.

- 🐙 GitHub: https://github.com/quijotevitruvio
- 💼 LinkedIn: https://www.linkedin.com/in/andr%C3%A9s-valencia-tob%C3%B3n/

### Cómo emite el autor las licencias
La app verifica las claves **offline** (firma criptográfica ECDSA P-256), sin servidores ni conexión. Emitirlas requiere la
clave privada, guardada en `tools/private-key.txt`, fuera de git:

```bash
pnpm license "Nombre del cliente" 12                      # 12 meses de validez
pnpm license "Nombre del cliente" --tipo permanente       # no caduca
pnpm license "Colegio X" --tipo educativa                 # institución educativa, no caduca
```

Copia la clave que imprime y entrégasela al cliente; él la pega en «Activar» dentro de la app. La app solo lleva la
**clave pública** (`src/branding.ts`), así que cualquiera puede verificar pero solo el autor puede emitir.

## Pruebas
```bash
pnpm test        # Vitest: licencias, refinado de bordes, parseo de proyectos, i18n
```

## Licencia (código)
**MIT** — ver [LICENSE](LICENSE). Uso libre, incluido comercial, sin garantías.

Los modelos de IA se descargan bajo demanda y tienen licencia propia: **MODNet**
(Apache-2.0, motor por defecto), **BiRefNet-lite** (MIT, requiere WebGPU) y
**Swin2SR** (Apache-2.0). **RMBG-1.4** se ofrece como opción marcada **solo para
uso no comercial** y nunca se usa por defecto.
