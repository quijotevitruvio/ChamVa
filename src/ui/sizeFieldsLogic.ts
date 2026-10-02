// Lógica pura de SizeFields (sin React): conversión al cambiar unidad/dpi, validación y resumen.
// width/height están SIEMPRE en píxeles (la verdad del documento); la unidad y el dpi solo
// deciden cómo se muestran y se escriben.
import {
  DEFAULT_DPI, clampPx, formatSize, fromPx, isValidDpi, parseLength, sizeInPx, toPx,
  type PaperSize, type Unit,
} from '../editor/core/units';

export interface SizeValue {
  width: number; // px
  height: number; // px
  unit: Unit;
  dpi: number;
}

export type Axis = 'width' | 'height';

export function sanitize(v: SizeValue): SizeValue {
  return {
    width: clampPx(v.width),
    height: clampPx(v.height),
    unit: v.unit,
    dpi: isValidDpi(v.dpi) ? v.dpi : DEFAULT_DPI,
  };
}

// Número que se muestra en el campo, en la unidad elegida.
export function fieldText(v: SizeValue, axis: Axis, locale?: string): string {
  return formatSize(fromPx(v[axis], v.unit, v.dpi), v.unit, locale);
}

// Cambiar la unidad CONVIERTE el número mostrado: los píxeles no cambian.
export function changeUnit(v: SizeValue, unit: Unit): SizeValue {
  return { ...v, unit };
}

// Cambiar el dpi mantiene las unidades físicas y recalcula los píxeles.
// Con la unidad en px no hay medida física que conservar: solo cambia el dpi.
export function changeDpi(v: SizeValue, dpi: number): SizeValue {
  if (!isValidDpi(dpi) || dpi === v.dpi) return v;
  if (v.unit === 'px') return { ...v, dpi };
  const re = (px: number) => clampPx(toPx(fromPx(px, v.unit, v.dpi), v.unit, dpi));
  return { ...v, width: re(v.width), height: re(v.height), dpi };
}

// Valida lo escrito en un campo (al salir o con Enter). Texto inválido → null (se restaura el anterior).
// Si el texto trae unidad («21 cm») se adopta como unidad del diseño.
export function commitField(v: SizeValue, axis: Axis, text: string, lock: boolean): SizeValue | null {
  const p = parseLength(text);
  if (!p || p.value <= 0) return null;
  const unit = p.unit ?? v.unit;
  const px = clampPx(toPx(p.value, unit, v.dpi));
  const other: Axis = axis === 'width' ? 'height' : 'width';
  const next: SizeValue = { ...v, unit, [axis]: px };
  if (lock && v[axis] > 0) next[other] = clampPx((px * v[other]) / v[axis]);
  return next;
}

export function swapOrientation(v: SizeValue): SizeValue {
  return { ...v, width: v.height, height: v.width };
}

// Aplica un papel (en la orientación actual del valor) al dpi vigente. Desde px pasa a mm.
export function applyPaper(v: SizeValue, paper: PaperSize): SizeValue {
  const landscape = v.width > v.height;
  const s = sizeInPx(paper, v.dpi, landscape);
  return { ...v, width: s.width, height: s.height, unit: v.unit === 'px' ? 'mm' : v.unit };
}

// Aplica un tamaño en px de «Pantalla/redes» o de los propósitos de impresión (a 300 ppp).
export function applyPixels(v: SizeValue, width: number, height: number, dpi?: number, unit?: Unit): SizeValue {
  return { ...v, width: clampPx(width), height: clampPx(height), dpi: dpi ?? v.dpi, unit: unit ?? v.unit };
}

// «= 2480 × 3508 px · 21 × 29,7 cm a 300 dpi»
export function summary(v: SizeValue, locale?: string): string {
  const u: Unit = v.unit === 'px' ? 'cm' : v.unit;
  const w = formatSize(fromPx(v.width, u, v.dpi), u, locale);
  const h = formatSize(fromPx(v.height, u, v.dpi), u, locale);
  return `= ${v.width} × ${v.height} px · ${w} × ${h} ${u} a ${v.dpi} dpi`;
}

// Etiqueta corta para el botón de la barra («21 × 29,7 cm»; en px, «1080×1080»).
export function sizeLabel(doc: { width: number; height: number; unit?: Unit; dpi?: number }, locale?: string): string {
  if (!doc.unit || doc.unit === 'px') return `${doc.width}×${doc.height}`;
  const dpi = isValidDpi(doc.dpi) ? doc.dpi : DEFAULT_DPI;
  const w = formatSize(fromPx(doc.width, doc.unit, dpi), doc.unit, locale);
  const h = formatSize(fromPx(doc.height, doc.unit, dpi), doc.unit, locale);
  return `${w} × ${h} ${doc.unit}`;
}
