// Modos de fusión: ÚNICA fuente de verdad para el lienzo (Konva), la exportación
// (PNG/JPG/PDF por `renderDocToCanvas`, SVG por `mix-blend-mode`) y el editor de video.
// Lógica pura: sin React ni Zustand.

export type BlendMode =
  | 'normal'
  | 'darken'
  | 'multiply'
  | 'burn'
  | 'lighten'
  | 'screen'
  | 'dodge'
  | 'add'
  | 'overlay'
  | 'softlight'
  | 'hardlight'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export interface BlendInfo {
  id: BlendMode;
  label: string;
  /** Valor de `globalCompositeOperation` (Canvas2D/Konva). */
  op: GlobalCompositeOperation;
  /** Valor de `mix-blend-mode` (CSS/SVG). */
  css: string;
  /** Palabras extra para buscar (paleta de comandos). */
  keywords: string;
  /** Tecla rápida estilo Photoshop (con Alt+Shift). */
  key: string;
  /** false: el SVG lo dibuja distinto según el visor (hay que avisarlo). */
  svgExact: boolean;
}

export interface BlendGroup {
  id: string;
  label: string;
  modes: BlendMode[];
}

const INFO: BlendInfo[] = [
  { id: 'normal', label: 'Normal', op: 'source-over', css: 'normal', keywords: 'sin fusion', key: 'N', svgExact: true },
  { id: 'darken', label: 'Oscurecer', op: 'darken', css: 'darken', keywords: 'darken', key: 'K', svgExact: true },
  { id: 'multiply', label: 'Multiplicar', op: 'multiply', css: 'multiply', keywords: 'multiply sombra', key: 'M', svgExact: true },
  { id: 'burn', label: 'Subexponer color', op: 'color-burn', css: 'color-burn', keywords: 'burn quemar', key: 'B', svgExact: true },
  { id: 'lighten', label: 'Aclarar', op: 'lighten', css: 'lighten', keywords: 'lighten', key: 'G', svgExact: true },
  { id: 'screen', label: 'Trama', op: 'screen', css: 'screen', keywords: 'screen pantalla', key: 'S', svgExact: true },
  { id: 'dodge', label: 'Sobreexponer color', op: 'color-dodge', css: 'color-dodge', keywords: 'dodge subexponer', key: 'D', svgExact: true },
  { id: 'add', label: 'Sumar', op: 'lighter', css: 'plus-lighter', keywords: 'add lighter suma', key: 'A', svgExact: false },
  { id: 'overlay', label: 'Superponer', op: 'overlay', css: 'overlay', keywords: 'overlay', key: 'O', svgExact: true },
  { id: 'softlight', label: 'Luz suave', op: 'soft-light', css: 'soft-light', keywords: 'soft light', key: 'F', svgExact: true },
  { id: 'hardlight', label: 'Luz fuerte', op: 'hard-light', css: 'hard-light', keywords: 'hard light', key: 'H', svgExact: true },
  { id: 'difference', label: 'Diferencia', op: 'difference', css: 'difference', keywords: 'difference', key: 'E', svgExact: true },
  { id: 'exclusion', label: 'Exclusión', op: 'exclusion', css: 'exclusion', keywords: 'exclusion', key: 'X', svgExact: true },
  { id: 'hue', label: 'Tono', op: 'hue', css: 'hue', keywords: 'hue matiz', key: 'U', svgExact: true },
  { id: 'saturation', label: 'Saturación', op: 'saturation', css: 'saturation', keywords: 'saturation', key: 'T', svgExact: true },
  { id: 'color', label: 'Color', op: 'color', css: 'color', keywords: 'color', key: 'C', svgExact: true },
  { id: 'luminosity', label: 'Luminosidad', op: 'luminosity', css: 'luminosity', keywords: 'luminosity brillo', key: 'Y', svgExact: true },
];

/** Todos los modos en el orden del menú (agrupados). */
export const BLEND_MODES: BlendMode[] = INFO.map((i) => i.id);

export const BLEND_GROUPS: BlendGroup[] = [
  { id: 'normal', label: 'Normal', modes: ['normal'] },
  { id: 'darken', label: 'Oscurecer', modes: ['darken', 'multiply', 'burn'] },
  { id: 'lighten', label: 'Aclarar', modes: ['lighten', 'screen', 'dodge', 'add'] },
  { id: 'contrast', label: 'Contraste', modes: ['overlay', 'softlight', 'hardlight'] },
  { id: 'compare', label: 'Comparar', modes: ['difference', 'exclusion'] },
  { id: 'components', label: 'Componentes', modes: ['hue', 'saturation', 'color', 'luminosity'] },
];

const BY_ID = new Map<string, BlendInfo>(INFO.map((i) => [i.id, i]));

export const BLEND_LABEL: Record<BlendMode, string> = Object.fromEntries(INFO.map((i) => [i.id, i.label])) as Record<
  BlendMode,
  string
>;

export const isBlendMode = (v: unknown): v is BlendMode => typeof v === 'string' && BY_ID.has(v);

/** Diseños antiguos (sin blendMode) o valores raros: siempre un modo válido. */
export const normalizeBlend = (v: unknown): BlendMode => (isBlendMode(v) ? v : 'normal');

export const blendInfo = (v: unknown): BlendInfo => BY_ID.get(normalizeBlend(v))!;

/** `globalCompositeOperation` de un modo (normal = source-over). */
export const blendOp = (v: unknown): GlobalCompositeOperation => blendInfo(v).op;

/** Para Konva/Canvas: undefined con «normal» (no toca el lienzo), el modo si no. */
export const blendOpOrUndefined = (v: unknown): GlobalCompositeOperation | undefined =>
  normalizeBlend(v) === 'normal' ? undefined : blendOp(v);

/** `mix-blend-mode` CSS/SVG de un modo. */
export const blendCss = (v: unknown): string => blendInfo(v).css;

/** ¿El SVG exportado reproduce el modo igual que el lienzo en cualquier visor? */
export const blendSvgExact = (v: unknown): boolean => blendInfo(v).svgExact;

/** Siguiente (+1) o anterior (-1) modo de la lista, con vuelta al principio/final. */
export function nextBlend(current: unknown, dir: 1 | -1): BlendMode {
  const i = BLEND_MODES.indexOf(normalizeBlend(current));
  return BLEND_MODES[(i + dir + BLEND_MODES.length) % BLEND_MODES.length];
}

/** Modo común de varias capas, o 'mixed' si difieren. */
export function commonBlend(modes: unknown[]): BlendMode | 'mixed' {
  if (!modes.length) return 'normal';
  const first = normalizeBlend(modes[0]);
  return modes.every((m) => normalizeBlend(m) === first) ? first : 'mixed';
}

/** Id de la acción del registro de atajos para un modo (`blend:multiply`). */
export const blendActionId = (m: BlendMode) => `blend:${m}`;
export const blendFromActionId = (id: string): BlendMode | null =>
  id.startsWith('blend:') && isBlendMode(id.slice(6)) ? (id.slice(6) as BlendMode) : null;

/** Capas (con modo) que el SVG no reproduce de forma exacta: para avisar en la exportación. */
export function svgInexactBlends(layers: { blendMode?: unknown; visible?: boolean }[]): BlendMode[] {
  const out = new Set<BlendMode>();
  for (const l of layers) {
    if (l.visible === false) continue;
    const m = normalizeBlend(l.blendMode);
    if (m !== 'normal' && !blendSvgExact(m)) out.add(m);
  }
  return [...out];
}

/** Atajos Alt+Shift+<tecla> de cada modo (para el registro de atajos y la documentación). */
export const BLEND_HOTKEYS: { mode: BlendMode; key: string }[] = INFO.map((i) => ({ mode: i.id, key: i.key }));
