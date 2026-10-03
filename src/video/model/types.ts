// Modelo de proyecto de video multipista, versión 2 (datos puros, sin React ni DOM).
//
// - `media`: archivos por referencia (un Blob por archivo, aunque lo usen varios clips).
// - `tracks`: pistas de video (video / imagen / texto) y de audio. Orden de capas:
//   entre las pistas de video, la que va ANTES en el array se ve ENCIMA.
// - Cada clip tiene un inicio absoluto en la línea de tiempo (`start`) y, si viene
//   de un archivo, el recorte del archivo (`inP`..`outP`) y la velocidad.
import type { ClipAudioFx } from '../engine/dsp';
import type { DuckSpec } from '../audio/duck';
import type { EqBand } from '../audio/eq';

export const VIDEO_PROJECT_VERSION = 2 as const;

export type TrackKind = 'video' | 'audio' | 'subtitle';
export type ClipKind = 'video' | 'audio' | 'image' | 'text' | 'subtitle' | 'adjust';
export type MediaKind = 'video' | 'audio' | 'image';

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  name: string;
  /** duración del archivo en s (0 = imagen o desconocida) */
  duration: number;
  /** archivo original (se guarda en IndexedDB) */
  blob?: Blob;
  /** miniatura (dataURL) del primer fotograma */
  thumb?: string;
  /** URL de objeto: SOLO en memoria, nunca se guarda */
  url?: string;
  /** el proyecto antiguo no tenía el archivo (no se puede mostrar ni exportar) */
  missing?: boolean;
  /** V7: ritmo detectado (instantes en s del ARCHIVO) */
  beats?: BeatInfo;
}

/** V7: resultado de la detección de ritmo de un archivo de audio. */
export interface BeatInfo {
  bpm: number;
  beats: number[];
  onsets?: number[];
}

/** Transformación de un clip visual. x/y: centro en fracción del fotograma (0..1). */
export interface Transform {
  x: number;
  y: number;
  /** 1 = tamaño base (video: encajado al fotograma; imagen/texto: `size`) */
  scale: number;
  /** grados, sentido horario */
  rotation: number;
  /** 0..1 */
  opacity: number;
}

export const IDENTITY_TRANSFORM: Readonly<Transform> = Object.freeze({ x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 });

/**
 * Estilo de un título o subtítulo (V4). Las medidas en px están en un lienzo de referencia de
 * 1080 px de lado corto y se escalan a cada salida (vista previa y exportación igual).
 * Mismos nombres y significado que `TextLayer` del editor de diseño.
 */
export interface TitleStyle {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  fill: string;
  strokeColor: string;
  /** 0 = sin contorno */
  strokeWidth: number;
  shadow: boolean;
  shadowColor: string;
  shadowBlur: number;
  shadowX: number;
  shadowY: number;
  align: 'left' | 'center' | 'right';
  textTransform: 'none' | 'upper' | 'lower' | 'caps';
  letterSpacing: number;
  lineHeight: number;
  /** 'background' = caja detrás del texto (color en `effectColor`); 'echo' = copias desplazadas */
  textEffect?: 'none' | 'echo' | 'background';
  effectColor?: string;
  underline?: boolean;
  /** ancho máximo del texto, fracción del ancho del fotograma (def. 0,9); más ancho = salto de línea */
  maxWidth?: number;
  /** id del preajuste de origen (solo informativo) */
  presetId?: string;
}

/** Resaltado palabra a palabra (karaoke): la palabra activa cambia de color y de escala. */
export interface Karaoke {
  /** color de la palabra activa */
  color: string;
  /** escala de la palabra activa (1 = sin cambio) */
  scale: number;
  /** las palabras ya dichas se quedan con el color */
  keep: boolean;
}

/** Animaciones de un título (V4). Todo opcional: sin esto, el texto aparece y desaparece sin más. */
export interface TitleAnim {
  /** id de entrada: none, fade, slideUp/Down/Left/Right, scale, pop, bounce, typewriter, rotate */
  in?: string;
  out?: string;
  /** duración (s) de entrada y de salida (def. 0,5) */
  inDur?: number;
  outDur?: number;
  /** a qué se aplica la entrada y la salida: todo el texto, cada palabra o cada letra */
  unit?: 'all' | 'word' | 'letter';
  /** retardo entre unidades, 0..1 de la duración (def. 0,6) */
  stagger?: number;
  /** animación continua: none, pulse, float, shake, wiggle, blink */
  emphasis?: string;
  /** velocidad de la animación continua (ciclos por segundo, def. 1) */
  emphasisSpeed?: number;
  karaoke?: Karaoke;
}

/** Tiempo de una palabra (s, relativo al inicio del clip): para el karaoke. */
export interface WordTime {
  text: string;
  start: number;
  end: number;
}

/** Estilo global de una pista de subtítulos (se aplica a todos sus clips). */
export interface SubtitleStyle {
  style: TitleStyle;
  position: 'bottom' | 'middle' | 'top';
  /** distancia al borde, fracción del alto (def. 0,07) */
  margin: number;
  /** máximo de líneas (def. 2): el salto es automático por ancho */
  maxLines: number;
  karaoke?: Karaoke;
  /** fundido de entrada/salida de cada subtítulo (s, def. 0) */
  fade?: number;
}

// ---- V6: transiciones, efectos y keyframes (campos aditivos: el formato sigue siendo `v: 2`) ----

/** Modos de fusión de un clip con lo que hay debajo (`globalCompositeOperation` del lienzo). */
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'add' | 'difference' | 'darken' | 'lighten' | 'softlight' | 'hardlight' | 'dodge' | 'burn' | 'exclusion';

/** Curva de aceleración: lineal, suave, entrada, salida, rebote o bézier cúbica (`bz` = x1,y1,x2,y2 como en CSS). */
export type EaseId = 'linear' | 'smooth' | 'in' | 'out' | 'bounce' | 'bezier';
export type Bezier = [number, number, number, number];

/** Transición de un clip: `type` es un id del catálogo (`video/fx/transitions.ts`). */
export interface TransitionSpec {
  type: string;
  /** s (0,1–3) */
  dur: number;
  ease?: EaseId;
  bz?: Bezier;
}

export type FxParams = Record<string, number | string>;

/** Un efecto de la pila de un clip: se aplican en el orden del array. `amount` 0..1 = intensidad. */
export interface FxInstance {
  id: string;
  /** id del catálogo (`video/fx/effects.ts`) */
  type: string;
  /** false = apagado (se conserva en la pila) */
  on?: boolean;
  amount: number;
  /** parámetros propios del tipo (los que falten toman su valor por defecto) */
  p?: FxParams;
}

/** Interpolación desde este fotograma clave hasta el siguiente. */
export type KeyInterp = 'linear' | 'smooth' | 'hold' | 'bezier';
/** Fotograma clave: `t` en segundos desde el inicio del clip (línea de tiempo, no del archivo). */
export interface Keyframe {
  t: number;
  v: number;
  e?: KeyInterp;
  bz?: Bezier;
}

// ---- V8: velocidad avanzada, invertir, bucle y reencuadre (campos aditivos: el formato sigue siendo `v: 2`) ----

/** Punto de una curva de velocidad: `s` = instante del ARCHIVO (s), `v` = velocidad en ese punto (0,1×–100×). */
export interface SpeedPoint {
  s: number;
  v: number;
}
/**
 * Curva de velocidad sobre el tiempo de fuente: la velocidad en un fotograma del archivo no cambia al recortar o dividir el clip.
 * Entre puntos se interpola en escala logarítmica (1×→4× pasa por 2× a mitad); antes del primero y después del último vale el extremo.
 */
export interface SpeedCurve {
  pts: SpeedPoint[];
  /** suaviza cada tramo (aceleración y frenada suaves en vez de rampas rectas) */
  smooth?: boolean;
}
/** Bucle de un tramo: `n` pasadas o hasta `dur` s (si hay `dur`, manda); `xf` = fundido cruzado entre pasadas (s). */
export interface LoopSpec {
  n?: number;
  dur?: number;
  xf?: number;
}
/** Marco del reencuadre: centro (fracción del fotograma de origen) y zoom (1 = el marco más grande que cabe en la proporción de salida). */
export interface ReframeKey {
  /** s desde el inicio del clip */
  t: number;
  cx: number;
  cy: number;
  zoom?: number;
}
export interface ReframeSpec {
  aspect: '16:9' | '9:16' | '1:1' | '4:5';
  cx: number;
  cy: number;
  zoom: number;
  /** marcos a lo largo del clip (seguimiento o fotogramas del marco); vacío = marco fijo */
  track?: ReframeKey[];
}

export interface Clip {
  id: string;
  kind: ClipKind;
  /** medio de origen (video / audio / imagen); los textos no tienen */
  mediaId?: string;
  name?: string;
  /** s de la línea de tiempo donde empieza */
  start: number;
  /** s del archivo (video/audio). Imagen/texto: inP = 0 y outP = duración en pantalla */
  inP: number;
  outP: number;
  /** velocidad (solo video/audio; imagen/texto siempre 1) */
  speed: number;
  /** 0..2 */
  volume: number;
  /** id de EFFECTS («Voz») */
  effect: string;
  /** filtros a medida (prevalecen sobre `effect`; los usa la API antigua del motor) */
  voice?: Omit<ClipAudioFx, 'volume'>;
  /** fundido de la imagen (s): de/a lo que haya debajo (negro si no hay nada) */
  fadeIn: number;
  fadeOut: number;
  /** fundido del sonido (s) */
  audioFadeIn: number;
  audioFadeOut: number;
  transform: Transform;
  /** texto: px con referencia a 720 px de lado corto · imagen: fracción del ancho */
  size?: number;
  text?: string;
  color?: string;
  /** imagen/texto: se ve desde `start` hasta el final del proyecto (ignora outP) */
  toEnd?: boolean;
  /** texto con estilo propio (V4); sin esto, el texto se dibuja como en V1 (Arial negrita, `size` y `color`) */
  tstyle?: TitleStyle;
  anim?: TitleAnim;
  /** subtítulo / texto: tiempo de cada palabra (karaoke); sin esto se reparte por letras */
  words?: WordTime[];
  /** transición de entrada (en la unión con el clip anterior si es contiguo; si no, entra desde lo de debajo) */
  tin?: TransitionSpec;
  /** transición de salida (solo cuenta si el clip siguiente no es contiguo o no tiene `tin`) */
  tout?: TransitionSpec;
  /** pila de efectos y filtros (los de un clip `adjust` afectan a todo lo que hay debajo) */
  fx?: FxInstance[];
  blend?: BlendMode;
  /** fotogramas clave por propiedad: x, y, scale, rotation, opacity, volume, `fx.<id>.amount` o `fx.<id>.<parámetro>` */
  keys?: Record<string, Keyframe[]>;
  /** V8: curva de velocidad (prevalece sobre `speed`) */
  curve?: SpeedCurve;
  /** V8: el clip se reproduce al revés (imagen y sonido) */
  reverse?: boolean;
  /** V8: conservar el tono del sonido al cambiar la velocidad (sin esto, el sonido se acelera y se vuelve agudo, como la imagen) */
  pitch?: boolean;
  /** V8: congelar fotograma: el clip muestra el fotograma `inP` del archivo durante `freeze` s (sin sonido) */
  freeze?: number;
  /** V8: repetir el tramo recortado */
  loop?: LoopSpec;
  /** V8: reencuadre (la transformación x/y/escala y sus fotogramas se derivan de esto) */
  reframe?: ReframeSpec;
  /** SOLO en memoria (nunca se guarda): copia del clip que dibuja la pasada saliente de un bucle con fundido cruzado */
  xlayer?: boolean;
  /** V7: panorámica del clip (−1 izquierda … 1 derecha, ley de potencia constante); sin esto, centro */
  pan?: number;
  /** V7: ganancia fija del clip en dB (la que deja «Normalizar clip a LUFS»); se suma al volumen */
  gainDb?: number;
  /** V7: ecualizador paramétrico del clip */
  eq?: EqBand[];
  /** V7: reducción de ruido (0..1, intensidad); sin esto, apagada */
  denoise?: number;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  /** sin sonido */
  muted: boolean;
  /** no se puede editar (las operaciones la ignoran) */
  locked: boolean;
  /** sin imagen (sigue sonando salvo que esté silenciada) */
  hidden: boolean;
  /** imán: clips en secuencia desde 0, sin huecos (como la pista de V1) */
  magnet: boolean;
  /** ordenados por `start`, sin solaparse */
  clips: Clip[];
  /** solo pistas de subtítulos: estilo global */
  subStyle?: SubtitleStyle;
  /** V7: mezclador. Volumen de la pista en dB (0 = sin cambio) */
  gainDb?: number;
  /** V7: panorámica de la pista (−1..1) */
  pan?: number;
  /** V7: solo (si alguna pista está en solo, solo suenan las que lo están; también al exportar) */
  solo?: boolean;
  /** V7: ecualizador paramétrico de la pista */
  eq?: EqBand[];
  /** V7: ducking automático (la pista baja cuando suena voz en otras) */
  duck?: DuckSpec;
}

/** V7: ajustes de audio del proyecto (todo opcional; sin esto el audio se mezcla como en V6). */
export interface ProjectAudio {
  /** ecualizador paramétrico maestro */
  eq?: EqBand[];
  /** normalización de sonoridad del programa entero (LUFS integrados) */
  loud?: { on: boolean; target: number };
  /** fundido cruzado de audio en las uniones de clips contiguos, s (0 / sin definir = sin fundido) */
  xfade?: number;
  /** imán de la línea de tiempo a las marcas de ritmo */
  beatSnap?: boolean;
  /** mostrar las marcas de ritmo en la regla */
  showBeats?: boolean;
}

export interface VideoProject {
  v: typeof VIDEO_PROJECT_VERSION;
  media: Record<string, MediaAsset>;
  tracks: Track[];
  eq: { low: number; mid: number; high: number };
  normalize: boolean;
  /** V7: ajustes de audio (ecualizador maestro, sonoridad objetivo, fundido cruzado, ritmo) */
  audio?: ProjectAudio;
  /** datos del formato antiguo que no se pudieron usar (se conservan, no se borran) */
  legacy?: { from: 1; orphanClips?: unknown[]; orphanOverlays?: unknown[] };
}

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
