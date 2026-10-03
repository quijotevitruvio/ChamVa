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
