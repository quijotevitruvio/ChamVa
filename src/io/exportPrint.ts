// Geometría pura para imprimir: unidades, marcas de corte, n-up, pliegos y
// planchas. Sin DOM ni canvas (se prueba en Vitest); el dibujo está en exportPdf.ts.

export const MM_PER_INCH = 25.4;

export type Dpi = 96 | 300;

// px → mm según la resolución elegida (96 dpi de pantalla o 300 dpi de impresión).
export function pxToMm(px: number, dpi: number): number {
  return (px / dpi) * MM_PER_INCH;
}
export function mmToPx(mm: number, dpi: number): number {
  return (mm / MM_PER_INCH) * dpi;
}

export type SheetId = 'a4' | 'letter';
export const SHEETS: Record<SheetId, { w: number; h: number; label: string }> = {
  a4: { w: 210, h: 297, label: 'A4' },
  letter: { w: 215.9, h: 279.4, label: 'Carta' },
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// Limita el sangrado a 0–10 mm.
export function clampBleedMm(mm: number): number {
  if (!Number.isFinite(mm)) return 0;
  return Math.min(10, Math.max(0, mm));
}

// Marcas de esquina (8 segmentos) alrededor de `trim`. Empiezan a `offset` mm del
// borde del corte y miden `len` mm; así quedan siempre fuera del sangrado.
export function cornerMarks(trim: Rect, offset: number, len: number): Seg[] {
  const x0 = trim.x;
  const y0 = trim.y;
  const x1 = trim.x + trim.w;
  const y1 = trim.y + trim.h;
  const out: Seg[] = [];
  for (const y of [y0, y1]) {
    out.push({ x1: x0 - offset - len, y1: y, x2: x0 - offset, y2: y });
    out.push({ x1: x1 + offset, y1: y, x2: x1 + offset + len, y2: y });
  }
  for (const x of [x0, x1]) {
    out.push({ x1: x, y1: y0 - offset - len, x2: x, y2: y0 - offset });
    out.push({ x1: x, y1: y1 + offset, x2: x, y2: y1 + offset + len });
  }
  return out;
}

// Geometría de la página con sangrado y marcas. Coordenadas en mm; el origen es
// la esquina de la página (ya incluye sangrado + zona de marcas).
export interface BleedPageGeom {
  pageW: number;
  pageH: number;
  trim: Rect; // tamaño final (donde se corta)
  bleedRect: Rect; // trim ampliado por el sangrado (donde va la imagen)
  marks: Seg[]; // marcas de corte
  registration: { cx: number; cy: number; r: number }[]; // marcas de registro
}

export const MARK_GAP = 1; // mm entre el sangrado y el inicio de la marca
export const MARK_LEN = 4; // mm de largo de cada marca
export const SLUG = MARK_GAP + MARK_LEN + 2; // zona extra para marcas, fuera del sangrado

export function bleedPageGeometry(
  trimWmm: number,
  trimHmm: number,
  bleedMm: number,
  withCrop: boolean,
  withRegistration: boolean,
): BleedPageGeom {
  const b = clampBleedMm(bleedMm);
  const slug = withCrop || withRegistration ? SLUG : 0;
  const m = b + slug;
  const pageW = trimWmm + 2 * m;
  const pageH = trimHmm + 2 * m;
  const trim = { x: m, y: m, w: trimWmm, h: trimHmm };
  const bleedRect = { x: slug, y: slug, w: trimWmm + 2 * b, h: trimHmm + 2 * b };
  const marks = withCrop ? cornerMarks(trim, b + MARK_GAP, MARK_LEN) : [];
  const registration: BleedPageGeom['registration'] = [];
  if (withRegistration) {
    const d = b + MARK_GAP + MARK_LEN / 2; // distancia del centro al corte
    const r = 1.2;
    registration.push(
      { cx: m + trimWmm / 2, cy: m - d, r },
      { cx: m + trimWmm / 2, cy: m + trimHmm + d, r },
      { cx: m - d, cy: m + trimHmm / 2, r },
      { cx: m + trimWmm + d, cy: m + trimHmm / 2, r },
    );
  }
  return { pageW, pageH, trim, bleedRect, marks, registration };
}

// --- N por hoja -------------------------------------------------------------

export type NUpCount = 2 | 4 | 6 | 9;

const GRIDS: Record<NUpCount, [number, number][]> = {
  // [columnas, filas] de las orientaciones posibles
  2: [[1, 2], [2, 1]],
  4: [[2, 2]],
  6: [[2, 3], [3, 2]],
  9: [[3, 3]],
};

export interface Layout {
  pageW: number;
  pageH: number;
  cols: number;
  rows: number;
  cells: Rect[]; // celdas, de izquierda a derecha y de arriba abajo
}

function gridCells(
  pageW: number,
  pageH: number,
  cols: number,
  rows: number,
  margin: number,
  gutter: number,
): Rect[] {
  const cw = (pageW - 2 * margin - (cols - 1) * gutter) / cols;
  const ch = (pageH - 2 * margin - (rows - 1) * gutter) / rows;
  const cells: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ x: margin + c * (cw + gutter), y: margin + r * (ch + gutter), w: cw, h: ch });
    }
  }
  return cells;
}

// Cuánto cabe una página de proporción `aspect` (ancho/alto) en una celda.
function fitScale(cell: Rect, aspect: number): number {
  return Math.min(cell.w, cell.h * aspect);
}

// Reparte `count` páginas por hoja: prueba las cuadrículas posibles (y la hoja
// vertical u horizontal) y se queda con la que da páginas más grandes.
// Con marcas la separación mínima es 6 mm para que quepan.
export function nUpLayout(
  count: NUpCount,
  sheet: SheetId,
  gutterMm: number,
  marginMm: number,
  aspect: number,
  withMarks: boolean,
): Layout {
  const gutter = Math.max(withMarks ? 6 : 0, gutterMm);
  const margin = Math.max(withMarks ? 6 : 0, marginMm);
  const s = SHEETS[sheet];
  let best: Layout | null = null;
  let bestScale = -1;
  for (const [cols, rows] of GRIDS[count]) {
    for (const landscape of [false, true]) {
      const pageW = landscape ? s.h : s.w;
      const pageH = landscape ? s.w : s.h;
      for (const [c, r] of [[cols, rows], [rows, cols]] as [number, number][]) {
        const cells = gridCells(pageW, pageH, c, r, margin, gutter);
        const sc = fitScale(cells[0], aspect);
        if (sc > bestScale + 1e-9) {
          bestScale = sc;
          best = { pageW, pageH, cols: c, rows: r, cells };
        }
      }
    }
  }
  return best!;
}

// Coloca una página de proporción `aspect` dentro de una celda: contenida y centrada.
export function fitInCell(cell: Rect, aspect: number): Rect {
  let w = cell.w;
  let h = w / aspect;
  if (h > cell.h) {
    h = cell.h;
    w = h * aspect;
  }
  return { x: cell.x + (cell.w - w) / 2, y: cell.y + (cell.h - h) / 2, w, h };
}

// --- Pliegos (cuadernillo) ---------------------------------------------------

export interface BookletSheet {
  front: [number | null, number | null]; // [izquierda, derecha] con índice de página 0-based; null = en blanco
  back: [number | null, number | null];
}

export type SignatureSize = 4 | 8 | 16;

// Imposición de UN cuadernillo de `size` páginas (múltiplo de 4): cada hoja se
// imprime a doble cara y plegada por la mitad. Índices ≥ total → página en blanco.
export function bookletSheets(size: number, total = size, offset = 0): BookletSheet[] {
  const n = Math.ceil(size / 4) * 4;
  const pg = (i: number) => (offset + i < total ? offset + i : null);
  const out: BookletSheet[] = [];
  for (let j = 0; j < n / 4; j++) {
    out.push({
      front: [pg(n - 1 - 2 * j), pg(2 * j)],
      back: [pg(2 * j + 1), pg(n - 2 - 2 * j)],
    });
  }
  return out;
}

// Todos los cuadernillos de un proyecto de `total` páginas.
export function bookletAll(total: number, size: SignatureSize): BookletSheet[] {
  const out: BookletSheet[] = [];
  for (let off = 0; off < total; off += size) out.push(...bookletSheets(size, total, off));
  return out;
}

// --- Plancha de pegatinas / tarjetas ----------------------------------------

export interface StepRepeat extends Layout {
  count: number;
  landscape: boolean;
}

// Repite una pieza de itemW×itemH mm en cuadrícula sobre la hoja, con medianil y
// margen. Prueba la hoja vertical y horizontal y elige la que acomoda más piezas.
export function stepRepeat(
  itemW: number,
  itemH: number,
  sheet: SheetId,
  marginMm: number,
  gutterMm: number,
  withMarks: boolean,
): StepRepeat {
  const gutter = Math.max(withMarks ? 6 : 0, gutterMm);
  const margin = Math.max(withMarks ? 6 : 0, marginMm);
  const s = SHEETS[sheet];
  let best: StepRepeat | null = null;
  for (const landscape of [false, true]) {
    const pageW = landscape ? s.h : s.w;
    const pageH = landscape ? s.w : s.h;
    const cols = Math.max(0, Math.floor((pageW - 2 * margin + gutter + 1e-9) / (itemW + gutter)));
    const rows = Math.max(0, Math.floor((pageH - 2 * margin + gutter + 1e-9) / (itemH + gutter)));
    const total = cols * rows;
    if (!best || total > best.count) {
      // Cuadrícula centrada en la hoja.
      const gw = cols * itemW + (cols - 1) * gutter;
      const gh = rows * itemH + (rows - 1) * gutter;
      const x0 = (pageW - gw) / 2;
      const y0 = (pageH - gh) / 2;
      const cells: Rect[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          cells.push({ x: x0 + c * (itemW + gutter), y: y0 + r * (itemH + gutter), w: itemW, h: itemH });
        }
      }
      best = { pageW, pageH, cols, rows, cells, count: total, landscape };
    }
  }
  return best!;
}
