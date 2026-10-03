// Catálogo de efectos y filtros por clip (V6): tipos, parámetros, preajustes de color («looks») y resolución
// de parámetros efectivos. Puro (sin lienzo): el cálculo de píxeles está en pixel.ts y el orquestador en fxDraw.ts.
//
// Reglas de la pila (`Clip.fx`):
//  - Se aplican EN EL ORDEN del array, cada uno sobre el resultado del anterior; sobre los píxeles ya dibujados del clip
//    (transformación, opacidad y fundido incluidos). Un clip de tipo `adjust` los aplica a todo lo que hay debajo.
//  - `on === false` o `amount <= 0` → se salta. `amount` (0..1) escala la intensidad: cada parámetro numérico escalable
//    vale `valor × amount` (el neutro de todos es 0); el croma, el espejo y las máscaras no escalan, solo se activan.
//  - Parámetros que faltan → valor por defecto del catálogo; fuera de rango → se limitan.
import type { FxInstance, FxParams } from '../model/types';

export type FxCategory = 'Color' | 'Imagen' | 'Forma' | 'Croma';

export interface ParamChoice {
  v: string;
  label: string;
}
export interface ParamDef {
  key: string;
  label: string;
  kind?: 'num' | 'color' | 'choice';
  min?: number;
  max?: number;
  step?: number;
  def: number | string;
  unit?: string;
  choices?: ParamChoice[];
  /** true: el parámetro no se escala con la intensidad */
  fixed?: boolean;
}
export interface FxDef {
  type: string;
  label: string;
  category: FxCategory;
  params: ParamDef[];
  /** no escala con la intensidad (solo se activa o no) */
  binary?: boolean;
}

const num = (key: string, label: string, min: number, max: number, def: number, step = 0.01, unit?: string, fixed?: boolean): ParamDef => ({ key, label, kind: 'num', min, max, step, def, unit, fixed });
const choice = (key: string, label: string, def: string, choices: [string, string][]): ParamDef => ({ key, label, kind: 'choice', def, choices: choices.map(([v, l]) => ({ v, label: l })), fixed: true });
const color = (key: string, label: string, def: string): ParamDef => ({ key, label, kind: 'color', def, fixed: true });

/** Preajustes de color (tipo LUT). Cada uno es una curva por canal + saturación + tinte de sombras/luces. */
export interface Look {
  id: string;
  label: string;
  sat: number;
  con: number;
  bri: number;
  /** levanta los negros (0..0,3): aspecto desvanecido */
  fade: number;
  gamma: number;
  /** ganancia por canal */
  gain: [number, number, number];
  /** tinte de sombras y de luces (fracción de 255) */
  sh: [number, number, number];
  hi: [number, number, number];
  gray?: boolean;
}
const L = (id: string, label: string, o: Partial<Look>): Look => ({ id, label, sat: 1, con: 1, bri: 0, fade: 0, gamma: 1, gain: [1, 1, 1], sh: [0, 0, 0], hi: [0, 0, 0], ...o });

export const LOOKS: Look[] = [
  L('warm', 'Cálido', { sat: 1.08, gain: [1.07, 1.0, 0.9], con: 1.04 }),
  L('cool', 'Frío', { sat: 0.95, gain: [0.92, 1.0, 1.1], con: 1.04 }),
  L('cine', 'Cine (teal y naranja)', { sat: 0.92, con: 1.14, sh: [-0.05, 0.02, 0.07], hi: [0.08, 0.02, -0.06] }),
  L('bw', 'Blanco y negro', { gray: true, con: 1.05 }),
  L('bwhigh', 'B/N contrastado', { gray: true, con: 1.45, bri: -0.03 }),
  L('noir', 'Noir', { gray: true, con: 1.6, bri: -0.08, gamma: 0.9 }),
  L('sepia', 'Sepia', { gray: true, gain: [1.1, 0.95, 0.74], con: 1.05 }),
  L('faded', 'Desvanecido', { sat: 0.78, con: 0.88, fade: 0.12, bri: 0.02 }),
  L('vintage', 'Vintage', { sat: 0.85, con: 0.95, fade: 0.1, gain: [1.06, 1.0, 0.88], sh: [0.02, 0.0, 0.03] }),
  L('vivid', 'Vívido', { sat: 1.45, con: 1.15 }),
  L('pastel', 'Pastel', { sat: 0.8, con: 0.85, bri: 0.07, fade: 0.06 }),
  L('golden', 'Hora dorada', { sat: 1.15, gain: [1.1, 1.02, 0.82], bri: 0.02, hi: [0.05, 0.03, -0.04] }),
  L('sunset', 'Atardecer', { sat: 1.2, con: 1.08, gain: [1.1, 0.95, 0.9], sh: [0.03, -0.02, 0.05], hi: [0.06, 0.0, -0.05] }),
  L('matrix', 'Matrix', { sat: 0.7, con: 1.15, gain: [0.7, 1.12, 0.75], sh: [-0.02, 0.05, -0.02] }),
  L('cyber', 'Cyberpunk', { sat: 1.3, con: 1.2, sh: [0.06, -0.03, 0.1], hi: [-0.04, 0.06, 0.08] }),
  L('film70', 'Película años 70', { sat: 0.9, con: 0.98, fade: 0.08, gain: [1.08, 1.02, 0.85], sh: [0.04, 0.02, 0.0] }),
  L('polaroid', 'Polaroid', { sat: 0.95, con: 0.92, fade: 0.07, bri: 0.04, gain: [1.04, 1.02, 0.94], sh: [0.0, 0.03, 0.04] }),
  L('dreamy', 'Soñador', { sat: 1.05, con: 0.85, bri: 0.09, gamma: 1.12, hi: [0.03, 0.01, 0.04] }),
  L('drama', 'Dramático', { sat: 0.85, con: 1.3, bri: -0.05, gamma: 0.92 }),
  L('bleach', 'Bleach bypass', { sat: 0.5, con: 1.35, bri: -0.02 }),
  L('moody', 'Sombrío', { sat: 0.82, con: 1.1, bri: -0.1, gain: [0.95, 1.0, 1.05] }),
  L('forest', 'Bosque', { sat: 1.05, con: 1.06, gain: [0.92, 1.08, 0.9], sh: [-0.02, 0.03, 0.0] }),
  L('duoblue', 'Azul y ámbar', { sat: 0.75, con: 1.15, sh: [-0.06, 0.0, 0.09], hi: [0.09, 0.04, -0.07] }),
  L('negative', 'Negativo', { con: -1 }),
];

export const lookById = (id: unknown): Look => LOOKS.find((l) => l.id === id) ?? LOOKS[0];

export const FX_DEFS: FxDef[] = [
  // ---- Color ----
  { type: 'brightness', label: 'Brillo', category: 'Color', params: [num('v', 'Brillo', -1, 1, 0.25)] },
  { type: 'contrast', label: 'Contraste', category: 'Color', params: [num('v', 'Contraste', -1, 1, 0.3)] },
  { type: 'saturation', label: 'Saturación', category: 'Color', params: [num('v', 'Saturación', -1, 1, 0.4)] },
  { type: 'temperature', label: 'Temperatura', category: 'Color', params: [num('v', 'Temperatura', -1, 1, 0.4)] },
  { type: 'tint', label: 'Tinte', category: 'Color', params: [num('v', 'Tinte', -1, 1, 0.3)] },
  { type: 'exposure', label: 'Exposición', category: 'Color', params: [num('v', 'Exposición', -1, 1, 0.3)] },
  { type: 'lights', label: 'Luces y sombras', category: 'Color', params: [num('hi', 'Luces', -1, 1, -0.3), num('sh', 'Sombras', -1, 1, 0.3)] },
  { type: 'vibrance', label: 'Intensidad de color', category: 'Color', params: [num('v', 'Vibración', -1, 1, 0.5)] },
  { type: 'hue', label: 'Matiz', category: 'Color', params: [num('v', 'Matiz', -180, 180, 40, 1, '°')] },
  { type: 'vignette', label: 'Viñeta', category: 'Color', params: [num('v', 'Fuerza', 0, 1, 0.6)] },
  { type: 'curves', label: 'Curvas', category: 'Color', params: [num('sh', 'Sombras', -1, 1, -0.2), num('mid', 'Medios', -1, 1, 0), num('hi', 'Luces', -1, 1, 0.2)] },
  {
    type: 'look',
    label: 'Preajuste de color (LUT)',
    category: 'Color',
    params: [choice('preset', 'Preajuste', 'cine', LOOKS.map((l) => [l.id, l.label] as [string, string]))],
  },
  // ---- Imagen ----
  { type: 'blur', label: 'Desenfoque gaussiano', category: 'Imagen', params: [num('r', 'Radio', 0, 40, 8, 0.5, ' px')] },
  { type: 'motionBlur', label: 'Desenfoque de movimiento', category: 'Imagen', params: [num('dist', 'Longitud', 0, 100, 30, 1), num('angle', 'Ángulo', 0, 360, 0, 1, '°', true)] },
  { type: 'sharpen', label: 'Nitidez', category: 'Imagen', params: [num('v', 'Cantidad', 0, 1, 0.6)] },
  { type: 'pixelate', label: 'Pixelar', category: 'Imagen', params: [num('size', 'Tamaño de píxel', 2, 80, 16, 1, ' px')] },
  { type: 'mosaic', label: 'Mosaico', category: 'Imagen', params: [num('size', 'Tamaño de teselas', 6, 80, 24, 1, ' px'), num('gap', 'Junta', 0, 0.5, 0.08, 0.01, '', true)] },
  { type: 'grain', label: 'Grano', category: 'Imagen', params: [num('v', 'Cantidad', 0, 1, 0.35)] },
  { type: 'chromatic', label: 'Aberración cromática (RGB)', category: 'Imagen', params: [num('v', 'Separación', 0, 100, 30, 1), num('angle', 'Ángulo', 0, 360, 0, 1, '°', true)] },
  { type: 'glitch', label: 'Glitch', category: 'Imagen', params: [num('v', 'Intensidad', 0, 100, 40, 1)] },
  { type: 'mirror', label: 'Espejo', category: 'Imagen', binary: true, params: [choice('mode', 'Modo', 'lr', [['lr', 'Izquierda → derecha'], ['rl', 'Derecha → izquierda'], ['tb', 'Arriba → abajo'], ['bt', 'Abajo → arriba'], ['quad', 'Cuatro cuadrantes']])] },
  { type: 'vhs', label: 'Ruido VHS', category: 'Imagen', params: [num('v', 'Intensidad', 0, 1, 0.6)] },
  { type: 'rays', label: 'Rayos de luz', category: 'Imagen', params: [num('v', 'Intensidad', 0, 1, 0.6), num('cx', 'Origen X', 0, 1, 0.8, 0.01, '', true), num('cy', 'Origen Y', 0, 1, 0.15, 0.01, '', true), num('thr', 'Umbral', 0, 1, 0.55, 0.01, '', true)] },
  // ---- Forma ----
  {
    type: 'mask',
    label: 'Máscara / forma',
    category: 'Forma',
    binary: true,
    params: [
      choice('shape', 'Forma', 'circle', [['rect', 'Rectángulo'], ['rounded', 'Esquinas redondeadas'], ['circle', 'Círculo'], ['heart', 'Corazón'], ['star', 'Estrella']]),
      num('size', 'Tamaño', 0.1, 1.5, 0.9, 0.01, '', true),
      num('round', 'Radio de esquina', 0, 0.5, 0.18, 0.01, '', true),
    ],
  },
  { type: 'border', label: 'Borde / contorno', category: 'Forma', params: [num('w', 'Grosor', 0, 40, 6, 0.5, ' px'), color('color', 'Color', '#ffffff')] },
  { type: 'shadow', label: 'Sombra paralela', category: 'Forma', params: [num('blur', 'Desenfoque', 0, 60, 20, 1, ' px'), num('dx', 'Desplazamiento X', -60, 60, 10, 1, ' px', true), num('dy', 'Desplazamiento Y', -60, 60, 12, 1, ' px', true), color('color', 'Color', '#000000')] },
  // ---- Croma ----
  { type: 'chroma', label: 'Croma (clave de color)', category: 'Croma', binary: true, params: [color('color', 'Color a quitar', '#00ff00'), num('tol', 'Tolerancia', 0, 1, 0.35, 0.01, '', true), num('soft', 'Suavizado', 0, 1, 0.15, 0.01, '', true), num('spill', 'Reducir reflejo', 0, 1, 0.5, 0.01, '', true)] },
];

export const fxDef = (type: string): FxDef | undefined => FX_DEFS.find((d) => d.type === type);
export const FX_CATEGORIES: FxCategory[] = ['Color', 'Imagen', 'Forma', 'Croma'];

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Efecto nuevo con valores por defecto. */
export function makeFx(type: string, o: { id?: string; amount?: number; p?: FxParams } = {}): FxInstance {
  const def = fxDef(type);
  const p: FxParams = {};
  for (const pd of def?.params ?? []) p[pd.key] = o.p?.[pd.key] ?? pd.def;
  return { id: o.id ?? `fx${Math.floor(Math.random() * 1e9).toString(36)}`, type, amount: clamp(o.amount ?? 1, 0, 1), p };
}

/** Valores de un preajuste de color por id (para el catálogo de «Ajustes»). */
export const makeLookFx = (lookId: string, amount = 1) => makeFx('look', { amount, p: { preset: lookId } });

/** Parámetros efectivos: por defecto + limitados + escalados por la intensidad. */
export function effectiveParams(fx: FxInstance): Record<string, number | string> {
  const def = fxDef(fx.type);
  const out: Record<string, number | string> = {};
  if (!def) return out;
  const amount = clamp(Number.isFinite(fx.amount) ? fx.amount : 1, 0, 1);
  for (const pd of def.params) {
    const raw = fx.p?.[pd.key];
    if (pd.kind === 'color' || pd.kind === 'choice') {
      out[pd.key] = typeof raw === 'string' ? raw : pd.def;
      continue;
    }
    let v = typeof raw === 'number' && Number.isFinite(raw) ? raw : (pd.def as number);
    v = clamp(v, pd.min ?? -Infinity, pd.max ?? Infinity);
    out[pd.key] = def.binary || pd.fixed ? v : v * amount;
  }
  return out;
}

/** ¿El efecto cambia algo? (encendido, intensidad > 0 y tipo conocido) */
export function fxActive(fx: FxInstance): boolean {
  return fx.on !== false && fx.amount > 0 && !!fxDef(fx.type);
}

/** Efectos que cuentan (activos) en orden de pila. */
export const activeFx = (list: readonly FxInstance[] | undefined): FxInstance[] => (list ? list.filter(fxActive) : []);
