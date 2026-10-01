// Importar y exportar paletas: GPL (GIMP), variables CSS, JSON, hex sueltos y SVG de muestras.
import { hexToRgb, hslToRgb, rgbToHex } from './colorTools';
import { colorName } from './colorNames';

export interface ParsedPalette {
  name?: string;
  colors: string[]; // #rrggbb en minúsculas, sin repetidos
  format: 'gpl' | 'css' | 'json' | 'hex';
}

const MAX_COLORS = 256;

// Un color suelto (#abc, #aabbcc, #aabbccdd, rgb(), rgba(), hsl()) → #rrggbb o null.
export function parseColorToken(token: string): string | null {
  const t = token.trim().toLowerCase();
  const hex = t.match(/^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (hex) {
    const h = hex[1];
    if (!t.startsWith('#') && h.length !== 6 && h.length !== 8) return null; // sin # solo 6/8
    const r = hexToRgb(h.length === 3 ? h.split('').map((c) => c + c).join('') : h);
    return r ? rgbToHex(r) : null;
  }
  const rgb = t.match(/^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/);
  if (rgb) return rgbToHex({ r: +rgb[1], g: +rgb[2], b: +rgb[3] });
  const hsl = t.match(/^hsla?\(\s*(-?\d+(?:\.\d+)?)(?:deg)?[\s,]+(\d+(?:\.\d+)?)%[\s,]+(\d+(?:\.\d+)?)%/);
  if (hsl) return rgbToHex(hslToRgb({ h: +hsl[1], s: +hsl[2] / 100, l: +hsl[3] / 100 }));
  return null;
}

function uniq(list: (string | null)[]): string[] {
  const out: string[] = [];
  for (const c of list) if (c && !out.includes(c)) out.push(c);
  return out.slice(0, MAX_COLORS);
}

function parseGpl(text: string): ParsedPalette {
  const lines = text.split(/\r?\n/);
  let name: string | undefined;
  const found: (string | null)[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || /^GIMP Palette/i.test(line)) continue;
    const nm = line.match(/^Name:\s*(.+)$/i);
    if (nm) {
      name = nm[1].trim();
      continue;
    }
    if (/^Columns:/i.test(line)) continue;
    const m = line.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/);
    if (m) found.push(rgbToHex({ r: +m[1], g: +m[2], b: +m[3] }));
  }
  return { name, colors: uniq(found), format: 'gpl' };
}

function parseCss(text: string): ParsedPalette {
  const found: (string | null)[] = [];
  const re = /--[\w-]+\s*:\s*([^;}]+)[;}]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) found.push(parseColorToken(m[1]));
  return { colors: uniq(found), format: 'css' };
}

function collectJson(v: unknown, out: (string | null)[], depth = 0): void {
  if (depth > 6 || out.length > MAX_COLORS * 2) return;
  if (typeof v === 'string') {
    const c = parseColorToken(v);
    if (c) out.push(c);
  } else if (Array.isArray(v)) {
    for (const x of v) collectJson(x, out, depth + 1);
  } else if (v && typeof v === 'object') {
    for (const x of Object.values(v as Record<string, unknown>)) collectJson(x, out, depth + 1);
  }
}

function parseJson(text: string): ParsedPalette | null {
  try {
    const data = JSON.parse(text);
    const out: (string | null)[] = [];
    collectJson(data, out);
    const name =
      data && typeof data === 'object' && !Array.isArray(data) && typeof (data as { name?: unknown }).name === 'string'
        ? (data as { name: string }).name
        : undefined;
    return { name, colors: uniq(out), format: 'json' };
  } catch {
    return null;
  }
}

function parseLoose(text: string): ParsedPalette {
  const found: (string | null)[] = [];
  // Funciones rgb()/hsl() primero (llevan comas internas), luego el resto por separadores.
  const fn = /(?:rgba?|hsla?)\([^)]*\)/gi;
  for (const m of text.match(fn) ?? []) found.push(parseColorToken(m));
  const rest = text.replace(fn, ' ');
  for (const tok of rest.split(/[\s,;]+/)) {
    if (tok) found.push(parseColorToken(tok));
  }
  return { colors: uniq(found), format: 'hex' };
}

// Detecta el formato y devuelve los colores. Sin colores válidos → colors: [].
export function parsePalette(text: string): ParsedPalette {
  const t = text.replace(/^﻿/, '').trim();
  if (!t) return { colors: [], format: 'hex' };
  if (/^GIMP Palette/i.test(t)) return parseGpl(t);
  if (t.startsWith('{') || t.startsWith('[')) {
    const j = parseJson(t);
    if (j) return j;
  }
  if (/--[\w-]+\s*:/.test(t)) return parseCss(t);
  return parseLoose(t);
}

// ───────────── Exportación ─────────────

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'color'
  );
}

// Nombres únicos por color: «azul-cielo», «azul-cielo-2»…
function uniqueNames(colors: string[]): string[] {
  const seen = new Map<string, number>();
  return colors.map((c) => {
    const base = slug(colorName(c));
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

const norm = (colors: string[]) => uniq(colors.map((c) => parseColorToken(c)));

export function toCssVars(colors: string[], prefix = 'color'): string {
  const list = norm(colors);
  const names = uniqueNames(list);
  return `:root {\n${list.map((c, i) => `  --${prefix}-${names[i]}: ${c};`).join('\n')}\n}\n`;
}

export function toJson(colors: string[], name = 'Paleta ChamVa'): string {
  const list = norm(colors);
  const names = uniqueNames(list);
  return (
    JSON.stringify(
      { name, colors: list.map((hex, i) => ({ name: colorName(hex), key: names[i], hex })) },
      null,
      2,
    ) + '\n'
  );
}

export function toGpl(colors: string[], name = 'Paleta ChamVa'): string {
  const list = norm(colors);
  const rows = list.map((c) => {
    const { r, g, b } = hexToRgb(c)!;
    const p = (n: number) => String(n).padStart(3, ' ');
    return `${p(r)} ${p(g)} ${p(b)}\t${colorName(c)}`;
  });
  return `GIMP Palette\nName: ${name.replace(/[\r\n]+/g, ' ')}\nColumns: 8\n#\n${rows.join('\n')}\n`;
}

const xmlEsc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Muestras en SVG: cuadrados de 80 px con el hex debajo.
export function toSvgSwatches(colors: string[]): string {
  const list = norm(colors);
  const cell = 80;
  const w = Math.max(1, list.length) * cell;
  const rects = list
    .map((c, i) => {
      const x = i * cell;
      return (
        `<rect x="${x}" y="0" width="${cell}" height="${cell}" fill="${c}"/>` +
        `<text x="${x + cell / 2}" y="${cell + 18}" font-family="sans-serif" font-size="12" text-anchor="middle" fill="#333">${xmlEsc(c)}</text>`
      );
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${cell + 28}" viewBox="0 0 ${w} ${cell + 28}"><rect width="${w}" height="${cell + 28}" fill="#fff"/>${rects}</svg>\n`;
}

export type PaletteExportFormat = 'css' | 'json' | 'gpl' | 'svg';

export const PALETTE_EXPORTS: Record<PaletteExportFormat, { label: string; ext: string; mime: string }> = {
  css: { label: 'Variables CSS', ext: 'css', mime: 'text/css' },
  json: { label: 'JSON', ext: 'json', mime: 'application/json' },
  gpl: { label: 'GIMP (.gpl)', ext: 'gpl', mime: 'text/plain' },
  svg: { label: 'Muestras SVG', ext: 'svg', mime: 'image/svg+xml' },
};

export function exportPalette(colors: string[], format: PaletteExportFormat, name?: string): string {
  switch (format) {
    case 'css':
      return toCssVars(colors);
    case 'json':
      return toJson(colors, name);
    case 'gpl':
      return toGpl(colors, name);
    case 'svg':
      return toSvgSwatches(colors);
  }
}
