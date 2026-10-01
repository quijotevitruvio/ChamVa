import type { Doc, StickyNote } from './types';

// Ayudas de maquetación (márgenes, sangrado, columnas): cálculo puro. Solo se
// dibujan en el editor; nunca entran en las exportaciones.

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export interface Columns {
  count: number;
  gutter: number;
  margin: number;
}
export interface Band {
  x: number;
  w: number;
}

export const NOTE_COLORS = ['#ffffff', '#ececec', '#d4d4d4', '#a8a8a8'];

const num = (v: unknown, def = 0) => (typeof v === 'number' && isFinite(v) ? v : def);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function hasMargins(m: Doc['margins']): m is Margins {
  return !!m && (m.top > 0 || m.right > 0 || m.bottom > 0 || m.left > 0);
}

// Columnas del ancho `width`: `count` bandas separadas por `gutter`, con
// `margin` a cada lado. Se recorta para que nunca salgan anchos negativos.
export function columnBands(width: number, c: Columns): Band[] {
  const count = Math.max(1, Math.round(c.count));
  const margin = clamp(c.margin, 0, width / 2);
  const gutter = Math.max(0, c.gutter);
  const inner = width - margin * 2 - gutter * (count - 1);
  if (inner <= 0) return [];
  const w = inner / count;
  return Array.from({ length: count }, (_, i) => ({ x: margin + i * (w + gutter), w }));
}

// Posiciones de imán que aportan márgenes y columnas (bordes de columna).
export function layoutSnapTargets(doc: Pick<Doc, 'width' | 'height' | 'margins' | 'columns'>): {
  x: number[];
  y: number[];
} {
  const x: number[] = [];
  const y: number[] = [];
  const m = doc.margins;
  if (hasMargins(m)) {
    if (m.left > 0) x.push(m.left);
    if (m.right > 0) x.push(doc.width - m.right);
    if (m.top > 0) y.push(m.top);
    if (m.bottom > 0) y.push(doc.height - m.bottom);
  }
  if (doc.columns && doc.columns.count > 0)
    for (const b of columnBands(doc.width, doc.columns)) x.push(b.x, b.x + b.w);
  return { x, y };
}

// Lee los campos de maquetación de un documento externo y descarta lo inválido.
export function normalizeLayoutFields(doc: Doc): void {
  const raw = doc as unknown as Record<string, unknown>;
  const m = raw.margins as Record<string, unknown> | undefined;
  if (m && typeof m === 'object') {
    const mm = {
      top: Math.max(0, num(m.top)),
      right: Math.max(0, num(m.right)),
      bottom: Math.max(0, num(m.bottom)),
      left: Math.max(0, num(m.left)),
    };
    if (hasMargins(mm)) doc.margins = mm;
    else delete doc.margins;
  } else delete doc.margins;

  const b = num(raw.bleed);
  if (b > 0) doc.bleed = b;
  else delete doc.bleed;

  const c = raw.columns as Record<string, unknown> | undefined;
  if (c && typeof c === 'object' && num(c.count) >= 1)
    doc.columns = {
      count: clamp(Math.round(num(c.count)), 1, 24),
      gutter: Math.max(0, num(c.gutter)),
      margin: Math.max(0, num(c.margin)),
    };
  else delete doc.columns;

  if (Array.isArray(raw.notes)) {
    const notes: StickyNote[] = [];
    for (const n of raw.notes as Record<string, unknown>[]) {
      if (!n || typeof n !== 'object' || typeof n.id !== 'string') continue;
      notes.push({
        id: n.id,
        x: num(n.x),
        y: num(n.y),
        text: typeof n.text === 'string' ? n.text : '',
        color: typeof n.color === 'string' ? n.color : NOTE_COLORS[0],
      });
    }
    if (notes.length) doc.notes = notes;
    else delete doc.notes;
  } else delete doc.notes;

  if (typeof raw.speakerNotes === 'string' && raw.speakerNotes) doc.speakerNotes = raw.speakerNotes;
  else delete doc.speakerNotes;
}
