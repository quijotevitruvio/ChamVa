// Informe de recursos: fuentes, imágenes, colores y problemas de un proyecto,
// para revisarlo antes de imprimir o entregar. Función pura (sin DOM).
import { FONT_FAMILIES, type Doc, type Gradient, type Layer } from '../editor/core/types';

export type FontKind = 'empaquetada' | 'sistema' | 'propia' | 'desconocida';

export interface FontUse {
  name: string;
  kind: FontKind;
  uses: number;
}
export interface ImageUse {
  page: number;
  layer: string;
  naturalW: number;
  naturalH: number;
  shownW: number; // tamaño en el diseño (px)
  shownH: number;
  bytes: number; // peso estimado de la imagen incrustada
  ratio: number; // píxeles de la imagen por píxel del diseño (<1 = ampliada, se verá borrosa)
}
export interface Issue {
  level: 'aviso' | 'info';
  page: number;
  layer: string;
  text: string;
}
export interface ResourceReport {
  pages: number;
  layers: number;
  fonts: FontUse[];
  images: ImageUse[];
  imageBytes: number;
  uniqueImages: number;
  colors: { hex: string; uses: number }[];
  issues: Issue[];
}

// En FONT_FAMILIES, hasta «Comic Sans MS» son del sistema; el resto se empaqueta con la app.
const BUNDLED_FROM = FONT_FAMILIES.indexOf('Comic Sans MS') + 1;
const SYSTEM = new Set(FONT_FAMILIES.slice(0, BUNDLED_FROM));
const BUNDLED = new Set(FONT_FAMILIES.slice(BUNDLED_FROM));

export function fontKind(name: string, customFonts: string[] = []): FontKind {
  const n = name.replace(/["']/g, '').split(',')[0].trim();
  if (BUNDLED.has(n)) return 'empaquetada';
  if (customFonts.includes(n)) return 'propia';
  if (SYSTEM.has(n)) return 'sistema';
  return 'desconocida';
}

// Peso aproximado de una imagen incrustada (base64 → bytes).
export function dataUrlBytes(src: string): number {
  if (!src.startsWith('data:')) return 0;
  const i = src.indexOf(',');
  if (i < 0) return 0;
  const body = src.length - i - 1;
  return src.slice(0, i).includes(';base64') ? Math.floor((body * 3) / 4) : body;
}

function normHex(c: string | undefined): string | null {
  if (!c) return null;
  const s = c.trim().toLowerCase();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (!m) return null;
  const h = m[1];
  if (h.length === 3) return '#' + [...h].map((x) => x + x).join('');
  return '#' + h.slice(0, 6);
}

export function buildResourceReport(pages: Doc[], customFonts: string[] = []): ResourceReport {
  const fonts = new Map<string, FontUse>();
  const colors = new Map<string, number>();
  const images: ImageUse[] = [];
  const issues: Issue[] = [];
  const seenImgs = new Set<string>();
  let layerCount = 0;
  const addColor = (c: string | undefined) => {
    const h = normHex(c);
    if (h) colors.set(h, (colors.get(h) ?? 0) + 1);
  };
  const addGrad = (g: Gradient | undefined) => g?.stops.forEach((s) => addColor(s.color));

  pages.forEach((doc, pi) => {
    const page = pi + 1;
    const bg = doc.background;
    if (bg.type === 'solid') addColor(bg.color);
    else if (bg.type === 'gradient') addGrad(bg.gradient);
    else if (bg.type === 'pattern') {
      addColor(bg.pattern.color1);
      addColor(bg.pattern.color2);
    }
    for (const l of doc.layers as Layer[]) {
      layerCount++;
      const name = l.name || l.type;
      if (!l.visible) issues.push({ level: 'info', page, layer: name, text: 'Capa oculta: no sale en la exportación' });
      else if (l.opacity <= 0) issues.push({ level: 'aviso', page, layer: name, text: 'Capa con opacidad 0: no se ve' });

      if (l.type === 'text') {
        const f = fonts.get(l.fontFamily) ?? { name: l.fontFamily, kind: fontKind(l.fontFamily, customFonts), uses: 0 };
        f.uses++;
        fonts.set(l.fontFamily, f);
        if (!l.text.trim()) issues.push({ level: 'aviso', page, layer: name, text: 'Capa de texto vacía' });
        addColor(l.fill);
        addGrad(l.fillGradient);
        if (l.strokeWidth > 0) addColor(l.strokeColor);
        if (l.shadow) addColor(l.shadowColor);
        if (l.textEffect && l.textEffect !== 'none') addColor(l.effectColor);
        l.spans?.forEach((s) => addColor(s.color));
      } else if (l.type === 'shape') {
        if (l.width * l.scaleX === 0 || l.height * l.scaleY === 0) {
          issues.push({ level: 'aviso', page, layer: name, text: 'Forma sin tamaño: no se ve' });
        }
        addColor(l.fill);
        addGrad(l.fillGradient);
        if (l.strokeWidth > 0) addColor(l.stroke);
        if (l.shadow) addColor(l.shadowColor);
      } else if (l.type === 'stroke') {
        addColor(l.color);
      } else {
        if (!l.src) issues.push({ level: 'aviso', page, layer: name, text: 'Imagen sin contenido' });
        const shownW = l.naturalWidth * Math.abs(l.scaleX);
        const shownH = l.naturalHeight * Math.abs(l.scaleY);
        const bytes = dataUrlBytes(l.src ?? '');
        const ratio = shownW > 0 ? l.naturalWidth / shownW : 1;
        images.push({ page, layer: name, naturalW: l.naturalWidth, naturalH: l.naturalHeight, shownW, shownH, bytes, ratio });
        seenImgs.add(l.src ?? '');
        if (l.visible && ratio < 0.75) {
          issues.push({
            level: 'aviso',
            page,
            layer: name,
            text: `Imagen pequeña para su tamaño: ${l.naturalWidth}×${l.naturalHeight} px mostrada a ${Math.round(shownW)}×${Math.round(shownH)} (ampliada ×${(1 / ratio).toFixed(1)}); se verá borrosa`,
          });
        }
        if (l.shadow) addColor(l.shadowColor);
      }
    }
  });

  for (const f of fonts.values()) {
    if (f.kind === 'sistema') {
      issues.push({ level: 'info', page: 0, layer: f.name, text: 'Fuente del sistema: no se incrusta; puede verse distinta en otro equipo (SVG/PDF)' });
    } else if (f.kind === 'desconocida') {
      issues.push({ level: 'aviso', page: 0, layer: f.name, text: 'Fuente no empaquetada ni subida: se sustituirá por otra' });
    } else if (f.kind === 'propia') {
      issues.push({ level: 'info', page: 0, layer: f.name, text: 'Fuente propia: no viaja dentro del proyecto; súbela de nuevo en otro equipo' });
    }
  }
  issues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'aviso' ? -1 : 1));

  return {
    pages: pages.length,
    layers: layerCount,
    fonts: [...fonts.values()].sort((a, b) => b.uses - a.uses),
    images,
    imageBytes: images.reduce((a, i) => a + i.bytes, 0),
    uniqueImages: seenImgs.size,
    colors: [...colors.entries()].map(([hex, uses]) => ({ hex, uses })).sort((a, b) => b.uses - a.uses),
    issues,
  };
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function reportToText(r: ResourceReport, title = 'Proyecto'): string {
  const L: string[] = [];
  L.push(`Informe de recursos — ${title}`);
  L.push(`${r.pages} página(s), ${r.layers} capa(s)`);
  L.push('', `FUENTES (${r.fonts.length})`);
  if (!r.fonts.length) L.push('  (sin texto)');
  for (const f of r.fonts) L.push(`  ${f.name} — ${f.kind}, ${f.uses} capa(s)`);
  L.push('', `IMÁGENES (${r.images.length} capas, ${r.uniqueImages} distintas, ~${fmtBytes(r.imageBytes)})`);
  if (!r.images.length) L.push('  (sin imágenes)');
  for (const i of r.images) {
    L.push(`  p.${i.page} ${i.layer}: ${i.naturalW}×${i.naturalH} px, en el diseño ${Math.round(i.shownW)}×${Math.round(i.shownH)}, ~${fmtBytes(i.bytes)}`);
  }
  L.push('', `COLORES (${r.colors.length})`);
  L.push('  ' + (r.colors.map((c) => `${c.hex} ×${c.uses}`).join('  ') || '(ninguno)'));
  L.push('', `PROBLEMAS (${r.issues.length})`);
  if (!r.issues.length) L.push('  Ninguno.');
  for (const s of r.issues) {
    L.push(`  [${s.level}]${s.page ? ` p.${s.page}` : ''} ${s.layer}: ${s.text}`);
  }
  return L.join('\n') + '\n';
}
