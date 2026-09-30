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
