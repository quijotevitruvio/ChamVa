// Estilos de título y de subtítulo (V4): valores por defecto, saneado de lo guardado
// (proyectos de otras versiones o editados a mano) y utilidades de color.
import type { Karaoke, SubtitleStyle, TitleAnim, TitleStyle, WordTime } from '../model/types';

export const REF_SIZE = 1080;

export const DEFAULT_TITLE_STYLE: Readonly<TitleStyle> = Object.freeze({
  fontFamily: 'Montserrat',
  fontSize: 96,
  bold: true,
  italic: false,
  fill: '#ffffff',
  strokeColor: '#000000',
  strokeWidth: 0,
  shadow: true,
  shadowColor: 'rgba(0,0,0,0.55)',
  shadowBlur: 10,
  shadowX: 0,
  shadowY: 4,
  align: 'center',
  textTransform: 'none',
  letterSpacing: 0,
  lineHeight: 1.1,
});

export const DEFAULT_KARAOKE: Readonly<Karaoke> = Object.freeze({ color: '#ffd84d', scale: 1.15, keep: false });

export const DEFAULT_SUBTITLE_STYLE: Readonly<SubtitleStyle> = Object.freeze({
  style: Object.freeze({
    ...DEFAULT_TITLE_STYLE,
    fontFamily: 'Inter',
    fontSize: 52,
    strokeWidth: 6,
    strokeColor: '#000000',
    shadow: false,
    lineHeight: 1.15,
    maxWidth: 0.86,
  }) as TitleStyle,
  position: 'bottom',
  margin: 0.07,
  maxLines: 2,
});

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const num = (v: unknown, d: number, min = -Infinity, max = Infinity) => (isFin(v) ? Math.max(min, Math.min(max, v)) : d);
const str = (v: unknown, d: string) => (typeof v === 'string' && v.length ? v : d);

/** Un título guardado → uno válido (campos que falten, con el valor por defecto). Sin objeto → undefined. */
export function sanitizeTitleStyle(raw: unknown): TitleStyle | undefined {
  if (!isObj(raw)) return undefined;
  const d = DEFAULT_TITLE_STYLE;
  const out: TitleStyle = {
    fontFamily: str(raw.fontFamily, d.fontFamily),
    fontSize: num(raw.fontSize, d.fontSize, 4, 1200),
    bold: raw.bold === undefined ? d.bold : raw.bold === true,
    italic: raw.italic === true,
    fill: str(raw.fill, d.fill),
    strokeColor: str(raw.strokeColor, d.strokeColor),
    strokeWidth: num(raw.strokeWidth, 0, 0, 200),
    shadow: raw.shadow === true,
    shadowColor: str(raw.shadowColor, d.shadowColor),
    shadowBlur: num(raw.shadowBlur, 0, 0, 200),
    shadowX: num(raw.shadowX, 0, -200, 200),
    shadowY: num(raw.shadowY, 0, -200, 200),
    align: raw.align === 'left' || raw.align === 'right' ? raw.align : 'center',
    textTransform: raw.textTransform === 'upper' || raw.textTransform === 'lower' || raw.textTransform === 'caps' ? raw.textTransform : 'none',
    letterSpacing: num(raw.letterSpacing, 0, -50, 200),
    lineHeight: num(raw.lineHeight, d.lineHeight, 0.5, 3),
  };
  if (raw.textEffect === 'echo' || raw.textEffect === 'background') out.textEffect = raw.textEffect;
  if (typeof raw.effectColor === 'string' && raw.effectColor) out.effectColor = raw.effectColor;
  if (raw.underline === true) out.underline = true;
  if (isFin(raw.maxWidth)) out.maxWidth = num(raw.maxWidth, 0.9, 0.1, 1);
  if (typeof raw.presetId === 'string') out.presetId = raw.presetId;
  return out;
}

export function sanitizeKaraoke(raw: unknown): Karaoke | undefined {
  if (!isObj(raw)) return undefined;
  return { color: str(raw.color, DEFAULT_KARAOKE.color), scale: num(raw.scale, DEFAULT_KARAOKE.scale, 0.5, 3), keep: raw.keep === true };
}

const UNITS = ['all', 'word', 'letter'] as const;

export function sanitizeAnim(raw: unknown): TitleAnim | undefined {
  if (!isObj(raw)) return undefined;
  const out: TitleAnim = {};
  if (typeof raw.in === 'string' && raw.in !== 'none') out.in = raw.in;
  if (typeof raw.out === 'string' && raw.out !== 'none') out.out = raw.out;
  if (isFin(raw.inDur) && raw.inDur > 0) out.inDur = num(raw.inDur, 0.5, 0.05, 10);
  if (isFin(raw.outDur) && raw.outDur > 0) out.outDur = num(raw.outDur, 0.5, 0.05, 10);
  if (UNITS.includes(raw.unit as (typeof UNITS)[number]) && raw.unit !== 'all') out.unit = raw.unit as TitleAnim['unit'];
  if (isFin(raw.stagger)) out.stagger = num(raw.stagger, 0.6, 0, 1);
  if (typeof raw.emphasis === 'string' && raw.emphasis !== 'none') out.emphasis = raw.emphasis;
  if (isFin(raw.emphasisSpeed)) out.emphasisSpeed = num(raw.emphasisSpeed, 1, 0.1, 8);
  const k = sanitizeKaraoke(raw.karaoke);
  if (k) out.karaoke = k;
  return Object.keys(out).length ? out : undefined;
}

export function sanitizeWords(raw: unknown): WordTime[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: WordTime[] = [];
  for (const w of raw) {
    if (!isObj(w) || typeof w.text !== 'string' || !isFin(w.start) || !isFin(w.end) || w.start < 0 || w.end < w.start) return undefined;
    out.push({ text: w.text, start: w.start, end: w.end });
  }
  return out.length ? out : undefined;
}

export function sanitizeSubtitleStyle(raw: unknown): SubtitleStyle | undefined {
  if (!isObj(raw)) return undefined;
  const style = sanitizeTitleStyle(raw.style) ?? { ...DEFAULT_SUBTITLE_STYLE.style };
  const out: SubtitleStyle = {
    style,
    position: raw.position === 'top' || raw.position === 'middle' ? raw.position : 'bottom',
    margin: num(raw.margin, DEFAULT_SUBTITLE_STYLE.margin, 0, 0.45),
    maxLines: Math.round(num(raw.maxLines, 2, 1, 6)),
  };
  const k = sanitizeKaraoke(raw.karaoke);
  if (k) out.karaoke = k;
  if (isFin(raw.fade) && raw.fade > 0) out.fade = num(raw.fade, 0, 0, 2);
  return out;
}

// ---------------- color ----------------

/** Luminancia aproximada (0..1) de un color CSS simple (#rgb, #rrggbb, rgb[a]()). null si no se entiende. */
export function luminance(color: string): number | null {
  const c = color.trim().toLowerCase();
  let r: number, g: number, b: number;
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c);
  if (m) [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x + x, 16));
  else if ((m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/.exec(c))) [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  else if ((m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(c))) [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Alfa de un color CSS (1 si no lleva). */
export function colorAlpha(color: string): number {
  const c = color.trim().toLowerCase();
  const m = /^rgba\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+[\s,/]+([\d.]+)\s*\)$/.exec(c);
  if (m) return Number(m[1]);
  const h = /^#[0-9a-f]{6}([0-9a-f]{2})$/.exec(c);
  return h ? parseInt(h[1], 16) / 255 : 1;
}

/** Un texto de diseño suele ser oscuro (papel blanco); sobre video se vería mal: lo pasa a claro. */
export function forVideo(style: TitleStyle): TitleStyle {
  const out = { ...style };
  const hasBox = style.textEffect === 'background';
  const lum = (c: string) => (colorAlpha(c) < 0.05 ? null : luminance(c));
  const fl = lum(style.fill);
  if (!hasBox && fl !== null && fl < 0.4) {
    out.fill = '#ffffff';
    if (!out.shadow) {
      out.shadow = true;
      out.shadowColor = 'rgba(0,0,0,0.55)';
      out.shadowBlur = Math.round(out.fontSize * 0.1);
      out.shadowX = 0;
      out.shadowY = Math.round(out.fontSize * 0.04);
    }
  }
  const sl = style.strokeWidth > 0 ? lum(style.strokeColor) : null;
  if (!hasBox && sl !== null && sl < 0.4 && colorAlpha(style.fill) < 0.05) out.strokeColor = '#ffffff';
  return out;
}

/** Color CSS simple → { hex (#rrggbb), a (0..1) }. null si no se entiende. */
export function parseColor(color: string): { hex: string; a: number } | null {
  const c = color.trim().toLowerCase();
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c);
  if (m) return { hex: `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`, a: 1 };
  if ((m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(c))) return { hex: `#${m[1]}`, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  if ((m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/.exec(c))) return { hex: `#${h(Number(m[1]))}${h(Number(m[2]))}${h(Number(m[3]))}`, a: m[4] === undefined ? 1 : Number(m[4]) };
  return null;
}

/** #rrggbb + alfa → color CSS (sin alfa si es 1). */
export function withAlpha(hex: string, a: number): string {
  const p = parseColor(hex);
  if (!p) return hex;
  if (a >= 1) return p.hex;
  const n = parseInt(p.hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(Math.max(0, a) * 100) / 100})`;
}
