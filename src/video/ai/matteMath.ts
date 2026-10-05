// Quitar fondo de video (V9): lógica PURA de las máscaras (sin lienzo ni modelo), para poder probarla con Vitest.
//  - Resolución de inferencia por modo («calidad» / «rápido»).
//  - Coherencia temporal: filtro bilateral en el tiempo (media ponderada con los fotogramas vecinos, que pesa menos
//    cuanto más cambia el píxel: quita el parpadeo en lo quieto sin dejar estela en lo que se mueve de verdad).
//  - Borde: contraer/expandir («choke») y difuminado («feather») en px de la máscara.
//  - Medidas: IoU con una verdad conocida y parpadeo temporal.
//  - Estimación previa de duración y memoria.
import { boxBlur } from '../../ai/bgcore';

export type MatteMode = 'quality' | 'fast';
export type MatteBg = 'transparent' | 'color' | 'image' | 'blur';

/** Lado corto de la inferencia por modo (MODNet se entrenó a 512 de lado corto; múltiplos de 32). */
export const MATTE_SHORT_SIDE: Record<MatteMode, number> = { quality: 512, fast: 256 };

/** Tamaño (múltiplo de 32) con el que se pasa el fotograma al modelo, conservando la proporción. */
export function inferSize(srcW: number, srcH: number, mode: MatteMode): { w: number; h: number } {
  const s = MATTE_SHORT_SIDE[mode] ?? 512;
  if (!(srcW > 0) || !(srcH > 0)) return { w: s, h: s };
  const k = s / Math.min(srcW, srcH);
  const r32 = (v: number) => Math.max(32, Math.round(v / 32) * 32);
  // el lado largo se topa a 2× el corto (paneles muy panorámicos no disparan la memoria)
  return { w: Math.min(r32(srcW * k), s * 2), h: Math.min(r32(srcH * k), s * 2) };
}

/** Fps con el que se calcula y se indexa la caché de máscaras (fotograma n ↔ instante n / fps del ARCHIVO). */
export const MATTE_FPS = 30;
export const frameIndex = (t: number, fps = MATTE_FPS) => Math.round(t * fps + 1e-6);

/**
 * Suavizado temporal de la máscara del fotograma `i` (bilateral en el tiempo). `strength` 0..1: 0 = la máscara del modelo
 * tal cual. Con fuerza > 0 usa hasta 2 vecinos por lado; el peso de un vecino cae con la distancia en el tiempo y con la
 * diferencia de valor (σ crece con la fuerza): un píxel que cambia mucho (movimiento real) apenas se mezcla.
 */
export function temporalSmooth(get: (i: number) => Uint8Array | undefined, i: number, strength: number): Uint8Array | undefined {
  const cur = get(i);
  if (!cur || !(strength > 0)) return cur;
  const s = Math.min(1, strength);
  const R = s >= 0.5 ? 2 : 1;
  const sigT = 0.6 + 1.2 * s;
  const sigV = 24 + 110 * s; // en niveles 0..255
  const inv2V = 1 / (2 * sigV * sigV);
  const nb: { d: Uint8Array; wt: number }[] = [];
  for (let k = -R; k <= R; k++) {
    if (!k) continue;
    const d = get(i + k);
    if (d && d.length === cur.length) nb.push({ d, wt: Math.exp(-(k * k) / (2 * sigT * sigT)) });
  }
  if (!nb.length) return cur;
  // tabla del peso por diferencia (0..255)
  const wv = new Float32Array(256);
  for (let v = 0; v < 256; v++) wv[v] = Math.exp(-v * v * inv2V);
  const out = new Uint8Array(cur.length);
  for (let p = 0; p < cur.length; p++) {
    const c = cur[p];
    let sum = c;
    let ws = 1;
    for (let q = 0; q < nb.length; q++) {
      const v = nb[q].d[p];
      const w = nb[q].wt * wv[v > c ? v - c : c - v];
      sum += v * w;
      ws += w;
    }
    out[p] = Math.round(sum / ws);
  }
  return out;
}

/**
 * Borde de la máscara: `feather` = radio de difuminado en px de la máscara (dos pasadas de caja ≈ gaussiana) y luego
 * `choke` −0,9..0,9 (positivo contrae, negativo expande, por niveles sobre el borde suave). Devuelve una máscara nueva (no toca la entrada).
 */
export function refineMask(m: Uint8Array, w: number, h: number, feather: number, choke = 0): Uint8Array {
  // mediana 3×3: quita los píxeles sueltos equivocados (salpicaduras del modelo) antes de difuminar, que si no los agranda
  let out: Uint8Array = median3(m, w, h);
  const r = Math.max(0, feather || 0);
  if (r >= 0.5) {
    const half = Math.max(1, Math.round(r / 2));
    let f = new Float32Array(out.length);
    for (let i = 0; i < out.length; i++) f[i] = out[i];
    f = boxBlur(boxBlur(f, w, h, half), w, h, half);
    for (let i = 0; i < f.length; i++) {
      const v = f[i];
      // lo que era 0 o 255 exacto lejos del borde sigue exacto (fondo de color «exacto» al exportar)
      out[i] = v < 0.5 ? 0 : v > 254.5 ? 255 : Math.round(v);
    }
  }
  // contraer/expandir por niveles sobre el borde ya suave (en una máscara dura no cambia nada)
  const c = Math.max(-0.9, Math.min(0.9, choke || 0));
  if (c)
    for (let i = 0; i < out.length; i++) {
      const v = c > 0 ? (out[i] - c * 255) / (1 - c) : out[i] / (1 + c);
      out[i] = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
    }
  return out;
}

/** Mediana 3×3 (bordes replicados). Una máscara de 0/255 sin píxeles sueltos sale igual. */
export function median3(m: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(m.length);
  const v = new Uint8Array(9);
  for (let y = 0; y < h; y++) {
    const y0 = (y > 0 ? y - 1 : 0) * w;
    const y1 = y * w;
    const y2 = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : 0;
      const x2 = x < w - 1 ? x + 1 : x;
      const c = m[y1 + x];
      // atajo: vecindario uniforme (lo más común: fondo o sujeto lleno)
      if (m[y0 + x] === c && m[y2 + x] === c && m[y1 + x0] === c && m[y1 + x2] === c && m[y0 + x0] === c && m[y0 + x2] === c && m[y2 + x0] === c && m[y2 + x2] === c) {
        out[y1 + x] = c;
        continue;
      }
      v[0] = m[y0 + x0];
      v[1] = m[y0 + x];
      v[2] = m[y0 + x2];
      v[3] = m[y1 + x0];
      v[4] = c;
      v[5] = m[y1 + x2];
      v[6] = m[y2 + x0];
      v[7] = m[y2 + x];
      v[8] = m[y2 + x2];
      // inserción (9 valores)
      for (let i = 1; i < 9; i++) {
        const t = v[i];
        let j = i - 1;
        while (j >= 0 && v[j] > t) {
          v[j + 1] = v[j];
          j--;
        }
        v[j + 1] = t;
      }
      out[y1 + x] = v[4];
    }
  }
  return out;
}

/** IoU de dos máscaras (umbral 128 en ambas). */
export function maskIoU(a: ArrayLike<number>, b: ArrayLike<number>, thr = 128): number {
  let inter = 0;
  let uni = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] >= thr;
    const y = b[i] >= thr;
    if (x && y) inter++;
    if (x || y) uni++;
  }
  return uni ? inter / uni : 1;
}

/**
 * Parpadeo temporal: media de |m_t − m_{t−1}| (0..255) en los píxeles donde la VERDAD no cambió entre los dos fotogramas
 * (sin verdad: en todos). Es lo que el ojo ve como borde «hirviendo».
 */
export function temporalFlicker(masks: ArrayLike<number>[], truth?: ArrayLike<number>[], thr = 128): number {
  let sum = 0;
  let n = 0;
  for (let t = 1; t < masks.length; t++) {
    const a = masks[t - 1];
    const b = masks[t];
    const ga = truth?.[t - 1];
    const gb = truth?.[t];
    for (let i = 0; i < b.length; i++) {
      if (ga && gb && ga[i] >= thr !== gb[i] >= thr) continue;
      sum += Math.abs(b[i] - a[i]);
      n++;
    }
  }
  return n ? sum / n : 0;
}

export interface MatteEstimate {
  frames: number;
  inW: number;
  inH: number;
  /** ms por fotograma supuestos (medidos si se pasan) */
  msPerFrame: number;
  seconds: number;
  /** bytes de la caché de máscaras al terminar */
  cacheBytes: number;
  /** pico aproximado de memoria del cálculo (modelo + tensores + caché) */
  peakBytes: number;
  warnings: string[];
}

/** ms por fotograma de MODNet fp32 en WASM (CPU, un hilo de worker), MEDIDOS en el banco V9 (Chrome estable sin cabeza, este equipo,
 * 2026-10-04): 740 ms a 448×256 y 2450 ms a 896×512. Punto de partida de la estimación; durante el cálculo manda el ETA medido. */
export const DEFAULT_MS_PER_FRAME: Record<MatteMode, number> = { quality: 2450, fast: 740 };
/** Tope de la caché de máscaras en memoria. */
export const MATTE_CACHE_BUDGET = 768 * 1024 * 1024;

/** Estimación ANTES de calcular: duración y memoria para un tramo de `seconds` s del archivo. */
export function estimateMatte(o: { seconds: number; srcW: number; srcH: number; mode: MatteMode; msPerFrame?: number; fps?: number; cached?: number }): MatteEstimate {
  const fps = o.fps ?? MATTE_FPS;
  const total = Math.max(0, Math.ceil(o.seconds * fps - 1e-6) + 1);
  const frames = Math.max(0, total - (o.cached ?? 0));
  const { w, h } = inferSize(o.srcW, o.srcH, o.mode);
  const ms = o.msPerFrame ?? DEFAULT_MS_PER_FRAME[o.mode];
  const cacheBytes = total * w * h;
  // modelo fp32 (26 MB) ≈ 150 MB de sesión ORT + tensores de entrada/salida float32 + un fotograma RGBA
  const peakBytes = 150e6 + w * h * 4 * 6 + o.srcW * o.srcH * 4 + cacheBytes;
  const warnings: string[] = [];
  const seconds = (frames * ms) / 1000;
  if (seconds > 600) warnings.push(`Tardará unos ${Math.round(seconds / 60)} min: prueba el modo rápido o un tramo más corto.`);
  if (cacheBytes > MATTE_CACHE_BUDGET) warnings.push(`Las máscaras ocuparían ${Math.round(cacheBytes / 1048576)} MB (más que el tope de ${MATTE_CACHE_BUDGET / 1048576} MB): calcula un tramo más corto o usa el modo rápido.`);
  return { frames, inW: w, inH: h, msPerFrame: ms, seconds, cacheBytes, peakBytes, warnings };
}

/** Texto legible de un tiempo restante (s). */
export function formatEta(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '—';
  if (s < 60) return `${Math.max(1, Math.round(s))} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s - m * 60)} s`;
}

/** ETA con media móvil exponencial del tiempo por fotograma (más estable que el total / hecho). */
export class EtaMeter {
  private avg = 0;
  private n = 0;
  constructor(private total: number, private alpha = 0.15) {}
  tick(msThisFrame: number): number {
    this.n++;
    this.avg = this.n === 1 ? msThisFrame : this.avg * (1 - this.alpha) + msThisFrame * this.alpha;
    return ((this.total - this.n) * this.avg) / 1000;
  }
  get msPerFrame() {
    return this.avg;
  }
}
