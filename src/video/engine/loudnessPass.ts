// Normalización de sonoridad en dos pasadas (V7): la primera mezcla el proyecto SIN ganancia de sonoridad y
// mide la sonoridad integrada (BS.1770, con puertas) y el pico real; la ganancia necesaria es objetivo − medida.
// Si con esa ganancia el limitador de pico real tuviera que actuar (lo que baja algo la sonoridad), se repite la
// mezcla con la ganancia puesta y se corrige con lo que falta, hasta quedar a ±0,05 LU (máx. 3 repeticiones).
// Es la misma mezcla que la exportación final (mismo mezclador, misma cadena): lo medido es lo que sale.
import { LoudnessMeter } from '../audio/loudness';
import { TimelineMixer } from './mixer';

export interface LoudnessSolve {
  /** ganancia a aplicar antes del limitador (dB) */
  gainDb: number;
  /** sonoridad integrada de la mezcla sin ganancia (LUFS); −Infinity si es silencio */
  measured: number;
  /** sonoridad integrada esperada tras aplicar la ganancia y el limitador */
  result: number;
  /** pico real esperado a la salida (dBTP) */
  truePeak: number;
  /** pasadas de mezcla usadas */
  passes: number;
  /** la mezcla no tiene sonido medible */
  silent: boolean;
}

export interface PassOptions {
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
  /** ceiling del limitador (dBTP), para saber si va a actuar */
  ceilingDb: number;
}

const abortError = () => new DOMException('Cancelado', 'AbortError');
const MAX_GAIN = 36;

async function runPass(make: (gainDb: number) => TimelineMixer, gainDb: number, o: PassOptions, base: number, span: number) {
  const m = make(gainDb);
  const pre = new LoudnessMeter(m.sampleRate);
  const post = new LoudnessMeter(m.sampleRate);
  m.master.onPre = (L, R, n) => pre.process(L, R, n);
  try {
    while (!m.finished) {
      if (o.signal?.aborted) throw abortError();
      const b = await m.render(m.sampleRate);
      if (!b.frames) break;
      post.process(b.L, b.R, b.frames);
      o.onProgress?.(base + span * Math.min(1, m.position / Math.max(1, m.totalSamples)));
    }
  } finally {
    m.close();
  }
  return { pre, post };
}

const lufsOf = (m: LoudnessMeter) => {
  const i = m.integrated();
  return Number.isFinite(i) ? i : m.ungated(); // menos de 400 ms: sin bloques, se usa la media sin puertas
};

/** Calcula la ganancia que lleva la mezcla a `target` LUFS integrados con el pico real por debajo del techo. */
export async function solveLoudnessGain(make: (gainDb: number) => TimelineMixer, target: number, o: PassOptions): Promise<LoudnessSolve> {
  let passes = 1;
  const first = await runPass(make, 0, o, 0, 0.5);
  const measured = lufsOf(first.pre);
  if (!Number.isFinite(measured)) return { gainDb: 0, measured, result: measured, truePeak: first.post.truePeakDb(), passes, silent: true };
  let gain = Math.max(-MAX_GAIN, Math.min(MAX_GAIN, target - measured));
  // ¿actuaría el limitador? (pico real previo + ganancia por encima del techo): si no, el resultado es exacto
  const tpRaw = first.pre.truePeakDb();
  if (tpRaw + gain <= o.ceilingDb - 0.05) return { gainDb: gain, measured, result: measured + gain, truePeak: tpRaw + gain, passes, silent: false };
  // El limitador hace que la sonoridad crezca menos que la ganancia: método de la secante sobre pasadas medidas.
  // Se devuelve la ganancia de la MEJOR pasada medida (no una extrapolada), así «result» es lo que de verdad saldrá.
  let best = { gain, result: measured + gain, truePeak: tpRaw + gain, err: Infinity };
  let prev: { g: number; l: number } | null = null;
  for (let k = 0; k < 5; k++) {
    passes++;
    const r = await runPass(make, gain, o, 0.5 + k * 0.1, 0.1);
    const result = lufsOf(r.post);
    const err = target - result;
    if (Math.abs(err) < best.err) best = { gain, result, truePeak: r.post.truePeakDb(), err: Math.abs(err) };
    if (Math.abs(err) <= 0.05) break;
    const slope = prev && Math.abs(gain - prev.g) > 1e-6 ? Math.max(0.15, Math.min(1.2, (result - prev.l) / (gain - prev.g))) : 1;
    prev = { g: gain, l: result };
    gain = Math.max(-MAX_GAIN, Math.min(MAX_GAIN, gain + err / slope));
  }
  return { gainDb: best.gain, measured, result: best.result, truePeak: best.truePeak, passes, silent: false };
}

/** Mide la mezcla tal cual sale (con la ganancia dada): sonoridad integrada y pico real. */
export async function measureMix(make: (gainDb: number) => TimelineMixer, gainDb: number, o: PassOptions): Promise<{ integrated: number; truePeak: number; ungated: number }> {
  const r = await runPass(make, gainDb, o, 0, 1);
  return { integrated: r.post.integrated(), truePeak: r.post.truePeakDb(), ungated: r.post.ungated() };
}
