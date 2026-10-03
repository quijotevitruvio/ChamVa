// Ecualizador paramétrico: bandas con tipo (paso alto/bajo, estante grave/agudo, campana, muesca),
// frecuencia, ganancia y Q. Una sola implementación para clip, pista y maestra, en la exportación y
// en la vista previa (AudioWorklet). `eqCurveDb` da la curva que dibuja el editor.
import { Biquad, biquadCoeffs, biquadResponseDb, type BiquadCoeffs, type BiquadType } from './biquad';

export type EqType = 'highpass' | 'lowshelf' | 'peak' | 'highshelf' | 'lowpass' | 'notch';

export interface EqBand {
  type: EqType;
  /** Hz */
  f: number;
  /** dB (ignorado en paso alto/bajo y muesca) */
  g: number;
  /** Q lineal */
  q: number;
  /** false = apagada (se conserva) */
  on?: boolean;
}

export const EQ_MIN_HZ = 20;
export const EQ_MAX_HZ = 20000;
export const EQ_MAX_BANDS = 12;

export const EQ_TYPE_LABEL: Record<EqType, string> = {
  highpass: 'Paso alto',
  lowshelf: 'Estante grave',
  peak: 'Campana',
  highshelf: 'Estante agudo',
  lowpass: 'Paso bajo',
  notch: 'Muesca',
};

/** Plantilla de 7 bandas, todas neutras (los pasos alto/bajo apagados). */
export function defaultEqBands(): EqBand[] {
  return [
    { type: 'highpass', f: 80, g: 0, q: 0.707, on: false },
    { type: 'lowshelf', f: 120, g: 0, q: 0.707 },
    { type: 'peak', f: 400, g: 0, q: 1 },
    { type: 'peak', f: 1500, g: 0, q: 1 },
    { type: 'peak', f: 4000, g: 0, q: 1 },
    { type: 'highshelf', f: 9000, g: 0, q: 0.707 },
    { type: 'lowpass', f: 16000, g: 0, q: 0.707, on: false },
  ];
}

const hasGain = (t: EqType) => t === 'peak' || t === 'lowshelf' || t === 'highshelf';

/** ¿La banda cambia el sonido? */
export function bandActive(b: EqBand): boolean {
  if (b.on === false) return false;
  return hasGain(b.type) ? b.g !== 0 : true;
}

export const eqIsFlat = (bands: readonly EqBand[] | undefined): boolean => !bands || !bands.some(bandActive);

const TYPE_MAP: Record<EqType, BiquadType> = { highpass: 'highpass', lowshelf: 'lowshelf', peak: 'peaking', highshelf: 'highshelf', lowpass: 'lowpass', notch: 'notch' };

/** Coeficientes de una banda (null = no hace nada). */
export function bandCoeffs(b: EqBand, sampleRate: number): BiquadCoeffs | null {
  if (!bandActive(b)) return null;
  const q = b.type === 'highpass' || b.type === 'lowpass' ? 20 * Math.log10(Math.max(0.1, b.q)) : b.q; // Web Audio: Q de paso alto/bajo en dB
  return biquadCoeffs(TYPE_MAP[b.type], b.f, sampleRate, { q, gainDb: hasGain(b.type) ? b.g : 0 });
}

/** Curva total (dB) en las frecuencias dadas. */
export function eqCurveDb(bands: readonly EqBand[], freqs: ArrayLike<number>, sampleRate = 48000): Float64Array {
  const out = new Float64Array(freqs.length);
  for (const b of bands) {
    const c = bandCoeffs(b, sampleRate);
    if (!c) continue;
    for (let i = 0; i < freqs.length; i++) out[i] += biquadResponseDb(c, freqs[i], sampleRate);
  }
  return out;
}

/** Ecualizador en serie: cada banda activa es un bicuadrático (estado propio por canal). */
export class ParametricEq {
  private filters: Biquad[] = [];
  constructor(bands: readonly EqBand[] | undefined, sampleRate: number, channels = 2) {
    for (const b of bands ?? []) {
      if (!bandActive(b)) continue;
      const q = b.type === 'highpass' || b.type === 'lowpass' ? 20 * Math.log10(Math.max(0.1, b.q)) : b.q;
      const f = new Biquad(TYPE_MAP[b.type], b.f, sampleRate, { q, gainDb: hasGain(b.type) ? b.g : 0 }, channels);
      if (!f.bypass) this.filters.push(f);
    }
  }
  get active(): boolean {
    return this.filters.length > 0;
  }
  process(L: Float32Array, R: Float32Array, n = L.length) {
    for (const f of this.filters) {
      f.process(L, 0, n);
      f.process(R, 1, n);
    }
  }
}

/** Clave estable para comparar dos listas de bandas (reconstruir solo si cambian). */
export function eqKey(bands: readonly EqBand[] | undefined): string {
  if (eqIsFlat(bands)) return '';
  return bands!
    .filter(bandActive)
    .map((b) => `${b.type}:${b.f}:${b.g}:${b.q}`)
    .join('|');
}

const EQ_TYPES: EqType[] = ['highpass', 'lowshelf', 'peak', 'highshelf', 'lowpass', 'notch'];

/** Lee bandas de datos no fiables (idempotente). Devuelve undefined si no hay nada que conservar (todo neutro y sin cambios de plantilla). */
export function sanitizeEqBands(raw: unknown): EqBand[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: EqBand[] = [];
  for (const r of raw) {
    if (out.length >= EQ_MAX_BANDS) break;
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (!EQ_TYPES.includes(o.type as EqType)) continue;
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const type = o.type as EqType;
    const band: EqBand = {
      type,
      f: Math.max(EQ_MIN_HZ, Math.min(EQ_MAX_HZ, num(o.f, 1000))),
      g: Math.max(-24, Math.min(24, num(o.g, 0))),
      q: Math.max(0.1, Math.min(18, num(o.q, 1))),
    };
    if (o.on === false) band.on = false;
    out.push(band);
  }
  return out.length ? out : undefined;
}
