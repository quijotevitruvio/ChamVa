# Auditoría de la parte de imagen (v0.8.0, HEAD 1945f9a)

Auditoría de solo lectura. Método: código (`imageProcessing.ts`, `export.ts`, `runExport.ts`,
`import.ts`, `App.tsx`, `store.ts`, `ai/*`, `ui/*`) y pruebas reales en Chromium (Playwright,
servidor Vite local) con imágenes sintéticas: un JPEG con EXIF Orientation=6, un JPEG de 12 MP
(4000×3000) y otro de 50 MP (8000×6250).

Leyenda: **Hecho** / **Parcial** / **Falta** / **Roto**. «Código» = leído, no ejecutado en pantalla.
«Probado» = ejecutado en el navegador.

## 1. Tabla por área

| Área | Estado | Evidencia |
|---|---|---|
| Importar: JPG/PNG/WebP/GIF/SVG/AVIF | Hecho | `io/import.ts` (FileReader + `<img>`); botón, arrastrar a toda la ventana y pegar (`App.tsx` 994-1100). Código |
| Orientación EXIF | Hecho | Probado: JPEG 400×200 con EXIF=6 entra como capa 200×400 (el navegador la aplica). El export re-codifica por canvas y no arrastra EXIF |
| HEIC/HEIF, TIFF, RAW | Falta | Sin decodificador (idea 6.29 sin hacer). `accept="image/*"` deja elegirlos y `importFiles` solo hace `console.error` (Bug 2) |
| Tamaño máximo al importar | Parcial | `photoCanvas`: lienzo tope 8000 px; la capa conserva la resolución real. Probado 50 MP: carga 31 ms, heap ~660 MB. Sin aviso de memoria en fotos enormes; Android no verificado |
| Foto → diseño del tamaño de la foto | Hecho | `newDesignFromImage`; avisa si pasa de 8000 px |
| Pegar imagen / arrastrar | Hecho | `onPaste`, `drop`, `classifyPaste`. Código |
| Recorte libre y proporciones | Parcial | `onApplyCrop` + barra con 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3. Destructivo y falla con capa girada (Bugs 3 y 6) |
| Girar 90° / voltear | Hecho | `PropertiesPanel` 284-289 y 488 (voltear es no destructivo: `flipX/flipY`) |
| Enderezar horizonte | Hecho | `StraightenTool.tsx`; destructivo (hornea píxeles) |
| Perspectiva | Hecho | `PerspectiveEditor.tsx`; destructivo y limitado a 4096 px (Bug 5) |
| Redimensionar imagen con remuestreo | Falta | Solo escala de capa y tamaño del lienzo; no hay «tamaño de imagen» ni «tamaño de lienzo» anclado. «Optimizar HD ×2» es lo único que cambia píxeles |
| Brillo, contraste, saturación, exposición, temperatura, tinte, luces, sombras, vibración | Hecho | `ImageAdjust` (types.ts 82-116); `processImage`. Probado: 12 MP tarda 180-350 ms |
| Curvas, niveles con histograma, HSL | Hecho | `curves.ts`, `levels.ts`, `hslMixer.ts` y sus editores |
| Nitidez, claridad, ruido, neblina, viñeta, grano, lente | Hecho | Probado a 12 MP: nitidez 740 ms, claridad 700, neblina 1830, **ruido 17,7 s** (Bug 4) |
| Filtros | Parcial | ~60 filtros por CSS + overlay (`filters.ts`). No hay LUT `.cube`/PNG ni control de intensidad comprobado |
| Capas de ajuste / no destructivo | Parcial | Ajustes, filtro, volteo, forma, reflejo y sombra viven en la capa y se editan siempre (bien). Recortar, enderezar, perspectiva, censurar, optimizar, quitar fondo y borrador hornean píxeles y pierden el original (salvo `originalSrc` en quitar fondo). No hay capa de ajuste que afecte a todo lo de debajo |
| Máscaras de capa | Falta | No existe `mask` en `ImageLayer`; el «Borrador» (`MaskEditor.tsx`) borra píxeles. Solo hay `maskShape` (recorte a forma) |
| Selección: varita, lazo, por color, por objeto con IA | Falta | `ToolId` = select/hand/zoom/text/shape/brush/eraser. Nada de selección de píxeles |
| Pincel y borrador | Parcial | Pincel de trazos vectoriales (capa `stroke`). El borrador de `MaskEditor` borra/restaura/«mágico» sobre la imagen |
| Clonar, parche, curar, dodge/burn, desenfoque, dedo, licuar | Falta | Ideas 1.6, 1.12, 1.16 sin hacer. Solo ojos rojos, censurar y suavizar piel por tono |
| Quitar fondo (modelo, bordes, restaurar) | Hecho | `bgcore.ts`: MODNet (Apache-2.0), BiRefNet-lite (MIT), RMBG-1.4 (NC, etiquetado). Selector de bordes y `originalSrc` para restaurar. Modelo en worker. No probado: descarga del modelo |
| Relleno generativo / inpaint | Parcial | `inpaint.ts`: Telea de OpenCV (rellena con lo de alrededor), no generativo. Sirve para manchas pequeñas, no para objetos grandes |
| Optimizar HD ×2 (super-resolución) | Hecho | Swin2SR en worker; reemplaza `src` y pierde `originalSrc`. No probado |
| Texto sobre imagen | Hecho | Rama 2 completa; relleno de texto con imagen |
| Marcos y mockups | Hecho | `maskShape`, `fillFrame`, `mockups.ts` (4 marcos en código) |
| Fusión y capas | Hecho | `blend.ts` (17 modos), opacidad por capa |
| Historial / deshacer | Parcial | 80 pasos (`HISTORY_LIMIT`), popover, saltar a un paso. Guarda documentos enteros con dataURLs: cada recorte añade un PNG nuevo en memoria |
| Atajos | Hecho | `shortcuts.ts` personalizables. Sin atajo para comparar antes/después ni restablecer ajustes |
| Exportar PNG/JPG/WebP | Hecho | Probado a 12 MP: PNG 25 MB en 0,6 s; JPG 3,1 MB en 0,2 s; WebP 3,5 MB en 1,4 s |
| Exportar AVIF | **Roto** | Probado: devuelve un blob `image/png` con extensión `.avif` (Bug 1) |
| SVG / PDF | Hecho | `exportSvg.ts`, `exportPdf.ts`. Código |
| Calidad, peso objetivo, ICO, GIF, APNG, ZIP, marca de agua | Hecho | `exportTargets.ts` (bisección de calidad), `exportPackages.ts` |
| Metadatos | Parcial | `pngMeta.ts` escribe título/autor/copyright; el canvas no copia EXIF ni GPS (bien para privacidad). No hay opción de conservar el EXIF original |
| Color / perfil ICC | Falta | Todo sRGB de canvas; sin Display-P3 ni perfil incrustado (idea 6.24) |
| DPI | Parcial | `exportPrint.ts` convierte px↔mm a 96/300; no se vio que escriba `pHYs`/densidad JFIF en el archivo (código) |
| Transparencia | Hecho | PNG/WebP con alfa; JPG pone fondo blanco |
| Rendimiento con fotos grandes | Parcial | Vista previa a 2048 px (`PREVIEW_MAX`); todo lo demás va en el hilo principal (Bug 4). Sin worker de píxeles ni teselas |
| Accesibilidad / interfaz | Parcial | `useDismiss` y botón de salir en modales (v0.8). Errores de importación sin aviso (Bug 2) |

## 2. Bugs reales

**Bug 1. AVIF exporta un PNG con extensión .avif (silencioso, alto).**
Pasos: abrir un diseño, Descargar, formato AVIF, guardar. Probado con
`renderRasterBlob(doc,'avif',…)` a 12 MP: `blob.type === 'image/png'`, 25 MB.
Causa: Chromium/WebView2 no codifica AVIF en `canvas.toBlob` y cae a PNG. `canvasToBlob` de
`runExport.ts` no compara `blob.type` con el MIME pedido (`batchConvert.ts` línea 63 sí).
El usuario recibe un archivo falso, enorme y que muchos programas no abren.
Arreglo: comparar el tipo y avisar / ocultar AVIF si no hay codificador (detección al arrancar);
codificador AVIF en WASM si se quiere de verdad (L).

**Bug 2. Fallo de importación sin mensaje (alto).**
Pasos: arrastrar o elegir un `.heic`/`.tif`/archivo corrupto con tipo `image/*` en el panel Subir.
`importFiles` (`App.tsx` 931-945) captura el error y solo hace `console.error`: no pasa nada visible.
Desde Inicio (`startFromPhoto`) sí hay toast: comportamiento inconsistente.
Arreglo: toast con el nombre del archivo y el motivo; S.

**Bug 3. Recortar una capa girada da un resultado equivocado (medio, código).**
Pasos: girar una foto 20°, Recortar, Aplicar. `beginCrop` crea un rectángulo alineado con los ejes
con la caja sin girar, y `onApplyCrop` calcula `sx/sy` restando `x/y` sin deshacer la rotación,
y la capa conserva su rotación. Las otras herramientas (`commitCanvas`) sí compensan la rotación.
Arreglo: bloquear Recortar con rotación distinta de 0 (con aviso) o recortar en el marco local; S/M.
No reproducido en pantalla.

**Bug 4. El procesado pesado bloquea la interfaz con fotos grandes (medio).**
Medido en 12 MP (hilo principal, resolución completa, que es lo que corre al exportar o recortar):
reducir ruido 17,7 s; combinado (ruido+neblina+claridad+nitidez+viñeta+grano) 10,9 s; neblina 1,8 s.
En 50 MP, contraste+nitidez 3 s. Sin barra de progreso ni cancelación; en tablet o Android será
bastante peor (no verificado). La vista previa está limitada a 2048 px, así que editar va bien.
Arreglo: mover `processImage` a un worker con `OffscreenCanvas` y «Procesando…»; M.

**Bug 5. Perspectiva reduce la foto en silencio (medio, código).**
`PerspectiveEditor.tsx` línea 158 aplica `limitCanvas(c)` a 4096 px: una foto de 50 MP sale a unos
13 MP sin avisar. Arreglo: avisar o subir el tope según memoria; S.

**Bug 6. Recortar convierte JPEG en PNG y fija los ajustes (medio, código + medición).**
`onApplyCrop` hace `toDataURL('image/png')`: la imagen de 12 MP pasa de 3,7 MB (dataURL JPEG) a
decenas de MB de cadena (el PNG exportado midió 25 MB), que se guarda también en el historial
(80 pasos), el autoguardado y las instantáneas. Los ajustes y el filtro quedan horneados y se
resetean a 0 (`replaceLayerImage`): no se pueden reeditar tras recortar. Es el mayor riesgo para el
uso fotográfico, porque recortar es lo primero que hace cualquiera. Arreglo: recorte no destructivo
(`crop: Rect` en la capa, aplicado al dibujar y exportar); M.

**Observación (no es bug):** una foto de 12000×9000 se ajusta a un lienzo de 8000 px (escala 0,67);
exportar a escala 1 da 8000 px. Ya avisa.

## 3. Lo que falta, priorizado

Esfuerzo S/M/L. Valor alto/medio/bajo. Modelo: **opus** si el fallo es silencioso o toca datos o IA con
licencia; **sonnet** si se comprueba en pantalla; **haiku** si es mecánico.

| # | Qué | Esf. | Valor | Modelo / esfuerzo | Motivo |
|---|---|---|---|---|---|
| 1 | Arreglar AVIF (detectar y avisar; ocultar si no hay) | S | Alto | sonnet, medio | Se comprueba con un export; arreglo acotado |
| 2 | Aviso de error al importar (HEIC, corrupto) | S | Alto | haiku, bajo | Mecánico |
| 3 | Recorte no destructivo con soporte de rotación | M | Alto | opus, alto | Cambia el modelo de datos (`ImageLayer`, migración de proyectos, export, SVG, PDF); un error corrompe diseños |
| 4 | Procesado en worker con progreso y cancelación | M | Alto | opus, alto | Debe dar píxeles idénticos al editor y al export; la divergencia es silenciosa |
| 5 | Máscaras de capa no destructivas (pincel + degradado) | L | Alto | opus, alto | Datos nuevos, export, historial, migración |
| 6 | Importar HEIC (y TIFF) | M | Alto | opus, alto | Decodificador WASM: licencias (libheif es LGPL) y peso del instalador |
| 7 | Selección: varita, lazo, por color | L | Alto | sonnet, alto | Se ve en pantalla; depende de las máscaras (5) |
| 8 | Clonar / curar / dodge-burn / desenfoque-dedo | L | Alto | sonnet, alto | Se comprueba a ojo; necesita capa de píxeles |
| 9 | Capas de ajuste (afectan a lo de abajo) | L | Medio | opus, alto | Cambia el orden de render y el export |
| 10 | Tamaño de imagen con remuestreo (Lanczos) y lienzo anclado | M | Medio | sonnet, medio | Se comprueba con una medida |
| 11 | LUT (.cube/PNG) con intensidad | M | Medio | sonnet, medio | Se ve en pantalla; cuidar licencias de los LUT incluidos |
| 12 | Selección por objeto con IA (SAM ligero) | L | Medio | opus, alto | Modelo con licencia y descarga |
| 13 | Relleno generativo real (difusión local) | L | Medio | opus, alto | Cientos de MB, licencias, memoria en Android |
| 14 | DPI escrito en JPG/PNG (`pHYs`, JFIF) + sRGB | S | Medio | sonnet, medio | Se comprueba leyendo el archivo |
| 15 | Conservar EXIF original (opcional) | S | Bajo | opus, medio | Toca datos personales (GPS): debe ser opt-in |
| 16 | Display-P3 / ICC de salida | M | Bajo | opus, alto | Un color incorrecto es silencioso |
| 17 | Atajo y botón para restablecer ajustes y comparar | S | Bajo | haiku, bajo | Mecánico |
| 18 | Aviso de memoria al importar fotos enormes (Android) | S | Medio | sonnet, medio | Hace falta probar en dispositivo |

## 4. Top 10 para la próxima versión

1. Arreglar la exportación AVIF (Bug 1).
2. Mensaje de error al importar archivos ilegibles (Bug 2).
3. Recorte no destructivo, también con capas giradas (Bugs 3 y 6).
4. Procesado de píxeles en worker con progreso (Bug 4).
5. Aviso o tope mayor en perspectiva (Bug 5).
6. Máscaras de capa no destructivas.
7. Importar HEIC.
8. Varita mágica y lazo (con las máscaras).
9. Clonar y curar.
10. Redimensionar imagen con remuestreo y DPI escrito en el archivo.

## 5. NO verificado

- Android/tablet (memoria, tiempos, gestos), app Tauri instalada y WebView2: solo se probó Chromium de escritorio.
- Descarga y uso real de los modelos (MODNet, BiRefNet-lite, Swin2SR): solo código.
- Bug 3 (recorte con rotación) y Bug 5 (límite 4096): solo por lectura de código.
- Exportación SVG/PDF con imágenes grandes, DPI en el archivo, atajos en pantalla, interfaz visual del flujo.
- Tiempos con imágenes sintéticas ruidosas en una sola máquina; un JPEG real puede variar.
- La prueba corrió en un servidor Vite que no era solo mío (puerto 1447) mientras otros agentes editaban `src/ui`; `imageProcessing` y `export` no dependen de esos cambios.
