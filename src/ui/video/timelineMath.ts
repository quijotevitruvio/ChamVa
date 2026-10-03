// Lógica pura de la línea de tiempo (sin React ni DOM): escala tiempo ↔ píxeles,
// regla, disposición de filas, hit-testing, selección, caja de selección,
// virtualización e imán en píxeles. Se prueba en timelineMath.test.ts.
import * as VM from '../../video/model';

// ---------- escala ----------
export const MIN_PPS = 2;
export const MAX_PPS = 800;
export const DEFAULT_PPS = 60;

export const clampPps = (pps: number) => Math.max(MIN_PPS, Math.min(MAX_PPS, Number.isFinite(pps) ? pps : DEFAULT_PPS));
export const timeToPx = (t: number, pps: number) => t * pps;
export const pxToTime = (px: number, pps: number) => px / pps;

/** Zoom manteniendo fijo el instante que hay bajo `anchorPx` (px del contenido, sin cabecera). */
export function zoomAround(pps: number, factor: number, anchorPx: number, scrollLeft: number): { pps: number; scrollLeft: number } {
  const next = clampPps(pps * factor);
  const anchorT = (scrollLeft + anchorPx) / pps;
  return { pps: next, scrollLeft: Math.max(0, anchorT * next - anchorPx) };
}

/** pps para que `duration` quepa en `viewPx` con un margen. */
export function fitPps(duration: number, viewPx: number, pad = 24): number {
  if (!(duration > 0) || viewPx <= pad * 2) return DEFAULT_PPS;
  return clampPps((viewPx - pad * 2) / duration);
}

// ---------- regla ----------
const STEPS = [0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

/** Paso (s) entre marcas principales: la primera con al menos `minPx` entre marcas. */
export function rulerStep(pps: number, minPx = 80): number {
  for (const s of STEPS) if (s * pps >= minPx) return s;
  return STEPS[STEPS.length - 1];
}

export interface Tick {
  t: number;
  major: boolean;
}

const SUBDIV: Record<number, number> = { 0.04: 4, 0.1: 5, 0.2: 4, 0.5: 5, 1: 5, 2: 4, 5: 5, 10: 5, 15: 3, 30: 3, 60: 6, 120: 4, 300: 5, 600: 5, 1800: 3, 3600: 6 };

/** Marcas entre t0 y t1: principales cada `rulerStep`, menores a una fracción exacta de ese paso. */
export function rulerTicks(pps: number, t0: number, t1: number): Tick[] {
  const step = rulerStep(pps);
  const minor = step / (SUBDIV[step] ?? 5);
  const out: Tick[] = [];
  const first = Math.max(0, Math.floor(t0 / minor) - 1);
  const last = Math.ceil(t1 / minor) + 1;
  for (let i = first; i <= last; i++) {
    const t = i * minor;
    const ratio = t / step;
    out.push({ t, major: Math.abs(ratio - Math.round(ratio)) < 1e-6 });
  }
  return out;
}

export function formatRuler(t: number, step: number): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  if (step < 1) return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
  return `${m}:${Math.floor(sec + 1e-6).toString().padStart(2, '0')}`;
}

/** mm:ss,d con una décima (para el cabezal). */
export function formatClock(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

// ---------- virtualización ----------
export interface TimeRange {
  t0: number;
  t1: number;
}

/** Instantes visibles (más un margen en píxeles a cada lado). */
export function visibleRange(scrollLeft: number, viewPx: number, pps: number, marginPx = 0): TimeRange {
  return { t0: Math.max(0, (scrollLeft - marginPx) / pps), t1: (scrollLeft + viewPx + marginPx) / pps };
}

/**
 * Ventana de renderizado estable: cambia solo al cruzar «cubos» de medio ancho de vista,
 * para no repintar todos los clips en cada píxel de scroll.
 */
export function renderWindow(scrollLeft: number, viewPx: number, pps: number): TimeRange & { bucket: number } {
  const half = Math.max(80, viewPx / 2);
  const bucket = Math.floor(scrollLeft / half);
  return { bucket, ...visibleRange(bucket * half, viewPx + half, pps, viewPx) };
}

/** Fin que se dibuja de un clip: los «hasta el final» llegan a la duración del proyecto. */
export const drawEnd = (c: VM.Clip, projectDur: number) => VM.effectiveEnd(c, projectDur);

/** Clips de una pista que tocan [t0, t1]. Las pistas están ordenadas por inicio: se corta pronto. */
export function visibleClips(track: VM.Track, r: TimeRange, projectDur: number, always?: ReadonlySet<string>): VM.Clip[] {
  const out: VM.Clip[] = [];
  for (const c of track.clips) {
    if (always?.has(c.id)) out.push(c);
    else if (c.start > r.t1) continue;
    else if (drawEnd(c, projectDur) >= r.t0) out.push(c);
  }
  return out;
}

// ---------- filas ----------
export const RULER_H = 28;
export const ROW_H: Record<VM.TrackKind, number> = { video: 58, audio: 44 };
export const HEADER_W = 132;
export const HEADER_W_COMPACT = 104;
/** Margen (px) de los bordes de un clip donde se recorta. */
export const TRIM_ZONE = 9;

/** Orden visual: pistas de video/imagen/texto arriba (en el orden de capas), audio abajo. */
export function displayTracks(p: VM.VideoProject): VM.Track[] {
  return [...p.tracks.filter((t) => t.kind === 'video'), ...p.tracks.filter((t) => t.kind === 'audio')];
}

export interface Row {
  trackId: string;
  kind: VM.TrackKind;
  /** y dentro de la zona de pistas (debajo de la regla) */
  y: number;
  h: number;
}

export function rowLayout(p: VM.VideoProject): Row[] {
  const rows: Row[] = [];
  let y = 0;
  for (const t of displayTracks(p)) {
    rows.push({ trackId: t.id, kind: t.kind, y, h: ROW_H[t.kind] });
    y += ROW_H[t.kind];
  }
  return rows;
}

export const rowsHeight = (rows: Row[]) => rows.reduce((h, r) => Math.max(h, r.y + r.h), 0);

export function rowAtY(rows: Row[], y: number): Row | null {
  return rows.find((r) => y >= r.y && y < r.y + r.h) ?? null;
}

/** Fila destino al arrastrar: la que hay bajo y, o la más cercana si está fuera. */
export function nearestRow(rows: Row[], y: number): Row | null {
  if (!rows.length) return null;
  return rowAtY(rows, y) ?? (y < 0 ? rows[0] : rows[rows.length - 1]);
}

// ---------- hit-testing ----------
export type HitZone = 'left' | 'right' | 'body';

export interface Hit {
  trackId: string;
  clipId: string;
  zone: HitZone;
}

/** Zona del clip según la x dentro de él (px desde su borde izquierdo). Los bordes se encogen en clips estrechos. */
export function zoneAt(xInClip: number, widthPx: number, zone = TRIM_ZONE): HitZone {
  const z = Math.min(zone, widthPx / 3);
  if (xInClip < z) return 'left';
  if (xInClip > widthPx - z) return 'right';
  return 'body';
}

/** Rectángulo de un clip en el contenido de las pistas (x desde t = 0, y desde la 1.ª fila). */
export function clipRect(c: VM.Clip, row: Row, pps: number, projectDur: number) {
  return { x: c.start * pps, y: row.y, w: Math.max(2, (drawEnd(c, projectDur) - c.start) * pps), h: row.h };
}

/** Clip bajo el punto (x, y) del contenido de las pistas. */
export function hitTest(p: VM.VideoProject, rows: Row[], pps: number, x: number, y: number): Hit | null {
  const row = rowAtY(rows, y);
  if (!row) return null;
  const track = VM.findTrack(p, row.trackId);
  if (!track) return null;
  const dur = VM.projectDuration(p);
  // de atrás adelante: si se tocasen dos, gana el último (el modelo no los solapa)
  for (let i = track.clips.length - 1; i >= 0; i--) {
    const c = track.clips[i];
    const r = clipRect(c, row, pps, dur);
    if (x >= r.x && x <= r.x + r.w) return { trackId: track.id, clipId: c.id, zone: zoneAt(x - r.x, r.w) };
  }
  return null;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const normBox = (b: Box): Box => ({ x0: Math.min(b.x0, b.x1), y0: Math.min(b.y0, b.y1), x1: Math.max(b.x0, b.x1), y1: Math.max(b.y0, b.y1) });

/** Ids de los clips cuyo rectángulo toca la caja (coordenadas del contenido de las pistas). */
export function clipsInBox(p: VM.VideoProject, rows: Row[], pps: number, box: Box): string[] {
  const b = normBox(box);
  const dur = VM.projectDuration(p);
  const out: string[] = [];
  for (const row of rows) {
    if (row.y + row.h <= b.y0 || row.y >= b.y1) continue;
    const track = VM.findTrack(p, row.trackId);
    if (!track) continue;
    for (const c of track.clips) {
      const r = clipRect(c, row, pps, dur);
      if (r.x <= b.x1 && r.x + r.w >= b.x0) out.push(c.id);
    }
  }
  return out;
}

// ---------- selección ----------
export type SelectMode = 'replace' | 'toggle' | 'add';

export function applySelection(prev: readonly string[], id: string, mode: SelectMode): string[] {
  const has = prev.includes(id);
  if (mode === 'replace') return [id];
  if (mode === 'add') return has ? [...prev] : [...prev, id];
  return has ? prev.filter((x) => x !== id) : [...prev, id];
}

/** Caja de selección: con Shift/Ctrl se suma a lo ya seleccionado; si no, lo sustituye. */
export function mergeBoxSelection(base: readonly string[], inBox: readonly string[], additive: boolean): string[] {
  if (!additive) return [...inBox];
  const s = new Set(base);
  for (const id of inBox) s.add(id);
  return [...s];
}

/** Quita ids que ya no existen en el proyecto. */
export function pruneSelection(p: VM.VideoProject, ids: readonly string[]): string[] {
  const next = ids.filter((id) => VM.findClip(p, id));
  return next.length === ids.length ? (ids as string[]) : next;
}

// ---------- imán en píxeles ----------
export const SNAP_PX = 8;

export const snapSeconds = (pps: number, px = SNAP_PX) => px / pps;

/** Imán para mover un clip: pega su inicio o su fin a bordes, cabezal o 0. */
export function snapMove(p: VM.VideoProject, clipId: string, proposedStart: number, pps: number, playhead: number, enabled = true) {
  if (!enabled) return { time: Math.max(0, proposedStart), target: null as null | 'zero' | 'playhead' | 'clip' };
  return VM.snapClipStart(p, clipId, proposedStart, { threshold: snapSeconds(pps), playhead });
}

/** Imán para un borde recortado. */
export function snapEdge(p: VM.VideoProject, clipId: string, t: number, pps: number, playhead: number, enabled = true) {
  if (!enabled) return { time: Math.max(0, t), target: null as null | 'zero' | 'playhead' | 'clip' };
  return VM.snapTime(p, t, { threshold: snapSeconds(pps), playhead, exclude: clipId });
}

/** Velocidad de auto-scroll (px/fotograma) al arrastrar cerca de un borde de la vista. */
export function autoScrollSpeed(pointerX: number, viewLeft: number, viewRight: number, zone = 48, max = 22): number {
  if (pointerX < viewLeft + zone) return -max * Math.min(1, (viewLeft + zone - pointerX) / zone);
  if (pointerX > viewRight - zone) return max * Math.min(1, (pointerX - (viewRight - zone)) / zone);
  return 0;
}
