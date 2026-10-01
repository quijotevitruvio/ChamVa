// Metadatos de fuentes: categoría y similitud. Todo puro (lo usan el buscador de
// fuentes, el aviso de «fuente faltante» y las pruebas).
import { FONT_FAMILIES } from './types';

export type FontCategory = 'sans' | 'serif' | 'display' | 'script' | 'mono';

export const FONT_CATEGORIES: { id: FontCategory; label: string }[] = [
  { id: 'sans', label: 'Sans serif' },
  { id: 'serif', label: 'Serif' },
  { id: 'display', label: 'Display' },
  { id: 'script', label: 'Manuscrita' },
  { id: 'mono', label: 'Monoespaciada' },
];

// Mapa propio: fuentes empaquetadas + algunas muy habituales que un proyecto o
// plantilla ajena puede traer (para sugerir un reemplazo parecido).
const KNOWN: Record<string, FontCategory> = {
  arial: 'sans',
  verdana: 'sans',
  tahoma: 'sans',
  'trebuchet ms': 'sans',
  georgia: 'serif',
  'times new roman': 'serif',
  'courier new': 'mono',
  impact: 'display',
  'comic sans ms': 'display',
  montserrat: 'sans',
  poppins: 'sans',
  roboto: 'sans',
  oswald: 'display',
  anton: 'display',
  'bebas neue': 'display',
  'playfair display': 'serif',
  lobster: 'script',
  pacifico: 'script',
  'dancing script': 'script',
  inter: 'sans',
  raleway: 'sans',
  nunito: 'sans',
  merriweather: 'serif',
  // Habituales fuera del paquete
  helvetica: 'sans',
  'helvetica neue': 'sans',
  'open sans': 'sans',
  lato: 'sans',
  'segoe ui': 'sans',
  calibri: 'sans',
  'source sans pro': 'sans',
  'work sans': 'sans',
  'dm sans': 'sans',
  garamond: 'serif',
  'eb garamond': 'serif',
  cambria: 'serif',
  palatino: 'serif',
  lora: 'serif',
  'libre baskerville': 'serif',
  baskerville: 'serif',
  bookman: 'serif',
  consolas: 'mono',
  courier: 'mono',
  'fira code': 'mono',
  'jetbrains mono': 'mono',
  'source code pro': 'mono',
  menlo: 'mono',
  monaco: 'mono',
  'lucida console': 'mono',
  'brush script mt': 'script',
  'lucida handwriting': 'script',
  caveat: 'script',
  'great vibes': 'script',
  satisfy: 'script',
  'permanent marker': 'display',
  'lilita one': 'display',
  bangers: 'display',
  'abril fatface': 'display',
  'alfa slab one': 'display',
  'archivo black': 'display',
};

// Palabras del nombre que delatan la categoría (fuentes propias o desconocidas).
const HINTS: [RegExp, FontCategory][] = [
  [/(mono|code|courier|consol|typewriter|terminal)/i, 'mono'],
  [/(script|hand|brush|calli|cursive|signature|marker|ink|written)/i, 'script'],
  [/(roman|antiqua|garamond|baskerville|didot|bodoni|times|slab|georgia|caslon|mincho|serif)/i, 'serif'],
  [/(display|black|heavy|poster|stencil|impact|condensed|headline|ultra)/i, 'display'],
];

const GENERIC = new Set([
  '',
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'inherit',
  'initial',
]);

// Primer nombre de una pila CSS, sin comillas: «"Foo Bar", sans-serif» → «Foo Bar».
export function primaryFamily(family: string): string {
  const first = (family ?? '').split(',')[0] ?? '';
  return first.trim().replace(/^["']|["']$/g, '').trim();
}

export function fontCategory(family: string): FontCategory {
  const name = primaryFamily(family).toLowerCase();
  const known = KNOWN[name];
  if (known) return known;
  // «Sans» gana a «serif» en nombres como «Noto Sans Serif Display»: se mira primero.
  if (/sans|gothic|grotesk|grotesque/i.test(name) && !/mono|code/i.test(name)) return 'sans';
  for (const [re, cat] of HINTS) if (re.test(name)) return cat;
  return 'sans';
}

// Categorías «vecinas»: sirven de segunda opción al buscar un reemplazo.
const NEIGHBOR: Record<FontCategory, FontCategory[]> = {
  sans: ['display', 'serif', 'mono', 'script'],
  serif: ['display', 'sans', 'script', 'mono'],
  display: ['sans', 'serif', 'script', 'mono'],
  script: ['display', 'serif', 'sans', 'mono'],
  mono: ['sans', 'serif', 'display', 'script'],
};

// Fuentes candidatas ordenadas de más a menos parecida a `family`.
export function similarFonts(family: string, available: string[] = [...FONT_FAMILIES]): string[] {
  const target = primaryFamily(family).toLowerCase();
  const cat = fontCategory(family);
  const rank = (f: string) => {
    const c = fontCategory(f);
    if (c === cat) return 0;
    const i = NEIGHBOR[cat].indexOf(c);
    return 1 + (i < 0 ? NEIGHBOR[cat].length : i);
  };
  return available
    .filter((f) => primaryFamily(f).toLowerCase() !== target)
    .map((f, i) => ({ f, r: rank(f), i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.f);
}

export function suggestSubstitute(family: string, available: string[] = [...FONT_FAMILIES]): string | null {
  return similarFonts(family, available)[0] ?? null;
}

// Familias de `used` que no existen en `known` (empaquetadas + propias). Se
// ignoran las genéricas de CSS y se comparan sin distinguir mayúsculas.
export function missingFonts(used: string[], known: string[]): string[] {
  const have = new Set(known.map((f) => primaryFamily(f).toLowerCase()));
  const out: string[] = [];
  for (const u of used) {
    const name = primaryFamily(u);
    const key = name.toLowerCase();
    if (GENERIC.has(key) || have.has(key) || out.some((o) => o.toLowerCase() === key)) continue;
    out.push(name);
  }
  return out;
}
