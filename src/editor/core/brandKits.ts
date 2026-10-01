// Kits de marca: lógica pura (sin DOM ni store) para varios kits con nombre,
// la hoja de marca automática y la guía de combinaciones con contraste WCAG.
import { contrastRatio, hexToRgb } from './colorTools';
import {
  DEFAULT_ADJUST,
  NO_SHADOW,
  type ImageLayer,
  type Layer,
  type ShapeLayer,
  type TextLayer,
  type UploadedImage,
} from './types';

export interface BrandKit {
  id: string;
  name: string;
  logos: UploadedImage[];
  colors: string[];
  fonts: string[];
  // Zona de respeto por logo (id → fracción de su altura). Por defecto 0,5.
  respect?: Record<string, number>;
}

export const DEFAULT_KIT_NAME = 'Mi marca';
export const DEFAULT_RESPECT = 0.5;
export const MAX_KITS = 24;

// ---- Migración y selección ----

// Convierte lo guardado (o nada) en una lista de kits válida. `legacy` es el kit
// único de versiones anteriores: pasa a ser el primero («Mi marca»).
export function migrateKits(
  raw: unknown,
  legacy: { colors: string[]; fonts: string[]; logos: UploadedImage[] },
  newId: () => string,
): BrandKit[] {
  const out: BrandKit[] = [];
  if (Array.isArray(raw)) {
    for (const k of raw) {
      if (!k || typeof k !== 'object') continue;
      const o = k as Partial<BrandKit>;
      if (typeof o.id !== 'string' || !o.id) continue;
      out.push({
        id: o.id,
        name: typeof o.name === 'string' && o.name.trim() ? o.name : DEFAULT_KIT_NAME,
        logos: Array.isArray(o.logos) ? o.logos : [],
        colors: Array.isArray(o.colors) ? o.colors.filter((c) => typeof c === 'string') : [],
        fonts: Array.isArray(o.fonts) ? o.fonts.filter((f) => typeof f === 'string') : [],
        ...(o.respect && typeof o.respect === 'object' ? { respect: o.respect } : {}),
      });
    }
  }
  if (out.length === 0) {
    out.push({
      id: newId(),
      name: DEFAULT_KIT_NAME,
      logos: legacy.logos,
      colors: legacy.colors,
      fonts: legacy.fonts,
    });
  }
  return out;
}

// El kit activo; si el id no existe, el primero.
export function activeKit(kits: BrandKit[], activeId: string | null | undefined): BrandKit {
  return kits.find((k) => k.id === activeId) ?? kits[0];
}

export function updateKit(kits: BrandKit[], id: string, patch: Partial<BrandKit>): BrandKit[] {
  return kits.map((k) => (k.id === id ? { ...k, ...patch } : k));
}

export function createKit(kits: BrandKit[], name: string, id: string): BrandKit[] {
  if (kits.length >= MAX_KITS) return kits;
  return [...kits, { id, name: name.trim() || 'Kit nuevo', logos: [], colors: [], fonts: [] }];
}

// Copia un kit (logos, colores, fuentes) bajo otro nombre.
export function duplicateKit(kits: BrandKit[], srcId: string, id: string): BrandKit[] {
  const src = kits.find((k) => k.id === srcId);
  if (!src || kits.length >= MAX_KITS) return kits;
  const copy: BrandKit = {
    ...src,
    id,
    name: `${src.name} (copia)`,
    logos: src.logos.map((l) => ({ ...l })),
    colors: [...src.colors],
    fonts: [...src.fonts],
    respect: src.respect ? { ...src.respect } : undefined,
  };
  const i = kits.findIndex((k) => k.id === srcId);
  const out = [...kits];
  out.splice(i + 1, 0, copy);
  return out;
}

export function renameKit(kits: BrandKit[], id: string, name: string): BrandKit[] {
  const n = name.trim();
  return n ? updateKit(kits, id, { name: n }) : kits;
}

// Borra un kit; siempre queda al menos uno. Devuelve también el nuevo activo.
export function deleteKit(
  kits: BrandKit[],
  id: string,
  activeId: string,
): { kits: BrandKit[]; activeId: string } {
  if (kits.length <= 1) return { kits, activeId };
  const out = kits.filter((k) => k.id !== id);
  return { kits: out, activeId: activeId === id ? out[0].id : activeId };
}

export function respectFactor(kit: BrandKit, logoId: string): number {
  const v = kit.respect?.[logoId];
  return typeof v === 'number' && v >= 0 ? v : DEFAULT_RESPECT;
}

// ---- Contraste y combinaciones ----

export type ContrastLevel = 'AAA' | 'AA' | 'AA grande' | 'no pasa';

export function contrastLevel(ratio: number): ContrastLevel {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA grande';
  return 'no pasa';
}

export interface ColorPair {
  fg: string; // color del texto
  bg: string; // color del fondo
  ratio: number;
  level: ContrastLevel;
  aa: boolean; // accesible para texto normal (≥ 4,5)
}

export function colorPair(fg: string, bg: string): ColorPair {
  const ratio = contrastRatio(fg, bg);
  return { fg, bg, ratio, level: contrastLevel(ratio), aa: ratio >= 4.5 };
}

// Matriz fondo (filas) × texto (columnas) con la diagonal vacía.
export function contrastMatrix(colors: string[]): (ColorPair | null)[][] {
  const list = [...new Set(colors)];
  return list.map((bg) => list.map((fg) => (fg === bg ? null : colorPair(fg, bg))));
}

// Todos los pares distintos, de mayor a menor contraste.
export function contrastPairs(colors: string[], onlyAA = false): ColorPair[] {
  const out: ColorPair[] = [];
  for (const row of contrastMatrix(colors)) for (const p of row) if (p) out.push(p);
  out.sort((a, b) => b.ratio - a.ratio);
  return onlyAA ? out.filter((p) => p.aa) : out;
}

// ---- Hoja de marca ----

export function rgbText(hex: string): string {
  const c = hexToRgb(hex);
  return c ? `RGB ${c.r}, ${c.g}, ${c.b}` : '';
}

export type SheetItem =
  | { kind: 'text'; x: number; y: number; text: string; fontSize: number; fontFamily: string; fill: string; bold?: boolean }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: string; stroke?: string }
  | { kind: 'logo'; x: number; y: number; w: number; h: number; logoId: string };

const SAFE_FONT = 'Arial';
const INK = '#171717';
const MUTED = '#737373';

// Disposición automática de la hoja: título, logos, paleta (hex y RGB),
// tipografías con muestra y ejemplos de uso. Coordenadas del lienzo `size`.
export function layoutBrandSheet(
  kit: Pick<BrandKit, 'name' | 'logos' | 'colors' | 'fonts'>,
  size: { width: number; height: number },
): SheetItem[] {
  const { width: W, height: H } = size;
  const u = Math.min(W, H) / 1080; // unidad de escala para tipografías
  const m = Math.round(Math.min(W, H) * 0.06);
  const innerW = W - m * 2;
  const innerH = H - m * 2;
  const items: SheetItem[] = [];
  const fs = (n: number) => Math.max(8, Math.round(n * u));

  // Reparto vertical por secciones (suma 1).
  const share = { head: 0.1, logos: 0.24, colors: 0.26, fonts: 0.22, usage: 0.18 };
  let y = m;
  const slot = (k: keyof typeof share) => {
    const top = y;
    const h = innerH * share[k];
    y += h;
    return { top, h };
  };

  const head = slot('head');
  items.push({ kind: 'text', x: m, y: head.top, text: `Hoja de marca · ${kit.name}`, fontSize: fs(44), fontFamily: kit.fonts[0] ?? SAFE_FONT, fill: INK, bold: true });
  items.push({ kind: 'rect', x: m, y: head.top + head.h - 4, w: innerW, h: 2, fill: INK });

  const sec = (s: { top: number; h: number }, title: string) => {
    items.push({ kind: 'text', x: m, y: s.top + 4, text: title, fontSize: fs(18), fontFamily: SAFE_FONT, fill: MUTED, bold: true });
    return { top: s.top + fs(18) * 1.8, h: s.h - fs(18) * 1.8 - 6 };
  };

  // Logos: cuadrícula de hasta 6 por fila, con versión clara y oscura de fondo.
  const logoSlot = sec(slot('logos'), 'LOGOS');
  const logos = kit.logos.slice(0, 8);
  if (logos.length) {
    const perRow = Math.min(logos.length, 4);
    const rows = Math.ceil(logos.length / perRow);
    const gap = Math.round(14 * u);
    const cw = (innerW - gap * (perRow - 1)) / perRow;
    const ch = (logoSlot.h - gap * (rows - 1)) / rows;
    logos.forEach((l, i) => {
      const cx = m + (i % perRow) * (cw + gap);
      const cy = logoSlot.top + Math.floor(i / perRow) * (ch + gap);
      items.push({ kind: 'rect', x: cx, y: cy, w: cw, h: ch, fill: '#ffffff', stroke: '#d4d4d4' });
      const pad = Math.min(cw, ch) * 0.12;
      const k = Math.min((cw - pad * 2) / l.naturalWidth, (ch - pad * 2) / l.naturalHeight);
      const w = l.naturalWidth * k;
      const h = l.naturalHeight * k;
      items.push({ kind: 'logo', x: cx + (cw - w) / 2, y: cy + (ch - h) / 2, w, h, logoId: l.id });
    });
  } else {
    items.push({ kind: 'text', x: m, y: logoSlot.top, text: 'Sin logos en el kit', fontSize: fs(20), fontFamily: SAFE_FONT, fill: MUTED });
  }

  // Paleta: muestras con código hex y RGB.
  const colSlot = sec(slot('colors'), 'PALETA');
  const colors = kit.colors.slice(0, 12);
  if (colors.length) {
    const perRow = Math.min(colors.length, 6);
    const rows = Math.ceil(colors.length / perRow);
    const gap = Math.round(14 * u);
    const cw = (innerW - gap * (perRow - 1)) / perRow;
    const rowH = (colSlot.h - gap * (rows - 1)) / rows;
    const textH = fs(15) * 2.6;
    colors.forEach((c, i) => {
      const cx = m + (i % perRow) * (cw + gap);
      const cy = colSlot.top + Math.floor(i / perRow) * (rowH + gap);
      items.push({ kind: 'rect', x: cx, y: cy, w: cw, h: Math.max(8, rowH - textH), fill: c, stroke: '#d4d4d4' });
      items.push({ kind: 'text', x: cx, y: cy + Math.max(8, rowH - textH) + 4, text: `${c.toUpperCase()}\n${rgbText(c)}`, fontSize: fs(15), fontFamily: SAFE_FONT, fill: INK });
    });
  } else {
    items.push({ kind: 'text', x: m, y: colSlot.top, text: 'Sin colores en el kit', fontSize: fs(20), fontFamily: SAFE_FONT, fill: MUTED });
  }

  // Tipografías con muestra.
  const fontSlot = sec(slot('fonts'), 'TIPOGRAFÍAS');
  const fonts = kit.fonts.slice(0, 4);
  if (fonts.length) {
    const rowH = fontSlot.h / fonts.length;
    fonts.forEach((f, i) => {
      const fy = fontSlot.top + i * rowH;
      const size = Math.min(fs(40), rowH * 0.5);
      items.push({ kind: 'text', x: m, y: fy, text: `Aa  ${f}`, fontSize: Math.round(size), fontFamily: f, fill: INK, bold: true });
      items.push({ kind: 'text', x: m + innerW * 0.5, y: fy + size * 0.1, text: 'El veloz murciélago hindú comía feliz cardillo y kiwi.', fontSize: Math.max(8, Math.round(size * 0.42)), fontFamily: f, fill: MUTED });
    });
  } else {
    items.push({ kind: 'text', x: m, y: fontSlot.top, text: 'Sin tipografías en el kit', fontSize: fs(20), fontFamily: SAFE_FONT, fill: MUTED });
  }

  // Ejemplos de uso: los mejores pares texto/fondo de la paleta.
  const useSlot = sec(slot('usage'), 'EJEMPLOS DE USO');
  const pairs = contrastPairs(kit.colors, true).slice(0, 4);
  const sample = pairs.length ? pairs : contrastPairs(['#171717', '#ffffff']).slice(0, 1);
  const gap = Math.round(14 * u);
  const cw = (innerW - gap * (sample.length - 1)) / sample.length;
  sample.forEach((p, i) => {
    const cx = m + i * (cw + gap);
    items.push({ kind: 'rect', x: cx, y: useSlot.top, w: cw, h: useSlot.h, fill: p.bg, stroke: '#d4d4d4' });
    items.push({
      kind: 'text',
      x: cx + cw * 0.08,
      y: useSlot.top + useSlot.h * 0.3,
      text: 'Texto de ejemplo',
      fontSize: Math.max(8, Math.round(Math.min(fs(26), useSlot.h * 0.28))),
      fontFamily: kit.fonts[0] ?? SAFE_FONT,
      fill: p.fg,
      bold: true,
    });
  });
  return items;
}

// Convierte la disposición en capas normales del editor (texto, formas, imágenes)
// para que la hoja se pueda editar como cualquier diseño.
export function sheetItemsToLayers(
  items: SheetItem[],
  logos: UploadedImage[],
  newId: () => string,
): Layer[] {
  const base = { rotation: 0, opacity: 1, blendMode: 'normal' as const, visible: true, locked: false, scaleX: 1, scaleY: 1 };
  const out: Layer[] = [];
  for (const it of items) {
    if (it.kind === 'text') {
      const l: TextLayer = {
        ...base,
        id: newId(),
        type: 'text',
        name: it.text.split('\n')[0].slice(0, 40),
        text: it.text,
        fontFamily: it.fontFamily,
        fontSize: it.fontSize,
        fill: it.fill,
        align: 'left',
        bold: !!it.bold,
        italic: false,
        textTransform: 'none',
        letterSpacing: 0,
        strokeColor: '#000000',
        strokeWidth: 0,
        shadow: false,
        shadowColor: '#000000',
        shadowBlur: 6,
        shadowX: 2,
        shadowY: 2,
        x: it.x,
        y: it.y,
      };
      out.push(l);
    } else if (it.kind === 'rect') {
      const l: ShapeLayer = {
        ...base,
        ...NO_SHADOW,
        id: newId(),
        type: 'shape',
        name: 'Rectángulo',
        shape: 'rect',
        width: it.w,
        height: it.h,
        fill: it.fill,
        stroke: it.stroke ?? '#000000',
        strokeWidth: it.stroke ? 2 : 0,
        cornerRadius: 0,
        x: it.x,
        y: it.y,
      };
      out.push(l);
    } else {
      const logo = logos.find((g) => g.id === it.logoId);
      if (!logo) continue;
      const l: ImageLayer = {
        ...base,
        ...NO_SHADOW,
        id: newId(),
        type: 'image',
        name: logo.name,
        src: logo.src,
        naturalWidth: logo.naturalWidth,
        naturalHeight: logo.naturalHeight,
        x: it.x,
        y: it.y,
        scaleX: it.w / logo.naturalWidth,
        scaleY: it.h / logo.naturalHeight,
        adjust: { ...DEFAULT_ADJUST },
        filter: 'none',
        flipX: false,
        flipY: false,
      };
      out.push(l);
    }
  }
  return out;
}

// ---- Zona de respeto ----

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Caja del logo ampliada con el margen (fracción de su altura) por los cuatro lados.
export function respectZone(logo: Box, factor: number): Box {
  const m = logo.h * Math.max(0, factor);
  return { x: logo.x - m, y: logo.y - m, w: logo.w + m * 2, h: logo.h + m * 2 };
}

// ¿La caja `other` entra en la zona (fuera del propio logo)? Si solo toca el
// borde no cuenta.
export function invadesZone(zone: Box, other: Box): boolean {
  return (
    other.x < zone.x + zone.w &&
    other.x + other.w > zone.x &&
    other.y < zone.y + zone.h &&
    other.y + other.h > zone.y
  );
}
