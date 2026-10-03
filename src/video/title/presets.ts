// Preajustes de título para video (V4): los 30 estilos de texto y los pares de fuentes del editor de
// diseño (`editor/core/textPresets`), pasados a claro para verse sobre video, más tercios inferiores,
// karaoke y títulos centrales propios del video. También los estilos de subtítulo.
import { FONT_PAIR_DEFS, TEXT_PRESET_DEFS, type FontPairDef, type TextPresetDef } from '../../editor/core/textPresets';
import type { Clip, Karaoke, SubtitleStyle, TitleAnim, TitleStyle } from '../model/types';
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_TITLE_STYLE, forVideo } from './style';

export type TitleCategory = 'Tercios inferiores' | 'Karaoke' | 'Títulos' | 'Subtítulos' | 'Etiquetas y sellos' | 'Citas' | 'Neón' | 'Retro' | 'Contorno' | 'Minimal';

export const TITLE_CATEGORIES: TitleCategory[] = ['Tercios inferiores', 'Karaoke', 'Títulos', 'Subtítulos', 'Etiquetas y sellos', 'Citas', 'Neón', 'Retro', 'Contorno', 'Minimal'];

export interface TitlePreset {
  id: string;
  name: string;
  category: TitleCategory;
  /** texto que se inserta */
  text: string;
  style: TitleStyle;
  anim?: TitleAnim;
  /** centro del texto (fracción del fotograma); por defecto el centro */
  pos?: { x: number; y: number };
  /** fondo de la tarjeta de muestra */
  previewBg?: string;
}

/** Un estilo de `TextLayer` (parcial) → estilo de título completo. */
export function titleStyleFromLayer(s: Partial<import('../../editor/core/types').TextLayer>, id?: string): TitleStyle {
  const d = DEFAULT_TITLE_STYLE;
  const out: TitleStyle = {
    fontFamily: s.fontFamily ?? d.fontFamily,
    fontSize: s.fontSize ?? 64,
    bold: s.bold ?? false,
    italic: s.italic ?? false,
    fill: s.fill ?? '#ffffff',
    strokeColor: s.strokeColor ?? '#000000',
    strokeWidth: s.strokeWidth ?? 0,
    shadow: s.shadow ?? false,
    shadowColor: s.shadowColor ?? d.shadowColor,
    shadowBlur: s.shadowBlur ?? 0,
    shadowX: s.shadowX ?? 0,
    shadowY: s.shadowY ?? 0,
    align: s.align ?? 'center',
    textTransform: s.textTransform ?? 'none',
    letterSpacing: s.letterSpacing ?? 0,
    lineHeight: s.lineHeight ?? 1.1,
    maxWidth: 0.9,
  };
  if (s.textEffect === 'echo' || s.textEffect === 'background') out.textEffect = s.textEffect;
  if (s.effectColor) out.effectColor = s.effectColor;
  if (s.underline) out.underline = true;
  if (id) out.presetId = id;
  return out;
}

const KARAOKE_Y: Karaoke = { color: '#ffd84d', scale: 1.18, keep: false };
const KARAOKE_G: Karaoke = { color: '#39ff14', scale: 1.12, keep: true };
const KARAOKE_P: Karaoke = { color: '#ff3d9a', scale: 1.2, keep: false };

const st = (id: string, o: Partial<TitleStyle>): TitleStyle => ({ ...DEFAULT_TITLE_STYLE, maxWidth: 0.9, ...o, presetId: id });

/** Preajustes propios del video. */
const NATIVE: TitlePreset[] = [
  {
    id: 'v-central',
    name: 'Título central',
    category: 'Títulos',
    text: 'Título del video',
    style: st('v-central', { fontFamily: 'Montserrat', fontSize: 120, bold: true, letterSpacing: -2 }),
    anim: { in: 'pop', out: 'fade', inDur: 0.6, outDur: 0.4 },
  },
  {
    id: 'v-central-tipo',
    name: 'Título con máquina de escribir',
    category: 'Títulos',
    text: 'Escribiendo el título…',
    style: st('v-central-tipo', { fontFamily: 'Courier New', fontSize: 84, bold: true }),
    anim: { in: 'typewriter', inDur: 1.2, out: 'fade', outDur: 0.4 },
  },
  {
    id: 'v-letras',
    name: 'Título letra a letra',
    category: 'Títulos',
    text: 'Letra a letra',
    style: st('v-letras', { fontFamily: 'Poppins', fontSize: 130, bold: true }),
    anim: { in: 'bounce', unit: 'letter', inDur: 1, stagger: 0.7, out: 'fade', outDur: 0.4 },
  },
  {
    id: 'v-palabras',
    name: 'Título palabra a palabra',
    category: 'Títulos',
    text: 'Palabra tras palabra',
    style: st('v-palabras', { fontFamily: 'Oswald', fontSize: 120, bold: true, textTransform: 'upper', letterSpacing: 3 }),
    anim: { in: 'slideUp', unit: 'word', inDur: 0.9, out: 'fade', outDur: 0.4 },
  },
  {
    id: 'v-tercio-simple',
    name: 'Tercio inferior simple',
    category: 'Tercios inferiores',
    text: 'Nombre Apellido',
    style: st('v-tercio-simple', { fontFamily: 'Montserrat', fontSize: 56, bold: true, align: 'left', textEffect: 'background', effectColor: 'rgba(0,0,0,0.65)', shadow: false }),
    anim: { in: 'slideRight', inDur: 0.5, out: 'slideLeft', outDur: 0.4 },
    pos: { x: 0.3, y: 0.82 },
  },
  {
    id: 'v-tercio-doble',
    name: 'Tercio con nombre y cargo',
    category: 'Tercios inferiores',
    text: 'NOMBRE APELLIDO\nCargo o descripción',
    style: st('v-tercio-doble', { fontFamily: 'Oswald', fontSize: 52, bold: true, align: 'left', lineHeight: 1.25, textEffect: 'background', effectColor: '#e11d48', shadow: false }),
    anim: { in: 'slideRight', inDur: 0.5, out: 'fade', outDur: 0.4 },
    pos: { x: 0.3, y: 0.8 },
  },
  {
    id: 'v-tercio-claro',
    name: 'Tercio inferior claro',
    category: 'Tercios inferiores',
    text: 'Lugar · Fecha',
    style: st('v-tercio-claro', { fontFamily: 'Poppins', fontSize: 46, bold: false, align: 'left', fill: '#111111', textEffect: 'background', effectColor: 'rgba(255,255,255,0.9)', shadow: false }),
    anim: { in: 'slideUp', inDur: 0.45, out: 'slideDown', outDur: 0.4 },
    pos: { x: 0.22, y: 0.86 },
  },
  {
    id: 'v-tercio-rotulo',
    name: 'Rótulo amarillo',
    category: 'Tercios inferiores',
    text: 'ÚLTIMA HORA',
    style: st('v-tercio-rotulo', { fontFamily: 'Anton', fontSize: 64, bold: false, fill: '#111111', letterSpacing: 2, textEffect: 'background', effectColor: '#ffd84d', shadow: false }),
    anim: { in: 'scale', inDur: 0.35, out: 'fade', outDur: 0.3, emphasis: 'pulse', emphasisSpeed: 0.7 },
    pos: { x: 0.2, y: 0.12 },
  },
  {
    id: 'v-karaoke-amarillo',
    name: 'Karaoke amarillo',
    category: 'Karaoke',
    text: 'Cada palabra se ilumina al decirla',
    style: st('v-karaoke-amarillo', { fontFamily: 'Montserrat', fontSize: 84, bold: true, strokeWidth: 8, strokeColor: '#000000', shadow: false }),
    anim: { in: 'fade', inDur: 0.25, out: 'fade', outDur: 0.25, karaoke: KARAOKE_Y },
    pos: { x: 0.5, y: 0.78 },
  },
  {
    id: 'v-karaoke-verde',
    name: 'Karaoke que se rellena',
    category: 'Karaoke',
    text: 'Las palabras dichas se quedan en verde',
    style: st('v-karaoke-verde', { fontFamily: 'Bebas Neue', fontSize: 110, bold: false, textTransform: 'upper', letterSpacing: 4, strokeWidth: 6, strokeColor: '#000000', shadow: false }),
    anim: { in: 'slideUp', inDur: 0.3, out: 'fade', outDur: 0.25, karaoke: KARAOKE_G },
    pos: { x: 0.5, y: 0.75 },
  },
  {
    id: 'v-karaoke-caja',
    name: 'Karaoke sobre caja',
    category: 'Karaoke',
    text: 'Karaoke con caja oscura',
    style: st('v-karaoke-caja', { fontFamily: 'Poppins', fontSize: 66, bold: true, textEffect: 'background', effectColor: 'rgba(0,0,0,0.7)', shadow: false }),
    anim: { in: 'scale', inDur: 0.3, out: 'fade', outDur: 0.25, karaoke: KARAOKE_P },
    pos: { x: 0.5, y: 0.8 },
  },
];

function fromDesign(d: TextPresetDef): TitlePreset {
  const id = 'd-' + d.id;
  const base = titleStyleFromLayer(d.style, id);
  return {
    id,
    name: d.name,
    category: d.category as TitleCategory,
    text: d.text,
    style: forVideo(base),
    anim: { in: 'fade', inDur: 0.4, out: 'fade', outDur: 0.4 },
    previewBg: d.previewBg && (d.category === 'Neón' || d.previewBg === '#14141a') ? d.previewBg : undefined,
  };
}

export const TITLE_PRESETS: TitlePreset[] = [...NATIVE, ...TEXT_PRESET_DEFS.map(fromDesign)];

export const getTitlePreset = (id: string) => TITLE_PRESETS.find((p) => p.id === id);

/** Un clip de texto con el preajuste aplicado (conserva id, tiempos y posición salvo que el preajuste fije una). */
export function applyPreset(clip: Clip, preset: TitlePreset, o: { keepText?: boolean; keepPosition?: boolean } = {}): Clip {
  const tr = preset.pos && !o.keepPosition ? { ...clip.transform, x: preset.pos.x, y: preset.pos.y } : clip.transform;
  const next: Clip = { ...clip, tstyle: { ...preset.style }, transform: tr };
  if (preset.anim) next.anim = JSON.parse(JSON.stringify(preset.anim));
  else delete next.anim;
  if (!o.keepText && preset.text) next.text = preset.text;
  return next;
}

// ---------------- pares de fuentes ----------------

export interface TitlePair {
  id: string;
  name: string;
  title: { text: string; style: TitleStyle; y: number };
  body: { text: string; style: TitleStyle; y: number };
}

function pairPart(p: FontPairDef['title'], id: string): TitleStyle {
  return forVideo(titleStyleFromLayer({ ...p, align: 'center', italic: p.italic ?? false }, id));
}

export const TITLE_PAIRS: TitlePair[] = FONT_PAIR_DEFS.map((p) => ({
  id: 'p-' + p.id,
  name: p.name,
  title: { text: p.titleText, style: pairPart(p.title, 'p-' + p.id), y: 0.44 },
  body: { text: p.bodyText, style: { ...pairPart(p.body, 'p-' + p.id), fontSize: Math.min(p.body.fontSize, 52) }, y: 0.58 },
}));

// ---------------- subtítulos ----------------

export interface SubtitlePreset {
  id: string;
  name: string;
  style: SubtitleStyle;
}

const sub = (id: string, name: string, o: Partial<TitleStyle>, rest: Partial<SubtitleStyle> = {}): SubtitlePreset => ({
  id,
  name,
  style: { ...DEFAULT_SUBTITLE_STYLE, ...rest, style: { ...DEFAULT_SUBTITLE_STYLE.style, ...o, presetId: id } },
});

export const SUBTITLE_PRESETS: SubtitlePreset[] = [
  sub('s-clasico', 'Clásico con contorno', {}),
  sub('s-caja', 'Caja oscura', { strokeWidth: 0, textEffect: 'background', effectColor: 'rgba(0,0,0,0.7)', fontSize: 48 }),
  sub('s-amarillo', 'Amarillo de cine', { fill: '#ffe14d', strokeWidth: 6, bold: true }),
  sub('s-sombra', 'Sombra suave', { strokeWidth: 0, shadow: true, shadowColor: 'rgba(0,0,0,0.85)', shadowBlur: 14, shadowY: 4 }),
  sub('s-grande', 'Grande y gordo (redes)', { fontFamily: 'Montserrat', fontSize: 84, bold: true, strokeWidth: 10, textTransform: 'upper' }, { position: 'middle', maxLines: 2 }),
  sub('s-karaoke', 'Karaoke', { fontFamily: 'Montserrat', fontSize: 72, bold: true, strokeWidth: 8 }, { karaoke: { color: '#ffd84d', scale: 1.15, keep: false }, position: 'bottom', margin: 0.12 }),
  sub('s-arriba', 'Arriba, discreto', { fontSize: 44, strokeWidth: 4, fill: '#ffffff' }, { position: 'top', margin: 0.06 }),
  sub('s-serif', 'Serif cursiva', { fontFamily: 'Merriweather', italic: true, bold: false, fontSize: 48, strokeWidth: 0, shadow: true, shadowColor: 'rgba(0,0,0,0.8)', shadowBlur: 12 }),
];

