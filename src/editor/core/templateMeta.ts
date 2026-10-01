// Etiquetas y color dominante de las plantillas (buscador de la pestaña
// «Plantillas»). Lógica pura: sin DOM, para poder probarla con Vitest.

// Etiquetas temáticas que se ofrecen como filtro.
export const TEMPLATE_TAGS = ['Redes', 'Impresión', 'Negocios', 'Eventos', 'Citas', 'Ventas', 'Personal'] as const;

// Etiquetas de las plantillas de fábrica, por nombre (los ids son correlativos
// y cambian al reordenar; el nombre es estable).
const PRESET_TAG_MAP: Record<string, string[]> = {
  'Cita': ['Redes', 'Citas'],
  'Promoción': ['Redes', 'Ventas', 'Negocios'],
  'Título simple': ['Negocios', 'Impresión'],
  'Historia': ['Redes', 'Eventos'],
  'Evento': ['Eventos', 'Redes'],
  'Rebajas': ['Ventas', 'Negocios', 'Redes'],
  'Frase': ['Redes', 'Citas'],
  'Perfil': ['Redes', 'Personal'],
};

// Etiquetas de una plantilla de fábrica: las del mapa + «Impresión» si el
// formato es grande y casi cuadrado/papel.
export function presetTags(name: string, width: number, height: number): string[] {
  const out = new Set(PRESET_TAG_MAP[name] ?? []);
  const big = Math.max(width, height);
  if (big >= 1700 && big / Math.min(width, height) < 1.6) out.add('Impresión');
  return [...out];
}

// "redes, venta  ,Redes" -> ['redes', 'venta'] (sin vacías ni duplicadas, máx. 12).
export function normalizeTags(input: string | string[]): string[] {
  const parts = Array.isArray(input) ? input : input.split(/[,;\n]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const tag = p.trim().replace(/\s+/g, ' ').slice(0, 24);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out.slice(0, 12);
}

// ---------- Color dominante ----------

export interface ColorSwatch {
  id: string;
  label: string;
  css: string; // color de la muestra
}

export const COLOR_SWATCHES: ColorSwatch[] = [
  { id: 'rojo', label: 'Rojo', css: '#e53935' },
  { id: 'naranja', label: 'Naranja', css: '#fb8c00' },
  { id: 'amarillo', label: 'Amarillo', css: '#fdd835' },
  { id: 'verde', label: 'Verde', css: '#43a047' },
  { id: 'azul', label: 'Azul', css: '#1e88e5' },
  { id: 'morado', label: 'Morado', css: '#8e24aa' },
  { id: 'claro', label: 'Claro', css: '#f5f5f5' },
  { id: 'oscuro', label: 'Oscuro', css: '#212121' },
];

// Índice de muestra (0..7) de un píxel RGB.
export function swatchIndexOf(r: number, g: number, b: number): number {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l > 0.88) return 6; // claro
  if (l < 0.18) return 7; // oscuro
  if (s < 0.14) return l > 0.5 ? 6 : 7;
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h >= 345 || h < 15) return 0;
  if (h < 45) return 1;
  if (h < 70) return 2;
  if (h < 170) return 3;
  if (h < 260) return 4;
  return 5;
}

// Histograma (8 posiciones, proporciones que suman 1) a partir de RGBA.
// Se ignoran los píxeles casi transparentes.
export function colorHistogram(rgba: ArrayLike<number>): number[] {
  const counts: number[] = new Array(COLOR_SWATCHES.length).fill(0);
  let total = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 40) continue;
    counts[swatchIndexOf(rgba[i], rgba[i + 1], rgba[i + 2])]++;
    total++;
  }
  return total === 0 ? counts : counts.map((c) => c / total);
}

export function dominantSwatchId(hist: number[]): string | null {
  let best = 0;
  let bi = -1;
  hist.forEach((v, i) => {
    if (v > best) {
      best = v;
      bi = i;
    }
  });
  return bi >= 0 ? COLOR_SWATCHES[bi].id : null;
}

// Una plantilla «tiene» un color si es el dominante o ocupa ≥ 25 % de la miniatura.
export function hasColor(hist: number[] | undefined, swatchId: string): boolean {
  if (!hist) return false;
  const i = COLOR_SWATCHES.findIndex((c) => c.id === swatchId);
  if (i < 0) return false;
  return dominantSwatchId(hist) === swatchId || hist[i] >= 0.25;
}

// ---------- Filtrado ----------

export interface TemplateFilter {
  query: string;
  tag: string | null;
  color: string | null;
}

export const EMPTY_FILTER: TemplateFilter = { query: '', tag: null, color: null };

export function isFilterActive(f: TemplateFilter): boolean {
  return !!(f.query.trim() || f.tag || f.color);
}

export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export interface FilterableTemplate {
  name: string;
  tags: string[];
  hist?: number[];
}

// El color solo filtra si ya se conoce el histograma (colorsReady); mientras
// se calcula, la plantilla no se oculta por color (evita parpadeos vacíos).
export function matchesTemplate(t: FilterableTemplate, f: TemplateFilter, colorsReady = true): boolean {
  const q = fold(f.query.trim());
  if (q) {
    const hay = fold([t.name, ...t.tags].join(' '));
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  if (f.tag && !t.tags.some((x) => fold(x) === fold(f.tag as string))) return false;
  if (f.color && colorsReady && !hasColor(t.hist, f.color)) return false;
  return true;
}
