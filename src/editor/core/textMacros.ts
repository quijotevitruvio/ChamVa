// Sustituciones de texto «al dibujar»: campos dinámicos ({{fecha}}, {{pagina}}…),
// fracciones Unicode automáticas y cambio de mayúsculas del contenido.
// Todo es puro y no depende de richText (richText lo importa).

export interface FieldValues {
  fecha: string;
  hora: string;
  pagina: string;
  total: string;
  diseno: string;
}

export const FIELD_NAMES = ['fecha', 'hora', 'pagina', 'total', 'diseno'] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

// Etiquetas para el menú «Insertar campo».
export const FIELD_LABELS: Record<FieldName, string> = {
  fecha: 'Fecha de hoy',
  hora: 'Hora actual',
  pagina: 'Número de página',
  total: 'Total de páginas',
  diseno: 'Nombre del diseño',
};

const two = (n: number) => String(n).padStart(2, '0');

// Valores por defecto: ahora, página 1 de 1 y sin nombre.
export function defaultFields(over: Partial<FieldValues> = {}, now: Date = new Date()): FieldValues {
  return {
    fecha: `${two(now.getDate())}/${two(now.getMonth() + 1)}/${now.getFullYear()}`,
    hora: `${two(now.getHours())}:${two(now.getMinutes())}`,
    pagina: '1',
    total: '1',
    diseno: '',
    ...over,
  };
}

// Valores de un documento dentro de un proyecto de varias páginas (por id).
export function fieldsForDoc(
  doc: { id: string; name?: string },
  pages: { id: string }[] | undefined,
  now: Date = new Date(),
): FieldValues {
  const idx = pages ? pages.findIndex((p) => p.id === doc.id) : -1;
  return defaultFields(
    {
      pagina: String((idx >= 0 ? idx : 0) + 1),
      total: String(pages && pages.length && idx >= 0 ? pages.length : 1),
      diseno: doc.name ?? '',
    },
    now,
  );
}

const FIELD_RE = /^\{\{\s*([a-zA-ZñÑ]+)\s*\}\}/;

// Campo que empieza justo en `i`: devuelve su longitud en el texto y su valor.
export function fieldAt(text: string, i: number, f: FieldValues): { len: number; value: string } | null {
  if (text.charCodeAt(i) !== 123 /* { */ || text.charCodeAt(i + 1) !== 123) return null;
  const m = FIELD_RE.exec(text.slice(i, i + 24));
  if (!m) return null;
  const key = m[1].toLowerCase().replace('ñ', 'n');
  const alias: Record<string, FieldName> = { nombre: 'diseno' };
  const name = (alias[key] ?? key) as FieldName;
  if (!(FIELD_NAMES as readonly string[]).includes(name)) return null;
  return { len: m[0].length, value: f[name] };
}

export function hasFields(text: string): boolean {
  return text.includes('{{');
}

const FRACTIONS: Record<string, string> = {
  '1/2': '½',
  '1/3': '⅓',
  '2/3': '⅔',
  '1/4': '¼',
  '3/4': '¾',
  '1/5': '⅕',
  '2/5': '⅖',
  '3/5': '⅗',
  '4/5': '⅘',
  '1/6': '⅙',
  '5/6': '⅚',
  '1/8': '⅛',
  '3/8': '⅜',
  '5/8': '⅝',
  '7/8': '⅞',
};

// Fracción «n/m» que empieza en `i` (no pegada a otras cifras o barras).
export function fractionAt(text: string, i: number): { len: number; value: string } | null {
  const c = text[i];
  if (c < '1' || c > '7' || text[i + 1] !== '/') return null;
  const key = text.slice(i, i + 3);
  const v = FRACTIONS[key];
  if (!v) return null;
  const prev = i > 0 ? text[i - 1] : '';
  const next = text[i + 3] ?? '';
  if (/[\d/.,]/.test(prev) || /[\d/]/.test(next)) return null;
  return { len: 3, value: v };
}

// Convierte las fracciones del texto (sirve para el botón de «convertir»).
export function convertFractions(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const f = fractionAt(text, i);
    if (f) {
      out += f.value;
      i += f.len - 1;
    } else out += text[i];
  }
  return out;
}

export type CaseMode = 'upper' | 'lower' | 'title' | 'sentence' | 'alternate';

export const CASE_LABELS: Record<CaseMode, string> = {
  upper: 'MAYÚSCULAS',
  lower: 'minúsculas',
  title: 'Primera De Cada Palabra',
  sentence: 'Primera de la oración',
  alternate: 'aLtErNaDo',
};

// Un carácter → otro del mismo largo (si el cambio alargara el texto, se deja como está,
// así los estilos por tramo siguen en su sitio).
const same = (c: string, f: (s: string) => string) => {
  const r = f(c);
  return r.length === c.length ? r : c;
};

// Cambia mayúsculas del CONTENIDO entre [start, end) (todo si se omiten).
export function changeCase(text: string, mode: CaseMode, start = 0, end = text.length): string {
  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(text.length, Math.max(start, end));
  if (b <= a) return text;
  const isLetter = (c: string) => /\p{L}/u.test(c);
  const isWord = (c: string) => /[\p{L}\p{N}]/u.test(c);
  let out = text.slice(0, a);
  let letterNo = 0;
  // Para «oración»: ¿empieza una frase en este punto? (inicio, tras . ! ? o salto de línea).
  let sentenceStart = true;
  if (mode === 'sentence' && a > 0) {
    const before = text.slice(0, a).replace(/[\s"'»”)\]]+$/u, '');
    sentenceStart = before === '' || /[.!?¡¿…\n]$/.test(before) || /\n\s*$/.test(text.slice(0, a));
  }
  for (let i = a; i < b; i++) {
    const c = text[i];
    let r = c;
    if (mode === 'upper') r = same(c, (s) => s.toUpperCase());
    else if (mode === 'lower') r = same(c, (s) => s.toLowerCase());
    else if (mode === 'title') {
      const prev = i > 0 ? text[i - 1] : '';
      r = isLetter(c)
        ? !isWord(prev) && prev !== "'" && prev !== '’'
          ? same(c, (s) => s.toUpperCase())
          : same(c, (s) => s.toLowerCase())
        : c;
    } else if (mode === 'sentence') {
      if (isLetter(c)) {
        r = sentenceStart ? same(c, (s) => s.toUpperCase()) : same(c, (s) => s.toLowerCase());
        sentenceStart = false;
      } else if (c === '\n' || (/[.!?…]/.test(c) && (i + 1 >= text.length || /\s/.test(text[i + 1]))))
        sentenceStart = true;
    } else if (mode === 'alternate') {
      if (isLetter(c)) {
        r = letterNo % 2 === 0 ? same(c, (s) => s.toLowerCase()) : same(c, (s) => s.toUpperCase());
        letterNo++;
      }
    }
    out += r;
  }
  return out + text.slice(b);
}
