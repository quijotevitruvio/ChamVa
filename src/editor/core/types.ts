// Modelo de datos del "documento" de ChamVa.
// El diseño NO se guarda como imagen, sino como este JSON de capas.
// Render y exportación son funciones que reciben este Doc y producen píxeles/vectores.

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten';

export interface LayerBase {
  id: string;
  name: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number; // grados
  opacity: number; // 0..1
  blendMode: BlendMode;
  visible: boolean;
  locked: boolean;
  anim?: string; // id de animación de entrada (ver animations.ts)
  animOut?: string; // id de animación de salida
  animDuration?: number; // segundos (def. 0.6)
}

export interface ImageAdjust {
  brightness: number; // 0..2 (1 = normal)
  contrast: number; // 0..2 (1 = normal)
  saturate: number; // 0..2 (1 = normal)
  // Campos opcionales: los documentos antiguos no los tienen (leer con ?? neutro).
  temperature?: number; // -1..1 (0 = normal; + cálido, - frío)
  tint?: number; // -1..1 (0 = normal; + magenta, - verde)
  highlights?: number; // -1..1 (0 = normal; + recupera luces)
  shadows?: number; // -1..1 (0 = normal; + levanta sombras)
  vibrance?: number; // -1..1 (0 = normal; saturación que protege tonos ya saturados)
  sharpen?: number; // 0..1 (0 = off)
  blur?: number; // 0..30 px (0 = off)
  vignette?: number; // 0..1 (0 = off)
  grain?: number; // 0..1 (0 = off)
  pixelate?: number; // 0..50 px de bloque (0 = off)
  posterize?: number; // 0..1 (0 = off)
  outline?: number; // 0..40 px (0 = off), contorno tipo sticker
  outlineColor?: string; // hex (def. #ffffff)
}

export const DEFAULT_ADJUST: ImageAdjust = {
  brightness: 1,
  contrast: 1,
  saturate: 1,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  vibrance: 0,
  sharpen: 0,
  blur: 0,
  vignette: 0,
  grain: 0,
  pixelate: 0,
  posterize: 0,
  outline: 0,
  outlineColor: '#ffffff',
};

export interface LayerShadow {
  shadow: boolean;
  shadowColor: string;
  shadowBlur: number;
  shadowX: number;
  shadowY: number;
}

export const NO_SHADOW: LayerShadow = {
  shadow: false,
  shadowColor: '#000000',
  shadowBlur: 12,
  shadowX: 4,
  shadowY: 4,
};

export interface ImageLayer extends LayerBase, LayerShadow {
  type: 'image';
  src: string; // dataURL / blob / ruta local
  originalSrc?: string; // imagen original (antes de quitar fondo) para "Restaurar"
  naturalWidth: number;
  naturalHeight: number;
  adjust: ImageAdjust;
  filter: string; // id del registro de filtros (ver filters.ts)
  flipX: boolean;
  flipY: boolean;
  maskShape?: ShapeKind; // recorta la imagen a una forma (marco)
  iconName?: string; // si viene de Iconify, permite recolorear
}

export type TextTransform = 'none' | 'upper' | 'lower' | 'caps';

export interface TextLayer extends LayerBase {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  fill: string;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  italic: boolean;
  textTransform: TextTransform;
  letterSpacing: number;
  strokeColor: string;
  strokeWidth: number; // 0 = sin contorno
  shadow: boolean;
  shadowColor: string;
  shadowBlur: number;
  shadowX: number;
  shadowY: number;
  curve?: number; // grados de arco (0 = recto)
  lineHeight?: number; // interlineado (def. 1)
  textEffect?: 'none' | 'echo' | 'background'; // efecto de texto (eco / fondo)
  effectColor?: string; // color del eco o del fondo
  listStyle?: 'none' | 'bullet' | 'number'; // lista: viñetas / numerada
}

// Texto tal cual se dibuja: aplica transformación de caja y prefijos de lista.
export function displayText(layer: TextLayer): string {
  const t = transformText(layer.text, layer.textTransform);
  const style = layer.listStyle ?? 'none';
  if (style === 'none') return t;
  const lines = t.split('\n');
  return lines
    .map((l, i) => (style === 'number' ? `${i + 1}.  ${l}` : `•  ${l}`))
    .join('\n');
}

// Aplica mayúsculas / minúsculas / capitalizar al texto mostrado.
export function transformText(text: string, mode: TextTransform): string {
  switch (mode) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'caps':
      return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    default:
      return text;
  }
}

export const FONT_FAMILIES = [
  // Del sistema (siempre disponibles)
  'Arial',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Impact',
  'Comic Sans MS',
  // Fuentes libres (OFL) empaquetadas con la app vía @fontsource (src/fonts.css)
  'Montserrat',
  'Poppins',
  'Roboto',
  'Oswald',
  'Anton',
  'Bebas Neue',
  'Playfair Display',
  'Lobster',
  'Pacifico',
  'Dancing Script',
  'Inter',
  'Raleway',
  'Nunito',
  'Merriweather',
];

// Estilos de texto predeterminados (como Canva).
export interface TextPreset {
  label: string;
  text: string;
  fontSize: number;
  bold: boolean;
}

export const TEXT_PRESETS: TextPreset[] = [
  { label: 'Título', text: 'Título', fontSize: 96, bold: true },
  { label: 'Subtítulo', text: 'Subtítulo', fontSize: 56, bold: true },
  { label: 'Cuerpo de texto', text: 'Escribe aquí', fontSize: 36, bold: false },
];

// Construye el fontStyle para Konva ('normal' | 'bold' | 'italic' | 'italic bold').
export function konvaFontStyle(bold: boolean, italic: boolean): string {
  const parts: string[] = [];
  if (italic) parts.push('italic');
  if (bold) parts.push('bold');
  return parts.length ? parts.join(' ') : 'normal';
}

// Construye el shorthand de ctx.font para Canvas 2D.
export function canvasFont(layer: TextLayer): string {
  const it = layer.italic ? 'italic ' : '';
  const bd = layer.bold ? 'bold ' : '';
  return `${it}${bd}${layer.fontSize}px ${layer.fontFamily}`;
}

export type ShapeKind =
  | 'rect'
  | 'ellipse'
  | 'triangle'
  | 'star'
  | 'line'
  | 'arrow'
  | 'pentagon'
  | 'hexagon'
  | 'octagon'
  | 'diamond'
  | 'heart'
  | 'cross'
  | 'doubleArrow'
  | 'blockArrow'
  | 'bubble'
  | 'cloud'
  | 'star6'
  | 'moon'
  | 'ring'
  | 'semicircle'
  | 'trapezoid'
  | 'parallelogram';

export interface ShapeLayer extends LayerBase, LayerShadow {
  type: 'shape';
  shape: ShapeKind;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
}

export const SHAPE_OPTIONS: { kind: ShapeKind; label: string; icon: string }[] = [
  { kind: 'rect', label: 'Rectángulo', icon: '▭' },
  { kind: 'ellipse', label: 'Círculo', icon: '⬭' },
  { kind: 'triangle', label: 'Triángulo', icon: '△' },
  { kind: 'star', label: 'Estrella', icon: '★' },
  { kind: 'line', label: 'Línea', icon: '─' },
  { kind: 'arrow', label: 'Flecha', icon: '→' },
  { kind: 'pentagon', label: 'Pentágono', icon: '⬠' },
  { kind: 'hexagon', label: 'Hexágono', icon: '⬡' },
  { kind: 'octagon', label: 'Octógono', icon: '⯃' },
  { kind: 'diamond', label: 'Rombo', icon: '◇' },
  { kind: 'heart', label: 'Corazón', icon: '♥' },
  { kind: 'cross', label: 'Cruz', icon: '✚' },
  { kind: 'doubleArrow', label: 'Flecha doble', icon: '⇔' },
  { kind: 'blockArrow', label: 'Flecha de bloque', icon: '➡' },
  { kind: 'bubble', label: 'Bocadillo', icon: '💬' },
  { kind: 'cloud', label: 'Nube', icon: '☁' },
  { kind: 'star6', label: 'Estrella de 6', icon: '✡' },
  { kind: 'moon', label: 'Luna', icon: '☾' },
  { kind: 'ring', label: 'Anillo', icon: '◎' },
  { kind: 'semicircle', label: 'Semicírculo', icon: '◓' },
  { kind: 'trapezoid', label: 'Trapecio', icon: '⏢' },
  { kind: 'parallelogram', label: 'Paralelogramo', icon: '▱' },
];

export type Layer = ImageLayer | TextLayer | ShapeLayer;

export interface GradientStop {
  offset: number; // 0..1
  color: string;
}

export interface Gradient {
  angle: number; // grados
  stops: GradientStop[];
}

export type Background =
  | { type: 'transparent' }
  | { type: 'solid'; color: string }
  | { type: 'gradient'; gradient: Gradient };

export const TRANSPARENT_BG: Background = { type: 'transparent' };

export interface Doc {
  id: string;
  name: string;
  width: number; // tamaño del lienzo en px
  height: number;
  background: Background;
  layers: Layer[];
  version: number;
}

// Calcula los puntos inicio/fin de un degradado lineal según el ángulo y el tamaño.
// Lo usan IGUAL el editor (Konva) y la exportación (Canvas 2D).
export function gradientPoints(angle: number, w: number, h: number) {
  const rad = (angle * Math.PI) / 180;
  const cx = w / 2;
  const cy = h / 2;
  const len = (Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad))) / 2;
  const dx = Math.cos(rad) * len;
  const dy = Math.sin(rad) * len;
  return { x0: cx - dx, y0: cy - dy, x1: cx + dx, y1: cy + dy };
}

// Imagen subida que queda en la galería "Subidos" para reutilizar.
export interface UploadedImage {
  id: string;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  name: string;
}

// Plantilla guardada: un diseño reutilizable con miniatura.
export interface SavedTemplate {
  id: string;
  name: string;
  thumb: string; // dataURL de vista previa
  doc: Doc;
}

// Presets de tamaño de lienzo (como Canva).
export interface CanvasPreset {
  label: string;
  width: number;
  height: number;
}

export const CANVAS_PRESETS: CanvasPreset[] = [
  { label: 'Instagram Post (1080×1080)', width: 1080, height: 1080 },
  { label: 'Instagram Story (1080×1920)', width: 1080, height: 1920 },
  { label: 'Facebook Post (1200×630)', width: 1200, height: 630 },
  { label: 'YouTube Thumbnail (1280×720)', width: 1280, height: 720 },
  { label: 'A4 300dpi (2480×3508)', width: 2480, height: 3508 },
  { label: 'Cuadrado (1000×1000)', width: 1000, height: 1000 },
];
