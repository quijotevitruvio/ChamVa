# Modelo de proyecto de video v2 (`src/video/model`)

Datos puros (sin React ni DOM). Todo se importa de `src/video/model` (`index.ts`).

## Forma
- `VideoProject { v: 2, media, tracks, eq, normalize, legacy? }`
- `media[id]`: `{ kind: video|audio|image, name, duration, blob?, thumb?, missing? }`. Un archivo = un medio,
  aunque lo usen varios clips. `url` solo vive en memoria (nunca se guarda).
- `Track { kind: video|audio, muted, locked, hidden, magnet, clips }`. **Capas: entre pistas de video, la que
  va antes en `tracks` se ve encima.** `hidden` quita la imagen (sigue sonando); `muted` quita el sonido.
- `Clip { kind: video|audio|image|text, mediaId?, start, inP, outP, speed, volume, effect, voice?, fadeIn,
  fadeOut, audioFadeIn, audioFadeOut, transform{x,y,scale,rotation,opacity}, size?, text?, color?, toEnd? }`.
  Video/audio: `inP..outP` = recorte del archivo. Imagen/texto: `inP = 0`, `outP` = duración en pantalla.

## Invariantes (las impone `normalizeTrack` tras cada operación)
- Clips de una pista ordenados por `start`, ≥ 0 y **sin solaparse**: lo que choca se empuja a la derecha, nunca se borra.
- Pista con `magnet`: secuencia desde 0 sin huecos, en el orden del array (como V1).
- `toEnd` (imagen/texto «hasta el final») solo en el último clip de su pista.
- Duración del proyecto (`projectDuration`) = fin del último clip **visual** (sin `toEnd`); el audio que sobresale se corta.
- Activo en t ⇔ `start ≤ t < fin` (exclusivo). Audio de video en pista no audible: no suena.

## Consultas (`query.ts`)
`clipDuration`, `clipEnd`, `projectDuration`, `clipsAt(p, t) → { visual (de abajo arriba), audible }`,
`sourceTimeAt(clip, t)`, `clipFadeAlpha`, `findClip`, `findTrack`, `videoTracksBottomUp`, `fitsTrack`.

## Operaciones (`ops.ts`) — devuelven un proyecto NUEVO, o el MISMO objeto si no aplican (pista bloqueada, id inexistente…)
`createProject`, `addTrack(p, kind, {id, index, magnet})`, `removeTrack`, `moveTrack` (orden de capas), `updateTrack`
(muted/locked/hidden/magnet/name; permitido aunque esté bloqueada), `addMedia`, `updateMedia`, `pruneMedia`,
`makeClip(kind, campos)`, `addClip(p, trackId, clip, {mode: 'push'|'insert'|'reject'})`, `appendClip`,
`updateClip(p, id, parche)` (números inválidos se ignoran), `moveClip(p, id, {start, trackId}, {mode})`,
`moveClipToIndex` (imán), `splitClip(p, id, t, nuevoId)`, `trimClip(p, id, 'in'|'out', t, {ripple})`,
`removeClip(p, id, {ripple})`, `duplicateClip`, `closeGaps`, `snapTime` / `snapClipStart` (imán de bordes: 0, cabezal y bordes de clips).

```ts
let p = VM.addTrack(VM.createProject(), 'video', { id: 'V', magnet: true });
p = VM.addMedia(p, { id: 'm', kind: 'video', name: 'a.mp4', duration: 10, blob });
p = VM.appendClip(p, 'V', VM.makeClip('video', { mediaId: 'm', outP: 10 }));
p = VM.addTrack(p, 'video', { id: 'PIP', index: 0 });               // encima de V
p = VM.addClip(p, 'PIP', VM.makeClip('video', { mediaId: 'm', start: 2, outP: 3,
  transform: { x: 0.75, y: 0.25, scale: 0.4, rotation: 0, opacity: 1 } }));
const s = VM.snapClipStart(p, clipId, propuesto, { threshold: 0.1, playhead });
```

## Deshacer (`history.ts`)
`createHistory(p)`, `commit(h, next, { group })` (mismo `group` seguido < 1 s = un paso: arrastres, deslizadores),
`endGroup` (al soltar), `undo`, `redo`, `canUndo`, `canRedo`, `replacePresent` (sin paso), `mapHistory`
(p. ej. miniaturas en todas las instantáneas). Límite 100 pasos; se guardan 30 (`saveUndo`/`loadUndo`, clave
`videoProject.undo`, solo se recuperan si la huella del presente coincide).

## Guardado y migración (`storage.ts`, `migrate.ts`)
- `new VideoProjectStore(io).load()` lee `videoProject`; un V1 se migra **en memoria** (`migrateVideoProject`,
  idempotente, no muta, Blobs por referencia, ids deterministas, lo inservible va a `legacy`).
- `save(p)` la 1.ª vez copia el V1 tal cual a `videoProject.v1-backup` (si falla, no pisa nada), escribe el v2,
  lo relee y solo entonces retira la copia. Nunca pisa una versión futura (`writable === false`).
- El motor lo exporta con `renderProject(p, opts)` (`src/video/engine/render.ts`); el banco compara contra
  el motor V1 congelado (`src/video/bench/v1Engine.ts`).

## V4: texto con estilo, animaciones y subtítulos (campos aditivos: el formato sigue siendo `v: 2`, sin migración)
- `Clip.tstyle?: TitleStyle` (texto con estilo propio: fuente, tamaño, color, contorno, sombra, caja, alineación,
  mayúsculas, espaciado; px en un lienzo de 1080 px de lado corto). Sin `tstyle` el texto se dibuja como en V1 (Arial
  negrita, `size`, `color`): los proyectos de antes salen idénticos. `Clip.anim?: TitleAnim` (entrada, salida, por
  palabra o letra, énfasis continuo, karaoke) y `Clip.words?: WordTime[]` (tiempos por palabra para el karaoke).
- Pistas `kind: 'subtitle'` con clips `kind: 'subtitle'` (`start`, duración = `outP`, `text`); estilo global en
  `Track.subStyle` (posición, margen, máx. de líneas, karaoke, fundido y un `TitleStyle`). No cuentan para
  `projectDuration`; `clipsAt` los pone encima de todo; `hidden` = no se incrustan al exportar.
- `normalizeV2` lee y sanea todo lo nuevo (idempotente); un clip que no encaja con su pista va a `legacy.orphanClips`.
- Lógica pura en `src/video/title/`: `anim.ts` (entrada/salida/énfasis en t), `karaoke.ts`, `wrap.ts` (salto por ancho,
  equilibrado, máx. de líneas), `srt.ts` (SRT/VTT/TXT: leer, escribir, solapes, ANSI/UTF-16), `subtitles.ts` (añadir,
  dividir, unir, desplazar, ajustar a escenas, estilo), `presets.ts` (43 estilos de título, 10 pares, 8 de subtítulo).
- Dibujo: `src/video/engine/titleDraw.ts` (reutiliza `drawStyledText` del editor de diseño). `composeFrame` lo llama,
  así que la exportación y la vista previa dibujan lo mismo.

## V6: transiciones, efectos, fusión, capas de ajuste y fotogramas clave (campos aditivos: el formato sigue siendo `v: 2`)
- Campos opcionales de `Clip`: `tin`/`tout` (transición de entrada/salida), `fx` (pila de efectos), `blend` (fusión),
  `keys` (fotogramas clave) y el tipo `adjust` (capa de ajuste: clip de una pista de video, dura como una imagen; sus
  efectos afectan a todo lo que hay debajo). `normalizeV2` los lee con `fx/sanitize.ts` (idempotente; datos corruptos se
  limpian; un proyecto sin ellos se lee igual que antes y no gana ningún campo).
- **Transiciones (semántica del solape).** No se solapa nada: el modelo sigue sin permitir clips solapados. En la UNIÓN de
  dos clips contiguos de una pista (|fin(A) − inicio(B)| ≤ 0,02 s) la transición es `B.tin ?? A.tout` y se CENTRA en el corte:
  ventana [corte − d/2, corte + d/2] con d = min(dur, dur(A), dur(B)) (0,1–3 s), así las ventanas de un clip nunca se pisan.
  Durante la ventana se ven A y B a la vez: `clipsAt` devuelve el que no está activo con `ext: true` y usa los MÁRGENES DE
  RECORTE del archivo (A sigue más allá de su salida y B empieza antes de su entrada, hasta los límites del archivo; sin margen
  se queda en el último/primer fotograma: `extendedSourceTime`). Imágenes, textos y capas de ajuste no necesitan margen.
  Sin vecino contiguo, `tin` es una entrada [inicio, inicio + d] y `tout` una salida [fin − d, fin] sobre lo que haya debajo.
  Si los clips dejan de ser contiguos la transición no se pierde: pasa a ser de entrada/salida. La duración del proyecto y el
  audio no cambian (no hay fundido cruzado de audio en la unión). Dividir un clip: la 1.ª mitad conserva `tin`, la 2.ª `tout`.
- **Pila de efectos** (`fx/effects.ts`, 27 tipos en Color, Imagen, Forma y Croma + 24 preajustes de color): se aplican en el orden del
  array sobre los píxeles ya dibujados del clip; `amount` (0..1) escala los parámetros numéricos (neutro 0); apagado o
  intensidad 0 = se salta. Cálculo en CPU sobre ImageData (reutiliza `src/editor/core`: color, curvas, nitidez, pixelado,
  aberración, glitch, desenfoque de movimiento) con tablas por canal que se fusionan (varios seguidos = una pasada); las máscaras,
  el borde y la sombra usan operaciones de lienzo. Sin GPU: la ruta base es la única. `blend`: `globalCompositeOperation`.
- **Fotogramas clave**: `Clip.keys[prop]` = lista ordenada de `{t, v, e, bz}` con `t` en segundos desde el inicio del clip;
  propiedades `x y scale rotation opacity volume` y `fx.<id>.<parámetro|amount>`. Antes del primero y después del último
  vale el extremo; entre dos, la interpolación del primero (lineal, suave, mantener, bézier). Al recortar el inicio los
  fotogramas se quedan en su instante de la línea de tiempo; al dividir se reparten con un fotograma en el corte. El volumen
  animado va como envolvente (`MixEntry.gain`) antes de la cadena del clip en la exportación.
- Lógica pura en `src/video/fx/`: `ease.ts`, `keyframes.ts`, `transitions.ts`, `effects.ts`, `sanitize.ts`, `clipOps.ts`
  (operaciones de proyecto, una llamada = un paso de deshacer), `pixel.ts`, `fxDraw.ts`, `transitionDraw.ts`, `thumbs.ts`
  (miniaturas con el mismo motor, en caché). `composeFrame` es la única composición (exportación, vista previa y miniaturas).
  Banco: `/dev/fx-bench.html` (`window.__fx`: transitions, effects, fxTimes, perf, export, exportFx, previewVsExport).


## V8: velocidad avanzada, invertir, bucle y reencuadre (campos aditivos: el formato sigue siendo `v: 2`)
- Campos opcionales de `Clip` (solo video/audio salvo `freeze` y `reframe`, solo video): `curve` (curva de velocidad),
  `reverse`, `pitch` (conservar el tono), `freeze` (congelar fotograma: duración en s), `loop` (`{ n | dur, xf }`) y `reframe`
  (marco de recorte). `xlayer` es SOLO en memoria (la copia del clip que dibuja la pasada saliente de un fundido cruzado).
  `normalizeV2` los lee con `speed/curve.ts`, `speed/clipTime.ts` y `reframe/math.ts` (idempotente; un clip sin ellos no gana campos).
- **Una sola fuente de verdad del tiempo** (`speed/clipTime.ts`): `clipDuration`, `sourceTimeAt`, `extendedSourceTime` (márgenes de
  transición), la exportación, la vista previa y el audio usan las mismas funciones (`passDuration`, `layersAt`, `sourceAtLocal`,
  `rateAt`). Sin curva/invertir/congelar/bucle son las expresiones de V1 (bit a bit).
- **Curva de velocidad** (`speed/curve.ts`): puntos `{ s, v }` con `s` = instante del ARCHIVO (la velocidad queda pegada al contenido: al
  recortar o dividir no se mueve) y `v` en 0,1×–100×. Entre puntos, interpolación logarítmica (`va·(vb/va)^x`; con `smooth`, x = smoothstep).
  El tiempo de salida es ∫ ds/v: forma cerrada en tramos lineales y Simpson de 64 paneles en los suaves; la inversa (salida → archivo) es
  exacta (cerrada) o por bisección. Velocidad constante = `speed` (0,1×–100× en la interfaz); `curve` prevalece sobre `speed`.
- **Invertir**: el origen va de `outP` a `inP`. La curva va con el contenido (la velocidad de un fotograma es la misma al derecho y al revés).
  Imagen: `engine/reverse.ts` (decodifica por GOP y conserva una ventana de K fotogramas, K según el tamaño; se vuelve a decodificar el GOP
  para la ventana siguiente). Audio: `engine/timeAudio.ts` (`ReverseAudioSource`, bloques de 2 s). Límites: aviso a 5 min, tope 1 h.
- **Congelar fotograma**: `freeze` s sobre el fotograma `inP`, sin sonido; `freezeFrame` divide el clip y mete el congelado entre las dos mitades.
- **Bucle**: `n` pasadas o hasta `dur`, `xf` s de fundido cruzado entre pasadas (la duración es `(n−1)·(B−xf)+B`). Un bucle no se divide ni se
  recorta por delante. El fundido dibuja DOS capas del mismo clip (`xlayer`), cada una con su propio decodificador.
- **Audio** (`engine/timeAudio.ts`): el mezclador ve un clip normal en tiempo local (inP 0, velocidad 1) y `ClipTimeSource` traduce con el mismo
  mapa de tiempo; con `pitch`, estiramiento WSOLA sobre el audio a ritmo natural (no con invertido).
- **Reencuadre** (`reframe/`): `reframe` guarda el marco (proporción, centro, zoom, marcos `track` en s del clip) y se DERIVA la transformación
  x/y/escala y sus fotogramas clave (`applyReframe`); `composeFrame` no sabe nada del reencuadre, así que la vista previa y la exportación
  son iguales. Seguimiento propio (`reframe/tracker.ts`, plantilla ZNCC adaptativa, sin OpenCV: no trae clasificadores de caras y el editor
  es offline) y suavizado (`framesFromTrack`: mediana, zona muerta de «operador», gaussiana sin retardo, Douglas–Peucker). Banco: `/dev/speed-bench.html`.

## V7: audio de verdad (campos aditivos: el formato sigue siendo `v: 2`, sin migración)
- Campos opcionales: `Clip.pan` (−1..1, potencia constante), `gainDb`, `eq` (`EqBand[]`), `denoise` (0..1); `Track.gainDb`, `pan`, `solo`, `eq`,
  `duck` (`DuckSpec`); `MediaAsset.beats` (`BeatInfo`: pulsos en s del ARCHIVO); `VideoProject.audio` (`ProjectAudio`: `eq` maestro, `loud {on, target LUFS}`,
  `xfade` s, `beatSnap`, `showBeats`). `normalizeV2` los lee con `audio/sanitize.ts` (idempotente; un valor neutro no añade campo: un proyecto sin ajustes
  de audio se lee y se guarda igual que en V6). Operaciones en `audio/mixOps.ts` (`setClipAudio`, `setTrackMix`, `setProjectAudio`, `setMediaBeats`): una llamada = un paso.
- **Una sola mezcla.** `engine/audioPlan.ts` (puro) decide qué suena (silencio y solo, TAMBIÉN al exportar), resuelve las pistas de control del ducking (una pista con
  ducking nunca es control de otra) y calcula los fundidos cruzados; `TimelineMixer` suma cada clip en el bus de su pista, cada pista pasa por `TrackChain`
  (EQ → dB → toma de control → ducking → panorámica) y la maestra por `MasterChain` (EQ de 3 bandas → EQ paramétrico → compresor → ganancia de sonoridad → limitador de
  pico real, techo −1,3 dBTP: −1 dBTP más 0,3 dB para el error del medidor y los códecs con pérdida). La vista previa en vivo usa los MISMOS `ClipChain/TrackChain/MasterChain`
  en AudioWorklets (`dsp.worklet.ts` → `liveDsp.ts`): cada pista es un nodo con 2 entradas (clips, control) y 2 salidas (pista, toma); el banco `/dev/audio-bench.html` mide
  cociente RMS 1,0000 y diferencia máxima 1e-7 entre la vista previa en vivo y la exportación.
- **Sonoridad** (`audio/loudness.ts`): BS.1770-4 (K-weighting, bloques de 400 ms con solape del 75 %, puertas −70 LUFS y −10 LU), momentánea, a corto plazo, integrada y pico real (×4).
  `engine/loudnessPass.ts` normaliza en varias pasadas medidas con el mismo mezclador (la ganancia va ANTES del limitador; el limitador baja algo la sonoridad y se corrige con la secante).
  La interfaz repite la medida en segundo plano tras cada cambio (`ui/video/loudness.ts`) y manda la ganancia a la vista previa.
- **Latencia.** El limitador de pico real tiene `latency` muestras (134): el mezclador mezcla ese tanto por delante y descarta el arranque, así la exportación sale alineada;
  la vista previa las deja (≈ 2,8 ms). El reductor de ruido retrasa el clip `SpectralDenoiser.LATENCY` (1024 muestras, 21 ms) tanto en la exportación como en vivo.
- **Reducción de ruido** (`audio/denoise.ts`): sustracción espectral propia, sin dependencias (STFT de 1024, mínimos por bin, regla de Wiener atenuada). RNNoise (BSD-3,
  COPYING de xiph/rnnoise verificado) NO se integra: sus puertos wasm de npm (`@jitsi/rnnoise-wasm` sin campo de licencia; `@shiguredo/rnnoise-wasm` Apache-2.0) añadirían una
  dependencia nueva y un wasm dentro del AudioWorklet cuya paridad exportación/vista previa no está probada.
- **Ritmo** (`audio/beats.ts`, `engine/beatAnalysis.ts`): flujo espectral + autocorrelación + programación dinámica; las marcas salen en la regla y, con `audio.beatSnap`, entran en `snapTime` (objetivo `'beat'`).
- **Exportar solo audio** (`engine/audioExport.ts`): WAV 16/24 bits (dither TPDF), OGG/Opus (`AudioEncoder` + contenedor Ogg propio, `ogg.ts`) y M4A/AAC (`AudioEncoder` + mp4-muxer);
  si el equipo no codifica Opus/AAC se degrada con aviso. MP3 no se ofrece: no hay codificador JS con licencia permisiva verificada (lamejs es LGPL).

## V9a: quitar fondo por fotograma y estabilización (campos aditivos: el formato sigue siendo `v: 2`, sin migración)
- Dos efectos «de origen» en la pila normal `Clip.fx` (solo clips de video): `bgremove` y `stabilize` (`fx/effects.ts`, `AI_FX_DEFS`,
  categoría `IA`, fuera de `FX_CATEGORIES` hasta que llegue su interfaz). `sanitizeFxList` los lee como cualquier efecto (idempotente);
  un proyecto sin ellos no cambia. Parámetros: `bgremove { mode quality|fast, bg transparent|color|image|blur, color, bgMedia, feather (px a
  720), choke −0,5..0,5, smooth 0..1 (coherencia temporal), blur }`; `stabilize { smooth s (0,1–3), maxZoom 1–1,5, rotation on|off }`.
  Admiten fotogramas clave (`fx.<id>.<parámetro>`).
- **No pasan por la pila de píxeles**: `composeFrame` los aplica al FOTOGRAMA DEL ARCHIVO antes de la transformación del clip
  (`ai/aiFrame.ts`, `processAiFrame`): estabilizar (traslación + giro + zoom de recorte) y luego la máscara (`destination-in`) y el fondo
  (`destination-over`) con la MISMA transformación. Así exportación, vista previa y miniaturas dan lo mismo (diferencia medida 0).
- **Cachés en memoria por sesión** (`ai/cache.ts`): máscaras por `matteKey(medio, modo)` y fotograma del archivo (n = round(t·30));
  movimiento por `stabKey(medio)`. La composición SOLO lee: sin cálculo se ve el original, `aiNoticesAt(p, t)` lo dice en la vista previa y
  `renderProject` avisa con `aiCoverageNotices` (porcentaje calculado por clip). Calcular otra vez solo hace lo que falta. Tope 768 MB.
- Cálculo (`ai/analyze.ts`): `computeMatte(p, clipId, { engine, mode, range, signal, onProgress })` (MODNet en `ai/matte.worker.ts`, red
  cortada) y `computeStabilization(p, clipId, …)`; progreso con ETA (media móvil), cancelación y estimación previa (`estimateClipMatte`,
  `estimateStab`). Lógica pura con pruebas: `ai/matteMath.ts` (resolución por modo, suavizado temporal bilateral, mediana 3×3, borde, IoU,
  parpadeo), `ai/stabMath.ts` (movimiento, trayectoria, gaussiana con reflexión impar, correcciones y zoom). Banco: `/dev/ai-bench.html`.
