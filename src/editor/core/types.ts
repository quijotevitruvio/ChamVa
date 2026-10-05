import type { TextSpan } from './richText';

import type { ChartSpec, TableSpec } from './charts';
// Modelo de datos del "documento" de ChamVa.
// El diseño NO se guarda como imagen, sino como este JSON de capas.
// Render y exportación son funciones que reciben este Doc y producen píxeles/vectores.

// Los modos de fusión viven en blend.ts (lienzo, exportación y video los comparten).
import type { BlendMode } from './blend';
export type { BlendMode };
import type { LayerMask } from './layerMask';
export type { LayerMask };

export interface LayerBase {
  id: string;
  groupId?: string; // capas con el mismo groupId se seleccionan y mueven juntas
  frame?: boolean; // forma que actúa como "marco": se le suelta una foto encima
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
  folderId?: string; // carpeta de capas (solo organización: no cambia el orden de dibujo)
  styleId?: string; // estilo de objeto compartido vinculado (Doc.styles)
  constraints?: LayerConstraints; // cómo se recoloca al cambiar el tamaño del lienzo
  // Máscara de capa no destructiva (layerMask.ts), en el marco local de la capa. Sin campo = sin máscara.
  mask?: LayerMask;
}

// Restricciones al redimensionar el lienzo (ver constraints.ts).
export type ConstraintH = 'left' | 'right' | 'center' | 'stretch' | 'scale';
export type ConstraintV = 'top' | 'bottom' | 'center' | 'stretch' | 'scale';
export interface LayerConstraints {
  h: ConstraintH;
  v: ConstraintV;
}

// Carpeta de capas (Doc.folders). Árbol por parentId; solo organiza el panel.
export interface LayerFolder {
  id: string;
  name: string;
  parentId?: string;
  collapsed?: boolean;
  visible?: boolean; // false = oculta (sus capas se ocultan)
  locked?: boolean; // true = bloqueada (sus capas se bloquean)
}

// Estilo de objeto con nombre (Doc.styles): un parche de estilo reutilizable.
export interface SharedStyle {
  id: string;
  name: string;
  style: Record<string, unknown>;
}

// --- Ajustes de píxel avanzados (curvas, niveles, mezclador HSL) ---
export type CurvePoint = [number, number]; // [entrada, salida], ambos 0..255
export interface ToneCurves {
  rgb?: CurvePoint[]; // curva maestra
  r?: CurvePoint[];
  g?: CurvePoint[];
  b?: CurvePoint[];
}
export interface LevelsAdjust {
  inBlack: number; // 0..254 (0 = neutro)
  gamma: number; // 0.1..10 (1 = neutro; >1 aclara medios)
  inWhite: number; // 1..255 (255 = neutro)
  outBlack: number; // 0..255 (0 = neutro)
  outWhite: number; // 0..255 (255 = neutro)
}
export type HslFamily = 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta';
export interface HslShift {
  h?: number; // -100..100 (±100 = ±30° de tono)
  s?: number; // -100..100
  l?: number; // -100..100
}
export type HslMix = Partial<Record<HslFamily, HslShift>>;

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
  invert?: boolean; // negativo (false = off)
  hue?: number; // -180..180 grados (0 = normal)
  exposure?: number; // -100..100 (0 = normal; ±100 = ±2 stops)
  clarity?: number; // 0..100 (0 = off), contraste local
  grayscale?: number; // 0..100 (0 = color)
  sepia?: number; // 0..100 (0 = off)
  threshold?: number; // 0..255 (0 = off), blanco/negro puro
  curves?: ToneCurves; // curvas de tono (undefined = off)
  levels?: LevelsAdjust; // niveles (undefined = off)
  hslMix?: HslMix; // mezclador por familia de color (undefined = off)
  denoise?: number; // 0..100 (0 = off), reducir ruido de luminancia
  denoiseColor?: number; // 0..100 (0 = off), reducir ruido de color
  dehaze?: number; // 0..100 (0 = off), quitar neblina
  lensDistortion?: number; // -100..100 (0 = off; + corrige barril, - corrige cojín)
  lensVignette?: number; // 0..100 (0 = off), aclara los bordes (corrige viñeteo)
  fx?: ImageFx; // efectos creativos y retoque (undefined = off)
}

// Efectos creativos y retoque (ver imageEffects.ts). Todo opcional; 0/undefined = apagado.
export type FxBlend = 'screen' | 'multiply' | 'overlay' | 'softlight';
export type FxTexture = 'paper' | 'film' | 'dust' | 'bokeh' | 'leak' | 'canvas';
export interface RedEyePoint {
  x: number; // 0..1 del ancho
  y: number; // 0..1 del alto
  r: number; // radio, fracción del lado mayor
}
export interface ImageFx {
  tiltAmount?: number; // 0..100 desenfoque tilt-shift
  tiltPos?: number; // 0..1 centro de la banda nítida (def. .5)
  tiltWidth?: number; // 0..1 ancho de la banda (def. .25)
  tiltVertical?: boolean; // banda vertical en vez de horizontal
  tiltSat?: number; // 0..100 saturación extra (efecto maqueta)
  motionDist?: number; // 0..100 desenfoque de movimiento
  motionAngle?: number; // grados
  radialAmount?: number; // 0..100 desenfoque radial (giro)
  zoomAmount?: number; // 0..100 desenfoque de zoom
  blurCx?: number; // 0..1 centro de radial/zoom (def. .5)
  blurCy?: number;
  chroma?: number; // 0..100 aberración cromática
  chromaAngle?: number; // grados
  glitch?: number; // 0..100 intensidad
  glitchSeed?: number; // semilla entera
  htSize?: number; // 0..40 tamaño de punto del halftone (0 = off)
  htAngle?: number; // grados de la trama
  htColor?: boolean; // puntos de color (si no, monocromo)
  sketchMode?: 'pencil' | 'comic';
  sketchAmount?: number; // 0..100 (0 = off)
  dblSrc?: string; // imagen de la doble exposición (dataURL reducido)
  dblMode?: FxBlend;
  dblOpacity?: number; // 0..1
  texKind?: FxTexture;
  texAmount?: number; // 0..1 opacidad (0 = off)
  texMode?: FxBlend;
  texScale?: number; // 0.5..3
  texSeed?: number;
  redEyes?: RedEyePoint[];
  skin?: number; // 0..100 suavizar piel
  gradMap?: Gradient; // mapa de degradado
  gradMapAmount?: number; // 0..100 (0 = off)
  glowAmount?: number; // 0..100 resplandor (bloom)
  glowRadius?: number; // 0..100
  glowColor?: string; // hex; vacío = color natural
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
  invert: false,
  hue: 0,
  exposure: 0,
  clarity: 0,
  grayscale: 0,
  sepia: 0,
  threshold: 0,
  denoise: 0,
  denoiseColor: 0,
  dehaze: 0,
  lensDistortion: 0,
  lensVignette: 0,
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
  // Recorte no destructivo (imageCrop.ts): región visible de `src`, en fracciones 0..1 de la imagen
  // completa y SIN volteo. Con recorte, naturalWidth/Height son las del trozo visible. Sin campo = entera.
  crop?: ImageCrop;
  iconName?: string; // si viene de Iconify, permite recolorear
  chart?: ChartSpec; // gráfica reeditable (se re-renderiza a src)
  table?: TableSpec; // tabla reeditable (se re-renderiza a src)
  reflection?: ImageReflection; // reflejo en el suelo (no destructivo)
  castShadow?: ImageCastShadow; // sombra proyectada sobre el suelo (no destructivo)
}

// Recorte de la imagen fuente en fracciones (0..1) de su ancho y alto. Fracciones y no píxeles para
// que siga alineado si `src` cambia de resolución (Optimizar HD, quitar fondo, SVG, QR).
export interface ImageCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Reflejo en suelo: copia volteada bajo la capa con degradado de desvanecimiento.
export interface ImageReflection {
  opacity: number; // 0..1 (opacidad del reflejo en su arranque)
  length: number; // 0.1..1 (fracción de la altura de la imagen que se ve)
  gap: number; // separación en px (de la propia imagen) entre capa y reflejo
}

// Sombra proyectada «en el suelo»: silueta aplastada que parte de la base de la capa.
export interface ImageCastShadow {
  angle: number; // grados: 0 = hacia la derecha, 90 = hacia el espectador, -90 = detrás
  length: number; // 0.1..2 (veces la altura de la imagen)
  blur: number; // px de desenfoque
  opacity: number; // 0..1
  color: string;
}

export type TextTransform = 'none' | 'upper' | 'lower' | 'caps';

export interface TextLayer extends LayerBase {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  fill: string;
  fillGradient?: Gradient; // si existe, sustituye a `fill` en el texto sin color propio
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
  underline?: boolean; // subrayado de todo el texto
  spans?: TextSpan[]; // estilo por palabra: solo lo que difiere de la base (richText.ts)
  // Tipografía avanzada (typography.ts): todo opcional; sin estos campos el texto se dibuja como siempre.
  boxWidth?: number; // ancho fijo de la caja (px): el texto salta de línea por palabras
  boxHeight?: number; // alto fijo de la caja (px); necesario para columnas y autoajuste
  autoFit?: boolean; // reduce/ajusta el tamaño de fuente hasta que quepa en la caja
  fitMin?: number; // tamaño mínimo del autoajuste (def. 6)
  fitMax?: number; // tamaño máximo del autoajuste (def. fontSize)
  indent?: number; // sangría de la primera línea de cada párrafo (px)
  paragraphSpacing?: number; // espacio extra entre párrafos (px)
  dropCap?: 'none' | 'first' | 'all'; // capitular: solo el primer párrafo / todos
  dropCapLines?: number; // alto de la capitular en líneas (2–5)
  columns?: number; // columnas de texto (con boxWidth)
  columnGap?: number; // separación entre columnas (px)
  tabStops?: number[]; // paradas de tabulación (px); def. cada 4 em
  tabLeader?: 'none' | 'dots' | 'dashes'; // relleno de la tabulación
  fractions?: boolean; // «1/2» → «½» al dibujar
  kerning?: Record<string, number>; // ajuste en px por pareja de letras («AV»)
  // Efectos de texto avanzados (textFx.ts): todo opcional; sin ellos el texto se dibuja como siempre.
  imageFill?: TextImageFill; // relleno del texto con una imagen
  extrude?: TextExtrude; // sombra larga / extrusión 3D
  outlines?: TextOutline[]; // contornos concéntricos (del interior al exterior, hasta 4)
  inkTexture?: TextInk; // desgaste de tinta (ruido determinista)
  highlight?: TextHighlight; // resaltador / subrayado / tachado de rotulador (todo el texto)
  pathText?: TextPathCurve; // el texto sigue una curva Bézier de 4 puntos de control
}

export interface TextImageFill {
  src: string; // dataURL de la imagen
  fit: 'cover' | 'tile'; // cubrir el cuadro o repetir en mosaico
  scale: number; // 1 = tamaño natural (mosaico) / ajuste exacto (cubrir)
  x: number; // desplazamiento (px)
  y: number;
}
export interface TextExtrude {
  depth: number; // px (máx. 200)
  angle: number; // grados (0 = derecha, 90 = abajo)
  color: string;
  mode: 'long' | 'solid'; // sombra larga plana / extrusión con oscurecimiento
}
export interface TextOutline {
  color: string;
  width: number; // grosor del anillo (px)
}
export interface TextInk {
  amount: number; // 0..1
  seed: number;
}
export interface TextHighlight {
  color: string;
  opacity: number; // 0..1
  mode: 'marker' | 'underline' | 'strike';
  thickness: number; // relativo al tamaño de fuente
}
export interface TextPathCurve {
  points: { x: number; y: number }[]; // 4 puntos de control (Bézier cúbica), en el espacio de la capa
  offset?: number; // desplazamiento del inicio del texto a lo largo del trazado (px)
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
  fillGradient?: Gradient; // si existe, sustituye a `fill`
  strokeGradient?: Gradient; // si existe, el contorno usa este degradado en vez de `stroke`
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

// Trazo a mano alzada (pinceles). Cada pincelada = UNA capa; la geometría se genera por código
// (brush.ts) a partir de `pts`, así que el .chamva solo guarda los puntos suavizados.
export type BrushStyle =
  | 'pencil'
  | 'pen'
  | 'marker'
  | 'brush'
  | 'watercolor'
  | 'airbrush'
  | 'highlighter'
  | 'chalk'
  | 'calligraphy';

export interface StrokeLayer extends LayerBase {
  type: 'stroke';
  brush: BrushStyle;
  color: string;
  size: number; // grosor base en px del documento
  pts: number[]; // [x, y, presión 0..1, …] relativos al origen de la capa (x, y)
  seed: number; // semilla del grano (aerógrafo, tiza, lápiz): mismo trazo = mismo dibujo
  width: number; // caja de la capa (incluye margen del pincel)
  height: number;
}

export type Layer = ImageLayer | TextLayer | ShapeLayer | StrokeLayer;

export interface GradientStop {
  offset: number; // 0..1
  color: string;
}

export interface Gradient {
  angle: number; // grados (solo lineal)
  stops: GradientStop[];
  kind?: 'linear' | 'radial' | 'conic'; // por defecto lineal
  // Cónico (conic.ts): `angle` es el ángulo de inicio; centro como fracción 0..1 de la caja (def. 0.5).
  cx?: number;
  cy?: number;
  dither?: boolean; // «Suavizar»: ruido muy sutil determinista contra las bandas
}

// Grano del fondo (grain.ts): amount 0..100, size = tamaño del grano en px del documento.
export interface BgGrain {
  amount: number;
  size: number;
}

export type Background =
  | { type: 'transparent' }
  | { type: 'solid'; color: string; grain?: BgGrain }
  | { type: 'gradient'; gradient: Gradient; grain?: BgGrain }
  | { type: 'pattern'; pattern: PatternSpec; grain?: BgGrain };

// Patrón de fondo repetido (ver patterns.ts): color1 = fondo, color2 = motivo.
export type PatternKind = 'dots' | 'lines' | 'grid' | 'diagonal' | 'zigzag' | 'checks' | 'waves';
export interface PatternSpec {
  kind: PatternKind;
  color1: string;
  color2: string;
  size: number; // lado de la baldosa en px del documento
  thickness: number; // grosor del trazo (o radio del punto) en px
}

// Nota adhesiva interna: solo se ve en el editor, no se exporta.
export interface StickyNote {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string; // solo grises/blanco
}

export const TRANSPARENT_BG: Background = { type: 'transparent' };

export interface Doc {
  id: string;
  name: string;
  width: number; // tamaño del lienzo en px
  height: number;
  background: Background;
  layers: Layer[];
  version: number;
  // Guías del usuario (px del documento): x = verticales, y = horizontales.
  guides?: { x: number[]; y: number[] };
  // Ayudas de maquetación (solo editor, nunca se exportan).
  margins?: { top: number; right: number; bottom: number; left: number };
  bleed?: number; // sangrado en px, fuera del lienzo
  // Unidad y resolución con que el usuario piensa este tamaño (los px siguen siendo la verdad).
  unit?: import('./units').Unit;
  dpi?: number;
  columns?: { count: number; gutter: number; margin: number };
  notes?: StickyNote[];
  speakerNotes?: string; // notas del orador de esta página
  // Colores usados en este diseño (el más reciente primero): «Colores del diseño».
  recentColors?: string[];
  folders?: LayerFolder[]; // carpetas de capas (organización del panel)
  styles?: SharedStyle[]; // estilos de objeto compartidos
  isMaster?: boolean; // esta página es una página maestra
  masterId?: string; // id de la página maestra cuyas capas se muestran detrás (solo lectura)
  title?: string; // título de la página (distinto de `name`, que es el nombre del diseño en la primera)
  hidden?: boolean; // página oculta: no se exporta ni se presenta (sigue en el proyecto)
  locked?: boolean; // página bloqueada: sus capas no se mueven, transforman ni borran
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
  tags?: string[]; // etiquetas propias para el buscador de plantillas
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
