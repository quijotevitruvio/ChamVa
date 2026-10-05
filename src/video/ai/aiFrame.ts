// V9: efectos de origen sobre el FOTOGRAMA DEL ARCHIVO (antes de la transformación del clip): estabilizar y quitar fondo.
// Lo llama `composeFrame` (la única composición: exportación, vista previa y miniaturas), así que lo que se ve es lo que
// sale. Solo LEE de las cachés (`cache.ts`): sin cálculo previo el fotograma queda tal cual y `aiNoticesAt` lo avisa.
import type { Clip, FxInstance, VideoProject } from '../model/types';
import { AI_FX, effectiveParams, fxActive } from '../fx/effects';
import { fxAt } from '../fx/keyframes';
import { getScratch } from '../fx/scratch';
import { clipsAt, sourceTimeAt } from '../model/query';
import { matteCache, matteKey, motionCache, stabKey, type MaskCache, type MotionCache } from './cache';
import { MATTE_FPS, refineMask, temporalSmooth, type MatteBg, type MatteMode } from './matteMath';
import { stabCorrections, type Corrections } from './stabMath';

export interface AiFrameIn {
  image: CanvasImageSource;
  width: number;
  height: number;
  rotation: number;
}

export interface AiParams {
  matte?: { mode: MatteMode; bg: MatteBg; color: string; bgMedia: string; feather: number; choke: number; smooth: number; blur: number };
  stab?: { smooth: number; maxZoom: number; rotation: boolean };
}

/** ¿Tiene el clip algún efecto de origen activo? (barato: sin fotogramas clave) */
export const hasAiFx = (c: Pick<Clip, 'fx' | 'kind'>) => c.kind === 'video' && !!c.fx?.some((f) => AI_FX.has(f.type) && fxActive(f));

/** Parámetros efectivos de los efectos de origen del clip en el instante tt (con fotogramas clave). El último de cada tipo manda. */
export function aiParamsOf(clip: Clip, tt: number): AiParams {
  const out: AiParams = {};
  if (!clip.fx) return out;
  for (const raw of clip.fx) {
    if (!AI_FX.has(raw.type) || !fxActive(raw)) continue;
    const f: FxInstance = fxAt(clip, raw, tt);
    const q = effectiveParams(f);
    if (f.type === 'bgremove')
      out.matte = {
        mode: q.mode === 'fast' ? 'fast' : 'quality',
        bg: (['transparent', 'color', 'image', 'blur'].includes(String(q.bg)) ? q.bg : 'transparent') as MatteBg,
        color: typeof q.color === 'string' ? q.color : '#00b140',
        bgMedia: typeof q.bgMedia === 'string' ? q.bgMedia : '',
        feather: Number(q.feather) || 0,
        choke: Number(q.choke) || 0,
        smooth: Number(q.smooth) || 0,
        blur: Number(q.blur) || 0,
      };
    else if (f.type === 'stabilize') out.stab = { smooth: Number(q.smooth) || 1, maxZoom: Number(q.maxZoom) || 1.2, rotation: q.rotation !== 'off' };
  }
  return out;
}

// ---------- memorias (pequeñas, LRU) ----------
class Lru<V> {
  private m = new Map<string, V>();
  constructor(private max: number) {}
  get(k: string): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  set(k: string, v: V) {
    this.m.set(k, v);
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value!);
  }
  clear() {
    this.m.clear();
  }
}
const maskMemo = new Lru<ImageData>(48);
const corrMemo = new Lru<Corrections>(16);

/** Máscara final (suavizado temporal + borde) del instante t del archivo, o null si no está calculada. */
export function finalMask(cache: MaskCache, key: string, t: number, m: NonNullable<AiParams['matte']>): { data: Uint8Array; w: number; h: number; idx: number } | null {
  const hit = cache.lookup(key, t);
  if (!hit) return null;
  const { track: tr, idx } = hit;
  const sm = temporalSmooth((i) => tr.frames.get(i), idx, m.smooth)!;
  const feather = (m.feather * Math.min(tr.w, tr.h)) / 720;
  return { data: refineMask(sm, tr.w, tr.h, feather, m.choke), w: tr.w, h: tr.h, idx };
}

function maskImage(cache: MaskCache, key: string, t: number, m: NonNullable<AiParams['matte']>): ImageData | null {
  const tr = cache.peek(key);
  if (!tr) return null;
  const i = Math.round(t * tr.fps + 1e-6);
  const mk = `${key}|${cache.version}|${i}|${m.smooth}|${m.feather}|${m.choke}`;
  const got = maskMemo.get(mk);
  if (got) return got;
  const fm = finalMask(cache, key, t, m);
  if (!fm) return null;
  const img = new ImageData(fm.w, fm.h);
  const d = img.data;
  for (let p = 0, q = 3; p < fm.data.length; p++, q += 4) d[q] = fm.data[p];
  maskMemo.set(mk, img);
  return img;
}

/** Correcciones de estabilización del fotograma idx (null si ese tramo no está analizado). */
export function stabAt(cache: MotionCache, key: string, t: number, s: NonNullable<AiParams['stab']>): { cx: number; cy: number; ca: number; zoom: number } | null {
  const tr = cache.peek(key);
  if (!tr || !tr.motion.size) return null;
  const idx = Math.round(t * tr.fps + 1e-6);
  if (!tr.motion.has(idx)) return null;
  // tramo contiguo analizado que contiene idx
  let i0 = idx;
  while (tr.motion.has(i0 - 1)) i0--;
  let i1 = idx;
  while (tr.motion.has(i1 + 1)) i1++;
  const mk = `${key}|${cache.version}|${i0}|${i1}|${s.smooth}|${s.maxZoom}|${s.rotation}`;
  let c = corrMemo.get(mk);
  if (!c) {
    c = stabCorrections((i) => tr.motion.get(i), i0, i1, { fps: tr.fps, w: tr.w, h: tr.h, smooth: s.smooth, maxZoom: s.maxZoom, rotation: s.rotation });
    corrMemo.set(mk, c);
  }
  const k = idx - c.i0;
  return { cx: c.cx[k], cy: c.cy[k], ca: c.ca[k], zoom: c.zoom };
}

type C2 = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function applyStab(ctx: C2, w: number, h: number, st: { cx: number; cy: number; ca: number; zoom: number } | null) {
  if (!st) return;
  ctx.translate(w / 2, h / 2);
  ctx.scale(st.zoom, st.zoom);
  ctx.translate(st.cx * w, st.cy * h);
  if (st.ca) ctx.rotate(st.ca);
  ctx.translate(-w / 2, -h / 2);
}

export interface AiEnv {
  /** tamaño de la salida (el fotograma procesado no pasa de su lado largo) */
  outW: number;
  outH: number;
  /** imagen de un medio (fondo «imagen») */
  image(mediaId: string): CanvasImageSource | null;
  /** cachés (pruebas); por defecto las de la sesión */
  masks?: MaskCache;
  motion?: MotionCache;
}

/**
 * Fotograma del archivo con los efectos de origen aplicados (estabilizar → quitar fondo con su fondo), o el MISMO
 * fotograma si el clip no tiene ninguno. `srcTime` = instante del archivo que se ve. `slot` distingue lienzos de trabajo.
 */
export function processAiFrame(clip: Clip, f: AiFrameIn, srcTime: number, tt: number, env: AiEnv, slot = ''): AiFrameIn {
  if (!hasAiFx(clip) || !clip.mediaId) return f;
  const prm = aiParamsOf(clip, tt);
  if (!prm.matte && !prm.stab) return f;
  const masks = env.masks ?? matteCache;
  const motion = env.motion ?? motionCache;
  const st = prm.stab ? stabAt(motion, stabKey(clip.mediaId), srcTime, prm.stab) : null;
  const mimg = prm.matte ? maskImage(masks, matteKey(clip.mediaId, prm.matte.mode), srcTime, prm.matte) : null;
  if (!st && !mimg) return f; // nada calculado: se ve el original (y se avisa aparte)
  const k = Math.min(1, Math.max(env.outW, env.outH) / Math.max(f.width, f.height, 1));
  const pw = Math.max(2, Math.round(f.width * k));
  const ph = Math.max(2, Math.round(f.height * k));
  const s = getScratch(`ai:${clip.id}${slot}`, pw, ph);
  const ctx = s.ctx;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  applyStab(ctx, pw, ph, st);
  ctx.drawImage(f.image, 0, 0, pw, ph);
  ctx.restore();
  if (mimg && prm.matte) {
    const mc = getScratch(`aim:${clip.id}${slot}`, mimg.width, mimg.height);
    mc.ctx.putImageData(mimg, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    applyStab(ctx, pw, ph, st);
    ctx.drawImage(mc.canvas as CanvasImageSource, 0, 0, pw, ph);
    ctx.restore();
    const m = prm.matte;
    if (m.bg !== 'transparent') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-over';
      if (m.bg === 'color') {
        ctx.fillStyle = m.color;
        ctx.fillRect(0, 0, pw, ph);
      } else if (m.bg === 'blur') {
        const r = (m.blur * Math.max(pw, ph)) / 1280;
        if (r > 0.3) ctx.filter = `blur(${r.toFixed(2)}px)`;
        applyStab(ctx, pw, ph, st);
        // un poco más grande: el desenfoque no oscurece los bordes
        const e = r * 2;
        ctx.drawImage(f.image, -e, -e, pw + 2 * e, ph + 2 * e);
      } else if (m.bg === 'image') {
        const img = m.bgMedia ? env.image(m.bgMedia) : null;
        const dims = img as unknown as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number } | null;
        const iw = dims?.naturalWidth || dims?.width || 0;
        const ih = dims?.naturalHeight || dims?.height || 0;
        if (img && iw && ih) {
          const c = Math.max(pw / iw, ph / ih); // cubrir
          ctx.drawImage(img, (pw - iw * c) / 2, (ph - ih * c) / 2, iw * c, ih * c);
        }
      }
      ctx.restore();
    }
  }
  return { image: s.canvas as CanvasImageSource, width: pw, height: ph, rotation: f.rotation };
}

// ---------- cobertura y avisos ----------

export interface AiCoverage {
  clipId: string;
  kind: 'bgremove' | 'stabilize';
  have: number;
  total: number;
  /** tramos sin calcular (s del archivo) */
  missing: [number, number][];
}

/** Tramo del archivo que usa el clip (s). */
export function clipSourceRange(c: Clip): [number, number] {
  if (c.freeze) return [c.inP, c.inP];
  return [Math.min(c.inP, c.outP), Math.max(c.inP, c.outP)];
}

/** Qué tienen calculado los clips con efectos de origen (para avisar antes de exportar). */
export function aiCoverage(p: VideoProject, masks: MaskCache = matteCache, motion: MotionCache = motionCache): AiCoverage[] {
  const out: AiCoverage[] = [];
  for (const t of p.tracks)
    for (const c of t.clips) {
      if (!hasAiFx(c) || !c.mediaId) continue;
      const prm = aiParamsOf(c, c.start);
      const [a, b] = clipSourceRange(c);
      if (prm.matte) out.push({ clipId: c.id, kind: 'bgremove', ...masks.coverage(matteKey(c.mediaId, prm.matte.mode), a, b, MATTE_FPS) });
      if (prm.stab) {
        const tr = motion.peek(stabKey(c.mediaId));
        const fps = tr?.fps ?? MATTE_FPS;
        const i0 = Math.round(a * fps + 1e-6);
        const i1 = Math.max(i0, Math.round(b * fps + 1e-6));
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
        out.push({ clipId: c.id, kind: 'stabilize', have, total: i1 - i0 + 1, missing });
      }
    }
  return out;
}

/** Avisos legibles de la cobertura (vacío = todo calculado). */
export function aiCoverageNotices(p: VideoProject, masks: MaskCache = matteCache, motion: MotionCache = motionCache): string[] {
  const out: string[] = [];
  for (const c of aiCoverage(p, masks, motion)) {
    if (c.have >= c.total) continue;
    const what = c.kind === 'bgremove' ? 'Quitar fondo' : 'Estabilizar';
    const pct = Math.round((100 * c.have) / Math.max(1, c.total));
    out.push(`${what}: el clip «${c.clipId}» tiene calculado el ${pct} % (${c.have}/${c.total} fotogramas); lo que falta sale sin el efecto. Calcúlalo antes para que salga entero.`);
  }
  return out;
}

/** Avisos para la vista previa en el instante t: efectos de origen que en este punto aún no están calculados. */
export function aiNoticesAt(p: VideoProject, t: number, masks: MaskCache = matteCache, motion: MotionCache = motionCache): string[] {
  const out: string[] = [];
  for (const { clip } of clipsAt(p, t).visual) {
    if (!hasAiFx(clip) || !clip.mediaId) continue;
    const prm = aiParamsOf(clip, t);
    const st = sourceTimeAt(clip, t);
    if (prm.matte && !masks.lookup(matteKey(clip.mediaId, prm.matte.mode), st)) out.push('Quitar fondo aún no está calculado aquí: se ve el original.');
    if (prm.stab && !stabAt(motion, stabKey(clip.mediaId), st, prm.stab)) out.push('La estabilización aún no está analizada aquí: se ve sin estabilizar.');
  }
  return [...new Set(out)];
}

/** Ids de medio que usan como fondo los clips con «quitar fondo» (la exportación los carga). */
export function aiBackgroundMedia(p: VideoProject): string[] {
  const ids = new Set<string>();
  for (const t of p.tracks)
    for (const c of t.clips)
      for (const f of c.fx ?? []) if (f.type === 'bgremove' && fxActive(f) && typeof f.p?.bgMedia === 'string' && f.p.bgMedia && f.p.bg === 'image') ids.add(f.p.bgMedia);
  return [...ids];
}

/** Olvida las memorias de máscaras y correcciones (p. ej. al cerrar el editor). */
export function clearAiMemo() {
  maskMemo.clear();
  corrMemo.clear();
}
