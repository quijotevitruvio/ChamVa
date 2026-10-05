// V9b: lógica PURA de la interfaz de «quitar fondo» y «estabilizar»: rango a calcular (clip entero o entre marcas),
// resumen de cobertura por clip (banda de la línea de tiempo), textos de aviso (vista previa y exportación) y la vista previa
// del recorte de la estabilización. Sin React, sin lienzo ni IndexedDB: se prueba en aiPlan.test.ts.
import type { Clip, VideoProject } from '../model/types';
import { clipsAt, effectiveEnd, findClip, projectDuration, sourceTimeAt } from '../model/query';
import { aiCoverage, aiParamsOf, clipSourceRange, hasAiFx, stabAt, type AiCoverage } from './aiFrame';
import { matteCache, matteKey, motionCache, stabKey, type MaskCache, type MotionCache } from './cache';
import { MATTE_FPS, formatEta } from './matteMath';
import { jitterRms, stabCorrections, trajectory, type Motion } from './stabMath';

export type AiKind = 'bgremove' | 'stabilize';
export const AI_KIND_LABEL: Record<AiKind, string> = { bgremove: 'Quitar fondo', stabilize: 'Estabilizar' };

// ---------- cobertura ----------

/** Porcentaje entero 0..100 de lo calculado: solo vale 100 si está TODO (nunca redondea 99,6 a 100). */
export function coveragePct(have: number, total: number): number {
  if (total <= 0) return 100;
  if (have >= total) return 100;
  return Math.max(0, Math.min(99, Math.floor((100 * have) / total)));
}

export interface ClipAiStatus {
  clipId: string;
  /** el peor de los efectos de origen del clip */
  pct: number;
  complete: boolean;
  parts: { kind: AiKind; pct: number; have: number; total: number }[];
}

/** Estado de cálculo por clip con efectos de origen activos (para la banda del clip en la línea de tiempo). */
export function aiStatusByClip(cov: AiCoverage[]): Map<string, ClipAiStatus> {
  const out = new Map<string, ClipAiStatus>();
  for (const c of cov) {
    const part = { kind: c.kind, pct: coveragePct(c.have, c.total), have: c.have, total: c.total };
    const cur = out.get(c.clipId);
    if (!cur) out.set(c.clipId, { clipId: c.clipId, pct: part.pct, complete: part.pct >= 100, parts: [part] });
    else {
      cur.parts.push(part);
      cur.pct = Math.min(cur.pct, part.pct);
      cur.complete = cur.pct >= 100;
    }
  }
  return out;
}

/** Texto de la banda del clip: «IA calculada 100 %» o «IA 60 %». */
export const bandText = (s: Pick<ClipAiStatus, 'pct' | 'complete'>) => (s.complete ? 'IA calculada 100 %' : `IA ${s.pct} %`);

/** Texto largo (para title/lector de pantalla) de una parte: «Quitar fondo: calculado 60 % (18/31 fotogramas)». */
export const partText = (p: ClipAiStatus['parts'][number]) => `${AI_KIND_LABEL[p.kind]}: ${p.pct >= 100 ? 'calculado 100 %' : p.have === 0 ? 'sin calcular' : `calculado ${p.pct} %`} (${p.have}/${p.total} fotogramas)`;

/** Suma de los tramos que faltan (s del archivo) y su número de fotogramas. */
export function missingTotals(c: Pick<AiCoverage, 'have' | 'total'>): { frames: number; seconds: number } {
  const frames = Math.max(0, c.total - c.have);
  return { frames, seconds: frames / MATTE_FPS };
}

// ---------- rango a calcular ----------

export type AiScope = 'clip' | 'marks';
export interface Marks {
  in: number | null;
  out: number | null;
}

export type ScopeResult = { ok: true; range: [number, number]; label: string } | { ok: false; reason: string };

/**
 * Tramo del ARCHIVO (s) que hay que calcular: el que usa el clip entero, o el recortado a las marcas de entrada/salida
 * (que están en la línea de tiempo y se pasan al archivo con la velocidad/curva del clip).
 */
export function scopeRange(p: VideoProject, clipId: string, scope: AiScope, marks: Marks): ScopeResult {
  const c = findClip(p, clipId)?.clip;
  if (!c) return { ok: false, reason: 'El clip ya no existe.' };
  const full = clipSourceRange(c);
  if (scope === 'clip') return { ok: true, range: full, label: 'el clip completo' };
  if (marks.in === null && marks.out === null) return { ok: false, reason: 'No hay marcas de entrada/salida: márcalas en la línea de tiempo o elige «Clip completo».' };
  const end = effectiveEnd(c, projectDuration(p));
  const t0 = Math.max(c.start, marks.in ?? c.start);
  const t1 = Math.min(end, marks.out ?? end);
  if (!(t1 - t0 > 1e-6)) return { ok: false, reason: 'Las marcas no cubren este clip.' };
  // en los extremos del clip se toma el del archivo tal cual (sourceTimeAt en el último instante queda un pelo por debajo)
  const a = t0 <= c.start + 1e-6 ? full[0] : sourceTimeAt(c, t0);
  const b = t1 >= end - 1e-6 ? full[1] : sourceTimeAt(c, t1);
  const lo = Math.max(full[0], Math.min(a, b));
  const hi = Math.min(full[1], Math.max(a, b));
  if (!(hi >= lo)) return { ok: false, reason: 'Las marcas no cubren este clip.' };
  return { ok: true, range: [lo, hi], label: 'el tramo entre marcas' };
}

/** Cobertura de [a, b] (s del archivo) para el efecto `kind` del clip. */
export function rangeCoverage(p: VideoProject, clipId: string, kind: AiKind, range: [number, number], masks: MaskCache = matteCache, motion: MotionCache = motionCache): { have: number; total: number; missing: [number, number][] } | null {
  const c = findClip(p, clipId)?.clip;
  if (!c?.mediaId) return null;
  const prm = aiParamsOf(c, c.start);
  if (kind === 'bgremove') {
    if (!prm.matte) return null;
    return masks.coverage(matteKey(c.mediaId, prm.matte.mode), range[0], range[1], MATTE_FPS);
  }
  if (!prm.stab) return null;
  const tr = motion.peek(stabKey(c.mediaId));
  const fps = tr?.fps ?? MATTE_FPS;
  const i0 = Math.round(range[0] * fps + 1e-6);
  const i1 = Math.max(i0, Math.round(range[1] * fps + 1e-6));
  let have = 0;
  const missing: [number, number][] = [];
  let run = -1;
  for (let i = i0; i <= i1; i++) {
    if (tr?.motion.has(i)) {
      have++;
      if (run >= 0) missing.push([run / fps, (i - 1) / fps]), (run = -1);
    } else if (run < 0) run = i;
  }
  if (run >= 0) missing.push([run / fps, i1 / fps]);
  return { have, total: i1 - i0 + 1, missing };
}

// ---------- avisos ----------

export interface NoticeItem {
  clipId: string;
  kind: AiKind;
  text: string;
}

/** Lo ya calculado del clip como inciso: « (calculado el 40 % del clip)», o nada si aún no hay nada. */
const doneWords = (pct: number) => (pct <= 0 ? '' : ` (calculado el ${pct} % del clip)`);

/** Avisos de la vista previa en el instante t, uno por efecto sin calcular AQUÍ, con su cobertura total. */
export function noticeItemsAt(p: VideoProject, t: number, masks: MaskCache = matteCache, motion: MotionCache = motionCache): NoticeItem[] {
  const out: NoticeItem[] = [];
  const cov = aiCoverage(p, masks, motion);
  for (const { clip } of clipsAt(p, t).visual) {
    if (!hasAiFx(clip) || !clip.mediaId) continue;
    const prm = aiParamsOf(clip, t);
    const st = sourceTimeAt(clip, t);
    const pctOf = (kind: AiKind) => {
      const c = cov.find((x) => x.clipId === clip.id && x.kind === kind);
      return c ? coveragePct(c.have, c.total) : 0;
    };
    if (prm.matte && !masks.lookup(matteKey(clip.mediaId, prm.matte.mode), st))
      out.push({ clipId: clip.id, kind: 'bgremove', text: `Quitar fondo: este punto no está calculado${doneWords(pctOf('bgremove'))}, por eso se ve el original.` });
    if (prm.stab && !stabAt(motion, stabKey(clip.mediaId), st, prm.stab))
      out.push({ clipId: clip.id, kind: 'stabilize', text: `Estabilizar: este punto no está analizado${doneWords(pctOf('stabilize'))}, por eso se ve sin estabilizar.` });
  }
  return out;
}

/** Ids de clip de unos avisos, sin repetir. */
export const noticeClips = (items: NoticeItem[]) => [...new Set(items.map((i) => i.clipId))];

export interface ExportPending {
  clipId: string;
  name: string;
  kind: AiKind;
  pct: number;
  /** 100 − pct */
  missingPct: number;
  seconds: number;
}

/** Efectos de origen que no están calculados del todo (lo que la exportación avisaría). */
export function exportPending(p: VideoProject, masks: MaskCache = matteCache, motion: MotionCache = motionCache): ExportPending[] {
  const out: ExportPending[] = [];
  for (const c of aiCoverage(p, masks, motion)) {
    if (c.have >= c.total) continue;
    const clip = findClip(p, c.clipId)?.clip;
    const name = clip?.name ?? (clip?.mediaId ? p.media[clip.mediaId]?.name : undefined) ?? 'clip';
    const pct = coveragePct(c.have, c.total);
    out.push({ clipId: c.clipId, name, kind: c.kind, pct, missingPct: 100 - pct, seconds: missingTotals(c).seconds });
  }
  return out;
}

/** Texto de la pregunta antes de exportar. «El 60 % del clip «X» no está calculado: ¿calcular antes de exportar?» */
export function exportPromptText(items: ExportPending[]): string {
  if (!items.length) return '';
  const one = (i: ExportPending) => `El ${i.missingPct} % del clip «${i.name}» no está calculado (${AI_KIND_LABEL[i.kind].toLowerCase()})`;
  if (items.length === 1) return `${one(items[0])}: ¿calcular antes de exportar?`;
  return `Hay ${items.length} efectos de IA sin calcular del todo: ¿calcular antes de exportar?`;
}

// ---------- estabilización: vista previa del recorte ----------

export interface StabPreview {
  /** zoom de recorte aplicado (≥ 1) */
  zoom: number;
  /** % del fotograma que se pierde por el recorte (por lado, medio) */
  cropPct: number;
  /** la corrección se limitó por el tope de recorte (queda algo de temblor en los picos) */
  clamped: boolean;
  /** temblor (px del análisis) antes y después, y cuánto baja (0..1) */
  before: number;
  after: number;
  reduction: number;
  /** corrección por fotograma en fracción del fotograma (para dibujar el recorrido del encuadre) */
  path: { x: number; y: number }[];
  frames: number;
}

/** Lo que haría la estabilización con estos parámetros en el tramo ya analizado de [range]; null si no hay movimiento medido. */
export function stabPreview(motion: MotionCache, mediaId: string, range: [number, number], s: { smooth: number; maxZoom: number; rotation: boolean }): StabPreview | null {
  const tr = motion.peek(stabKey(mediaId));
  if (!tr || tr.motion.size < 3) return null;
  const i0 = Math.round(range[0] * tr.fps + 1e-6);
  const i1 = Math.round(range[1] * tr.fps + 1e-6);
  // el mayor tramo contiguo analizado dentro del rango
  let best: [number, number] | null = null;
  let run: number | null = null;
  for (let i = i0; i <= i1 + 1; i++) {
    const has = i <= i1 && tr.motion.has(i);
    if (has && run === null) run = i;
    if (!has && run !== null) {
      if (!best || i - 1 - run > best[1] - best[0]) best = [run, i - 1];
      run = null;
    }
  }
  if (!best || best[1] - best[0] < 2) return null;
  const get = (i: number): Motion | undefined => tr.motion.get(i);
  const corr = stabCorrections(get, best[0], best[1], { fps: tr.fps, w: tr.w, h: tr.h, smooth: s.smooth, maxZoom: s.maxZoom, rotation: s.rotation });
  const traj = trajectory(get, best[0], best[1]);
  const after = new Float64Array(traj.x.length);
  for (let k = 0; k < after.length; k++) after[k] = traj.x[k] + corr.cx[k] * tr.w;
  const before = jitterRms(traj.x);
  const aft = jitterRms(after);
  const step = Math.max(1, Math.floor(corr.cx.length / 60));
  const path: { x: number; y: number }[] = [];
  for (let k = 0; k < corr.cx.length; k += step) path.push({ x: corr.cx[k], y: corr.cy[k] });
  return {
    zoom: corr.zoom,
    cropPct: Math.round((1 - 1 / corr.zoom) * 1000) / 10,
    clamped: corr.clamped,
    before,
    after: aft,
    reduction: before > 1e-9 ? Math.max(0, Math.min(1, 1 - aft / before)) : 0,
    path,
    frames: corr.cx.length,
  };
}

// ---------- estimación (texto para la interfaz) ----------

export function formatMem(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / 1048576;
  return mb < 1024 ? `${mb < 10 ? mb.toFixed(1).replace('.', ',') : Math.round(mb)} MB` : `${(mb / 1024).toFixed(1).replace('.', ',')} GB`;
}

/** Tamaño de una descarga con un decimal («25,9 MB»): el consentimiento nombra el tamaño EXACTO, sin redondear a «26 MB». */
export function formatDownload(bytes: number): string {
  const mb = bytes / 1e6;
  return mb < 1000 ? `${mb.toFixed(1).replace('.', ',')} MB` : `${(mb / 1000).toFixed(2).replace('.', ',')} GB`;
}

/** «≈ 2 min 30 s · ocupa unos 40 MB; pico de memoria ≈ 600 MB». */
export function estimateText(e: { seconds: number; cacheBytes: number; peakBytes: number; frames: number }): string {
  if (e.frames <= 0) return 'Todo lo de este tramo ya está calculado.';
  // la estabilización guarda unos pocos bytes por fotograma: no se menciona la memoria
  const mem = e.cacheBytes >= 1048576 ? ` · las máscaras ocupan ${formatMem(e.cacheBytes)} · pico de memoria ≈ ${formatMem(e.peakBytes)}` : '';
  return `${e.frames} fotogramas · tarda unos ${formatEta(e.seconds)}${mem}`;
}

/** ¿Un clip de video puede llevar estos efectos? (clip de video con medio presente) */
export const canUseAi = (c: Clip | undefined): c is Clip => !!c && c.kind === 'video' && !!c.mediaId;
