# ChamVa — Auditoría técnica (v0.2.1, actualizada en v0.3.0)

Revisión hecha el 2026-08-26 sobre el código completo, con foco en **quitar fondo
y transparencias**, y segunda ronda general el 2026-09-01. Marcas: 🔴 crítico ·
🟠 importante · 🟡 mejora · ✅ corregido (se indica la versión).

---

## 1. Quitar fondo (`src/ai/background-removal.ts`, `ai.worker.ts`)

### Lo que está bien
- Dos motores (RMBG-1.4 vía Transformers.js y isnet vía imgly) con selector de
  calidad; RMBG en Web Worker (v0.2.0); la máscara se aplica como canal alfa real
  (no como recorte duro), así que los bordes son suaves.
- El borrador/pincel (`MaskEditor`) permite restaurar desde `originalSrc` — buen
  diseño: el original nunca se pierde.

### Problemas encontrados

1. ✅ **RESUELTO en v0.3.0 — Licencias de los modelos.** `briaai/RMBG-1.4` es **CC BY-NC 4.0 (no
   comercial)** y `@imgly/background-removal` es **AGPL-3.0** (o licencia de pago).
   ChamVa vende "licencias de apoyo" por PayPal: eso puede leerse como uso
   comercial de RMBG, y AGPL obliga a que el código de ChamVa sea compatible con
   AGPL (no puede ser MIT). Opciones limpias: **BiRefNet-lite** o **RMBG-2.0**
   revisando su licencia (BiRefNet es MIT), o **U²-Net / MODNet** (Apache-2.0).
   **Hecho:** se eliminó `@imgly/background-removal` (AGPL) y el motor por
   defecto es ahora **MODNet (Apache-2.0)**, con **BiRefNet-lite (MIT)** como
   opción de máxima calidad por GPU. RMBG-1.4 queda como opción marcada "solo
   uso no comercial". El repo ya tiene **LICENSE (MIT)** con el detalle por
   modelo.

2. ✅ **RESUELTO en v0.3.0 — El refinado de bordes dañaba detalles finos.** `refineEdges` hace erosión
   1px + desenfoque 1px **siempre**, a resolución completa. En fotos grandes es
   inocuo, pero en **logos, iconos, texto o imágenes pequeñas** (< 500 px) se come
   el contorno y deja bordes borrosos; en cabello quita hebras. Mejora:
   - Hacerlo opcional y con intensidad (slider "Suavizar bordes" 0–3 px).
   - Detectar imágenes gráficas (histograma de alfa casi binario) y saltarlo.
   **Hecho:** se quitó la erosión ciega. Hay selector de **Bordes** (Automático /
   Foto suave / Logo-texto nítido / Sin refinar); el modo automático distingue
   gráficos por el histograma de alfa, y en todos los casos se aplica
   **descontaminación de color** en los píxeles semitransparentes (despeja F en
   C = a·F + (1−a)·B), que elimina el halo sin comerse hebras ni contornos.

3. ✅ **RESUELTO en v0.3.0 — Sin vista previa ni comparación.** El recorte se aplica directo como capa
   nueva. Canva/remove.bg muestran antes/después y permiten elegir. **Hecho:** diálogo de resultado con antes/después
   (mantener pulsado), fondo claro/oscuro de prueba, cambio de modo de bordes que
   reprocesa al momento, y botón "Retocar con pincel" que abre el `MaskEditor`
   sobre el recorte.

4. ✅ **RESUELTO en v0.3.0 — imgly fuera.** Todos los motores corren en el Web
   Worker; ya no queda ninguna ruta que bloquee el hilo de la interfaz.

5. 🟡 **Resolución fija de 1024×1024** en RMBG: para fotos verticales o muy
   grandes la máscara se estira; funciona, pero un tiling en 2×2 para imágenes
   > 2000 px mejora bordes de cabello y objetos pequeños.

6. ✅ **RESUELTO en v0.3.0 — Mensajes de error sin contexto.** Sin internet la primera vez el error
   es "Failed to fetch". **Hecho:** se detecta el fallo de red y se explica
   que hace falta internet la primera vez (o usar "Preparar offline"). Si
   BiRefNet falla por falta de WebGPU, la app avisa y cambia sola a MODNet.

7. ✅ Quitar fondo ya no sobreescribe el fondo elegido por el usuario (solo el
   blanco por defecto pasa a transparente).

## 2. Transparencias en todo el pipeline

| Punto | Estado |
|---|---|
| Lienzo transparente por defecto + tablero de ajedrez en el editor | ✅ correcto |
| Export PNG/WebP/AVIF conserva alfa | ✅ correcto |
| Export JPG rellena blanco si el lienzo es transparente | ✅ correcto (pero ver 8) |
| Filtros/duotono respetan alfa (`applyOverlayDuotone` salta píxeles alfa 0) | ✅ correcto |
| Sombra sigue la silueta de un PNG transparente | ✅ correcto (canvas shadow) |
| Borrador mágico (inpaint) conserva alfa original | ✅ correcto |
| **Optimizar HD (Swin2SR) perdía la transparencia** | ✅ **corregido en v0.2.1** (se reescala el alfa original y se reaplica) |
| GIF de páginas: aplana sobre blanco | 🟡 aceptable; GIF soporta 1-bit alfa, se podría ofrecer "fondo transparente" con umbral |
| Duotono: píxeles semitransparentes (alfa 1–254) se recoloran sin premultiplicar | 🟡 bordes de recortes pueden mostrar franja rara con duotono; corregir ponderando por alfa |
| `MaskEditor` borra con pincel de borde duro (clip circular) | ✅ **corregido en v0.3.0**: degradado radial + `destination-out`, control de **Dureza**, zoom y deshacer |

8. ✅ **RESUELTO en v0.3.0 — JPG con fondo transparente rellenaba blanco sin avisar.** El usuario que
   exporta un recorte como JPG cree que "se perdió la transparencia". **Hecho:** aviso ámbar en el menú de descarga y
   PNG preseleccionado cuando el lienzo es transparente.

9. ✅ **RESUELTO en v0.3.0 — `MaskEditor` con zoom, deshacer y dureza.** Zoom con
   rueda y botones (hasta 8×), Ctrl+Z / botón Deshacer con historial de 20
   trazos, y dureza del pincel regulable (0–100 %).

## 3. Descarga y guardado

10. ✅ **Corregido en v0.2.1 — bug grave en la app instalada:** `<a download>`
    con `blob:` **no funciona en macOS (WKWebView) ni en Android WebView**, así
    que en esas plataformas "Descargar" no hacía nada. Ahora hay guardado
    nativo (diálogo Guardar como… en escritorio, `Descargas/ChamVa/` en móvil)
    con respaldo al método web. **Pendiente probar en un Mac y un Android reales.**
11. ✅ La descarga nunca estuvo bloqueada por licencia; el aviso de apoyo salía
    tras **cada** descarga, lo que se sentía como un muro. Ahora sale como
    máximo una vez al día.

## 4. Resto del programa

12. ✅ **RESUELTO en v0.3.0 — LICENSE (MIT)** en la raíz del repo, con el detalle
    de licencias de cada modelo de IA y de las bibliotecas principales.
13. ✅ **RESUELTO en v0.3.0 — OpenCV empaquetado.** Se usa `@techstark/opencv-js`
    dentro del bundle (chunk aparte con carga perezosa): el borrador mágico ya no
    descarga nada de `docs.opencv.org` y funciona sin conexión.
14. ✅ **RESUELTO en v0.3.0 — CSP activa.** Política restrictiva en
    `tauri.conf.json`: `default-src 'self'`, scripts propios + `wasm-unsafe-eval`
    y `connect-src` acotado a HuggingFace, Iconify, unpkg (ffmpeg) y Google Fonts.
15. 🟠 **`App.tsx` (2.900+ líneas)** concentra toda la UI; cada función nueva lo
    engorda. Extraer paneles (PLAN-MEJORA #11) antes de que cueste el doble.
16. 🟡 **i18n parcial:** el chrome está en es/en, pero propiedades, avisos y el
    editor de video siguen en español. Completar el diccionario.
17. 🟡 **Sin tests:** `license.ts`, `refineEdges`, `restoreAlpha` y los
    exportadores son funciones puras ideales para Vitest.
18. 🟡 **Identificador `com.chamva.app`** (choca con `.app` en macOS) — cambiar
    en el próximo release mayor junto con regenerar el proyecto Android.
19. 🟡 **APK fuera de CI:** se compila y sube a mano. Añadir job de Android al
    workflow con el keystore como secreto de GitHub.

20. ✅ **NUEVO en v0.3.0 — Auto-actualizador.** La app instalada de escritorio
    consulta GitHub Releases al arrancar y muestra un banner "Nueva versión
    disponible" con descarga, instalación y reinicio en un clic (paquetes
    firmados con minisign; la clave privada vive solo como secreto de GitHub).
    También hay "Buscar actualizaciones" manual en Ajustes.

## 5. Estado tras v0.3.0

De los 6 puntos priorizados en esta auditoría, **los 6 están resueltos**, más el
LICENSE, OpenCV empaquetado, la CSP y el auto-actualizador.

### Segunda ronda (también en v0.3.0): revisión general del programa

| Hallazgo | Estado |
|---|---|
| `idbSet` tragaba los errores → el usuario no sabía que el autoguardado había dejado de funcionar | ✅ Se avisa con toast (máx. 1/min) y se pide almacenamiento persistente al arrancar |
| Fuentes propias en localStorage (límite ~5 MB, fallo silencioso) | ✅ Guardadas como Blob en IndexedDB, con migración automática |
| Sin ErrorBoundary: pantalla en blanco ante cualquier error de render | ✅ `ErrorBoundary` con "Recargar y recuperar" y copia del error |
| Autoguardado serializaba las imágenes en base64 en cada pausa (MB por tecla) | ✅ Almacén de imágenes por hash (`io/assets.ts`): el documento persistido pesa KB; galería y copias cada 30 s; recolección de huérfanas |
| Fuentes de Google por internet (sin red → Arial) | ✅ 14 fuentes OFL empaquetadas vía `@fontsource` (~700 KB) |
| ffmpeg descargado de unpkg en cada instalación | ✅ Cache Storage + incluido en "Preparar offline" |
| Exportación de video grababa en tiempo real (perdía fotogramas) | ✅ Render determinista con WebCodecs → MP4 (H.264 + AAC, audio mezclado offline); respaldo a la ruta antigua si no hay WebCodecs |
| El proyecto de video se perdía al cerrar el editor | ✅ Persistido en IndexedDB (clips como Blob), con botón "Nuevo" |
| `App.tsx` con 3.400 líneas | ✅ 1.070 líneas: 10 componentes extraídos (`PropertiesPanel`, `RailPanels`, `LicenseDialogs`, `HomeScreen`, `SizeMenu`, `DownloadMenu`, `SelectionMenus`, `PageBar`, `UpdateBanner`, `ShortcutsDialog`) |
| Cero tests | ✅ Vitest: 17 pruebas (licencias con claves efímeras, refinado/descontaminación, parseo de proyectos, i18n) — `pnpm test` |
| `fs:scope` permitía escribir en todo `$HOME` | ✅ Acotado a Descargas/Escritorio/Documentos/Imágenes/Vídeos |
| Atajos invisibles | ✅ Panel "?" / F1 con todos los atajos |
| Identificador `com.chamva.app` | ✅ Cambiado a `com.chamva.editor` (proyecto Android regenerado). **Android: la v0.3.0 se instala como app nueva; desinstalar la anterior** |
| "Subir fuente" del riel no hacía nada sin un texto seleccionado (input oculto solo existía en Propiedades) | ✅ Input siempre montado |

**Lo que queda pendiente** (por orden de valor):

1. Probar en hardware real el guardado nativo en **macOS y Android** y el
   auto-actualizador de extremo a extremo (necesita dos releases firmados: a
   partir de v0.3.0 → v0.3.1 será la primera actualización automática).
2. Completar i18n (propiedades, avisos, editor de video).
3. Job de Android en CI con el keystore como secreto.
4. Duotono: ponderar por alfa para evitar franjas en bordes semitransparentes.
5. GIF con transparencia de 1 bit como opción de exportación.
6. Tests de integración del editor (Playwright) sobre el flujo completo.

## 6. Subtítulos automáticos (V5a, 2026-10-03): licencias verificadas

Comprobado **en línea el 2026-10-03 leyendo el origen** (no de memoria). Código en `src/ai/transcribe/`.

| Componente | Fuente exacta | Licencia | Cómo se verificó | Tamaño |
|---|---|---|---|---|
| Whisper (código y pesos) | github.com/openai/whisper | **MIT** | `LICENSE` («MIT License, Copyright (c) 2022 OpenAI») y README: «code and model weights are released under the MIT License» | — |
| Fichas de pesos originales | huggingface.co/openai/whisper-{tiny,base,small} | Apache-2.0 (ficha HF) | API de HF `cardData.license` | — |
| **Pesos ONNX usados** tiny | huggingface.co/Xenova/whisper-tiny @ `5332fcc` | **Apache-2.0** | ficha `README.md` («license: apache-2.0») + API | WASM 43,6 MB · WebGPU 122,4 MB |
| **Pesos ONNX usados** base | huggingface.co/Xenova/whisper-base @ `64da572` | **Apache-2.0** | ídem | WASM 79,7 MB · WebGPU 208,9 MB |
| **Pesos ONNX usados** small | huggingface.co/Xenova/whisper-small @ `2d67713` | **Apache-2.0** | ídem | WASM 251,9 MB · WebGPU 588,8 MB |
| `@huggingface/transformers` 4.2.0 | github.com/huggingface/transformers.js + `node_modules/.../LICENSE` | **Apache-2.0** | `LICENSE` del repo y del paquete instalado | ya era dependencia |
| `onnxruntime-web` 1.26.0-dev | github.com/microsoft/onnxruntime | **MIT** | `LICENSE` del repo («MIT License, Copyright (c) Microsoft Corporation»); `package.json` instalado: MIT | wasm ya empaquetado |
| Detección de voz (VAD) | propia (energía por tramas, `windows.ts`) | MIT (ChamVa) | sin modelo: no hay nada que descargar ni licenciar | 0 |

**Descartados:** `onnx-community/whisper-*_timestamped` (su ficha **no declara licencia**: sin verificar, no se usa);
Silero VAD (no hace falta: el VAD por energía basta para trocear).

**Descarga y privacidad:**
- Nada se descarga sin consentimiento con el tamaño exacto (`downloadPlan` → `downloadModel({ consent })`).
- Modelos fijados a un **commit** con tamaño y huella por archivo (sha256 LFS / sha1 de blob git): se verifica
  todo; si no coincide, se borra. Descarga reanudable por trozos de 8 MB (IndexedDB + `Range`).
- El worker de transcripción tiene la **red cortada** para Hugging Face: solo lee la caché `chamva-models-v1`; sin
  modelo da un error legible («Falta el modelo…») y no descarga nada. El audio nunca sale del equipo.
- **CSP:** no hizo falta tocarla. `connect-src` ya permitía `https://huggingface.co` y `https://*.hf.co`
  (la redirección real de los pesos va a `us.aws.cdn.hf.co`, comprobado con `curl -I`). La CSP es global: lo que
  limita la red a «solo esta descarga, solo tras permiso» es el código (lista cerrada del manifiesto + worker cortado).
- Pendiente: `navigator.storage.estimate()` en Chromium tarda en reflejar el espacio liberado tras borrar.

## 7. IA de video (V9a, 2026-10-04): licencias verificadas

Comprobado **en línea el 2026-10-04 leyendo el `LICENSE` y la ficha reales** (curl a GitHub raw / API de Hugging Face; nada de memoria).
Código en `src/video/ai/`. Regla: solo se integra lo permisivo verificado en **código y pesos**; lo demás se documenta y no entra.

| Modelo / algoritmo | Fuente exacta | Licencia verificada | Cómo se verificó | Tamaño | Estado |
|---|---|---|---|---|---|
| **MODNet** (código, modelos y demos) | github.com/ZHKKKe/MODNet | **Apache-2.0** | `LICENSE` («Apache License Version 2.0») y README §License: «The code, models, and demos in this repository (excluding GIF files…) are released under the Apache License 2.0» | — | **Integrado** (quitar fondo de video, por fotograma) |
| **Pesos ONNX MODNet** | huggingface.co/Xenova/modnet @ `fa2fa546` | **Apache-2.0** | ficha `README.md` («license: apache-2.0») + API `cardData.license` | `onnx/model.onnx` fp32 25 888 640 B (sha256 `07c308cf…`) + 2 JSON (448 B) = **25,9 MB** | **Integrado**, fijado a commit, descarga con consentimiento y huella |
| BiRefNet-lite (código / pesos ONNX) | github.com/ZhengPeng7/BiRefNet · onnx-community/BiRefNet_lite-ONNX @ `de15b22b` | **MIT** / **MIT** | `LICENSE` («MIT License, Copyright (c) 2024 ZhengPeng») · API `cardData.license: mit` | 114 MB fp16, solo WebGPU | Ya presente en imagen; **no** para video (114 MB y GPU por fotograma: inviable) |
| RMBG-1.4 | huggingface.co/briaai/RMBG-1.4 | **NO permisiva** (`license: other`, «bria-rmbg-1.4», «source-available model for non-commercial use») | API `cardData` | 176 MB | Sigue solo en imagen marcada «no comercial»; **no** se integra en video |
| RVM (Robust Video Matting) | github.com/PeterL1n/RobustVideoMatting | **GPL-3.0** (código; README: «Code is re-released under GPL-3.0») | `LICENSE` (GNU GPL v3) | — | **NO se integra** (copyleft incompatible con el MIT de ChamVa); pesos sin licencia propia aparte |
| MediaPipe Selfie Segmentation (modelo) | storage.googleapis.com/mediapipe-assets/Model Card MediaPipe Selfie Segmentation.pdf · github.com/google-ai-edge/mediapipe | **Apache-2.0** (tarjeta: «LICENSED UNDER Apache License, Version 2.0»; repo: `LICENSE` Apache-2.0) | PDF de la tarjeta descargado y leído; `LICENSE` del repo | `selfie_segmenter.tflite` 249 537 B (URL «latest», sin fijar) | Verificada pero **no integrada en V9a**: exige `@mediapipe/tasks-vision` (dependencia nueva + wasm) y la URL no está fijada a versión. Candidata para un modo «muy rápido» |
| OpenCV.js `@techstark/opencv-js` 5.0.0 | `node_modules/@techstark/opencv-js/LICENSE` y `package.json` | **Apache-2.0** | archivos del paquete instalado; github.com/opencv/opencv `LICENSE` Apache-2.0 | 13,3 MB | **No se usa**: trae `calcOpticalFlowPyrLK`/`goodFeaturesToTrack` pero no `estimateAffinePartial2D` ni `phaseCorrelate` |
| Estabilización | propia (`stabMath.ts`: pirámide SAD + bloques + similitud robusta + gaussiana) | MIT (ChamVa) | sin modelo ni dependencia | 0 | **Integrada** |
| Aislar / quitar voz: Demucs | github.com/facebookresearch/demucs | código **MIT** (`LICENSE`, README «released under the MIT license») | `LICENSE` + README | 80–300 MB según variante | **NO se integra**: los puertos ONNX/web de Hugging Face los sube terceros con licencias contradictorias (MIT, Apache-2.0, OpenRAIL, **CC BY-NC 4.0**) y procedencia de pesos **sin verificar**; ninguno oficial. Queda pendiente de una auditoría propia (V9b) |

**Descarga y privacidad (igual que Whisper, §6):** `matteDownloadPlan` da el tamaño exacto → la interfaz pide permiso →
`downloadMatteModel({ consent })` (sin él, `ConsentError`); solo las 3 URL del manifiesto, al commit fijado, verificadas por
tamaño y sha256/sha1 (lo dañado se borra); reanudable (IndexedDB + `Range`). El worker de inferencia (`matte.worker.ts`)
tiene la red cortada para Hugging Face: sin modelo da «Falta el modelo» y no descarga nada. Los fotogramas van por
`postMessage` al worker y no salen del equipo. La función de imagen previa (`bgcore.ts`) sigue descargando por su cuenta
desde la rama `main` sin diálogo: pendiente de pasarla al mismo patrón.
