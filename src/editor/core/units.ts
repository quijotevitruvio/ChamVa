// Unidades de medida del lienzo (lógica pura, sin DOM). Los píxeles siguen siendo
// la verdad del documento; la unidad y los ppp (dpi) son la forma en que el usuario
// piensa el tamaño. 1 in = 25,4 mm = 72 pt = 6 pc.
export type Unit = 'px' | 'mm' | 'cm' | 'in' | 'pt' | 'pc';

export const UNITS: Unit[] = ['px', 'mm', 'cm', 'in', 'pt', 'pc'];
export const DEFAULT_DPI = 96;
export const DPI_CHOICES = [72, 96, 150, 300, 600];
export const MIN_PX = 16;
export const MAX_PX = 8000;
export const MIN_DPI = 36;
export const MAX_DPI = 2400;

// Cuántas pulgadas vale una unidad física (px depende del dpi).
const INCHES: Record<Exclude<Unit, 'px'>, number> = {
  in: 1,
  mm: 1 / 25.4,
  cm: 1 / 2.54,
  pt: 1 / 72,
  pc: 1 / 6,
};

const DECIMALS: Record<Unit, number> = { px: 0, mm: 1, cm: 2, in: 3, pt: 1, pc: 2 };

export function isUnit(u: unknown): u is Unit {
  return typeof u === 'string' && (UNITS as string[]).includes(u);
}

export function isValidDpi(d: unknown): d is number {
  return typeof d === 'number' && isFinite(d) && d >= MIN_DPI && d <= MAX_DPI;
}

function safeDpi(dpi: number): number {
  return isValidDpi(dpi) ? dpi : DEFAULT_DPI;
}

// Valor en la unidad dada → píxeles (sin redondear).
export function toPx(value: number, unit: Unit, dpi: number = DEFAULT_DPI): number {
  if (unit === 'px') return value;
  return value * INCHES[unit] * safeDpi(dpi);
}

// Píxeles → valor en la unidad dada (sin redondear).
export function fromPx(px: number, unit: Unit, dpi: number = DEFAULT_DPI): number {
  if (unit === 'px') return px;
  return px / (INCHES[unit] * safeDpi(dpi));
}

export function convert(value: number, from: Unit, to: Unit, dpi: number = DEFAULT_DPI): number {
  if (from === to) return value;
  return fromPx(toPx(value, from, dpi), to, dpi);
}

// Límites del editor: el código existente no impone tope, así que 16–8000 px.
export function clampPx(px: number): number {
  if (!isFinite(px)) return MIN_PX;
  return Math.min(MAX_PX, Math.max(MIN_PX, Math.round(px)));
}

// «21,59» o «8.5» según el idioma, con los decimales propios de cada unidad y sin ceros sobrantes.
export function formatSize(value: number, unit: Unit, locale?: string): string {
  const loc = locale ?? (typeof navigator !== 'undefined' ? navigator.language : undefined);
  const v = isFinite(value) ? value : 0;
  const opts = { minimumFractionDigits: 0, maximumFractionDigits: DECIMALS[unit], useGrouping: false };
  let nf: Intl.NumberFormat;
  try {
    nf = new Intl.NumberFormat(loc, opts);
  } catch {
    nf = new Intl.NumberFormat(undefined, opts);
  }
  const s = nf.format(v);
  return s === '-0' ? '0' : s;
}

const UNIT_ALIASES: Record<string, Unit> = {
  px: 'px',
  pixel: 'px',
  pixeles: 'px',
  píxeles: 'px',
  mm: 'mm',
  cm: 'cm',
  in: 'in',
  '"': 'in',
  pulg: 'in',
  pulgada: 'in',
  pulgadas: 'in',
  inch: 'in',
  inches: 'in',
  pt: 'pt',
  pc: 'pc',
  pica: 'pc',
  picas: 'pc',
};

// «21,59 cm», «8.5in», «1080», «210mm» → { value, unit? }. Basura → null.
export function parseLength(text: string): { value: number; unit?: Unit } | null {
  if (typeof text !== 'string') return null;
  const m = /^\s*(\d+(?:[.,]\d+)?|[.,]\d+)\s*([^\d\s.,]*)\s*$/.exec(text);
  if (!m) return null;
  const value = Number(m[1].replace(',', '.'));
  if (!isFinite(value)) return null;
  const raw = m[2].toLowerCase();
  if (!raw) return { value };
  const unit = UNIT_ALIASES[raw];
  return unit ? { value, unit } : null;
}

export interface PaperSize {
  id: string;
  label: string;
  group: 'Papel' | 'Impresión';
  widthMm: number; // en vertical (ancho ≤ alto)
  heightMm: number;
}

export const PAPER_SIZES: PaperSize[] = [
  { id: 'a0', label: 'A0', group: 'Papel', widthMm: 841, heightMm: 1189 },
  { id: 'a1', label: 'A1', group: 'Papel', widthMm: 594, heightMm: 841 },
  { id: 'a2', label: 'A2', group: 'Papel', widthMm: 420, heightMm: 594 },
  { id: 'a3', label: 'A3', group: 'Papel', widthMm: 297, heightMm: 420 },
  { id: 'a4', label: 'A4', group: 'Papel', widthMm: 210, heightMm: 297 },
  { id: 'a5', label: 'A5', group: 'Papel', widthMm: 148, heightMm: 210 },
  { id: 'a6', label: 'A6', group: 'Papel', widthMm: 105, heightMm: 148 },
  { id: 'a7', label: 'A7', group: 'Papel', widthMm: 74, heightMm: 105 },
  { id: 'b4', label: 'B4', group: 'Papel', widthMm: 250, heightMm: 353 },
  { id: 'b5', label: 'B5', group: 'Papel', widthMm: 176, heightMm: 250 },
  { id: 'letter', label: 'Carta (Letter)', group: 'Papel', widthMm: 215.9, heightMm: 279.4 },
  { id: 'legal', label: 'Oficio (Legal)', group: 'Papel', widthMm: 215.9, heightMm: 355.6 },
  { id: 'tabloid', label: 'Tabloide', group: 'Papel', widthMm: 279.4, heightMm: 431.8 },
  { id: 'statement', label: 'Statement', group: 'Papel', widthMm: 139.7, heightMm: 215.9 },
  { id: 'bizcard', label: 'Tarjeta de visita 85 × 55 mm', group: 'Impresión', widthMm: 55, heightMm: 85 },
  { id: 'postcard', label: 'Postal 148 × 105 mm', group: 'Impresión', widthMm: 105, heightMm: 148 },
  { id: 'poster18', label: 'Cartel 18 × 24 in', group: 'Impresión', widthMm: 457.2, heightMm: 609.6 },
  { id: 'poster24', label: 'Cartel 24 × 36 in', group: 'Impresión', widthMm: 609.6, heightMm: 914.4 },
];

export function orientation(p: { widthMm: number; heightMm: number }): 'vertical' | 'horizontal' {
  return p.widthMm > p.heightMm ? 'horizontal' : 'vertical';
}

// Tamaño en píxeles de un papel a cierto dpi, en vertical u horizontal.
export function sizeInPx(
  preset: { widthMm: number; heightMm: number },
  dpi: number,
  landscape = false,
): { width: number; height: number } {
  const a = clampPx(toPx(preset.widthMm, 'mm', dpi));
  const b = clampPx(toPx(preset.heightMm, 'mm', dpi));
  const portrait = { width: Math.min(a, b), height: Math.max(a, b) };
  return landscape ? { width: portrait.height, height: portrait.width } : portrait;
}
