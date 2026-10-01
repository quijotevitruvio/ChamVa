// Texto con estilo por tramos (negrita/cursiva/subrayado/color por palabra).
//
// Modelo: la capa de texto conserva su estilo BASE (bold, italic, underline,
// fill) y una lista opcional de `spans` que solo guardan lo que DIFIERE de la
// base en un rango [start, end) de `layer.text` (offsets UTF-16, los mismos que
// dan <textarea> y contenteditable). Todo aquí es puro: lo usan el editor, la
// exportación raster, la SVG y los tests.
import type { TextLayer } from './types';
import { defaultFields, fieldAt, fractionAt, type FieldValues } from './textMacros';

export interface SpanStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  // Superíndice / subíndice del tramo ('none' lo quita al aplicar un estilo).
  script?: 'sup' | 'sub' | 'none';
}

export interface TextSpan extends SpanStyle {
  start: number; // incluido
  end: number; // excluido
}

export interface ResolvedStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  script?: 'sup' | 'sub'; // solo existe la clave cuando hay superíndice/subíndice
}

export interface StyledRun extends ResolvedStyle {
  text: string;
  // Solo los rellena la maquetación avanzada (typography.ts):
  dx?: number; // ajuste de kerning antes del tramo (px)
  tab?: boolean; // el tramo es una tabulación
  leader?: string; // carácter de relleno de la tabulación («.»)
}

// Tamaño y desplazamiento (relativos al tamaño de fuente) de sup/sub.
export const SCRIPT_SCALE = 0.62;
export const SCRIPT_DY = { sup: 0, sub: 0.38 } as const;

type StyleKey = keyof SpanStyle;
const KEYS: StyleKey[] = ['bold', 'italic', 'underline', 'color', 'script'];

// '#FFF' → '#ffffff'; cualquier otra cosa se devuelve en minúsculas.
export function normalizeHex(c: string): string {
  const s = (c || '').trim().toLowerCase();
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : s;
}

export function baseStyle(l: TextLayer): ResolvedStyle {
  return {
    bold: !!l.bold,
    italic: !!l.italic,
    underline: !!l.underline,
    color: normalizeHex(l.fill),
  };
}

export function hasSpans(l: TextLayer): boolean {
  return !!l.spans && l.spans.some((s) => s.end > s.start && KEYS.some((k) => s[k] !== undefined));
}

// Estilo resuelto de cada unidad de `layer.text`.
export function resolveCharStyles(l: TextLayer): ResolvedStyle[] {
  const base = baseStyle(l);
  const out: ResolvedStyle[] = Array.from({ length: l.text.length }, () => ({ ...base }));
  for (const sp of l.spans ?? []) {
    const a = Math.max(0, sp.start);
    const b = Math.min(l.text.length, sp.end);
    for (let i = a; i < b; i++) {
      const st = out[i];
      if (sp.bold !== undefined) st.bold = sp.bold;
      if (sp.italic !== undefined) st.italic = sp.italic;
      if (sp.underline !== undefined) st.underline = sp.underline;
      if (sp.color !== undefined) st.color = normalizeHex(sp.color);
      if (sp.script === 'sup' || sp.script === 'sub') st.script = sp.script;
      else if (sp.script === 'none') delete st.script;
    }
  }
  return out;
}

const sameStyle = (a: ResolvedStyle, b: ResolvedStyle) =>
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.underline === b.underline &&
  a.color === b.color &&
  a.script === b.script;

// Convierte estilos por carácter en spans mínimos (solo diferencias con la base).
export function compressCharStyles(chars: ResolvedStyle[], base: ResolvedStyle): TextSpan[] {
  const spans: TextSpan[] = [];
  const diffOf = (st: ResolvedStyle): SpanStyle => {
    const d: SpanStyle = {};
    if (st.bold !== base.bold) d.bold = st.bold;
    if (st.italic !== base.italic) d.italic = st.italic;
    if (st.underline !== base.underline) d.underline = st.underline;
    if (normalizeHex(st.color) !== base.color) d.color = normalizeHex(st.color);
    if (st.script) d.script = st.script;
    return d;
  };
  const same = (a: SpanStyle, b: SpanStyle) => KEYS.every((k) => a[k] === b[k]);
  let cur: TextSpan | null = null;
  for (let i = 0; i < chars.length; i++) {
    const d = diffOf(chars[i]);
    const empty = KEYS.every((k) => d[k] === undefined);
    if (cur && !empty && same(cur, d) && cur.end === i) {
      cur.end = i + 1;
    } else if (!empty) {
      cur = { start: i, end: i + 1, ...d };
      spans.push(cur);
    } else {
      cur = null;
    }
  }
  return spans;
}

// Aplica `patch` al rango [start, end) y devuelve los spans nuevos.
export function applySpanStyle(l: TextLayer, start: number, end: number, patch: SpanStyle): TextSpan[] {
  const chars = resolveCharStyles(l);
  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(l.text.length, Math.max(start, end));
  for (let i = a; i < b; i++) {
    const st = chars[i];
    if (patch.bold !== undefined) st.bold = patch.bold;
    if (patch.italic !== undefined) st.italic = patch.italic;
    if (patch.underline !== undefined) st.underline = patch.underline;
    if (patch.color !== undefined) st.color = normalizeHex(patch.color);
    if (patch.script === 'sup' || patch.script === 'sub') st.script = patch.script;
    else if (patch.script === 'none') delete st.script;
  }
  return compressCharStyles(chars, baseStyle(l));
}

// Valor que debe tomar `key` al pulsar el botón con [start,end) seleccionado:
// si TODO el rango ya lo tiene, se quita; si no, se pone.
export function toggleTarget(
  l: TextLayer,
  start: number,
  end: number,
  key: 'bold' | 'italic' | 'underline',
): boolean {
  const chars = resolveCharStyles(l);
  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(l.text.length, Math.max(start, end));
  if (b <= a) return !baseStyle(l)[key];
  for (let i = a; i < b; i++) if (!chars[i][key]) return true;
  return false;
}

// Quita `key` de todos los spans (cuando se cambia el estilo de TODO el texto).
export function stripSpanKey(spans: TextSpan[] | undefined, key: StyleKey): TextSpan[] | undefined {
  if (!spans) return spans;
  const out = spans
    .map((s) => {
      const c = { ...s };
      delete c[key];
      return c;
    })
    .filter((s) => KEYS.some((k) => s[k] !== undefined));
  return out.length ? out : undefined;
}

// Reubica los spans tras editar el texto como texto plano (textarea). Detecta
// la zona cambiada por prefijo/sufijo común: lo de antes queda igual, lo de
// después se desplaza, y lo escrito DENTRO o AL FINAL de un tramo lo hereda.
export function remapSpans(
  spans: TextSpan[] | undefined,
  oldText: string,
  newText: string,
): TextSpan[] | undefined {
  if (!spans || !spans.length || oldText === newText) return spans;
  let prefix = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (prefix < minLen && oldText[prefix] === newText[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  )
    suffix++;
  const oldEnd = oldText.length - suffix;
  const newEnd = newText.length - suffix;
  const delta = newEnd - oldEnd;
  const mapStart = (p: number) => (p < prefix ? p : p >= oldEnd ? p + delta : prefix);
  // El final se evalúa primero contra oldEnd: un tramo que termina justo donde
  // se inserta texto se extiende (seguir escribiendo en negrita).
  const mapEnd = (p: number) => (p >= oldEnd ? p + delta : p <= prefix ? p : newEnd);
  const out = spans
    .map((s) => ({ ...s, start: mapStart(s.start), end: mapEnd(s.end) }))
    .map((s) => ({ ...s, start: Math.max(0, s.start), end: Math.min(newText.length, s.end) }))
    .filter((s) => s.end > s.start);
  return out.length ? out : undefined;
}

// Líneas listas para dibujar: aplica mayúsculas/minúsculas y prefijos de lista
// y agrupa caracteres consecutivos con el mismo estilo en tramos.
export function styledLines(
  l: TextLayer,
  opts: { list?: boolean; fields?: Partial<FieldValues> } = {},
): StyledRun[][] {
  // Los campos ({{fecha}}…) y las fracciones solo se miran si hacen falta.
  const wantFields = l.text.includes('{{');
  const fieldVals = wantFields ? defaultFields(opts.fields) : null;
  const wantFractions = !!l.fractions && l.text.includes('/');
  const chars = resolveCharStyles(l);
  const base = baseStyle(l);
  const mode = l.textTransform;
  const listStyle = opts.list === false ? 'none' : (l.listStyle ?? 'none');
  const lines: StyledRun[][] = [[]];
  let lineNo = 0;
  const push = (text: string, st: ResolvedStyle) => {
    const line = lines[lines.length - 1];
    const last = line[line.length - 1];
    if (last && sameStyle(last, st)) last.text += text;
    else line.push({ ...st, text });
  };
  const prefixFor = (n: number) => (listStyle === 'number' ? `${n + 1}.  ` : '•  ');
  if (listStyle !== 'none') push(prefixFor(0), base);
  const isLetter = (c: string) => /\p{L}/u.test(c);
  const isWordChar = (c: string) => /[\p{L}\p{N}]/u.test(c);
  for (let i = 0; i < l.text.length; i++) {
    const c = l.text[i];
    if (c === '\n') {
      lineNo++;
      lines.push([]);
      if (listStyle !== 'none') push(prefixFor(lineNo), base);
      continue;
    }
    if (fieldVals && c === '{') {
      const f = fieldAt(l.text, i, fieldVals);
      if (f) {
        for (const ch of f.value) push(ch, chars[i]);
        i += f.len - 1;
        continue;
      }
    }
    if (wantFractions) {
      const f = fractionAt(l.text, i);
      if (f) {
        push(f.value, chars[i]);
        i += f.len - 1;
        continue;
      }
    }
    let shown = c;
    if (mode === 'upper') shown = c.toUpperCase();
    else if (mode === 'lower') shown = c.toLowerCase();
    else if (mode === 'caps') {
      const prev = i > 0 ? l.text[i - 1] : '';
      if (isLetter(c) && !isWordChar(prev)) shown = c.toUpperCase();
    }
    push(shown, chars[i]);
  }
  return lines;
}

// Fuente de Canvas 2D para un tramo.
export function runFont(l: TextLayer, st: ResolvedStyle): string {
  const size = st.script ? l.fontSize * SCRIPT_SCALE : l.fontSize;
  return `${st.italic ? 'italic ' : ''}${st.bold ? 'bold ' : ''}${size}px ${l.fontFamily}`;
}

// Valor de `script` al pulsar «sup»/«sub» con [start,end) seleccionado: si TODO
// el rango ya lo tiene se quita; si no, se pone.
export function scriptTarget(
  l: TextLayer,
  start: number,
  end: number,
  which: 'sup' | 'sub',
): 'sup' | 'sub' | 'none' {
  const chars = resolveCharStyles(l);
  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(l.text.length, Math.max(start, end));
  if (b <= a) return 'none';
  for (let i = a; i < b; i++) if (chars[i].script !== which) return which;
  return 'none';
}
