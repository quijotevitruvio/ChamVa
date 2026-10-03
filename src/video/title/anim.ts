// Animaciones de títulos y subtítulos (V4): funciones puras del tiempo. La vista previa y la
// exportación las evalúan con el mismo instante, así que dan el mismo fotograma.
//
//  - Entrada (progreso 0 → 1 en `inDur`) y salida (1 → 0 en `outDur`, al final del clip).
//  - Cada animación puede aplicarse a todo el texto, a cada palabra o a cada letra (con retardo escalonado).
//  - «Énfasis»: animación continua mientras el clip está en pantalla.
import type { TitleAnim } from '../model/types';

export interface AnimState {
  /** desplazamiento, fracción del ancho / del alto del fotograma */
  dx: number;
  dy: number;
  /** multiplicador de escala */
  scale: number;
  opacity: number;
  /** grados, sentido horario */
  rotation: number;
}

export const NEUTRAL: Readonly<AnimState> = Object.freeze({ dx: 0, dy: 0, scale: 1, opacity: 1, rotation: 0 });

export interface AnimDef {
  id: string;
  label: string;
}

export const ANIM_IN: AnimDef[] = [
  { id: 'none', label: 'Ninguna' },
  { id: 'fade', label: 'Aparecer' },
  { id: 'slideUp', label: 'Subir' },
  { id: 'slideDown', label: 'Bajar' },
  { id: 'slideLeft', label: 'Entrar desde la izquierda' },
  { id: 'slideRight', label: 'Entrar desde la derecha' },
  { id: 'scale', label: 'Escala' },
  { id: 'pop', label: 'Zoom con rebote' },
  { id: 'bounce', label: 'Caída con rebote' },
  { id: 'rotate', label: 'Giro' },
  { id: 'typewriter', label: 'Máquina de escribir' },
];
/** Las salidas son las mismas entradas, al revés. */
export const ANIM_OUT: AnimDef[] = ANIM_IN;

export const ANIM_EMPHASIS: AnimDef[] = [
  { id: 'none', label: 'Ninguna' },
  { id: 'pulse', label: 'Latido' },
  { id: 'float', label: 'Flotar' },
  { id: 'shake', label: 'Temblor' },
  { id: 'wiggle', label: 'Balanceo' },
  { id: 'blink', label: 'Parpadeo' },
];

export const ANIM_UNITS: { id: NonNullable<TitleAnim['unit']>; label: string }[] = [
  { id: 'all', label: 'Todo el texto' },
  { id: 'word', label: 'Por palabra' },
  { id: 'letter', label: 'Por letra' },
];

export const DEFAULT_ANIM_DUR = 0.5;
export const DEFAULT_STAGGER = 0.6;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
const easeOutBack = (p: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};
const easeOutBounce = (p: number) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (p < 1 / d1) return n1 * p * p;
  if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75;
  if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375;
  return n1 * (p -= 2.625 / d1) * p + 0.984375;
};

/**
 * Estado de la animación `id` con progreso p (0 = recién empieza, 1 = ya en su sitio).
 * `n` > 1: es una palabra o una letra (los desplazamientos son más pequeños).
 * La «máquina de escribir» no es un estado: la resuelve `unitProgress` con un escalón por unidad.
 */
export function enterState(id: string | undefined, p: number, unitCount = 1): AnimState {
  if (!id || id === 'none') return NEUTRAL;
  const pp = clamp01(p);
  const e = easeOut(pp);
  const inv = 1 - e;
  const k = unitCount > 1 ? 0.4 : 1;
  switch (id) {
    case 'fade':
      return { ...NEUTRAL, opacity: e };
    case 'slideUp':
      return { ...NEUTRAL, dy: inv * 0.12 * k, opacity: e };
    case 'slideDown':
      return { ...NEUTRAL, dy: -inv * 0.12 * k, opacity: e };
    case 'slideLeft':
      return { ...NEUTRAL, dx: -inv * 0.25 * k, opacity: e };
    case 'slideRight':
      return { ...NEUTRAL, dx: inv * 0.25 * k, opacity: e };
    case 'scale':
      return { ...NEUTRAL, scale: 0.3 + 0.7 * e, opacity: e };
    case 'pop':
      return { ...NEUTRAL, scale: Math.max(0, easeOutBack(pp)), opacity: clamp01(pp * 4) };
    case 'bounce':
      return { ...NEUTRAL, dy: -(1 - easeOutBounce(pp)) * 0.3 * k, opacity: clamp01(pp * 5) };
    case 'rotate':
      return { ...NEUTRAL, rotation: -inv * 90, scale: 0.5 + 0.5 * e, opacity: e };
    case 'typewriter':
      return NEUTRAL; // ver unitVisible
    default:
      return NEUTRAL;
  }
}

/** Progreso de la unidad i de n cuando el progreso global es p (retardo escalonado `stagger`). */
export function unitProgress(p: number, i: number, n: number, stagger: number): number {
  if (n <= 1) return clamp01(p);
  const d = stagger / n;
  const span = 1 - (n - 1) * d;
  return clamp01((p - i * d) / Math.max(1e-6, span));
}

/** Unidad efectiva: la máquina de escribir sin unidad elegida avanza letra a letra. */
export function effectiveUnit(anim: TitleAnim | undefined): 'all' | 'word' | 'letter' {
  if (!anim) return 'all';
  if (anim.unit && anim.unit !== 'all') return anim.unit;
  if (anim.in === 'typewriter' || anim.out === 'typewriter') return 'letter';
  return 'all';
}

/** ¿Hay entrada, salida o énfasis que dibujar por unidades (palabra / letra) o con karaoke? */
export function needsUnits(anim: TitleAnim | undefined): boolean {
  return !!anim && (effectiveUnit(anim) !== 'all' || !!anim.karaoke);
}

/** Duraciones de entrada y salida ya ajustadas para que quepan en el clip (`dur`). */
export function animDurations(anim: TitleAnim | undefined, dur: number): { inD: number; outD: number } {
  let inD = anim?.in && anim.in !== 'none' ? (anim.inDur ?? DEFAULT_ANIM_DUR) : 0;
  let outD = anim?.out && anim.out !== 'none' ? (anim.outDur ?? DEFAULT_ANIM_DUR) : 0;
  if (inD + outD > dur && inD + outD > 0) {
    const k = dur / (inD + outD);
    inD *= k;
    outD *= k;
  }
  return { inD, outD };
}

const mul = (a: AnimState, b: AnimState): AnimState => ({
  dx: a.dx + b.dx,
  dy: a.dy + b.dy,
  scale: a.scale * b.scale,
  opacity: a.opacity * b.opacity,
  rotation: a.rotation + b.rotation,
});

/**
 * Estado de entrada/salida de la unidad i (de n) en el instante lt (s desde el inicio del clip) de un clip de
 * `dur` s. `visible` = false: la unidad aún no se ha escrito (máquina de escribir) o ya se borró.
 */
export function unitState(anim: TitleAnim | undefined, lt: number, dur: number, i = 0, n = 1): { state: AnimState; visible: boolean } {
  if (!anim) return { state: NEUTRAL, visible: true };
  const { inD, outD } = animDurations(anim, dur);
  const stagger = anim.stagger ?? DEFAULT_STAGGER;
  let st: AnimState = NEUTRAL;
  let visible = true;
  if (inD > 0 && lt < inD) {
    const p = clamp01(lt / inD);
    if (anim.in === 'typewriter') visible = visible && p > i / n;
    else st = mul(st, enterState(anim.in, unitProgress(p, i, n, stagger), n));
  }
  if (outD > 0 && dur - lt < outD) {
    const p = clamp01((dur - lt) / outD);
    if (anim.out === 'typewriter') visible = visible && p > i / n;
    else st = mul(st, enterState(anim.out, unitProgress(p, i, n, stagger), n));
  }
  return { state: st, visible };
}

/** Animación continua en el instante lt. */
export function emphasisState(anim: TitleAnim | undefined, lt: number): AnimState {
  const id = anim?.emphasis;
  if (!id || id === 'none') return NEUTRAL;
  const w = 2 * Math.PI * (anim?.emphasisSpeed ?? 1);
  switch (id) {
    case 'pulse':
      return { ...NEUTRAL, scale: 1 + 0.06 * Math.sin(w * lt) };
    case 'float':
      return { ...NEUTRAL, dy: 0.012 * Math.sin(w * lt) };
    case 'shake':
      return { ...NEUTRAL, dx: 0.005 * Math.sin(w * lt * 9), dy: 0.003 * Math.sin(w * lt * 13 + 1) };
    case 'wiggle':
      return { ...NEUTRAL, rotation: 3 * Math.sin(w * lt) };
    case 'blink':
      return { ...NEUTRAL, opacity: 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(w * lt)) };
    default:
      return NEUTRAL;
  }
}

/** Resumen para pruebas y para saber si un clip tiene alguna animación. */
export function hasAnim(anim: TitleAnim | undefined): boolean {
  return !!anim && !!(anim.in || anim.out || anim.emphasis || anim.karaoke);
}
