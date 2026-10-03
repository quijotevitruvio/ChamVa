// Modelo de proyecto de video multipista, versión 2 (datos puros, sin React ni DOM).
//
// - `media`: archivos por referencia (un Blob por archivo, aunque lo usen varios clips).
// - `tracks`: pistas de video (video / imagen / texto) y de audio. Orden de capas:
//   entre las pistas de video, la que va ANTES en el array se ve ENCIMA.
// - Cada clip tiene un inicio absoluto en la línea de tiempo (`start`) y, si viene
//   de un archivo, el recorte del archivo (`inP`..`outP`) y la velocidad.
import type { ClipAudioFx } from '../engine/dsp';

export const VIDEO_PROJECT_VERSION = 2 as const;

export type TrackKind = 'video' | 'audio' | 'subtitle';
export type ClipKind = 'video' | 'audio' | 'image' | 'text' | 'subtitle';
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
}

export interface VideoProject {
  v: typeof VIDEO_PROJECT_VERSION;
  media: Record<string, MediaAsset>;
  tracks: Track[];
  eq: { low: number; mid: number; high: number };
  normalize: boolean;
  /** datos del formato antiguo que no se pudieron usar (se conservan, no se borran) */
  legacy?: { from: 1; orphanClips?: unknown[]; orphanOverlays?: unknown[] };
}

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
