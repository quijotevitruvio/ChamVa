import { describe, expect, it } from 'vitest';
import { Biquad, biquadCoeffs, biquadResponseDb } from './biquad';
import { detectBeats } from './beats';
import { SpectralDenoiser } from './denoise';
import { DuckEnvelope, DEFAULT_DUCK } from './duck';
import { EQ_MAX_BANDS, ParametricEq, defaultEqBands, eqCurveDb, eqIsFlat, sanitizeEqBands, type EqBand } from './eq';
import { FFT } from './fft';
import { TruePeakLimiter } from './limiter';
import { LoudnessMeter, TruePeakDetector, kWeightingGainDb, measureLoudness, toDb } from './loudness';
import { applyPan, panGains } from './pan';

const SR = 48000;

/** PRNG determinista (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sine = (freq: number, ampDb: number, seconds: number, sr = SR) => {
  const n = Math.round(seconds * sr);
  const a = Math.pow(10, ampDb / 20);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = a * Math.sin((2 * Math.PI * freq * i) / sr);
  return x;
};
/** Ruido rosa (Voss-McCartney, 16 filas). */
function pink(seconds: number, seed = 1, sr = SR): Float32Array {
  const r = rng(seed);
  const n = Math.round(seconds * sr);
  const rows = new Float64Array(16);
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    rows[i] = r() * 2 - 1;
    sum += rows[i];
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // fila a actualizar = nº de ceros finales de i
    let k = 0;
    let v = i + 1;
    while ((v & 1) === 0 && k < 15) {
      v >>= 1;
      k++;
    }
    sum -= rows[k];
    rows[k] = r() * 2 - 1;
    sum += rows[k];
    out[i] = (sum + (r() * 2 - 1)) / 17;
  }
  return out;
}
const rms = (x: Float32Array, a = 0, b = x.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
};
const scale = (x: Float32Array, db: number) => {
  const g = Math.pow(10, db / 20);
  return x.map((v) => v * g);
};

/** Referencia independiente: BS.1770 en una sola pasada, con los coeficientes publicados a 48 kHz y doble precisión. */
function referenceLufs(L: Float32Array, R: Float32Array): number {
  const stage = (x: Float32Array, b: number[], a: number[]) => {
    const y = new Float64Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
      y[i] = v;
    }
    return y;
  };
  const b1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], a1 = [1, -1.69065929318241, 0.73248077421585];
  const b2 = [1, -2, 1], a2 = [1, -1.99004745483398, 0.99007225036621];
  const k = (x: Float32Array) => stage(Float32Array.from(stage(x, b1, a1)), b2, a2);
  const kl = k(L), kr = k(R);
  const blk = 19200, step = 4800;
  const e: number[] = [];
  for (let s = 0; s + blk <= kl.length; s += step) {
    let z = 0;
    for (let i = s; i < s + blk; i++) z += kl[i] * kl[i] + kr[i] * kr[i];
    e.push(z / blk);
  }
  const lk = (v: number) => -0.691 + 10 * Math.log10(v);
  const abs = e.filter((v) => lk(v) > -70);
  const rel = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const fin = abs.filter((v) => lk(v) > rel);
  return lk(fin.reduce((a, b) => a + b, 0) / fin.length);
}

describe('FFT', () => {
  it('inversa(directa(x)) = x y localiza una frecuencia', () => {
    const fft = new FFT(256);
    const re = new Float64Array(256);
    const im = new Float64Array(256);
    for (let i = 0; i < 256; i++) re[i] = Math.cos((2 * Math.PI * 16 * i) / 256);
    const copy = Float64Array.from(re);
    fft.forward(re, im);
    expect(Math.hypot(re[16], im[16])).toBeCloseTo(128, 3);
    expect(Math.hypot(re[17], im[17])).toBeLessThan(1e-9);
    fft.inverse(re, im);
    for (let i = 0; i < 256; i++) expect(re[i]).toBeCloseTo(copy[i], 9);
  });
});

describe('sonoridad BS.1770 / R128', () => {
  it('ponderación K: ~0 dB a 1 kHz, +4 dB en agudos, corta los graves', () => {
    expect(kWeightingGainDb(1000, SR)).toBeCloseTo(0.69, 1);
    expect(kWeightingGainDb(10000, SR)).toBeGreaterThan(3.5);
    expect(kWeightingGainDb(30, SR)).toBeLessThan(-3);
  });

  it('seno de 1 kHz a −20 dBFS en estéreo = −20 LUFS (±0,1)', () => {
    const x = sine(1000, -20, 20);
    const r = measureLoudness(x, x, SR);
    expect(r.integrated).toBeGreaterThan(-20.1);
    expect(r.integrated).toBeLessThan(-19.9);
    expect(r.momentaryMax).toBeCloseTo(r.integrated, 1);
    expect(r.shortTermMax).toBeCloseTo(r.integrated, 1);
    expect(r.samplePeak).toBeCloseTo(-20, 1);
  });

  it('un solo canal vale 3,01 LU menos; sube 1 LU por cada dB', () => {
    const x = sine(1000, -20, 10);
    const z = new Float32Array(x.length);
    const one = measureLoudness(x, z, SR).integrated;
    const both = measureLoudness(x, x, SR).integrated;
    expect(both - one).toBeCloseTo(3.01, 1);
    expect(measureLoudness(scale(x, 6), scale(x, 6), SR).integrated - both).toBeCloseTo(6, 2);
  });

  it('ruido rosa: coincide con una referencia independiente (±0,02 LU) y es lineal con el nivel', () => {
    const p = pink(30, 7);
    const q = scale(p, -18 - toDb(rms(p)));
    const mine = measureLoudness(q, q, SR).integrated;
    expect(mine).toBeCloseTo(referenceLufs(q, q), 1);
    expect(Math.abs(mine - referenceLufs(q, q))).toBeLessThan(0.02);
    const louder = scale(q, 5);
    expect(measureLoudness(louder, louder, SR).integrated - mine).toBeCloseTo(5, 2);
    // el ruido rosa a −18 dBFS RMS queda en torno a −18..−20 LUFS (referencia de la ponderación K en rosa)
    expect(mine).toBeGreaterThan(-21);
    expect(mine).toBeLessThan(-16);
  });

  it('la medida no depende del tamaño de los bloques', () => {
    const p = pink(12, 3);
    const a = new LoudnessMeter(SR);
    const b = new LoudnessMeter(SR);
    a.process(p, p);
    const r = rng(5);
    for (let i = 0; i < p.length; ) {
      const n = Math.min(p.length - i, 1 + Math.floor(r() * 3000));
      b.process(p.subarray(i, i + n), p.subarray(i, i + n), n);
      i += n;
    }
    expect(b.integrated()).toBeCloseTo(a.integrated(), 6);
    expect(b.truePeakDb()).toBeCloseTo(a.truePeakDb(), 6);
  });

  it('puertas: ignora el silencio (−80 dBFS) y lo 10 LU más bajo que la media', () => {
    const loud = sine(1000, -23, 10);
    const quiet = sine(1000, -50, 10);
    const sil = sine(1000, -80, 10);
    const cat = (...p: Float32Array[]) => {
      const out = new Float32Array(p.reduce((a, b) => a + b.length, 0));
      let o = 0;
      for (const x of p) {
        out.set(x, o);
        o += x.length;
      }
      return out;
    };
    const solo = measureLoudness(loud, loud, SR).integrated;
    const mix = cat(loud, quiet, sil, loud);
    expect(Math.abs(measureLoudness(mix, mix, SR).integrated - solo)).toBeLessThan(0.1);
    // sin puerta relativa (todo a −40 dBFS) sí se mide
    const all = cat(sil, sil);
    expect(measureLoudness(all, all, SR).integrated).toBe(-Infinity);
  });

  it('momentánea y a corto plazo siguen a la señal', () => {
    const m = new LoudnessMeter(SR);
    const a = sine(1000, -30, 4);
    m.process(a, a);
    expect(m.shortTerm()).toBeCloseTo(-30, 0);
    const b = sine(1000, -10, 0.5);
    m.process(b, b);
    expect(m.momentary()).toBeCloseTo(-10, 0);
    expect(m.shortTerm()).toBeGreaterThan(-30);
  });

  it('pico real: un seno a fs/4 con fase de 45° tiene picos de muestra de −3 dB y pico real de ~0 dB', () => {
    const n = 4800;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin((Math.PI / 2) * i + Math.PI / 4);
    const m = new LoudnessMeter(SR);
    m.process(x, x);
    expect(m.samplePeakDb()).toBeCloseTo(-3.01, 1);
    expect(m.truePeakDb()).toBeGreaterThan(-0.3);
    expect(m.truePeakDb()).toBeLessThan(0.15);
  });

  it('el detector devuelve el pico del instante n − DELAY', () => {
    const d = new TruePeakDetector();
    let out = 0;
    for (let i = 0; i < 40; i++) out = d.push(i === 20 ? 1 : 0);
    expect(out).toBeLessThan(0.05);
    const d2 = new TruePeakDetector();
    const seen: number[] = [];
    for (let i = 0; i < 40; i++) seen.push(d2.push(i === 20 ? 1 : 0));
    expect(seen[20 + TruePeakDetector.DELAY]).toBeCloseTo(1, 3);
  });
});

/** Comprobador independiente de pico real: sinc con ventana larga (±48 muestras) sobremuestreada ×16. */
function truePeakRef(x: Float32Array, from = 0, to = x.length): number {
  let best = 0;
  const R = 16;
  const H = 48;
  for (let i = from + H; i < to - H; i++) {
    for (let p = 0; p < R; p++) {
      const f = p / R;
      let s = 0;
      for (let j = -H + 1; j <= H; j++) {
        const d = j - f;
        const w = 0.5 + 0.5 * Math.cos((Math.PI * d) / (H + 1));
        s += x[i + j] * (Math.abs(d) < 1e-12 ? 1 : (Math.sin(Math.PI * d) / (Math.PI * d)) * w);
      }
      best = Math.max(best, Math.abs(s));
    }
  }
  return best;
}

describe('limitador de pico real', () => {
  it('no deja pasar más de −1 dBTP en señal muy fuerte (medido con un comprobador independiente ×16)', () => {
    const r = rng(11);
    const n = Math.round(SR * 0.5);
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    // mezcla de tonos agudos fuertes (muchos picos entre muestras) + ruido
    for (let i = 0; i < n; i++) {
      const a = 1.6 * Math.sin((2 * Math.PI * 11025 * i) / SR + 0.7) + 0.8 * Math.sin((2 * Math.PI * 3000 * i) / SR) + 0.5 * (r() * 2 - 1);
      L[i] = a;
      R[i] = 0.9 * a + 0.3 * Math.sin((2 * Math.PI * 7000 * i) / SR);
    }
    const lim = new TruePeakLimiter(SR, -1.3);
    const oL = Float32Array.from(L);
    const oR = Float32Array.from(R);
    for (let i = 0; i < n; i += 480) lim.process(oL.subarray(i, i + 480), oR.subarray(i, i + 480), 480);
    const skip = lim.latency;
    // alineado: la salida n corresponde a la entrada n − latency
    const chL = oL.subarray(skip + 2000);
    const chR = oR.subarray(skip + 2000);
    const tp = Math.max(truePeakRef(chL, 0, chL.length - 200), truePeakRef(chR, 0, chR.length - 200));
    expect(toDb(tp)).toBeLessThanOrEqual(-1.0);
    expect(lim.reduced).toBeGreaterThan(1000);
    // el medidor del proyecto coincide con el comprobador a ~0,3 dB
    const meter = new LoudnessMeter(SR);
    meter.process(chL, chR);
    expect(Math.abs(meter.truePeakDb() - toDb(tp))).toBeLessThan(0.6);
  });

  it('señal por debajo del techo: sale igual (retardada) sin tocar', () => {
    const x = sine(440, -12, 0.5);
    const lim = new TruePeakLimiter(SR);
    const L = Float32Array.from(x);
    const R = Float32Array.from(x);
    lim.process(L, R);
    for (let i = lim.latency + 10; i < x.length; i++) expect(L[i]).toBeCloseTo(x[i - lim.latency], 6);
    expect(lim.reduced).toBe(0);
  });

  it('no depende del tamaño de bloque', () => {
    const x = sine(2000, 3, 0.3);
    const a = new TruePeakLimiter(SR);
    const b = new TruePeakLimiter(SR);
    const A = Float32Array.from(x), Ar = Float32Array.from(x);
    const B = Float32Array.from(x), Br = Float32Array.from(x);
    a.process(A, Ar);
    for (let i = 0; i < B.length; i += 128) b.process(B.subarray(i, i + 128), Br.subarray(i, i + 128), Math.min(128, B.length - i));
    for (let i = 0; i < A.length; i++) expect(B[i]).toBeCloseTo(A[i], 6);
  });
});

describe('ecualizador paramétrico', () => {
  it('campana de +6 dB a 1 kHz: +6 dB en el centro, ~0 lejos; el filtro real coincide con la curva', () => {
    const band: EqBand = { type: 'peak', f: 1000, g: 6, q: 1 };
    const curve = eqCurveDb([band], [100, 1000, 10000], SR);
    expect(curve[1]).toBeCloseTo(6, 3);
    expect(Math.abs(curve[0])).toBeLessThan(0.7);
    const x = sine(1000, -20, 1);
    const L = Float32Array.from(x);
    const R = Float32Array.from(x);
    new ParametricEq([band], SR).process(L, R);
    expect(toDb(rms(L, SR / 2)) - toDb(rms(x, SR / 2))).toBeCloseTo(6, 1);
  });

  it('estantes y pasos: grave +6 dB en 40 Hz, agudo −6 dB en 15 kHz, paso alto corta 50 Hz', () => {
    const c = eqCurveDb(
      [
        { type: 'lowshelf', f: 120, g: 6, q: 0.707 },
        { type: 'highshelf', f: 9000, g: -6, q: 0.707 },
      ],
      [40, 1000, 15000],
      SR,
    );
    expect(c[0]).toBeGreaterThan(5);
    expect(Math.abs(c[1])).toBeLessThan(0.5);
    expect(c[2]).toBeLessThan(-5);
    const hp = eqCurveDb([{ type: 'highpass', f: 200, g: 0, q: 0.707 }], [50, 1000], SR);
    expect(hp[0]).toBeLessThan(-20);
    expect(Math.abs(hp[1])).toBeLessThan(0.5);
    const notch = eqCurveDb([{ type: 'notch', f: 1000, g: 0, q: 4 }], [1000, 3000], SR);
    expect(notch[0]).toBeLessThan(-40);
  });

  it('plantilla de 7 bandas neutra = plana; bandas apagadas no cuentan; sanea datos malos', () => {
    const d = defaultEqBands();
    expect(d.length).toBeGreaterThanOrEqual(5);
    expect(eqIsFlat(d)).toBe(true);
    expect(eqIsFlat([{ type: 'peak', f: 1000, g: 6, q: 1, on: false }])).toBe(true);
    expect(eqIsFlat([{ type: 'highpass', f: 80, g: 0, q: 0.7 }])).toBe(false);
    const s = sanitizeEqBands([{ type: 'peak', f: 5, g: 99, q: -1 }, { type: 'zzz' }, null, ...new Array(30).fill({ type: 'peak', f: 1000, g: 1, q: 1 })])!;
    expect(s[0].f).toBe(20);
    expect(s[0].g).toBe(24);
    expect(s[0].q).toBe(0.1);
    expect(s.length).toBe(EQ_MAX_BANDS);
    expect(sanitizeEqBands(sanitizeEqBands(s))).toEqual(s);
    expect(sanitizeEqBands('x')).toBeUndefined();
  });

  it('Biquad del módulo conserva la semántica de Web Audio (paso bajo −3 dB en el corte con Q 0 dB... y bypass)', () => {
    expect(new Biquad('peaking', 1000, SR, { gainDb: 0 }).bypass).toBe(true);
    const c = biquadCoeffs('lowpass', 1000, SR, { q: -3.0103 })!; // Q lineal 0,707
    expect(biquadResponseDb(c, 1000, SR)).toBeCloseTo(-3.01, 1);
  });
});

describe('panorámica de potencia constante', () => {
  it('gL² + gR² es constante (=2) en todo el recorrido y el centro es ganancia 1', () => {
    for (let p = -1; p <= 1.0001; p += 0.05) {
      const [l, r] = panGains(p);
      expect(l * l + r * r).toBeCloseTo(2, 10);
    }
    const [cl, cr] = panGains(0);
    expect(cl).toBeCloseTo(1, 12);
    expect(cr).toBeCloseTo(1, 12);
    const [ll, lr] = panGains(-1);
    expect(lr).toBeLessThan(1e-9);
    expect(ll).toBeCloseTo(Math.SQRT2, 9);
  });
  it('applyPan: pan 0 no toca; a la derecha silencia L', () => {
    const L = Float32Array.from([1, 1]);
    const R = Float32Array.from([1, 1]);
    applyPan(L, R, 0);
    expect([L[0], R[0]]).toEqual([1, 1]);
    applyPan(L, R, 1);
    expect(L[0]).toBeLessThan(1e-9);
    expect(R[0]).toBeCloseTo(Math.SQRT2, 6);
  });
});

describe('ducking', () => {
  it('baja la pista X dB mientras suena la señal de control y vuelve al acabar', () => {
    const secs = 4;
    const n = SR * secs;
    const music = sine(220, -18, secs);
    const voice = new Float32Array(n);
    // voz entre 1,0 s y 2,5 s
    for (let i = Math.round(1 * SR); i < Math.round(2.5 * SR); i++) voice[i] = 0.2 * Math.sin((2 * Math.PI * 180 * i) / SR);
    const L = Float32Array.from(music);
    const R = Float32Array.from(music);
    const d = new DuckEnvelope({ ...DEFAULT_DUCK, on: true, db: 14 }, SR);
    d.process(L, R, voice, voice);
    const lvl = (a: number, b: number) => toDb(rms(L, Math.round(a * SR), Math.round(b * SR))) - toDb(rms(music, Math.round(a * SR), Math.round(b * SR)));
    expect(lvl(0.2, 0.9)).toBeGreaterThan(-0.1); // antes de la voz: intacta
    expect(lvl(1.3, 2.4)).toBeLessThan(-13.8); // durante la voz: −14 dB (≥ X)
    expect(lvl(1.3, 2.4)).toBeGreaterThan(-14.3);
    expect(lvl(3.7, 4)).toBeGreaterThan(-1); // recuperada (relajación de 400 ms)
    expect(d.minGainDb).toBeLessThan(-13.9);
  });
  it('sin señal de control no hace nada; entre palabras cortas se mantiene bajada (hold)', () => {
    const music = sine(220, -18, 1);
    const L = Float32Array.from(music);
    const R = Float32Array.from(music);
    new DuckEnvelope({ ...DEFAULT_DUCK, on: true }, SR).process(L, R, null, null);
    expect(L[1234]).toBeCloseTo(music[1234], 7);
    // dos ráfagas de voz separadas 100 ms: la ganancia no sube entre ellas
    const n = SR * 2;
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      if ((t > 0.5 && t < 1.0) || (t > 1.1 && t < 1.6)) v[i] = 0.2 * Math.sin((2 * Math.PI * 200 * i) / SR);
    }
    const m2 = sine(220, -18, 2);
    const A = Float32Array.from(m2), B = Float32Array.from(m2);
    new DuckEnvelope({ ...DEFAULT_DUCK, on: true, db: 12 }, SR).process(A, B, v, v);
    const gap = toDb(rms(A, Math.round(1.04 * SR), Math.round(1.09 * SR))) - toDb(rms(m2, Math.round(1.04 * SR), Math.round(1.09 * SR)));
    expect(gap).toBeLessThan(-11);
  });
});

/** Voz sintética: armónicos de 140 Hz con envolvente de formantes y sílabas de 0,35 s con pausas de 0,3 s. */
function syntheticVoice(seconds: number, sr = SR) {
  const n = Math.round(seconds * sr);
  const x = new Float32Array(n);
  const gate = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const ph = t % 0.65;
    const on = ph < 0.35 ? Math.sin((Math.PI * ph) / 0.35) : 0; // sílaba
    gate[i] = on > 0.05 ? 1 : 0;
    let s = 0;
    const f0 = 140 + 10 * Math.sin(2 * Math.PI * 4 * t);
    for (let h = 1; h <= 24; h++) {
      const f = f0 * h;
      if (f > 4000) break;
      const form = Math.exp(-Math.pow((f - 600) / 400, 2)) + 0.7 * Math.exp(-Math.pow((f - 1700) / 600, 2)) + 0.3 * Math.exp(-Math.pow((f - 3000) / 700, 2));
      s += form * Math.sin(2 * Math.PI * f0 * h * t + h);
    }
    x[i] = 0.12 * on * s;
  }
  return { x, gate };
}

describe('reducción de ruido espectral', () => {
  it('sin ganancia por cuadro (alfa 0) reconstruye la entrada con el retardo de LATENCY', () => {
    const p = pink(1, 2);
    const d = new SpectralDenoiser(0.5, SR);
    (d as unknown as { alpha: number }).alpha = 0;
    (d as unknown as { floor: number }).floor = 1;
    const L = Float32Array.from(p);
    const R = Float32Array.from(p);
    for (let i = 0; i < L.length; i += 128) d.process(L.subarray(i, i + 128), R.subarray(i, i + 128), 128);
    let err = 0;
    for (let i = SpectralDenoiser.LATENCY + 2000; i < p.length; i++) err = Math.max(err, Math.abs(L[i] - p[i - SpectralDenoiser.LATENCY]));
    expect(err).toBeLessThan(1e-4);
  });

  it.each(['blanco+zumbido', 'rosa'])('baja ≥ 10 dB el ruido de fondo (%s) en las pausas y conserva la voz (correlación con la voz limpia)', (kind) => {
    const secs = 10;
    const { x: voice, gate } = syntheticVoice(secs);
    const r = rng(99);
    const n = voice.length;
    const noise = new Float32Array(n);
    if (kind === 'rosa') {
      const p = pink(secs, 21);
      const g = 0.03 / rms(p);
      for (let i = 0; i < n; i++) noise[i] = p[i] * g;
    } else {
      // ruido casi blanco + zumbido de 50 Hz (estacionario)
      for (let i = 0; i < n; i++) noise[i] = 0.02 * (r() + r() + r() - 1.5) * 2 + 0.004 * Math.sin((2 * Math.PI * 50 * i) / SR);
    }
    const noisy = new Float32Array(n);
    for (let i = 0; i < n; i++) noisy[i] = voice[i] + noise[i];
    const L = Float32Array.from(noisy);
    const R = Float32Array.from(noisy);
    const d = new SpectralDenoiser(0.7, SR);
    for (let i = 0; i < n; i += 128) d.process(L.subarray(i, i + 128), R.subarray(i, i + 128), Math.min(128, n - i));
    const lat = SpectralDenoiser.LATENCY;
    // alinear salida con la entrada
    const out = L.subarray(lat);
    // pausas: lejos de las sílabas (±0,08 s), tras 3 s de aprendizaje
    let sIn = 0, sOut = 0, c = 0;
    // sílabas: correlación
    let dotN = 0, dotO = 0, nv = 0, no = 0, nn = 0;
    const margin = Math.round(0.08 * SR);
    for (let i = 3 * SR; i < n - lat; i++) {
      let quiet = true;
      for (const k of [-margin, 0, margin]) if (gate[Math.max(0, Math.min(n - 1, i + k))]) quiet = false;
      if (quiet) {
        sIn += noisy[i] * noisy[i];
        sOut += out[i] * out[i];
        c++;
      } else if (gate[i]) {
        dotN += voice[i] * noisy[i];
        dotO += voice[i] * out[i];
        nv += voice[i] * voice[i];
        no += out[i] * out[i];
        nn += noisy[i] * noisy[i];
      }
    }
    const reduction = 10 * Math.log10(sIn / c) - 10 * Math.log10(sOut / c);
    const corrNoisy = dotN / Math.sqrt(nv * nn);
    const corrOut = dotO / Math.sqrt(nv * no);
    expect(reduction).toBeGreaterThanOrEqual(10);
    expect(corrOut).toBeGreaterThan(0.95);
    expect(corrOut).toBeGreaterThan(corrNoisy - 0.01); // la voz ya estaba muy por encima del ruido: no se degrada
    // la voz no pierde más de 2 dB de nivel
    const lossDb = 10 * Math.log10(no / nv);
    expect(lossDb).toBeGreaterThan(-2);
    expect(lossDb).toBeLessThan(1.5);
  });

  it('intensidad 0 no toca la señal ni añade retardo', () => {
    const x = pink(0.2, 4);
    const L = Float32Array.from(x);
    const R = Float32Array.from(x);
    new SpectralDenoiser(0, SR).process(L, R);
    expect(Array.from(L.subarray(0, 50))).toEqual(Array.from(x.subarray(0, 50)));
  });
});

describe('detección de ritmo', () => {
  /** Bombo sintético: seno de 60 Hz con caída exponencial rápida y un golpe de ruido. */
  function kick(bpm: number, seconds: number, sr = SR) {
    const n = Math.round(seconds * sr);
    const x = new Float32Array(n);
    const period = (60 / bpm) * sr;
    const r = rng(3);
    const times: number[] = [];
    for (let b = 0; b * period < n; b++) {
      const s0 = Math.round(b * period);
      times.push(s0 / sr);
      for (let i = 0; i < 0.25 * sr && s0 + i < n; i++) {
        const t = i / sr;
        x[s0 + i] += 0.8 * Math.exp(-t * 22) * Math.sin(2 * Math.PI * (60 + 90 * Math.exp(-t * 40)) * t) + 0.2 * Math.exp(-t * 200) * (r() * 2 - 1);
      }
    }
    return { x, times };
  }

  it('bombo a 120 BPM: tempo 120 ±1 y pulsos a ≤ 30 ms de los golpes reales', () => {
    const { x, times } = kick(120, 20);
    const res = detectBeats(x, SR);
    expect(res.bpm).toBeGreaterThan(119);
    expect(res.bpm).toBeLessThan(121);
    expect(res.beats.length).toBeGreaterThan(30);
    let hits = 0;
    for (const b of res.beats) if (times.some((t) => Math.abs(t - b) <= 0.03)) hits++;
    expect(hits / res.beats.length).toBeGreaterThan(0.9);
    expect(res.onsets.length).toBeGreaterThan(30);
    expect(res.confidence).toBeGreaterThan(0.2);
  });

  it('bombo a 90 y a 140 BPM', () => {
    for (const bpm of [90, 140]) {
      const { x } = kick(bpm, 16);
      const res = detectBeats(x, SR);
      expect(Math.abs(res.bpm - bpm)).toBeLessThan(1.5);
    }
  });

  it('silencio y audio muy corto no dan pulsos', () => {
    expect(detectBeats(new Float32Array(SR * 5), SR).beats).toEqual([]);
    expect(detectBeats(new Float32Array(100), SR).beats).toEqual([]);
  });
});
