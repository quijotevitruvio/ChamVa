// Estilos de texto listos (un clic) y pares de fuentes título + cuerpo.
// Solo usa campos reales de TextLayer y fuentes de FONT_FAMILIES (empaquetadas
// con la app o del sistema). Los tamaños están dados para un lienzo de
// referencia de 1080 px en su lado menor y se escalan en buildTextLayerProps.
import type { TextLayer } from './types';

export type PresetCategory =
  | 'Títulos'
  | 'Subtítulos'
  | 'Etiquetas y sellos'
  | 'Citas'
  | 'Neón'
  | 'Retro'
  | 'Contorno'
  | 'Minimal';

export const PRESET_CATEGORIES: PresetCategory[] = [
  'Títulos',
  'Subtítulos',
  'Etiquetas y sellos',
  'Citas',
  'Neón',
  'Retro',
  'Contorno',
  'Minimal',
];

export interface TextPresetDef {
  id: string;
  name: string;
  category: PresetCategory;
  sample: string; // texto corto para la tarjeta
  text: string; // texto que se inserta en el lienzo
  style: Partial<TextLayer>;
  previewBg?: string; // fondo de la tarjeta (para neón / texto claro)
}

export interface FontPairDef {
  id: string;
  name: string;
  title: { fontFamily: string; bold: boolean; italic?: boolean; fill: string; fontSize: number; letterSpacing?: number; textTransform?: TextLayer['textTransform']; lineHeight?: number };
  body: { fontFamily: string; bold: boolean; italic?: boolean; fill: string; fontSize: number; letterSpacing?: number; textTransform?: TextLayer['textTransform']; lineHeight?: number };
  titleText: string;
  bodyText: string;
}

export const REF_SIZE = 1080; // lado menor del lienzo de referencia
const MAX_WIDTH_FRAC = 0.9; // un texto nunca ocupa más de esto del ancho
const MIN_FONT = 8;
const MAX_FONT = 600;
const CLEAR = 'rgba(255,255,255,0)';

const base = { align: 'center' as const, textTransform: 'none' as const };

export const TEXT_PRESET_DEFS: TextPresetDef[] = [
  // ---- Títulos
  { id: 'titulo-impacto', name: 'Título impacto', category: 'Títulos', sample: 'Título', text: 'Título grande',
    style: { ...base, fontFamily: 'Montserrat', fontSize: 130, bold: true, letterSpacing: -4, fill: '#111111', lineHeight: 1 } },
  { id: 'titulo-condensado', name: 'Condensado', category: 'Títulos', sample: 'TITULAR', text: 'TITULAR FUERTE',
    style: { ...base, fontFamily: 'Anton', fontSize: 150, bold: false, letterSpacing: 2, fill: '#111111', textTransform: 'upper', lineHeight: 1 } },
  { id: 'titulo-bebas', name: 'Bebas amplio', category: 'Títulos', sample: 'CARTEL', text: 'GRAN CARTEL',
    style: { ...base, fontFamily: 'Bebas Neue', fontSize: 170, bold: false, letterSpacing: 8, fill: '#111111', textTransform: 'upper', lineHeight: 1 } },
  { id: 'titulo-editorial', name: 'Editorial serif', category: 'Títulos', sample: 'Editorial', text: 'Título editorial',
    style: { ...base, fontFamily: 'Playfair Display', fontSize: 120, bold: true, letterSpacing: -1, fill: '#1a1a1a', lineHeight: 1.05 } },
  { id: 'titulo-espaciado', name: 'Mayúsculas espaciadas', category: 'Títulos', sample: 'ESPACIADO', text: 'TÍTULO ESPACIADO',
    style: { ...base, fontFamily: 'Montserrat', fontSize: 70, bold: false, letterSpacing: 16, fill: '#111111', textTransform: 'upper' } },

  // ---- Subtítulos
  { id: 'sub-limpio', name: 'Subtítulo limpio', category: 'Subtítulos', sample: 'Subtítulo', text: 'Subtítulo claro y legible',
    style: { ...base, fontFamily: 'Inter', fontSize: 52, bold: false, fill: '#444444' } },
  { id: 'sub-serif', name: 'Subtítulo serif', category: 'Subtítulos', sample: 'Subtítulo', text: 'Un subtítulo con carácter',
    style: { ...base, fontFamily: 'Merriweather', fontSize: 48, bold: false, italic: true, fill: '#333333', lineHeight: 1.2 } },
  { id: 'sub-mayusculas', name: 'Subtítulo en versalitas', category: 'Subtítulos', sample: 'SUBTÍTULO', text: 'Subtítulo en mayúsculas',
    style: { ...base, fontFamily: 'Raleway', fontSize: 42, bold: true, letterSpacing: 6, fill: '#666666', textTransform: 'upper' } },
  { id: 'sub-firma', name: 'Firma manuscrita', category: 'Subtítulos', sample: 'Firma', text: 'Con cariño',
    style: { ...base, fontFamily: 'Dancing Script', fontSize: 84, bold: true, fill: '#222222' } },

  // ---- Etiquetas y sellos
  { id: 'etiqueta-negra', name: 'Etiqueta negra', category: 'Etiquetas y sellos', sample: 'NUEVO', text: 'NUEVO',
    style: { ...base, fontFamily: 'Montserrat', fontSize: 46, bold: true, letterSpacing: 4, fill: '#ffffff', textTransform: 'upper', textEffect: 'background', effectColor: '#111111' } },
  { id: 'etiqueta-clara', name: 'Etiqueta clara', category: 'Etiquetas y sellos', sample: 'Destacado', text: 'Destacado',
    style: { ...base, fontFamily: 'Poppins', fontSize: 44, bold: true, fill: '#111111', textEffect: 'background', effectColor: '#e5e5e5' } },
  { id: 'etiqueta-oferta', name: 'Oferta', category: 'Etiquetas y sellos', sample: 'OFERTA', text: 'OFERTA',
    style: { ...base, fontFamily: 'Oswald', fontSize: 64, bold: true, letterSpacing: 5, fill: '#ffffff', textTransform: 'upper', textEffect: 'background', effectColor: '#e11d48' } },
  { id: 'etiqueta-amarilla', name: 'Marcador amarillo', category: 'Etiquetas y sellos', sample: 'Importante', text: 'Importante',
    style: { ...base, fontFamily: 'Nunito', fontSize: 50, bold: true, fill: '#111111', textEffect: 'background', effectColor: '#ffd84d' } },

  // ---- Citas
  { id: 'cita-serif', name: 'Cita serif', category: 'Citas', sample: '“Cita”', text: '“La creatividad es inteligencia divirtiéndose.”',
    style: { ...base, fontFamily: 'Playfair Display', fontSize: 70, bold: false, italic: true, fill: '#222222', lineHeight: 1.25 } },
  { id: 'cita-clasica', name: 'Cita clásica', category: 'Citas', sample: '“Cita”', text: '“Lo esencial es invisible a los ojos.”',
    style: { ...base, fontFamily: 'Merriweather', fontSize: 54, bold: false, italic: true, fill: '#333333', lineHeight: 1.35 } },
  { id: 'cita-manuscrita', name: 'Cita manuscrita', category: 'Citas', sample: '“Cita”', text: '“Haz lo que amas.”',
    style: { ...base, fontFamily: 'Dancing Script', fontSize: 100, bold: true, fill: '#222222', lineHeight: 1.1 } },

  // ---- Neón (mejor sobre fondo oscuro)
  { id: 'neon-rosa', name: 'Neón rosa', category: 'Neón', sample: 'Neón', text: 'Open Night',
    previewBg: '#14141a',
    style: { ...base, fontFamily: 'Lobster', fontSize: 120, bold: false, fill: '#ffffff', shadow: true, shadowColor: '#ff2bd6', shadowBlur: 26, shadowX: 0, shadowY: 0 } },
  { id: 'neon-cian', name: 'Neón cian', category: 'Neón', sample: 'NEÓN', text: 'NEÓN',
    previewBg: '#14141a',
    style: { ...base, fontFamily: 'Montserrat', fontSize: 110, bold: true, letterSpacing: 6, fill: '#e6fcff', textTransform: 'upper', shadow: true, shadowColor: '#00e5ff', shadowBlur: 22, shadowX: 0, shadowY: 0 } },
  { id: 'neon-verde', name: 'Neón verde', category: 'Neón', sample: 'ARCADE', text: 'ARCADE',
    previewBg: '#14141a',
    style: { ...base, fontFamily: 'Oswald', fontSize: 120, bold: true, letterSpacing: 8, fill: '#eaffe6', textTransform: 'upper', shadow: true, shadowColor: '#39ff14', shadowBlur: 24, shadowX: 0, shadowY: 0 } },

  // ---- Retro
  { id: 'retro-eco', name: 'Eco retro', category: 'Retro', sample: 'Retro', text: 'Retro Vibes',
    style: { ...base, fontFamily: 'Lobster', fontSize: 120, bold: false, fill: '#ffd23f', textEffect: 'echo', effectColor: '#ff5a36' } },
  { id: 'retro-sombra', name: 'Sombra dura', category: 'Retro', sample: 'DISCO', text: 'DISCO',
    style: { ...base, fontFamily: 'Anton', fontSize: 140, bold: false, letterSpacing: 3, fill: '#f5e6c8', textTransform: 'upper', shadow: true, shadowColor: '#d6452e', shadowBlur: 0, shadowX: 7, shadowY: 7 } },
  { id: 'retro-playa', name: 'Verano', category: 'Retro', sample: 'Verano', text: 'Verano',
    style: { ...base, fontFamily: 'Pacifico', fontSize: 110, bold: false, fill: '#ff6b6b', shadow: true, shadowColor: '#222222', shadowBlur: 0, shadowX: 5, shadowY: 5 } },
  { id: 'retro-bebas-eco', name: 'Eco mono', category: 'Retro', sample: 'GRANDE', text: 'GRANDE',
    style: { ...base, fontFamily: 'Bebas Neue', fontSize: 160, bold: false, letterSpacing: 6, fill: '#ffffff', textTransform: 'upper', textEffect: 'echo', effectColor: '#111111' },
    previewBg: '#f1f1f1' },

  // ---- Contorno
  { id: 'contorno-hueco', name: 'Contorno hueco', category: 'Contorno', sample: 'HUECO', text: 'HUECO',
    style: { ...base, fontFamily: 'Anton', fontSize: 160, bold: false, letterSpacing: 4, fill: CLEAR, strokeColor: '#111111', strokeWidth: 3, textTransform: 'upper' } },
  { id: 'contorno-grueso', name: 'Contorno grueso', category: 'Contorno', sample: 'Contorno', text: 'Contorno',
    style: { ...base, fontFamily: 'Montserrat', fontSize: 120, bold: true, fill: '#ffffff', strokeColor: '#111111', strokeWidth: 8 } },
  { id: 'contorno-fino', name: 'Contorno fino', category: 'Contorno', sample: 'FINO', text: 'LÍNEA FINA',
    style: { ...base, fontFamily: 'Bebas Neue', fontSize: 170, bold: false, letterSpacing: 10, fill: CLEAR, strokeColor: '#111111', strokeWidth: 2, textTransform: 'upper' } },

  // ---- Minimal
  { id: 'minimal-sombra', name: 'Sombra suave', category: 'Minimal', sample: 'Suave', text: 'Sombra suave',
    style: { ...base, fontFamily: 'Poppins', fontSize: 100, bold: true, fill: '#222222', shadow: true, shadowColor: 'rgba(0,0,0,0.28)', shadowBlur: 18, shadowX: 0, shadowY: 8 } },
  { id: 'minimal-subrayado', name: 'Subrayado', category: 'Minimal', sample: 'Subrayado', text: 'Texto subrayado',
    style: { ...base, fontFamily: 'Inter', fontSize: 60, bold: false, fill: '#111111', underline: true } },
  { id: 'minimal-fino', name: 'Fino espaciado', category: 'Minimal', sample: 'MINIMAL', text: 'MINIMAL',
    style: { ...base, fontFamily: 'Raleway', fontSize: 84, bold: false, letterSpacing: 18, fill: '#111111', textTransform: 'upper' } },
  { id: 'minimal-blanco', name: 'Blanco sobre oscuro', category: 'Minimal', sample: 'Blanco', text: 'Texto blanco',
    previewBg: '#222222',
    style: { ...base, fontFamily: 'Poppins', fontSize: 90, bold: true, fill: '#ffffff' } },
  { id: 'minimal-gris', name: 'Gris suave', category: 'Minimal', sample: 'Gris', text: 'Texto en gris',
    style: { ...base, fontFamily: 'Nunito', fontSize: 70, bold: false, fill: '#8a8a8a' } },
  { id: 'minimal-mono', name: 'Máquina de escribir', category: 'Minimal', sample: 'Mono', text: 'Texto monoespaciado',
    style: { ...base, fontFamily: 'Courier New', fontSize: 52, bold: false, letterSpacing: 2, fill: '#333333' } },
];

export const FONT_PAIR_DEFS: FontPairDef[] = [
  { id: 'par-editorial', name: 'Editorial', titleText: 'Título editorial', bodyText: 'Un subtítulo sereno que acompaña al titular',
    title: { fontFamily: 'Playfair Display', bold: true, fill: '#1a1a1a', fontSize: 110, letterSpacing: -1, lineHeight: 1.05 },
    body: { fontFamily: 'Inter', bold: false, fill: '#555555', fontSize: 46 } },
  { id: 'par-moderno', name: 'Moderno', titleText: 'Diseño moderno', bodyText: 'Texto de apoyo con lectura cómoda',
    title: { fontFamily: 'Montserrat', bold: true, fill: '#111111', fontSize: 110, letterSpacing: -3, lineHeight: 1 },
    body: { fontFamily: 'Merriweather', bold: false, fill: '#555555', fontSize: 42 } },
  { id: 'par-impacto', name: 'Impacto', titleText: 'GRAN ANUNCIO', bodyText: 'Todos los detalles, aquí abajo',
    title: { fontFamily: 'Anton', bold: false, fill: '#111111', fontSize: 150, letterSpacing: 2, textTransform: 'upper', lineHeight: 1 },
    body: { fontFamily: 'Roboto', bold: false, fill: '#444444', fontSize: 48 } },
  { id: 'par-deportivo', name: 'Deportivo', titleText: 'FINAL DE TEMPORADA', bodyText: 'Sábado a las 18:00 en el pabellón',
    title: { fontFamily: 'Bebas Neue', bold: false, fill: '#111111', fontSize: 160, letterSpacing: 6, textTransform: 'upper', lineHeight: 1 },
    body: { fontFamily: 'Oswald', bold: false, fill: '#555555', fontSize: 50, letterSpacing: 2 } },
  { id: 'par-elegante', name: 'Elegante', titleText: 'Nuestra boda', bodyText: 'Te invitamos a celebrarlo con nosotros',
    title: { fontFamily: 'Dancing Script', bold: true, fill: '#222222', fontSize: 130 },
    body: { fontFamily: 'Raleway', bold: false, fill: '#666666', fontSize: 42, letterSpacing: 3 } },
  { id: 'par-retro', name: 'Retro', titleText: 'Noche retro', bodyText: 'Música, luces y buen ambiente',
    title: { fontFamily: 'Lobster', bold: false, fill: '#d6452e', fontSize: 130 },
    body: { fontFamily: 'Nunito', bold: false, fill: '#444444', fontSize: 46 } },
  { id: 'par-limpio', name: 'Limpio', titleText: 'Menos es más', bodyText: 'Una idea simple, bien contada',
    title: { fontFamily: 'Poppins', bold: true, fill: '#111111', fontSize: 104, lineHeight: 1.05 },
    body: { fontFamily: 'Inter', bold: false, fill: '#666666', fontSize: 44 } },
  { id: 'par-clasico', name: 'Clásico', titleText: 'Título clásico', bodyText: 'Tipografía de siempre, sin sorpresas',
    title: { fontFamily: 'Georgia', bold: true, fill: '#1a1a1a', fontSize: 108 },
    body: { fontFamily: 'Arial', bold: false, fill: '#555555', fontSize: 44 } },
  { id: 'par-cartel', name: 'Cartel', titleText: 'EVENTO ABIERTO', bodyText: 'Entrada libre hasta completar aforo',
    title: { fontFamily: 'Oswald', bold: true, fill: '#111111', fontSize: 130, letterSpacing: 4, textTransform: 'upper', lineHeight: 1 },
    body: { fontFamily: 'Montserrat', bold: false, fill: '#555555', fontSize: 42 } },
  { id: 'par-divertido', name: 'Divertido', titleText: '¡Hola, verano!', bodyText: 'Planes para los días más largos',
    title: { fontFamily: 'Pacifico', bold: false, fill: '#ff6b6b', fontSize: 120 },
    body: { fontFamily: 'Poppins', bold: false, fill: '#444444', fontSize: 44 } },
];

export function getTextPreset(id: string): TextPresetDef | undefined {
  return TEXT_PRESET_DEFS.find((p) => p.id === id);
}
export function getFontPair(id: string): FontPairDef | undefined {
  return FONT_PAIR_DEFS.find((p) => p.id === id);
}

export interface DocSize {
  width: number;
  height: number;
}
export type MeasureFn = (props: Partial<TextLayer>) => { width: number; height: number };

// Medida aproximada cuando no hay canvas (pruebas): ~0.55 em por carácter.
export function estimateTextBox(props: Partial<TextLayer>): { width: number; height: number } {
  const size = props.fontSize ?? 48;
  const text = props.text ?? '';
  const upper = props.textTransform === 'upper';
  const lines = text.split('\n');
  const em = (props.bold ? 0.62 : 0.56) * (upper ? 1.15 : 1);
  const widest = Math.max(1, ...lines.map((l) => l.length));
  const width = widest * (size * em + (props.letterSpacing ?? 0));
  return { width: Math.max(1, width), height: lines.length * size * (props.lineHeight ?? 1) };
}

// Escala el tamaño de referencia al lienzo, lo limita para que el texto quepa
// y lo centra. Pura: la medida real la inyecta quien tenga canvas.
export function scaleTextProps(
  props: Partial<TextLayer>,
  doc: DocSize,
  measure: MeasureFn = estimateTextBox,
): Partial<TextLayer> {
  const k = Math.min(doc.width, doc.height) / REF_SIZE;
  const clamp = (n: number) => Math.min(MAX_FONT, Math.max(MIN_FONT, n));
  let fontSize = clamp(Math.round((props.fontSize ?? 48) * k));
  const refSize = props.fontSize ?? 48;
  const scaled = (size: number): Partial<TextLayer> => {
    const r = size / refSize; // razón final respecto al tamaño de referencia
    return {
      ...props,
      fontSize: size,
      letterSpacing: Math.round((props.letterSpacing ?? 0) * r * 10) / 10,
      ...(props.shadow
        ? {
            shadowBlur: Math.round((props.shadowBlur ?? 0) * r),
            shadowX: Math.round((props.shadowX ?? 0) * r),
            shadowY: Math.round((props.shadowY ?? 0) * r),
          }
        : {}),
      ...(props.strokeWidth ? { strokeWidth: Math.max(1, Math.round(props.strokeWidth * r)) } : {}),
    };
  };
  let out = scaled(fontSize);
  const maxW = doc.width * MAX_WIDTH_FRAC;
  const w = measure(out).width;
  if (w > maxW) {
    fontSize = clamp(Math.floor(fontSize * (maxW / w)));
    out = scaled(fontSize);
  }
  return out;
}

// Props completas de una capa de texto para el preset, centrada en el lienzo.
export function buildTextLayerProps(
  preset: TextPresetDef,
  doc: DocSize,
  measure: MeasureFn = estimateTextBox,
): Partial<TextLayer> {
  const props = scaleTextProps({ ...preset.style, text: preset.text, name: preset.name }, doc, measure);
  const box = measure(props);
  return {
    ...props,
    x: Math.round((doc.width - box.width) / 2),
    y: Math.round((doc.height - box.height) / 2),
  };
}

// Dos capas (título y cuerpo) una bajo la otra, el conjunto centrado.
export function buildFontPairProps(
  pair: FontPairDef,
  doc: DocSize,
  measure: MeasureFn = estimateTextBox,
): [Partial<TextLayer>, Partial<TextLayer>] {
  const common = { align: 'center' as const, italic: false, textTransform: 'none' as const };
  const title = scaleTextProps(
    { ...common, ...pair.title, text: pair.titleText, name: `${pair.name} · título` },
    doc,
    measure,
  );
  const body = scaleTextProps(
    { ...common, ...pair.body, text: pair.bodyText, name: `${pair.name} · cuerpo` },
    doc,
    measure,
  );
  const tb = measure(title);
  const bb = measure(body);
  const gap = Math.round((title.fontSize ?? 48) * 0.25);
  const total = tb.height + gap + bb.height;
  const top = Math.round((doc.height - total) / 2);
  return [
    { ...title, x: Math.round((doc.width - tb.width) / 2), y: top },
    { ...body, x: Math.round((doc.width - bb.width) / 2), y: top + tb.height + gap },
  ];
}
