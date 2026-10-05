# Plan de video: de editor básico a rival de CapCut

Fecha: 2026-10-03 · Estado: **solo plan**, sin código. Fuente: lectura de `src/ui/VideoEditor.tsx`,
`src/io/videoRender.ts`, `src/io/ffmpegConvert.ts`, `src/io/exportAnim.ts`, `docs/ideas.md` (rama 5),
`docs/estado-ideas.md` y una prueba real en el navegador (Chromium, `vite --port 1431`).

---

## 1. Auditoría: qué hay de verdad hoy

### 1.1 Piezas

| Pieza | Archivo | Qué hace |
|---|---|---|
| Editor de video | `src/ui/VideoEditor.tsx` (1594 líneas, un solo componente) | Pantalla completa aparte del diseño («Editar video» en Inicio). Estado local de React, **sin deshacer/rehacer**, sin pasar por el store de zustand. |
| Render MP4 | `src/io/videoRender.ts` | WebCodecs (`VideoEncoder` H.264 + `AudioEncoder` AAC) + `mp4-muxer`, fotograma a fotograma con *seek* en un `<video>`; audio con `OfflineAudioContext`. |
| Ruta antigua | `VideoEditor.tsx` → `recordWebM` | `canvas.captureStream` + `MediaRecorder` en **tiempo real** (WebM VP9). Si no hay WebCodecs, convierte a MP4 con ffmpeg.wasm. |
| ffmpeg.wasm | `src/io/ffmpegConvert.ts` | Núcleo 0.12.10 de un hilo, **descargado de unpkg** la primera vez (~30 MB) y guardado en Cache Storage. Build con libx264 (**GPL**). |
| Animación de diseño | `src/io/exportAnim.ts` + `App.tsx` | «MP4 (animación)» = Doc → **GIF 600 px / 256 colores** → ffmpeg.wasm → MP4. Pierde calidad y necesita internet la primera vez. |
| Motor de diseño con tiempo | `renderDocToCanvas(doc, scale, bg, t, total)` en `src/io/export.ts` | Ya pinta cualquier página en el instante `t`. **Es la palanca más valiosa** para el video (texto por palabra, fuentes, efectos, animaciones). |

### 1.2 Capacidades reales

- **Pistas:** 1 de video (clips en secuencia, sin huecos) + 1 de audio (en secuencia desde 0) +
  capas de texto o imagen con inicio y fin numéricos. No es multipista.
- **Por clip:** recorte de entrada y salida (asas en la línea de tiempo), dividir (`S`), reordenar
  arrastrando, velocidad, fundido de entrada y salida a negro, volumen, «Voz» (filtros paso alto/bajo,
  eco y compuerta de ruido).
- **Global:** ecualizador de 3 bandas; «Normalizar» es un **compresor**, no LUFS.
- **Otros:** grabar micrófono, forma de onda en los clips de audio, zoom de la línea de tiempo,
  atajos (espacio, ←/→ por fotograma, `S`, `Supr`), proyecto guardado en IndexedDB (clave única
  `videoProject`, con los Blobs dentro).
- **Exportación:** solo **16:9** (720p o 1080p), 24/30/60 fps, WebM o MP4. No hay 9:16, 1:1, 4:5 ni 4K.

### 1.3 Prueba real (2026-10-03, Chromium de escritorio)

Dos clips WebM de 3 s (640×360, VP8 + Opus con tono de 440 Hz) generados en la página, subidos al
editor, más una capa de texto, exportados a MP4 720p30:

| Medida | Resultado |
|---|---|
| Archivo | `chamva-video.mp4`, 585 KB, 1280×720, 5,9 s: **funciona** |
| Tiempo | 9,8 s para 5,9 s de video (**≈0,6× tiempo real** a 720p; a 1080p60 será varias veces peor) |
| Colores | Correctos en cada clip (rojo y azul) |
| Primer fotograma | **Negro** en t=0,1 s (fallo: se dibuja antes de que el `<video>` tenga el fotograma) |
| Audio | Presente, 5,89 s, pico **1,00** → sin limitador, riesgo de saturación |
| Persistencia | Tras recargar la página, el proyecto se recuperó de IndexedDB |

Nota: durante la prueba otra sesión editaba `src/` (recargas por HMR) y usaba el puerto 1429.

### 1.4 Fallos y límites encontrados en el código

1. **Seek por fotograma:** cada fotograma hace `currentTime = t` y espera `seeked`; es lento y en
   videos de fotogramas variables (móviles) puede repetir o saltar fotogramas.
2. **Memoria:** `renderAudio` hace `fetch(url).arrayBuffer()` del **archivo de video completo** y lo
   decodifica entero por cada clip (un clip dividido en 3 se decodifica 3 veces). El MP4 de salida
   se arma **entero en RAM** (`ArrayBufferTarget`). Con 1 GB de entrada en Android, se cae.
3. **Lo que se ve no es lo que sale:** el texto usa `Arial` en negrita; la ruta WebM usa el tamaño en px
   tal cual y la MP4 lo escala por `h/720` → a 1080p el texto sale de distinto tamaño según la ruta.
   La compuerta de ruido («Reducir ruido») solo actúa en la vista previa, **no en el MP4**.
4. **Vista previa:** un único `<video>` al que se le cambia el `src` en cada corte → parpadeo y salto
   en las uniones; la pista de audio no se sincroniza con el cabezal al buscar.
5. **ffmpeg.wasm:** rompe la promesa offline (descarga desde unpkg), es GPL (x264) y de un hilo
   (lentísimo para 1080p). Solo se usa si no hay WebCodecs (Linux WebKitGTK, WebViews viejos).
6. **IndexedDB:** todos los Blobs en una sola clave; videos grandes = cuota llena y escritura de
   cientos de MB cada 2 s de inactividad.
7. **Sin pruebas:** no hay test de `videoRender.ts` ni de la línea de tiempo. Nunca se probó con MP4
   H.264 de móvil, HEVC de iPhone, fotogramas variables, videos largos ni Android.

### 1.5 Plataformas (lo que hay que comprobar, no está probado)

| Plataforma | WebView | WebCodecs | Ruta MP4 hoy |
|---|---|---|---|
| Windows | WebView2 (Chromium) | Sí | WebCodecs (la probada arriba) |
| Android | System WebView (Chromium) | Sí, codificador H.264 depende del hardware | WebCodecs, **sin probar**; memoria justa |
| macOS | WKWebView | `VideoEncoder` sí (Safari ≥16.4); `AudioEncoder` y AAC por verificar | Por verificar |
| Linux | WebKitGTK | No o parcial | MediaRecorder + ffmpeg.wasm (internet la 1.ª vez) |
| Web | Navegador | Chromium sí; Firefox parcial; Safari por verificar | Mixta |

---

## 2. Comparación con CapCut

Leyenda: **Existe** · **Parcial** · **Falta** · **Imposible offline** (o no razonable).

| Área | CapCut | ChamVa hoy | Clase |
|---|---|---|---|
| Línea de tiempo multipista | Pistas ilimitadas, imán, PiP | 1 video + 1 audio + capas | Parcial |
| Recortar / dividir | Sí | Sí | Existe |
| Velocidad constante | Sí | Sí | Existe |
| Curvas de velocidad | Sí | No | Falta |
| Invertir clip | Sí | No | Falta (caro en memoria; mejor en nativo) |
| Congelar fotograma | Sí | No | Falta |
| Transiciones | Cientos | Solo fundido a negro | Falta |
| Efectos y filtros de video | Cientos + LUT | Ninguno visual | Falta (el motor de ajustes de imagen ya existe) |
| Texto animado | Plantillas | Texto plano Arial | Parcial; **el diseño ya tiene texto por palabra y animaciones** |
| Subtítulos manuales / SRT | Sí | No | Falta |
| Subtítulos automáticos | Nube, muy buenos | No | Falta → **posible offline con Whisper (MIT)** |
| Quitar fondo de video | Sí (nube y local) | Solo imagen | Falta (lento offline, posible) |
| Chroma key | Sí | No | Falta (fácil, shader) |
| Estabilización | Sí | No | Falta (OpenCV.js ya está en dependencias) |
| Keyframes | Sí | No | Falta |
| Ducking | Sí | No | Falta |
| Normalizar | Sí | Compresor | Parcial |
| Quitar ruido | Sí (IA) | Filtros + compuerta | Parcial (RNNoise, BSD) |
| Quitar voz / aislar | Sí | No | Falta (modelos pesados; licencia por revisar) |
| Plantillas de video | Miles, en la nube | No | Falta; biblioteca grande = **imposible offline** |
| Música y efectos con licencia | Enorme | No | **Imposible igualar**; solo un paquete CC0 pequeño |
| 9:16 / 1:1 / 4:5 | Sí | Solo 16:9 | Falta |
| 1080p / 4K / 60 fps | Sí | 1080p60 | Parcial |
| Atajos | Completos | Básicos | Parcial |
| Vista previa fluida | Nativa, GPU | Un `<video>`, salta en cortes | Falta |
| Rendimiento de exportación | Nativo, hardware | 0,6× tiempo real a 720p | Falta (mejorable mucho) |
| Sincronización y nube | Sí | No | Fuera de alcance (a propósito) |

### Dónde NO se le gana a CapCut (ser honestos)

- **Rendimiento bruto** en móvil y en 4K: CapCut usa decodificadores nativos y GPU con años de
  ajuste. Una app web/Tauri puede acercarse en escritorio con WebCodecs o sidecar, no superarlo.
- **Contenido en la nube:** plantillas de moda, música con licencia, efectos que cambian cada semana.
- **IA en la nube:** subtítulos, voces, avatares y efectos de IA pesados son mejores en sus servidores.

### Dónde SÍ se le gana

- **Offline de verdad y privado:** nada sale del equipo (CapCut sube contenido y cambió sus términos).
- **Sin marca de agua, sin cuenta, sin muro de pago** en exportar 4K o quitar fondo.
- **IA local gratis:** Whisper para subtítulos, segmentación para quitar fondo, RNNoise para ruido.
- **Diseño gráfico integrado:** cada título puede ser una página de ChamVa (fuentes, texto por
  palabra, efectos de texto, kit de marca, paleta). CapCut no tiene un editor de diseño de verdad.
- **Proyecto abierto** y portable (`.chamva`), sin bloqueo de proveedor; código MIT.

---

## 3. Plan por tramos

Cada tramo es publicable por sí solo. Regla de modelos: **opus, esfuerzo alto** donde el fallo es
silencioso (motor de exportación, formato de proyecto, migración de datos, licencias, sidecar);
**sonnet, esfuerzo medio** lo que se ve en pantalla o tiene prueba numérica; **haiku** lo mecánico.

### Banco de pruebas común (se construye en V1 y lo usan todos)

Clips generados por código, nunca descargados: barras de color con el número de fotograma pintado,
tono de 1 kHz con un «bip» y un destello blanco en el mismo instante (para medir sincronía), en
variantes: MP4 H.264 30 fps, WebM VP8/Opus, **fotogramas variables**, sin audio, vertical 1080×1920,
1080p60 y uno largo de 10 min. Comprobaciones automáticas sobre el archivo exportado: duración ±1
fotograma, color en puntos de muestra por fotograma, desfase bip–destello < 1 fotograma, pico de audio
≤ −1 dBFS, sin fotogramas negros no esperados. La lógica pura (línea de tiempo, tiempos, SRT, LUFS)
va en Vitest; la parte con WebCodecs, en una página de pruebas solo de desarrollo que se ejecuta en
el navegador (y en la app Tauri de Windows y Android antes de publicar).

### V1 · Motor de exportación fiable — **opus, esfuerzo alto**

- **Objetivo:** que exportar no falle en silencio ni se coma la memoria, y sea rápido.
- **Qué:** sacar el render a `src/video/engine/` (modelo puro «línea de tiempo → fotograma en t»,
  compartido luego con la vista previa); decodificar con `VideoDecoder` + desmultiplexor (mp4box.js,
  BSD-3, o equivalente) en vez de *seek*; audio decodificado por trozos; salida **en streaming** a disco
  (escritura por trozos con Tauri fs / File System Access, `StreamTarget` de mp4-muxer); limitador a
  −1 dBFS; formatos 16:9, 9:16, 1:1, 4:5 y 4K; cancelar; arreglar primer fotograma negro, tamaño de
  texto y compuerta de ruido en la exportación. Reemplazar «MP4 (animación)» del diseño por
  `renderDocToCanvas` + WebCodecs (fuera el GIF intermedio). ffmpeg.wasm queda solo como último
  recurso y **empaquetado localmente**, no desde unpkg (o se elimina: decisión 3).
- **Archivos:** `src/io/videoRender.ts` → `src/video/engine/*`, `src/io/ffmpegConvert.ts`,
  `src/io/exportAnim.ts`, `App.tsx` (ruta anim-mp4), llamadas en `VideoEditor.tsx`.
- **Depende de:** nada. **Va primero.**
- **Prueba:** banco completo en Chromium, WebView2 (Windows) y Android; 10 min a 1080p sin pasar de
  ~500 MB de RAM; meta ≥ 2× tiempo real a 1080p30 en escritorio.
- **Riesgos:** códecs H.264 no disponibles en algún Android (caer a otro perfil o a VP9/WebM y
  avisar); macOS sin `AudioEncoder` AAC (Opus en WebM o AAC por sidecar); fotogramas variables.

### V2 · Proyecto de video y línea de tiempo multipista — **opus alto** (modelo y migración) + **sonnet medio** (interfaz)

- **Objetivo:** pistas ilimitadas de video, capas y audio, con huecos, imán opcional, ajuste a
  bordes y cabezal, marcadores, **deshacer/rehacer** y copiar/pegar.
- **Qué:** modelo de datos versionado (`VideoProject`: pistas, clips con `start` en la línea de
  tiempo, medios por referencia); store de zustand reutilizando `historyLogic`; medios guardados como
  archivos (OPFS en web, carpeta del proyecto en Tauri) en vez de Blobs dentro de una sola clave;
  **migración** desde `videoProject` sin perder nada; partir `VideoEditor.tsx` en componentes.
  Decidir si el video es otro tipo de pestaña del sistema de pestañas ya existente (decisión 8).
- **Archivos:** `src/video/model/*`, `src/video/state/*`, `src/ui/video/*`, `src/io/idb.ts`.
- **Depende de:** V1 (el motor lee el nuevo modelo).
- **Prueba:** Vitest del modelo (dividir, mover, imán, deshacer) y de la migración con un proyecto
  antiguo guardado; banco de exportación con 3 pistas solapadas.
- **Riesgos:** migración que pierde clips en silencio; cuota de almacenamiento.

### V3 · Vista previa fluida — **sonnet, esfuerzo alto** (revisión de opus del contrato con el motor)

- **Objetivo:** reproducir sin saltos en los cortes, con capas y audio sincronizados, buscar con el
  cabezal al instante y ver lo mismo que se exporta.
- **Qué:** compositor en canvas (WebGL cuando haga falta) que usa el mismo motor que V1;
  decodificación adelantada del clip siguiente; caché de miniaturas; audio programado con Web Audio
  sobre el reloj del compositor; calidad de vista previa reducida automática; **proxies** opcionales
  para 4K y móvil.
- **Depende de:** V1 y V2.
- **Prueba:** contador de fotogramas perdidos en reproducción de 1 min con 3 pistas (meta < 1 %);
  comparación píxel a píxel vista previa vs. exportación en 10 instantes.
- **Hecho (V3):** `composeFrame` (compose.ts) es la única composición, usada por exportación y vista previa;
  el audio en vivo ejecuta `ClipChain`/`MasterChain` de `dsp.ts` en AudioWorklet (`liveDsp.ts`,
  `dsp.worklet.ts`), sin segunda implementación. Precarga y reutilización del elemento al cortar
  (`src/ui/video/preview/preloadPlanner.ts`), reloj de audio, caché LRU de fotogramas para el scrubbing,
  calidad Auto/Alta/Media/Baja (720/540/360 p) y fps de depuración. Banco: `/dev/preview-bench.html`.
  Límites: clips con `inP = 0` no pueden arrancar antes del corte; en reproducción manda el elemento
  `<video>` (no WebCodecs), así que un códec que el navegador no abra no se ve en la vista previa.

### V4 · Texto, títulos y subtítulos manuales — **sonnet, esfuerzo medio**

- Capas de título que son **páginas de diseño de ChamVa** (fuentes, texto por palabra, efectos,
  animaciones de entrada y salida) pintadas con `renderDocToCanvas(t)`; editor de subtítulos;
  importar y exportar SRT/VTT; estilos de subtítulo con resaltado palabra a palabra (karaoke);
  tercios inferiores y créditos rodantes como plantillas locales.
- **Prueba:** Vitest del analizador SRT/VTT (ida y vuelta); banco de exportación con subtítulos.
- **Hecho (V4):** clips de texto con estilo propio y 43 preajustes (los 32 estilos del editor de diseño pasados a claro, tercios
  inferiores, karaoke), 10 pares de fuentes, animaciones de entrada/salida/énfasis (todo, palabra o letra) y karaoke;
  pista de subtítulos con tabla editable, SRT/VTT/TXT (leer y escribir), desplazar, ajustar a escenas, dividir/unir y estilo
  global; exportar con subtítulos incrustados o `.srt`/`.vtt` aparte. Los títulos usan `drawStyledText` directamente (no
  `renderDocToCanvas`, que es asíncrona y construye un lienzo por fotograma) y se componen en `composeFrame`.
  Pendiente: créditos rodantes, efectos de texto avanzados (extrusión, texto en curva) en las animaciones por unidades.

### V5 · Subtítulos automáticos con IA local — **opus alto** (auditoría de licencias y descarga) + **sonnet medio** (integración)

- Whisper (código y pesos MIT) con `@huggingface/transformers` (ya es dependencia) en un worker;
  modelos tiny/base/small a elegir según el equipo; marcas de tiempo por palabra → V4. En escritorio,
  whisper.cpp (MIT) como sidecar opcional, más rápido.
- **Prueba:** audio de voz sintetizado o grabado a propósito con texto conocido; medir tasa de error
  de palabras y desfase de tiempos.
- **Riesgos:** tamaño de descarga (75–480 MB), memoria en Android, idioma español.
- **Hecho (V5a, motor; la interfaz va aparte):** `src/ai/transcribe/` — worker propio (chunk aparte, sin pesos en el
  build), audio del proyecto/pista/rango a mono 16 kHz con el mezclador de V2, VAD por energía y ventanas de ≤ 30 s
  cortadas en silencios (solape de 2 s si no hay silencio, fusión sin duplicar), marcas por palabra afinadas con la
  energía, idioma automático o elegido, traducción a inglés, progreso y cancelación; `segmentsToSubtitles` → `Cue[]`
  de V4. Descarga con consentimiento, reanudable, verificada (sha256/sha1) y borrable. Licencias: AUDITORIA.md §6.

  | Modelo | Fuente (commit fijado) | Licencia verificada | WASM (q8) | WebGPU (fp32+q4) |
  |---|---|---|---|---|
  | tiny | Xenova/whisper-tiny @ 5332fcc | Apache-2.0 (pesos ONNX) · MIT (Whisper) | 43,6 MB | 122,4 MB |
  | base | Xenova/whisper-base @ 64da572 | Apache-2.0 · MIT | 79,7 MB | 208,9 MB |
  | small | Xenova/whisper-small @ 2d67713 | Apache-2.0 · MIT | 251,9 MB | 588,8 MB |

  Medido en Chromium 152 (Windows, CPU de escritorio, 32 GB) con voz sintética de Windows (SAPI) troceada por palabras
  con tiempos exactos: base/WASM 67 s de audio en 23–26 s (×0,34–0,39 del tiempo real), 3 ventanas, 124/124 palabras
  en orden sin duplicados, 100 % a ±0,3 s (mediana 4 ms); tiny/WASM ×0,21–0,29, 29/30 a ±0,3 s. Sin el afinado por
  energía Whisper llega 0,2–0,4 s tarde (mediana 0,21 s base, 0,38 s tiny). Memoria del renderizador: +1 GB pico con
  base/WASM. WebGPU (tiny) fue MÁS lento que WASM en este equipo (×0,39 frente a ×0,24) y alineó peor.
  Notas: ORT 1.26-dev necesita `graphOptimizationLevel: 'basic'` en WASM (el decodificador q8 falla con la
  optimización completa). Para regenerar el manifiesto: API `/api/models/<repo>` (sha) y `/api/models/<repo>/tree/<sha>`
  (tamaño, `lfs.oid` u `oid`). Pendiente: small sin medir, Android/macOS sin probar, voz real (no sintética).

### V6 · Transiciones, efectos, color y keyframes — **sonnet, esfuerzo medio**

- Transiciones en la unión (disolver, deslizar, empujar, zoom, barrido); filtros y LUT `.cube`
  reutilizando el motor de ajustes de imagen; chroma key (shader); keyframes de posición, escala,
  rotación y opacidad con curvas; Ken Burns para fotos; congelar fotograma; fotograma a imagen.
- **Prueba:** banco con colores esperados en el punto medio de cada transición; Vitest de la
  interpolación de keyframes.
- **Hecho (V6, 2026-10-03):** 27 transiciones (unión centrada en el corte con márgenes de recorte, entrada/salida), pila de
  27 efectos + 24 preajustes de color, croma por tonalidad, 12 modos de fusión, capas de ajuste, fotogramas clave
  (lineal/suave/mantener/bézier, auto-key, copiar/pegar, 6 presets) y pestañas Transiciones/Efectos/Ajustes con
  miniaturas del propio motor. Ver `src/video/model/README.md` (sección V6). Banco `/dev/fx-bench.html`: 27/27
  transiciones por píxeles (borde de la cortina circular a 367 px = ¼ de la diagonal), croma, fusión, ajuste, máscaras,
  escala 1→2 = 1,5 a mitad, exportación real con márgenes de recorte y vista previa = exportación (diferencia 0).
  Rendimiento 720p, 3 capas + 2 efectos: 13,6 ms/fotograma (p95 18,5; con transición 14,2; 540p 8 ms; 360p 4 ms).
  No hecho: importar `.cube`, congelar fotograma, fotograma a imagen, GPU (el fundido cruzado de audio llegó en V7).

### V7 · Audio de verdad — **sonnet, esfuerzo alto**

- Normalizar a LUFS (EBU R128: −14 YouTube, −16 podcast), ducking automático, quitar ruido con
  RNNoise (BSD, wasm), mezclador por pista (volumen, silencio, panorámica), ecualizador con curva,
  marcas de ritmo, exportar solo audio (WAV, Opus/OGG, AAC/M4A; MP3 solo si la librería es
  compatible con MIT).
- **Prueba:** numérica: medir LUFS del archivo exportado (±0,5 LU), reducción de ganancia en ducking.
- **Hecho (V7, 2026-10-03):** normalización a LUFS (BS.1770-4: K-weighting, puertas, M/S/I y pico real; −14/−16/−23/personalizado, de proyecto o de clip),
  limitador de pico real con anticipación, ducking por sidechain, reducción de ruido espectral propia, mezclador por pista (dB, solo, silencio,
  panorámica de potencia constante, medidores), ecualizador paramétrico de 7 bandas con curva (clip, pista y maestra), marcas de ritmo con imán,
  fundido cruzado de audio, y exportar solo audio (WAV 16/24, OGG/Opus, M4A/AAC). Ver `src/video/model/README.md` (sección V7) y el banco
  `/dev/audio-bench.html`. Medido en Chromium sobre el archivo exportado y decodificado: WAV −14,00 / −16,00 / −23,00 LUFS; Opus ±0,1 LU y AAC ±0,4 LU
  (se compensa lo que el códec cambia el nivel: se codifica, decodifica y mide); pico real ≤ −1 dBTP en todos; ducking −12,0 dB con X = 12;
  reducción de ruido −20 dB sin tocar la voz (nivel −0,15 dB); vista previa en vivo = exportación (cociente RMS 1,0000, diferencia máxima 1e-7).
- **Desviaciones:** RNNoise (BSD-3, COPYING de xiph/rnnoise verificado) NO se integra: sus puertos wasm de npm añaden una dependencia y un wasm dentro del
  AudioWorklet sin paridad probada con la exportación (`@jitsi/rnnoise-wasm` ni declara licencia en npm); se usa sustracción espectral propia, sin
  dependencias. MP3 se omite: no hay codificador JS con licencia permisiva verificada (lamejs es LGPL).

### V8 · Velocidad avanzada y reencuadre — **sonnet, esfuerzo medio**

- Curvas de velocidad, invertir (por bloques de GOP para no agotar memoria), reencuadre 16:9 → 9:16
  con zona elegida y seguimiento automático de cara (OpenCV.js, ya en dependencias).
- **Hecho (V8):** curvas de velocidad editables con 6 preajustes (mapeo ∫ds/v exacto; duración, exportación, vista previa y audio
  comparten el mismo mapa), velocidad constante 0,1×–100×, invertir por bloques de GOP (memoria acotada, aviso a 5 min, tope 1 h), congelar
  fotograma, fotograma a imagen, bucle con fundido cruzado y reencuadre 9:16 / 1:1 / 4:5 con marco arrastrable, fotogramas del marco y
  seguimiento automático propio (plantilla ZNCC; OpenCV.js no se usa: sin clasificadores de caras offline). Ver `src/video/model/README.md`
  (sección V8) y el banco `/dev/speed-bench.html`. No hecho: seguimiento de caras con modelo, estabilización (V9), vista previa de audio
  invertido y fundido cruzado de audio en la vista previa.

### V9 · IA de video — **opus alto** (licencias de modelos) + **sonnet medio**

- Quitar fondo por fotograma (modelo de segmentación de licencia permisiva; **verificar la licencia
  del modelo que usa hoy `src/ai/background-removal.ts`**: varios populares son no comerciales),
  estabilización (OpenCV.js), aislar o quitar voz (solo con modelo de licencia compatible).
- **Riesgos:** lentitud (avisar con estimación de tiempo), memoria.
- **Hecho (V9a, motor + licencias, 2026-10-04; interfaz fina pendiente):** efectos de origen `bgremove` y `stabilize` en `Clip.fx` (aditivos, sin migración),
  aplicados por `composeFrame` al fotograma del archivo leyendo cachés por medio y fotograma (`src/video/ai/`); cálculo aparte con progreso, ETA,
  cancelación y estimación previa; solo se calcula lo que falta; la vista previa avisa si no está calculado y la exportación avisa del % cubierto.
  Licencias leídas del `LICENSE`/ficha real (detalle en `AUDITORIA.md` §7):

  | Modelo / algoritmo | Fuente | Licencia verificada | Tamaño | Estado |
  |---|---|---|---|---|
  | MODNet código + modelos | github.com/ZHKKKe/MODNet | Apache-2.0 (LICENSE + README §License «code, models, and demos») | — | integrado |
  | MODNet ONNX fp32 | Xenova/modnet @ `fa2fa546` | Apache-2.0 (ficha) | 25,9 MB | integrado, fijado, con consentimiento y sha256 |
  | BiRefNet-lite | ZhengPeng7/BiRefNet · onnx-community/BiRefNet_lite-ONNX | MIT / MIT | 114 MB, WebGPU | solo imagen (inviable por fotograma) |
  | RMBG-1.4 | briaai/RMBG-1.4 | NO permisiva (no comercial) | 176 MB | no en video |
  | RVM | PeterL1n/RobustVideoMatting | GPL-3.0 | — | NO (copyleft) |
  | MediaPipe Selfie Segmentation | tarjeta PDF + google-ai-edge/mediapipe | Apache-2.0 | 0,25 MB | verificada, no integrada (dependencia nueva + URL sin fijar) |
  | OpenCV.js 5.0.0 | @techstark/opencv-js | Apache-2.0 | 13,3 MB | no usada (sin `estimateAffinePartial2D`) |
  | Estabilización | propia (`stabMath.ts`) | MIT | 0 | integrada |
  | Aislar voz (Demucs) | facebookresearch/demucs | código MIT; puertos ONNX de terceros sin verificar / algunos CC BY-NC | 80–300 MB | NO integrada |

  Banco `/dev/ai-bench.html` (Chrome estable sin cabeza, clip sintético 640×360, 91 fotogramas): MODNet REAL descargado (25 889 088 B, huellas
  verificadas): rápido 448×256 IoU medio 0,962 (mín. 0,829), 740 ms/fotograma en WASM; calidad 896×512 IoU 0,887 (mín. 0,792), 2,45 s/fotograma
  (el sujeto es una figura dibujada, no una persona real: MODNet está entrenado con retratos). Parpadeo (|Δ| medio en píxeles cuya verdad no cambia)
  1,15 → 0,93 con la coherencia temporal. Fondo de color: 100 % de píxeles exactos donde la máscara es 0 (rápido; 99,995 % en calidad por el filtro de
  reducción); 97,8 % del fondo «seguro» (a > 6 px del sujeto). Vista previa = exportación: diferencia 0 en los 5 instantes. Repetir = 0 fotogramas
  recalculados; cancelar a los 10 y seguir solo calcula lo que falta. Motor simulado (resta de fondo con ruido): IoU 0,987, parpadeo 2,81 → 1,01.
  Estabilización (120 fotogramas, temblor conocido ±7/±5 px y ±0,006 rad sobre un paneo): error del movimiento medido 0,11 px, temblor medido en la
  SALIDA 2,46 → 0,15 px (−94 %), giro 0,0035 → 0,0003 rad, 22,7 ms/fotograma de análisis (320×180), vista previa = exportación (0).
  No hecho: interfaz (diálogo con estimación y consentimiento, botones de calcular), persistir la caché entre sesiones, WebGPU, fondo «imagen» sin
  medir en banco, Android/macOS, memoria del worker sin medir (solo la caché y la estimación), aislar voz.

### V10 · ffmpeg nativo en escritorio — **opus, esfuerzo alto**

- Sidecar de ffmpeg en Windows/macOS/Linux para **importar cualquier códec** (HEVC de iPhone, ProRes,
  MKV), proxies rápidos y exportación con codificador por hardware.
- **Licencia:** build **LGPL de verdad** (auditando también las bibliotecas externas, no solo `-L`)
  sin x264/x265/vid.stab; H.264 con los codificadores del sistema
  (`h264_mf` en Windows, `h264_videotoolbox` en macOS, VA-API en Linux). Distribuido como binario
  aparte con aviso LGPL y fuente.
- **Seguridad:** permisos del plugin `shell` limitados a ese binario y a argumentos validados (nunca
  rutas ni argumentos sin filtrar desde la interfaz).
- **Peso:** +25–80 MB por instalador.
- **Hecho (V10, Windows verificado):** `src-tauri/src/native_media/` (comandos tipados, sin plugin
  `shell`) + `src/video/native/` (detección, probe, proxy H.264 del sistema o VP8, WAV, fotogramas
  crudos del original, exportación por hardware experimental) + diálogo «Convertir para editar».
  Build BtbN lgpl-shared n9.0.2 fijado por SHA-256 en `src-tauri/ffmpeg-manifest.json`; se empaqueta
  con `scripts/fetch-ffmpeg.mjs` y `--config src-tauri/tauri.ffmpeg.conf.json` (+150 MB sin comprimir).
  Seguridad, licencia y pendientes: `docs/seguridad-ffmpeg.md`. **Empaquetado en el instalador de
  Windows** (CI solo `windows-latest`), copia propia «si es la misma versión, se omite / si cambió,
  se repara» y Release de fuentes LGPL: `docs/release-ffmpeg.md`. No hecho: exportar desde el original
  dentro del exportador (la API `NativeFrameReader` existe), macOS/Linux.
- **Corrección (2026-10-05): el build BtbN «lgpl-shared» NO es LGPL limpio** (FFTW GPL-2.0+ vía
  chromaprint, zvbi GPL-2.0-only, opencore-amr Apache-2.0, libaribb24 LGPL-3.0) y se descartó:
  manifiesto `"status": "blocked-license"`, la app no lo usa ni lo instala, y **v0.9.0 sale sin
  FFmpeg** (CI como en v0.8.1; importación como en v0.8.1, con aviso «conviértelo a MP4 H.264»).
  **v0.9.1 (hecho 2026-10-05):** build propio LGPL-2.1-or-later (`ffmpeg-build.yml`, solo
  bibliotecas de la lista blanca, sin chromaprint ni zvbi), auditado y publicado con su fuente en
  el Release `ffmpeg-lgpl-n9.0.2-22-g46d8f462ee-chamva1`; manifiesto en `"ok"` y `release.yml`
  lo empaqueta en Windows (NSIS 35,1 MB / MSI 41,7 MB). macOS/Linux siguen sin FFmpeg.

### Después

Hecho: grabar pantalla, cámara, pantalla con la cámara en burbuja y micrófono (`src/video/record/`, diálogo «Grabar»), 12 plantillas
de video locales (`src/video/templates/`, selector «Plantillas») y «Bucle perfecto» (`src/video/speed/perfectLoop.ts`). Pendiente:
biblioteca de sonidos CC0 pequeña.

---

## 4. Riesgos transversales

| Riesgo | Mitigación |
|---|---|
| Memoria (Android, videos largos) | Decodificar y escribir en streaming (V1), proxies (V3), límites con aviso claro |
| ffmpeg GPL (x264) en ffmpeg.wasm actual | Retirarlo o sustituirlo por build LGPL local; nunca empaquetar x264 en el instalador MIT |
| Patentes H.264/AAC | Usar siempre el codificador del navegador o del sistema (WebCodecs, MF, VideoToolbox), que traen su licencia; ofrecer AV1/VP9 + Opus (libres) como alternativa |
| Licencias de modelos de IA | Auditoría por modelo antes de integrarlo (regla de la rama 7) |
| Fallos silenciosos de exportación | Banco de pruebas automático en cada tramo y en las 3 plataformas antes de publicar |
| `VideoEditor.tsx` monolítico | Partirlo en V2; no añadir funciones nuevas al archivo actual |

---

## 5. Arquitectura recomendada

```
Interfaz (React)  ──►  Modelo VideoProject (zustand + deshacer, versionado)
                           │
                           ▼
                 Motor común (src/video/engine)
          «qué se ve y se oye en el instante t»
         ┌─────────────┼──────────────────────┐
   Vista previa      Exportación          Diseño ChamVa
 (canvas/WebGL)   (backend intercambiable)  renderDocToCanvas(t)
                       │
       ┌───────────────┼─────────────────────┐
  WebCodecs +       ffmpeg sidecar        ffmpeg.wasm
  mp4-muxer         (escritorio, LGPL)    (último recurso, local)
  (por defecto      importar todo,
  web, Windows,     hardware, proxies
  Android)
```

- **WebCodecs primero en todas partes** donde exista (Windows y Android ya lo tienen): es lo que
  da valor antes y sin peso extra.
- **Sidecar de ffmpeg LGPL en escritorio** (V10) para importar cualquier formato y exportar con
  hardware; no es requisito para V1–V3.
- **ffmpeg.wasm** solo como último recurso, empaquetado y sin x264, o eliminado.
- Un único motor para vista previa y exportación: lo que se ve es lo que sale.

### Decisiones que debe tomar el usuario

1. **Plataformas de video en V1:** ¿Windows + Android + web Chromium, dejando macOS y Linux para
   después?
2. **Sidecar de ffmpeg:** ¿aceptar +25–80 MB por instalador de escritorio a cambio de importar
   HEVC/ProRes y exportar más rápido (V10)?
3. **ffmpeg.wasm de unpkg:** ¿eliminarlo, o empaquetarlo local con build LGPL? (hoy rompe el
   «offline» y arrastra GPL).
4. **Formato por defecto:** MP4 H.264 (compatible con todo, patentes vía sistema) o también
   WebM AV1/VP9 + Opus (libre).
5. **Modelos de Whisper:** ¿qué tamaños ofrecer y si se descargan bajo demanda?
6. **Música:** ¿paquete CC0 pequeño incluido o ninguno?
7. **Alcance de Android:** ¿exportación 1080p como máximo en móvil?
8. **Integración:** ¿el video pasa a ser un tipo de pestaña dentro del sistema de pestañas actual,
   o sigue como pantalla aparte?

### Orden recomendado

V1 (motor fiable) → V2 (multipista) → V3 (vista previa fluida) → V4 (texto y subtítulos) →
V5 (subtítulos con IA, el argumento estrella frente a CapCut) → V6 → V7 → V8 → V9 → V10.
No se añaden efectos antes de tener V1–V3: sin un motor y una vista previa fiables, cada efecto
nuevo multiplica los fallos silenciosos.

## Biblioteca de sonidos CC0 (pestaña «Sonidos»)

- 109 archivos (98 efectos/jingles + 11 pistas de música), 6,5 MB en `public/sounds/` (OGG/Opus). Todo CC0 1.0: Kenney (kenney.nl) y recursos de OpenGameArt cuya página declara exactamente «CC0».
- Se genera con `python scripts/sounds/build-sounds.py --cache <carpeta>` (ffmpeg con libopus; la herramienta verifica la licencia en la página de cada fuente y aborta si no es CC0). Produce `index.json` (con SHA-256) y `LICENCIAS.md`.
- Carga perezosa: el índice y cada archivo se piden al abrir la pestaña / usar un sonido; no entran al bundle. El service worker NO los precachea: los guarda al usarse en la caché `sonidos-chamva-1` (la URL lleva `?v=<hash>`).
- Pruebas: `src/video/sounds/soundIndex.test.ts` (archivos, hashes, licencias, presupuesto, búsqueda).
- Descartados: CC-BY / OGA-BY (p. ej. «Fireworks With Applause», «Rain on Window Loop», «Up in the Sky»), «Well Done» (nombre de archivo CCBY3 contradice la licencia), Pixabay e Incompetech.
