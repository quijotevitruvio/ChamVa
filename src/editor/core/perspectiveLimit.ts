// Tamaño de salida de «Corregir perspectiva»: antes se recortaba a 4096 px EN SILENCIO.
// Ahora se calcula qué tamaño cabe según la memoria, se ofrecen opciones y se avisa.

export interface OutputOption {
  id: 'full' | 'safe' | 'compat';
  label: string;
  w: number;
  h: number;
  /** Factor respecto al tamaño natural del cuadrilátero (≤ 1). */
  f: number;
  /** Supera lo que cabe cómodamente en la memoria estimada: puede ir lento o fallar. */
  risky: boolean;
}

export interface OutputPlan {
  natural: { w: number; h: number };
  options: OutputOption[];
  defaultId: OutputOption['id'];
  /** true si la opción por defecto es menor que el tamaño natural (hay que avisar). */
  reduced: boolean;
}

// Límites duros de un canvas en Chromium/WebView2 (lado y área); con margen.
export const CANVAS_MAX_SIDE = 16384;
export const CANVAS_MAX_AREA = 200_000_000;
/** Lado clásico de compatibilidad (el tope antiguo, ahora solo una opción). */
export const COMPAT_SIDE = 4096;
// Bytes de memoria por píxel de SALIDA durante la corrección (buffer de warp + canvas + copias).
const BYTES_PER_OUT_PX = 16;
// Y por píxel de la fuente (canvas + ImageData ya vivos).
const BYTES_PER_SRC_PX = 8;
const MIN_OUT_PX = 4_000_000;

// Presupuesto en bytes. `deviceMemory` (GB, API de Chromium; 8 es su máximo) puede faltar
// (WebView de Android, Safari…): se asume un equipo medio de 4 GB.
export function memoryBudgetBytes(deviceMemoryGB?: number): number {
  const gb = typeof deviceMemoryGB === 'number' && deviceMemoryGB > 0 ? deviceMemoryGB : 4;
  return gb * 1024 ** 3 * 0.2;
}

const fmtMp = (w: number, h: number) => `${((w * h) / 1e6).toFixed(w * h >= 1e7 ? 0 : 1)} MP`;

function scaled(w: number, h: number, f: number) {
  return { w: Math.max(1, Math.round(w * f)), h: Math.max(1, Math.round(h * f)) };
}

export function planPerspectiveOutput(
  natural: { w: number; h: number },
  srcPixels: number,
  deviceMemoryGB?: number,
): OutputPlan {
  const nw = Math.max(1, Math.round(natural.w));
  const nh = Math.max(1, Math.round(natural.h));
  const hardF = Math.min(1, CANVAS_MAX_SIDE / Math.max(nw, nh), Math.sqrt(CANVAS_MAX_AREA / (nw * nh)));
  // Mínimo útil: siempre cabe una salida de ~4 MP aunque la fuente ya ocupe casi todo.
  const room = Math.max(MIN_OUT_PX * BYTES_PER_OUT_PX, memoryBudgetBytes(deviceMemoryGB) - srcPixels * BYTES_PER_SRC_PX);
  const memF = Math.min(1, Math.sqrt(room / BYTES_PER_OUT_PX / (nw * nh)));
  const safeF = Math.min(hardF, memF);

  const options: OutputOption[] = [];
  const add = (id: OutputOption['id'], name: string, f: number, risky: boolean) => {
    const s = scaled(nw, nh, f);
    if (options.some((o) => o.w === s.w && o.h === s.h)) return;
    options.push({ id, label: `${name}: ${s.w}×${s.h} px (${fmtMp(s.w, s.h)})`, w: s.w, h: s.h, f, risky });
  };
  // Máximo permitido por el canvas (puede superar la memoria estimada → «risky»).
  add('full', hardF < 1 ? 'Máximo del navegador' : 'Tamaño original', hardF, hardF > safeF + 1e-9);
  if (safeF < hardF - 1e-9) add('safe', 'Recomendado para tu memoria', safeF, false);
  const compatF = Math.min(safeF, COMPAT_SIDE / Math.max(nw, nh));
  if (compatF < Math.min(hardF, safeF) - 1e-9) add('compat', `Reducido a ${COMPAT_SIDE} px`, compatF, false);

  const defaultOpt = options.find((o) => !o.risky) ?? options[options.length - 1];
  return {
    natural: { w: nw, h: nh },
    options,
    defaultId: defaultOpt.id,
    reduced: defaultOpt.w < nw || defaultOpt.h < nh,
  };
}
