// Recolorear SVG (iconos y capas de imagen SVG): extrae sus colores distintos
// (atributos fill/stroke/stop-color… y declaraciones de style/<style>) y los
// sustituye por otros, p. ej. los de la paleta de marca. Todo es texto: puro.
import { hexToRgb, luminance, rgbToHex } from './colorTools';

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  lime: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  navy: '#000080',
  teal: '#008080',
  aqua: '#00ffff',
  cyan: '#00ffff',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  currentcolor: '#000000',
};

// Un valor CSS de color → '#rrggbb' (minúsculas) o null si no es un color
// sustituible (none, url(#id), transparent, inherit…).
export function parseCssColor(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v[0] === '#') {
    let h = v.slice(1);
    if (h.length === 4) h = h.slice(0, 3); // #rgba → #rgb (se descarta el alfa)
    if (h.length === 8) h = h.slice(0, 6);
    const rgb = hexToRgb('#' + h);
    return rgb ? rgbToHex(rgb) : null;
  }
  const m = v.match(/^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/);
  if (m) return rgbToHex({ r: +m[1], g: +m[2], b: +m[3] });
  return NAMED[v] ?? null;
}

const PROPS = 'fill|stroke|stop-color|flood-color|lighting-color|color';
// fill="…"  (atributo; el valor no incluye comillas)
const ATTR_RE = new RegExp(`(\\s(?:${PROPS})\\s*=\\s*)(["'])([^"']*)\\2`, 'gi');
// fill: …;  (dentro de style="" o <style>)
const CSS_RE = new RegExp(`((?:^|[;{\\s"'])(?:${PROPS})\\s*:\\s*)([^;}"']+)`, 'gi');

function eachColor(svg: string, fn: (hex: string | null, raw: string) => string): string {
  let out = svg.replace(ATTR_RE, (_m, pre: string, q: string, val: string) => `${pre}${q}${fn(parseCssColor(val), val)}${q}`);
  out = out.replace(CSS_RE, (_m, pre: string, val: string) => `${pre}${fn(parseCssColor(val), val)}`);
  return out;
}

// ¿El elemento raíz declara fill/stroke? (si ningún elemento lo hace, el SVG se
// pinta en negro por defecto).
export function extractSvgColors(svg: string): string[] {
  const seen: string[] = [];
  eachColor(svg, (hex, raw) => {
    if (hex && !seen.includes(hex)) seen.push(hex);
    return raw;
  });
  if (seen.length === 0 && /<svg[\s>]/i.test(svg)) seen.push('#000000'); // color implícito
  return seen;
}

// Sustituye colores según `map` (claves '#rrggbb' en minúsculas). Un SVG sin
// colores explícitos recibe el fill en la raíz si `map` trae el negro.
export function replaceSvgColors(svg: string, map: Record<string, string>): string {
  const explicit = (() => {
    let any = false;
    eachColor(svg, (hex, raw) => {
      if (hex) any = true;
      return raw;
    });
    return any;
  })();
  if (!explicit) {
    const to = map['#000000'];
    if (!to) return svg;
    return svg.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => `<svg${attrs} fill="${to}">`);
  }
  return eachColor(svg, (hex, raw) => (hex && map[hex] ? map[hex] : raw));
}

// Mapeo automático por luminosidad: los colores del SVG, de más oscuro a más
// claro, se reparten sobre la paleta ordenada igual (el más oscuro → el más
// oscuro de la paleta). Con un solo color se usa el primero de la paleta.
export function mapByLuminosity(colors: string[], palette: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const pal = [...new Set(palette.map((p) => parseCssColor(p) ?? p))];
  if (!colors.length || !pal.length) return map;
  const src = [...colors].sort((a, b) => luminance(a) - luminance(b));
  const dst = [...pal].sort((a, b) => luminance(a) - luminance(b));
  src.forEach((c, i) => {
    const j = src.length === 1 ? 0 : Math.round((i * (dst.length - 1)) / (src.length - 1));
    map[c] = dst[src.length === 1 ? 0 : j];
  });
  if (src.length === 1) map[src[0]] = pal[0];
  return map;
}

// ---- data URLs ----

export function isSvgDataUrl(src: string): boolean {
  return /^data:image\/svg\+xml/i.test(src);
}

export function decodeSvgDataUrl(src: string): string | null {
  const m = src.match(/^data:image\/svg\+xml([^,]*),(.*)$/is);
  if (!m) return null;
  try {
    if (/;base64/i.test(m[1])) {
      const bin = atob(m[2]);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return decodeURIComponent(m[2]);
  } catch {
    return null;
  }
}

export function encodeSvgDataUrl(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
