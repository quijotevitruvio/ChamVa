// Miniaturas de transiciones, efectos y preajustes: se renderizan con el MISMO motor (`composeFrame`) sobre un
// fotograma de muestra procedural y se guardan en caché (dataURL por id y progreso). Solo en el navegador.
import { composeFrame, type ComposeSources, type StillImage } from '../engine/compose';
import { makeClip } from '../model/ops';
import { addClip, addMedia, addTrack, createProject } from '../model/ops';
import type { FxInstance, TransitionSpec, VideoProject } from '../model/types';
import { makeFx, makeLookFx } from './effects';
import { setJunctionTransition } from './clipOps';
import { makeTransition } from './transitions';

export const THUMB_W = 160;
export const THUMB_H = 90;

type SceneKind = 'A' | 'B' | 'chroma';

/** Fotograma de muestra: cielo, sol, colinas, casita, nubes y una cara; colores vivos para que los efectos se aprecien. */
export function sampleScene(kind: SceneKind, w = THUMB_W, h = THUMB_H): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  if (kind === 'chroma') {
    g.fillStyle = '#00d63c';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2c9a0';
    g.beginPath();
    g.arc(w * 0.5, h * 0.42, h * 0.26, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a3b8f';
    g.fillRect(w * 0.3, h * 0.66, w * 0.4, h * 0.34);
    g.fillStyle = '#3a2a1c';
    g.beginPath();
    g.arc(w * 0.5, h * 0.3, h * 0.2, Math.PI, 0);
    g.fill();
    return cv;
  }
  const A = kind === 'A';
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, A ? '#2f6fd8' : '#5b2a86');
  sky.addColorStop(1, A ? '#bfe0ff' : '#ff9a62');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  g.fillStyle = A ? '#ffe27a' : '#fff2c4';
  g.beginPath();
  g.arc(w * (A ? 0.78 : 0.25), h * 0.26, h * 0.13, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = A ? '#3aa655' : '#a33d5a';
  g.beginPath();
  g.moveTo(0, h);
  g.quadraticCurveTo(w * 0.25, h * 0.45, w * 0.55, h * 0.72);
  g.quadraticCurveTo(w * 0.8, h * 0.88, w, h * 0.6);
  g.lineTo(w, h);
  g.fill();
  g.fillStyle = A ? '#d6483a' : '#f5d547';
  g.fillRect(w * 0.18, h * 0.58, w * 0.2, h * 0.2);
  g.fillStyle = A ? '#7b2b22' : '#4a3a12';
  g.beginPath();
  g.moveTo(w * 0.15, h * 0.58);
  g.lineTo(w * 0.28, h * 0.42);
  g.lineTo(w * 0.41, h * 0.58);
  g.fill();
  g.fillStyle = '#ffffffd0';
  for (const [x, y, r] of [[0.42, 0.18, 0.08], [0.5, 0.2, 0.06], [0.1, 0.14, 0.05]] as const) {
    g.beginPath();
    g.arc(w * x, h * y, h * r, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ffffff';
  g.font = `bold ${Math.round(h * 0.2)}px sans-serif`;
  g.textAlign = 'center';
  g.fillText(A ? 'A' : 'B', w * 0.68, h * 0.62);
  return cv;
}

const scenes = new Map<string, HTMLCanvasElement>();
const sceneOf = (k: SceneKind, w: number, h: number) => {
  const key = `${k}${w}x${h}`;
  let s = scenes.get(key);
  if (!s) scenes.set(key, (s = sampleScene(k, w, h)));
  return s;
};

const cache = new Map<string, string>();
const CACHE_MAX = 600;
const remember = (key: string, url: string) => {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, url);
  return url;
};

function sources(w: number, h: number, scene: Record<string, SceneKind>): ComposeSources {
  return {
    video: () => null,
    image: (c) => (c.mediaId && scene[c.mediaId] ? (sceneOf(scene[c.mediaId], w, h) as unknown as StillImage) : null),
  };
}

function canvasFor(w: number, h: number) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return { cv, g: cv.getContext('2d', { willReadFrequently: true })! };
}

function baseProject(withB: boolean): VideoProject {
  let p = addTrack(createProject(), 'video', { id: 'V' });
  p = addMedia(p, { id: 'A', kind: 'image', name: 'A', duration: 0 });
  p = addClip(p, 'V', makeClip('image', { id: 'a', mediaId: 'A', start: 0, outP: withB ? 3 : 4, size: 1 }));
  if (withB) {
    p = addMedia(p, { id: 'B', kind: 'image', name: 'B', duration: 0 });
    p = addClip(p, 'V', makeClip('image', { id: 'b', mediaId: 'B', start: 3, outP: 3, size: 1 }));
  }
  return p;
}

/** Progreso en el que la miniatura de una transición dice más (a mitad, el fundido a negro o el giro serían un cuadro vacío). */
export const thumbProgress = (id: string) => (id === 'fadeBlack' || id === 'fadeWhite' || id === 'flash' || id === 'flip' ? 0.3 : 0.5);

/** Miniatura de una transición en el progreso `p` (0..1, ya con la curva lineal) como dataURL (en caché). */
export function transitionThumb(spec: TransitionSpec | string, p = 0.5, w = THUMB_W, h = THUMB_H): string {
  const t = typeof spec === 'string' ? makeTransition(spec, { dur: 1, ease: 'linear' }) : { ...spec, dur: 1, ease: 'linear' as const };
  const key = `t:${t.type}:${p.toFixed(2)}:${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const proj = setJunctionTransition(baseProject(true), 'b', t);
  const { cv, g } = canvasFor(w, h);
  // ventana [2,5 – 3,5]: el progreso p cae en t = 2,5 + p
  composeFrame(g, proj, 2.5 + Math.max(0, Math.min(0.999, p)), 6, w, h, 'contain', sources(w, h, { A: 'A', B: 'B' }));
  return remember(key, cv.toDataURL('image/png'));
}

/** Miniatura de un efecto (o pila) sobre la escena de muestra (la de croma usa un fondo verde sobre un paisaje). */
export function fxThumb(fx: FxInstance | FxInstance[], o: { w?: number; h?: number; key?: string } = {}): string {
  const w = o.w ?? THUMB_W;
  const h = o.h ?? THUMB_H;
  const list = Array.isArray(fx) ? fx : [fx];
  const key = `f:${o.key ?? JSON.stringify(list.map((f) => [f.type, f.amount, f.p]))}:${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const chroma = list.some((f) => f.type === 'chroma');
  let p = addTrack(createProject(), 'video', { id: 'BG' });
  p = addTrack(p, 'video', { id: 'V' });
  p = addMedia(p, { id: 'A', kind: 'image', name: 'A', duration: 0 });
  p = addMedia(p, { id: 'C', kind: 'image', name: 'C', duration: 0 });
  p = addClip(p, 'BG', makeClip('image', { id: 'bg', mediaId: 'A', start: 0, outP: 4, size: 1 }));
  p = addClip(p, 'V', makeClip('image', { id: 'x', mediaId: chroma ? 'C' : 'A', start: 0, outP: 4, size: 1, fx: list }));
  const { cv, g } = canvasFor(w, h);
  composeFrame(g, p, 1, 4, w, h, 'contain', sources(w, h, { A: 'B', C: 'chroma' }));
  return remember(key, cv.toDataURL('image/png'));
}

/** Miniatura de un tipo de efecto con sus valores por defecto. */
export const fxTypeThumb = (type: string, params?: Record<string, number | string>) => fxThumb(makeFx(type, { id: 'thumb', p: params }), { key: `${type}:${JSON.stringify(params ?? {})}` });
/** Miniatura de un preajuste de color. */
export const lookThumb = (lookId: string) => fxThumb(makeLookFx(lookId), { key: `look:${lookId}` });
/** Miniatura de la fusión de una capa con otra (escena A debajo, B encima con el modo indicado). */
export function blendThumb(mode: string): string {
  const key = `b:${mode}:${THUMB_W}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let p = addTrack(createProject(), 'video', { id: 'BG' });
  p = addTrack(p, 'video', { id: 'V' });
  p = addMedia(p, { id: 'A', kind: 'image', name: 'A', duration: 0 });
  p = addMedia(p, { id: 'B', kind: 'image', name: 'B', duration: 0 });
  p = addClip(p, 'BG', makeClip('image', { id: 'bg', mediaId: 'A', start: 0, outP: 4, size: 1 }));
  p = addClip(p, 'V', makeClip('image', { id: 'x', mediaId: 'B', start: 0, outP: 4, size: 1, blend: mode as 'multiply' }));
  const { cv, g } = canvasFor(THUMB_W, THUMB_H);
  composeFrame(g, p, 1, 4, THUMB_W, THUMB_H, 'contain', sources(THUMB_W, THUMB_H, { A: 'A', B: 'B' }));
  return remember(key, cv.toDataURL('image/png'));
}

/** Vacía la caché de miniaturas (pruebas). */
export const clearThumbCache = () => {
  cache.clear();
  scenes.clear();
};
