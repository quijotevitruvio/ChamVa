// Maquetación tipográfica avanzada del texto: ancho de caja con salto de línea,
// sangría, espacio entre párrafos, capitular, columnas, tabulaciones con puntos
// guía, kerning por parejas y autoajuste al cuadro.
//
// Todo es PURO: la medida del texto entra como función (`MeasureRun`), así el
// editor (Konva), la exportación raster, la SVG y los tests comparten el mismo
// resultado. El dibujo (styledText.ts) solo recorre lo que aquí se calcula.
// Un texto sin ninguna opción nueva NO pasa por aquí (ver `usesTypography`).
import type { TextLayer } from './types';
import { styledLines, type StyledRun } from './richText';
import type { FieldValues } from './textMacros';

// Ancho de un tramo con la fuente de `l` (el llamador fija ctx.font).
export type MeasureRun = (l: TextLayer, run: StyledRun) => number;

export interface DropCapInfo {
  line: number; // línea (de `lines`) a la que acompaña
  run: StyledRun; // la letra, con su estilo
  fontSize: number;
  x: number; // dentro de la caja, sin el relleno del fondo
  y: number;
  w: number;
}

export interface Layout {
  layer: TextLayer; // capa con el tamaño EFECTIVO (autoajuste)
  lines: StyledRun[][];
  runWidths: number[][];
  widths: number[];
  xs: number[]; // desplazamiento horizontal de cada línea (columna + sangría)
  ys: number[]; // posición vertical de cada línea
  aw: number[]; // ancho disponible para alinear cada línea
  boxW: number;
  contentH: number; // alto que ocupa el texto
  textH: number; // alto de la caja (boxHeight si se fijó)
  drops: DropCapInfo[];
}

const isPos = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function hasKerning(l: TextLayer): boolean {
  return !!l.kerning && Object.values(l.kerning).some((v) => v);
}

// ¿El texto necesita la maquetación avanzada? Si no, se dibuja por el camino de siempre.
export function usesTypography(l: TextLayer): boolean {
  return (
    isPos(l.boxWidth) ||
    isPos(l.boxHeight) ||
    !!l.autoFit ||
    !!l.indent ||
    !!l.paragraphSpacing ||
    (!!l.dropCap && l.dropCap !== 'none') ||
    (l.columns ?? 1) > 1 ||
    l.text.includes('\t') ||
    l.text.includes('{{') ||
    !!l.fractions ||
    hasKerning(l) ||
    !!l.spans?.some((s) => s.script === 'sup' || s.script === 'sub')
  );
}

// Siguiente parada de tabulación estrictamente después de x (px desde el borde de la columna).
export function nextTabStop(x: number, stops: number[] | undefined, fontSize: number): number {
  const sorted = (stops ?? []).filter((s) => s > 0).sort((a, b) => a - b);
  for (const s of sorted) if (s > x + 0.5) return s;
  const step = Math.max(1, fontSize * 4);
  return (Math.floor((x + 0.5) / step) + 1) * step;
}

// Parte los tramos donde hay un kerning definido: el tramo que empieza en la
// segunda letra de la pareja lleva `dx` (se suma a su avance).
export function applyKerning(line: StyledRun[], kerning: Record<string, number>): StyledRun[] {
  const out: StyledRun[] = [];
  let prev = '';
  for (const run of line) {
    if (run.tab) {
      out.push(run);
      prev = '';
      continue;
    }
    let cur: StyledRun | null = null;
    for (const ch of run.text) {
      const k = prev ? kerning[prev + ch] : 0;
      if (k && Number.isFinite(k)) {
        if (cur) out.push(cur);
        cur = { ...run, text: ch, dx: k };
      } else if (cur) cur.text += ch;
      else cur = { ...run, text: ch };
      prev = ch;
    }
    if (cur) out.push(cur);
  }
  return out;
}

interface Atom {
  run: StyledRun;
  kind: 'word' | 'space' | 'tab';
}

const TOKEN = /\t|[ ]+|[^\t ]+/g;

function atomsOf(line: StyledRun[], leader: string | undefined): Atom[] {
  const atoms: Atom[] = [];
  for (const run of line) {
    let first = true;
    const toks = run.text.match(TOKEN) ?? [];
    for (const tok of toks) {
      const r: StyledRun = { ...run, text: tok };
      if (!first) delete r.dx;
      first = false;
      if (tok === '\t') atoms.push({ run: { ...r, tab: true, leader }, kind: 'tab' });
      else atoms.push({ run: r, kind: tok[0] === ' ' ? 'space' : 'word' });
    }
  }
  return atoms;
}

const sameLook = (a: StyledRun, b: StyledRun) =>
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.underline === b.underline &&
  a.color === b.color &&
  a.script === b.script &&
  !a.tab &&
  !b.tab &&
  !b.dx;

interface WrapSpec {
  x0: number; // inicio del contenido respecto al borde de la columna
  avail: number; // ancho disponible para el contenido
}

interface Wrapped {
  runs: StyledRun[];
  widths: number[];
}

// Salta de línea por palabras. Devuelve las líneas ya medidas (tramos fusionados).
function wrapParagraph(
  L: TextLayer,
  line: StyledRun[],
  specFor: (idx: number) => WrapSpec,
  measure: MeasureRun,
  leader: string | undefined,
): Wrapped[] {
  const atoms = atomsOf(line, leader);
  const out: Wrapped[] = [];
  let cur: Atom[] = [];
  let curW = 0;
  let idx = 0;
  let spec = specFor(0);
  const wOf = (a: Atom, x: number) =>
    a.kind === 'tab'
      ? Math.max(0, nextTabStop(x, L.tabStops, L.fontSize) - x)
      : measure(L, a.run) + (a.run.dx ?? 0);

  const flushLine = () => {
    // Los espacios del final no cuentan ni se dibujan.
    while (cur.length && cur[cur.length - 1].kind === 'space') cur.pop();
    const runs: StyledRun[] = [];
    for (const a of cur) {
      const last = runs[runs.length - 1];
      if (last && !a.run.tab && sameLook(last, a.run)) last.text += a.run.text;
      else runs.push({ ...a.run });
    }
    // Anchos finales (los tramos fusionados se miden de nuevo).
    let x = spec.x0;
    const widths = runs.map((r) => {
      const w = r.tab
        ? Math.max(0, nextTabStop(x, L.tabStops, L.fontSize) - x)
        : measure(L, r) + (r.dx ?? 0);
      x += w;
      return w;
    });
    out.push({ runs, widths });
    cur = [];
    curW = 0;
    idx++;
    spec = specFor(idx);
  };

  let word: Atom[] = [];
  const flushWord = () => {
    if (!word.length) return;
    const ww = word.reduce((s, a) => s + wOf(a, 0), 0);
    const hasContent = cur.some((c) => c.kind !== 'space');
    if (hasContent && curW + ww > spec.avail + 0.01) flushLine();
    for (const a of word) {
      cur.push(a);
      curW += wOf(a, spec.x0 + curW);
    }
    word = [];
  };

  for (const a of atoms) {
    if (a.kind === 'word') {
      word.push(a);
      continue;
    }
    flushWord();
    // Los espacios al principio de una línea envuelta se omiten.
    if (a.kind === 'space' && cur.length === 0 && idx > 0) continue;
    cur.push(a);
    curW += wOf(a, spec.x0 + curW);
  }
  flushWord();
  flushLine();
  return out;
}

// Mayor tamaño (múltiplo de `step`) para el que `fits` es cierto; `fits` debe
// ser monótona (si cabe a s, cabe a todo lo menor). Nunca baja de `min`.
export function fitFontSize(
  fits: (size: number) => boolean,
  min: number,
  max: number,
  step = 0.5,
): number {
  const lo0 = Math.max(1, Math.min(min, max));
  const hi0 = Math.max(lo0, max);
  if (fits(hi0)) return hi0;
  if (!fits(lo0)) return lo0;
  let lo = lo0;
  let hi = hi0; // lo cabe, hi no
  while (hi - lo > step) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

interface DropInfo {
  run: StyledRun;
  fs: number;
  w: number;
}

function layoutCore(L: TextLayer, measure: MeasureRun, fields?: Partial<FieldValues>): Layout {
  const fs = L.fontSize;
  const lh = L.lineHeight ?? 1;
  const step = fs * lh;
  const boxWidth = isPos(L.boxWidth) ? L.boxWidth : undefined;
  const boxHeight = isPos(L.boxHeight) ? L.boxHeight : undefined;
  const cols = boxWidth ? Math.max(1, Math.min(8, Math.round(L.columns ?? 1))) : 1;
  const gap = Math.max(0, L.columnGap ?? 0);
  const colW = boxWidth ? Math.max(1, (boxWidth - gap * (cols - 1)) / cols) : Infinity;
  const indent = L.indent && L.indent > 0 ? L.indent : 0;
  const spacing = L.paragraphSpacing && L.paragraphSpacing > 0 ? L.paragraphSpacing : 0;
  const leader = L.tabLeader === 'dots' ? '.' : L.tabLeader === 'dashes' ? '-' : undefined;
  const dropN =
    L.dropCap && L.dropCap !== 'none' && (L.listStyle ?? 'none') === 'none'
      ? Math.max(2, Math.min(5, Math.round(L.dropCapLines ?? 3)))
      : 0;

  let paras = styledLines(L, { fields });
  if (hasKerning(L)) paras = paras.map((p) => applyKerning(p, L.kerning!));

  interface Item extends Wrapped {
    para: number;
    x0: number;
  }
  const items: Item[] = [];
  const paraDrop = new Map<number, DropInfo>();
  const paraFirst: number[] = []; // índice de la primera línea de cada párrafo
  const paraLines: number[] = [];

  paras.forEach((p, pi) => {
    let line = p;
    let drop: DropInfo | null = null;
    if (dropN && (L.dropCap === 'all' || pi === 0)) {
      const ri = line.findIndex((r) => r.text.length > 0 && !r.tab);
      if (ri >= 0 && /[\p{L}\p{N}]/u.test(line[ri].text)) {
        const r0 = line[ri];
        const ch = [...r0.text][0];
        const capH = 0.7;
        const dsz = ((dropN - 1) * step + capH * fs) / capH;
        const dr: StyledRun = { ...r0, text: ch };
        delete dr.script;
        delete dr.dx;
        const w = measure({ ...L, fontSize: dsz }, dr) + fs * 0.12;
        drop = { run: dr, fs: dsz, w };
        const rest = r0.text.slice(ch.length);
        line = line.slice();
        if (rest) line[ri] = { ...r0, text: rest };
        else line.splice(ri, 1);
      }
    }
    const d = drop;
    const specFor = (idx: number): WrapSpec => {
      const x0 = d && idx < dropN ? d.w : d ? 0 : idx === 0 ? indent : 0;
      return { x0, avail: colW === Infinity ? Infinity : Math.max(1, colW - x0) };
    };
    const wrapped = wrapParagraph(L, line, specFor, measure, leader);
    if (d) paraDrop.set(pi, d);
    paraFirst[pi] = items.length;
    wrapped.forEach((w, k) => items.push({ ...w, para: pi, x0: specFor(k).x0 }));
    paraLines[pi] = wrapped.length;
  });

  // --- colocación: columnas y espacio entre párrafos ---
  const total = items.length;
  const balanced = Math.max(1, Math.ceil(total / cols));
  // Sin caja `colW` es Infinity y 0 * Infinity = NaN: la columna 0 siempre empieza en 0.
  const colX = (c: number) => (c === 0 ? 0 : c * (colW + gap));
  const ys: number[] = [];
  const colOf: number[] = [];
  const colEnd: number[] = Array(cols).fill(0);
  let col = 0;
  let lineInCol = 0;
  let gapAcc = 0;
  let prevPara = -1;
  const endPara = () => {
    // Una capitular más alta que su párrafo reserva el resto de sus líneas.
    if (prevPara >= 0 && paraDrop.has(prevPara)) gapAcc += Math.max(0, dropN - paraLines[prevPara]) * step;
    colEnd[col] = Math.max(colEnd[col], lineInCol * step + gapAcc);
  };
  items.forEach((it, i) => {
    if (it.para !== prevPara) {
      endPara();
      if (prevPara >= 0 && lineInCol > 0) gapAcc += spacing;
      prevPara = it.para;
    }
    const y = lineInCol * step + gapAcc;
    const over = boxHeight ? y + step > boxHeight + 0.01 : lineInCol >= balanced;
    if (cols > 1 && col < cols - 1 && lineInCol > 0 && over) {
      col++;
      lineInCol = 0;
      gapAcc = 0;
    }
    ys[i] = lineInCol * step + gapAcc;
    colOf[i] = col;
    lineInCol++;
  });
  endPara();
  const contentH = Math.max(0, ...colEnd);

  const lines = items.map((it) => it.runs);
  const runWidths = items.map((it) => it.widths);
  const widths = runWidths.map((ws) => ws.reduce((a, b) => a + b, 0));
  const xs = items.map((it, i) => colX(colOf[i]) + it.x0);
  const boxW = boxWidth ?? Math.max(0, ...widths.map((w, i) => xs[i] + w));
  const aw = items.map((it, i) => (boxWidth ? Math.max(0, colW - it.x0) : Math.max(0, boxW - xs[i])));
  const drops: DropCapInfo[] = [];
  paraDrop.forEach((d, pi) => {
    const i = paraFirst[pi];
    drops.push({
      line: i,
      run: d.run,
      fontSize: d.fs,
      x: colX(colOf[i]),
      y: ys[i] + 0.2 * fs - 0.2 * d.fs,
      w: d.w,
    });
  });
  return { layer: L, lines, runWidths, widths, xs, ys, aw, boxW, contentH, textH: boxHeight ?? contentH, drops };
}

// Maquetación completa (con autoajuste si procede).
export function layoutText(layer: TextLayer, measure: MeasureRun, fields?: Partial<FieldValues>): Layout {
  if (layer.autoFit && isPos(layer.boxWidth) && isPos(layer.boxHeight)) {
    const min = isPos(layer.fitMin) ? layer.fitMin : 6;
    const max = isPos(layer.fitMax) ? Math.max(layer.fitMax, min) : Math.max(layer.fontSize, min);
    const H = layer.boxHeight;
    const size = fitFontSize(
      (s) => layoutCore({ ...layer, fontSize: s }, measure, fields).contentH <= H + 0.01,
      min,
      max,
    );
    return layoutCore({ ...layer, fontSize: size }, measure, fields);
  }
  return layoutCore(layer, measure, fields);
}

// Clave corta con todo lo que afecta a la maquetación avanzada (para memoizar).
export function typographyKey(l: TextLayer): string {
  return [
    l.boxWidth,
    l.boxHeight,
    l.autoFit,
    l.fitMin,
    l.fitMax,
    l.indent,
    l.paragraphSpacing,
    l.dropCap,
    l.dropCapLines,
    l.columns,
    l.columnGap,
    l.tabStops?.join(','),
    l.tabLeader,
    l.fractions,
    l.kerning ? JSON.stringify(l.kerning) : '',
  ].join('|');
}
