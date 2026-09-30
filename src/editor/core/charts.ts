// Gráficas y tablas editables. Se renderizan con Canvas 2D a un PNG (dataURL)
// que se inserta como ImageLayer normal; el spec se guarda en la capa para reeditar.

export type ChartKind = 'bar' | 'barH' | 'line' | 'area' | 'pie' | 'donut';
export interface ChartSeries {
  name: string;
  color: string;
  values: number[];
}
export interface ChartSpec {
  kind: ChartKind;
  title: string;
  labels: string[];
  series: ChartSeries[];
  width: number;
  height: number;
  background: string; // '' = transparente
  textColor: string;
  fontFamily: string;
  showLegend: boolean;
  showValues: boolean;
  showGrid: boolean;
}
export interface TableSpec {
  cells: string[][];
  headerRow: boolean;
  headerBg: string;
  headerColor: string;
  bodyBg: string;
  stripeBg: string; // '' = sin rayado
  textColor: string;
  borderColor: string;
  fontFamily: string;
  fontSize: number;
  align: 'left' | 'center' | 'right';
  cellPadding: number;
}
export interface RenderResult {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
}

export const CHART_PALETTE = [
  '#4f8cff',
  '#ff7a59',
  '#2ec4a6',
  '#f5b83d',
  '#9b6bff',
  '#ef5b8f',
  '#5cc8ff',
  '#8bc34a',
];

const SCALE = 2;

export function defaultChart(kind: ChartKind = 'bar'): ChartSpec {
  const pie = kind === 'pie' || kind === 'donut';
  return {
    kind,
    title: 'Ventas por trimestre',
    labels: ['T1', 'T2', 'T3', 'T4', 'T5'],
    series: pie
      ? [{ name: 'Ventas', color: CHART_PALETTE[0], values: [30, 45, 25, 60, 40] }]
      : [
          { name: '2024', color: CHART_PALETTE[0], values: [30, 45, 25, 60, 40] },
          { name: '2025', color: CHART_PALETTE[1], values: [38, 52, 35, 55, 62] },
        ],
    width: 640,
    height: 400,
    background: '#ffffff',
    textColor: '#222222',
    fontFamily: 'Arial',
    showLegend: true,
    showValues: false,
    showGrid: true,
  };
}

export function defaultTable(): TableSpec {
  return {
    cells: [
      ['Producto', 'Cantidad', 'Precio'],
      ['Manzanas', '12', '3,50'],
      ['Peras', '8', '4,20'],
      ['Uvas', '20', '6,00'],
    ],
    headerRow: true,
    headerBg: '#4f8cff',
    headerColor: '#ffffff',
    bodyBg: '#ffffff',
    stripeBg: '#f1f4fb',
    textColor: '#222222',
    borderColor: '#d0d5e0',
    fontFamily: 'Arial',
    fontSize: 16,
    align: 'left',
    cellPadding: 10,
  };
}

// ---------- utilidades puras ----------

/** Marcas "bonitas" (1, 2, 5 × 10^n) que cubren [min, max]. Nunca devuelve NaN. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!isFinite(min)) min = 0;
  if (!isFinite(max)) max = 0;
  if (min > max) [min, max] = [max, min];
  count = Math.max(2, Math.floor(count) || 5);
  if (min === max) {
    if (min === 0) return [0, 1];
    const pad = Math.abs(min) * 0.5;
    min -= pad;
    max += pad;
  }
  const rawStep = (max - min) / (count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = nice * mag;
  const start = Math.floor(min / step + 1e-9) * step;
  const end = Math.ceil(max / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = start, i = 0; v <= end + step * 1e-6 && i < 200; v += step, i++) {
    out.push(Number((Math.round(v / step) * step).toPrecision(12)));
  }
  return out;
}

/** Convierte "1.234,5", "1,5", "1,234.5", "12" en número; NaN si no es numérico. */
export function parseNumber(raw: string): number {
  let s = raw.trim().replace(/\s/g, '').replace(/[%€$£]/g, '');
  if (!s || !/^[-+]?[\d.,]+$/.test(s)) return NaN;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // "1,5" decimal; "1,234,567" miles
    s = s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot >= 0 && s.split('.').length > 2) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return isFinite(n) ? n : NaN;
}

/** Texto pegado desde Excel/Sheets → matriz de celdas (separador: tab, si no `;`, si no `,`). */
export function parsePasted(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  const rows = lines.map((line) => {
    const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
    return line.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
  });
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return rows.map((r) => [...r, ...Array(width - r.length).fill('')]);
}

/** Matriz pegada → labels + series. Primera fila = encabezados si no es numérica. */
export function pastedToChart(
  rows: string[][],
  palette: string[] = CHART_PALETTE,
): { labels: string[]; series: ChartSeries[] } | null {
  if (!rows.length || !rows[0].length) return null;
  const nCols = rows[0].length;
  const firstNumeric = rows[0].slice(1).some((c) => !isNaN(parseNumber(c)));
  const hasHeader = !firstNumeric && nCols > 1;
  const body = hasHeader ? rows.slice(1) : rows;
  if (!body.length) return null;
  const valueCols = Math.max(1, nCols - 1);
  const series: ChartSeries[] = [];
  for (let c = 0; c < valueCols; c++) {
    series.push({
      name: hasHeader ? rows[0][c + 1] || `Serie ${c + 1}` : `Serie ${c + 1}`,
      color: palette[c % palette.length],
      values: body.map((r) => {
        const n = parseNumber(nCols > 1 ? r[c + 1] ?? '' : r[0] ?? '');
        return isNaN(n) ? 0 : n;
      }),
    });
  }
  const labels = body.map((r, i) => (nCols > 1 ? r[0] : `${i + 1}`) || `${i + 1}`);
  return { labels, series };
}

// ---------- render ----------

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * SCALE));
  canvas.height = Math.max(1, Math.round(h * SCALE));
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  return { canvas, ctx };
}

function font(spec: { fontFamily: string }, size: number, bold = false): string {
  return `${bold ? 'bold ' : ''}${size}px "${spec.fontFamily}", Arial, sans-serif`;
}

function clip(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 0) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 0 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s ? s + '…' : '';
}

function fmt(n: number): string {
  if (!isFinite(n)) return '0';
  const a = Math.abs(n);
  if (a >= 1e9) return +(n / 1e9).toFixed(1) + ' G';
  if (a >= 1e6) return +(n / 1e6).toFixed(1) + ' M';
  if (a >= 1e4) return +(n / 1e3).toFixed(1) + ' k';
  return String(+n.toFixed(2));
}

function safeNum(v: number): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

export function renderChart(spec: ChartSpec): RenderResult {
  const W = Math.max(120, Math.round(spec.width) || 640);
  const H = Math.max(100, Math.round(spec.height) || 400);
  const { canvas, ctx } = makeCanvas(W, H);
  if (spec.background) {
    ctx.fillStyle = spec.background;
    ctx.fillRect(0, 0, W, H);
  }
  const text = spec.textColor || '#222';
  const series = spec.series.filter((s) => s);
  const nCats = Math.max(spec.labels.length, ...series.map((s) => s.values.length), 0);
  const labels = Array.from({ length: nCats }, (_, i) => spec.labels[i] ?? String(i + 1));
  const pie = spec.kind === 'pie' || spec.kind === 'donut';

  ctx.textBaseline = 'middle';
  let top = 12;
  if (spec.title) {
    ctx.fillStyle = text;
    ctx.font = font(spec, 18, true);
    ctx.textAlign = 'center';
    ctx.fillText(clip(ctx, spec.title, W - 24), W / 2, top + 10);
    top += 32;
  }

  // Leyenda (abajo). En torta los ítems son las categorías.
  const legendItems = pie
    ? labels.map((l, i) => ({ name: l, color: CHART_PALETTE[i % CHART_PALETTE.length] }))
    : series.map((s) => ({ name: s.name, color: s.color }));
  let bottom = H - 10;
  if (spec.showLegend && legendItems.length) {
    ctx.font = font(spec, 12);
    const rowsL: { name: string; color: string; w: number }[][] = [[]];
    let rowW = 0;
    for (const it of legendItems) {
      const name = clip(ctx, it.name, Math.max(40, W / 2));
      const w = 14 + ctx.measureText(name).width + 14;
      if (rowW + w > W - 24 && rowsL[rowsL.length - 1].length) {
        rowsL.push([]);
        rowW = 0;
      }
      rowsL[rowsL.length - 1].push({ name, color: it.color, w });
      rowW += w;
    }
    const lh = 18;
    let y = bottom - rowsL.length * lh + lh / 2;
    for (const r of rowsL) {
      const total = r.reduce((a, b) => a + b.w, 0);
      let x = (W - total) / 2;
      for (const it of r) {
        ctx.fillStyle = it.color;
        ctx.fillRect(x, y - 5, 10, 10);
        ctx.fillStyle = text;
        ctx.textAlign = 'left';
        ctx.fillText(it.name, x + 14, y);
        x += it.w;
      }
      y += lh;
    }
    bottom -= rowsL.length * lh + 8;
  }

  const area = { x: 12, y: top + 4, w: W - 24, h: bottom - top - 4 };
  if (area.h > 20 && area.w > 20 && nCats > 0 && series.length > 0) {
    if (pie) drawPie(ctx, spec, area, labels, series[0]);
    else drawAxes(ctx, spec, area, labels, series);
  } else if (nCats === 0 || series.length === 0) {
    ctx.fillStyle = text;
    ctx.globalAlpha = 0.5;
    ctx.font = font(spec, 14);
    ctx.textAlign = 'center';
    ctx.fillText('Sin datos', W / 2, (top + bottom) / 2);
    ctx.globalAlpha = 1;
  }

  return { src: canvas.toDataURL('image/png'), naturalWidth: canvas.width, naturalHeight: canvas.height };
}

type Area = { x: number; y: number; w: number; h: number };

function drawPie(
  ctx: CanvasRenderingContext2D,
  spec: ChartSpec,
  a: Area,
  labels: string[],
  s: ChartSeries,
) {
  const vals = labels.map((_, i) => Math.max(0, safeNum(s.values[i] ?? 0)));
  const total = vals.reduce((x, y) => x + y, 0);
  const r = Math.min(a.w, a.h) / 2 - 4;
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  if (r < 8) return;
  if (total <= 0) {
    ctx.strokeStyle = spec.textColor;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }
  const inner = spec.kind === 'donut' ? r * 0.55 : 0;
  let ang = -Math.PI / 2;
  const bg = spec.background || '#ffffff';
  vals.forEach((v, i) => {
    if (v <= 0) return;
    const sweep = (v / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner);
    ctx.arc(cx, cy, r, ang, ang + sweep);
    ctx.arc(cx, cy, inner, ang + sweep, ang, true);
    ctx.closePath();
    ctx.fillStyle = CHART_PALETTE[i % CHART_PALETTE.length];
    ctx.fill();
    ctx.strokeStyle = bg;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const pct = (v / total) * 100;
    if (pct >= 4) {
      const mid = ang + sweep / 2;
      const rr = inner ? (r + inner) / 2 : r * 0.65;
      ctx.fillStyle = '#ffffff';
      ctx.font = font(spec, 12, true);
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 2;
      const t = spec.showValues ? `${fmt(v)} (${Math.round(pct)}%)` : `${Math.round(pct)}%`;
      ctx.fillText(t, cx + Math.cos(mid) * rr, cy + Math.sin(mid) * rr);
      ctx.shadowBlur = 0;
    }
    ang += sweep;
  });
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  spec: ChartSpec,
  a: Area,
  labels: string[],
  series: ChartSeries[],
) {
  const text = spec.textColor || '#222';
  const horizontal = spec.kind === 'barH';
  const isBar = spec.kind === 'bar' || horizontal;
  const all = series.flatMap((s) => labels.map((_, i) => safeNum(s.values[i] ?? 0)));
  let lo = Math.min(...all, 0);
  let hi = Math.max(...all, 0);
  if (!isBar && all.length) {
    lo = Math.min(...all);
    hi = Math.max(...all);
    if (spec.kind === 'area') {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
  }
  const ticks = niceTicks(lo, hi, 5);
  const tMin = ticks[0];
  const tMax = ticks[ticks.length - 1];
  const span = tMax - tMin || 1;

  ctx.font = font(spec, 11);
  const tickW = Math.min(
    60,
    Math.max(...ticks.map((t) => ctx.measureText(fmt(t)).width)) + 8,
  );
  const catW = horizontal
    ? Math.min(Math.max(...labels.map((l) => ctx.measureText(l).width), 10) + 8, a.w * 0.3)
    : 0;
  const plot: Area = horizontal
    ? { x: a.x + catW, y: a.y + 6, w: a.w - catW - 14, h: a.h - 26 }
    : { x: a.x + tickW, y: a.y + 8, w: a.w - tickW - 6, h: a.h - 30 };
  if (plot.w < 20 || plot.h < 20) return;

  const val2pos = (v: number) =>
    horizontal
      ? plot.x + ((v - tMin) / span) * plot.w
      : plot.y + plot.h - ((v - tMin) / span) * plot.h;

  // cuadrícula + marcas
  ctx.lineWidth = 1;
  ctx.fillStyle = text;
  ctx.font = font(spec, 11);
  for (const t of ticks) {
    const p = val2pos(t);
    if (spec.showGrid) {
      ctx.strokeStyle = text;
      ctx.globalAlpha = 0.15;
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(p, plot.y);
        ctx.lineTo(p, plot.y + plot.h);
      } else {
        ctx.moveTo(plot.x, p);
        ctx.lineTo(plot.x + plot.w, p);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (horizontal) {
      ctx.textAlign = 'center';
      ctx.fillText(fmt(t), p, plot.y + plot.h + 12);
    } else {
      ctx.textAlign = 'right';
      ctx.fillText(fmt(t), plot.x - 6, p);
    }
  }
  // eje cero
  const zero = val2pos(Math.min(Math.max(0, tMin), tMax));
  ctx.strokeStyle = text;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  if (horizontal) {
    ctx.moveTo(zero, plot.y);
    ctx.lineTo(zero, plot.y + plot.h);
  } else {
    ctx.moveTo(plot.x, zero);
    ctx.lineTo(plot.x + plot.w, zero);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  const n = labels.length;
  const bandLen = (horizontal ? plot.h : plot.w) / n;
  const bandStart = (i: number) => (horizontal ? plot.y : plot.x) + i * bandLen;

  // etiquetas de categoría
  ctx.fillStyle = text;
  ctx.font = font(spec, 11);
  labels.forEach((l, i) => {
    const c = bandStart(i) + bandLen / 2;
    if (horizontal) {
      ctx.textAlign = 'right';
      ctx.fillText(clip(ctx, l, catW - 6), plot.x - 6, c);
    } else {
      ctx.textAlign = 'center';
      ctx.fillText(clip(ctx, l, bandLen - 4), c, plot.y + plot.h + 14);
    }
  });

  const showVal = (v: number, x: number, y: number, align: CanvasTextAlign) => {
    ctx.fillStyle = text;
    ctx.font = font(spec, 10);
    ctx.textAlign = align;
    ctx.fillText(fmt(v), x, y);
  };

  if (isBar) {
    const groupW = bandLen * 0.75;
    const barW = groupW / series.length;
    series.forEach((s, si) => {
      ctx.fillStyle = s.color;
      labels.forEach((_, i) => {
        const v = safeNum(s.values[i] ?? 0);
        const off = bandStart(i) + (bandLen - groupW) / 2 + si * barW;
        const p = val2pos(v);
        if (horizontal) {
          ctx.fillRect(Math.min(zero, p), off + 1, Math.abs(p - zero), Math.max(1, barW - 2));
          if (spec.showValues)
            showVal(v, v >= 0 ? p + 4 : p - 4, off + barW / 2, v >= 0 ? 'left' : 'right');
          ctx.fillStyle = s.color;
        } else {
          ctx.fillRect(off + 1, Math.min(zero, p), Math.max(1, barW - 2), Math.abs(p - zero));
          if (spec.showValues)
            showVal(v, off + barW / 2, v >= 0 ? p - 7 : p + 7, 'center');
          ctx.fillStyle = s.color;
        }
      });
    });
    return;
  }

  // línea / área
  series.forEach((s) => {
    const pts = labels.map((_, i) => ({
      x: bandStart(i) + bandLen / 2,
      y: val2pos(safeNum(s.values[i] ?? 0)),
      v: safeNum(s.values[i] ?? 0),
    }));
    if (spec.kind === 'area') {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, zero);
      pts.forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.lineTo(pts[pts.length - 1].x, zero);
      ctx.closePath();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    pts.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
      if (spec.showValues) showVal(p.v, p.x, p.v >= 0 ? p.y - 10 : p.y + 10, 'center');
    });
  });
}

export function renderTable(spec: TableSpec): RenderResult {
  const rows = spec.cells.length ? spec.cells : [['']];
  const nCols = Math.max(1, ...rows.map((r) => r.length));
  const fs = Math.max(6, spec.fontSize || 16);
  const pad = Math.max(0, spec.cellPadding ?? 8);
  const rowH = Math.round(fs * 1.25 + pad * 2);
  const measure = makeCanvas(1, 1).ctx;
  const colW: number[] = Array(nCols).fill(0);
  rows.forEach((r, ri) => {
    const head = spec.headerRow && ri === 0;
    measure.font = font(spec, fs, head);
    for (let c = 0; c < nCols; c++) {
      colW[c] = Math.max(colW[c], Math.ceil(measure.measureText(r[c] ?? '').width));
    }
  });
  const widths = colW.map((w) => Math.max(w + pad * 2, fs * 2));
  const W = widths.reduce((a, b) => a + b, 0) + 1;
  const H = rowH * rows.length + 1;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.textBaseline = 'middle';
  rows.forEach((r, ri) => {
    const head = spec.headerRow && ri === 0;
    const bodyIdx = spec.headerRow ? ri - 1 : ri;
    let x = 0;
    const y = ri * rowH;
    for (let c = 0; c < nCols; c++) {
      const w = widths[c];
      const fill = head ? spec.headerBg : spec.stripeBg && bodyIdx % 2 === 1 ? spec.stripeBg : spec.bodyBg;
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, w, rowH);
      }
      ctx.strokeStyle = spec.borderColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w, rowH);
      ctx.fillStyle = head ? spec.headerColor : spec.textColor;
      ctx.font = font(spec, fs, head);
      ctx.textAlign = spec.align;
      const tx = spec.align === 'left' ? x + pad : spec.align === 'right' ? x + w - pad : x + w / 2;
      ctx.fillText(r[c] ?? '', tx, y + rowH / 2 + 1);
      x += w;
    }
  });
  return { src: canvas.toDataURL('image/png'), naturalWidth: canvas.width, naturalHeight: canvas.height };
}
