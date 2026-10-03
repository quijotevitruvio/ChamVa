// Partición de texto en líneas por ancho (títulos y subtítulos). Pura: quien dibuja inyecta `measure`.
//
//  - Los saltos de línea que escribió el usuario se respetan siempre.
//  - Salto «voraz» por palabras; una palabra más ancha que la línea se parte por letras.
//  - Si el resultado tiene 2 o más líneas se equilibran (la línea más ancha lo más corta posible),
//    como en los subtítulos de cine, en vez de una línea larga y otra con una sola palabra.
export type MeasureFn = (s: string) => number;

/** Salto voraz de UN párrafo (sin saltos de línea). */
function greedy(par: string, maxW: number, measure: MeasureFn): string[] {
  const words = par.split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let cur = '';
  const pushWord = (w: string) => {
    if (!cur) {
      cur = w;
      return;
    }
    const tryLine = cur + ' ' + w;
    if (measure(tryLine) <= maxW) cur = tryLine;
    else {
      lines.push(cur);
      cur = w;
    }
  };
  for (const w of words) {
    if (measure(w) <= maxW) pushWord(w);
    else {
      // palabra más ancha que la línea: por letras (por puntos de código, sin partir pares sustitutos)
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      let piece = '';
      for (const ch of Array.from(w)) {
        if (piece && measure(piece + ch) > maxW) {
          lines.push(piece);
          piece = ch;
        } else piece += ch;
      }
      cur = piece;
    }
  }
  lines.push(cur);
  return lines;
}

/** Líneas de un párrafo con el mismo número de líneas que el salto voraz pero lo más equilibradas posible. */
function balanced(par: string, maxW: number, measure: MeasureFn): string[] {
  const base = greedy(par, maxW, measure);
  if (base.length < 2) return base;
  let lo = 0;
  for (const w of par.split(/\s+/)) lo = Math.max(lo, Math.min(measure(w), maxW));
  let hi = maxW;
  let best = base;
  for (let i = 0; i < 14 && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2;
    const l = greedy(par, mid, measure);
    if (l.length <= base.length) {
      best = l;
      hi = mid;
    } else lo = mid;
  }
  return best;
}

/** Líneas del texto con ancho máximo `maxW`. `balance`: equilibra las líneas de cada párrafo. */
export function wrapLines(text: string, maxW: number, measure: MeasureFn, balance = true): string[] {
  const out: string[] = [];
  for (const par of text.replace(/\r\n?/g, '\n').split('\n')) out.push(...(balance ? balanced(par, maxW, measure) : greedy(par, maxW, measure)));
  return out;
}

export interface FitResult {
  lines: string[];
  /** 1 = tamaño normal; menos = hubo que reducir la letra para que cupiera en `maxLines` */
  scale: number;
  /** aun así hay más líneas de las permitidas */
  overflow: boolean;
}

/**
 * Ajusta el texto a `maxLines` líneas de ancho `maxW`: primero salto por ancho; si sobran líneas,
 * reduce la letra (hasta `minScale`) y, si todavía no cabe, deja las líneas de más (`overflow`)
 * en vez de cortar texto.
 */
export function fitLines(text: string, maxW: number, measure: MeasureFn, maxLines: number, minScale = 0.8): FitResult {
  let lines = wrapLines(text, maxW, measure);
  if (lines.length <= maxLines) return { lines, scale: 1, overflow: false };
  for (let s = 0.95; s >= minScale - 1e-9; s -= 0.05) {
    lines = wrapLines(text, maxW / s, measure);
    if (lines.length <= maxLines) return { lines, scale: Math.round(s * 100) / 100, overflow: false };
  }
  lines = wrapLines(text, maxW / minScale, measure);
  return { lines, scale: minScale, overflow: lines.length > maxLines };
}
