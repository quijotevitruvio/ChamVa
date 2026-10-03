import { jsPDF } from 'jspdf';
import type { Doc } from '../editor/core/types';
import { renderDocToCanvas } from './export';
import {
  bleedPageGeometry,
  bookletAll,
  clampBleedMm,
  cornerMarks,
  fitInCell,
  mmToPx,
  nUpLayout,
  pxToMm,
  SHEETS,
  stepRepeat,
  type NUpCount,
  type Seg,
  type SheetId,
  type SignatureSize,
} from './exportPrint';

// Crea un PDF: cada página del diseño es una página del PDF.
export async function exportPagesToPdf(pages: Doc[]): Promise<Blob> {
  let pdf: jsPDF | null = null;
  for (const page of pages) {
    const w = page.width;
    const h = page.height;
    const orientation = w >= h ? 'landscape' : 'portrait';
    // PDF no maneja transparencia → fondo blanco.
    const canvas = await renderDocToCanvas(page, 1, '#ffffff');
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    if (!pdf) {
      pdf = new jsPDF({ orientation, unit: 'px', format: [w, h] });
    } else {
      pdf.addPage([w, h], orientation);
    }
    pdf.addImage(dataUrl, 'JPEG', 0, 0, w, h);
  }
  return (pdf as jsPDF).output('blob');
}

// ---------------------------------------------------------------------------
// Impresión: sangrado y marcas, marcadores, n por hoja, pliegos y planchas.
// La geometría (mm) vive en exportPrint.ts; aquí solo se dibuja con jsPDF.
// ---------------------------------------------------------------------------

function newPdfMm(w: number, h: number): jsPDF {
  return new jsPDF({ orientation: w >= h ? 'landscape' : 'portrait', unit: 'mm', format: [w, h] });
}
function addPageMm(pdf: jsPDF, w: number, h: number) {
  pdf.addPage([w, h], w >= h ? 'landscape' : 'portrait');
}

function drawSegs(pdf: jsPDF, segs: Seg[]) {
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.1);
  for (const s of segs) pdf.line(s.x1, s.y1, s.x2, s.y2);
}

// Escala de render para que el PDF tenga ~300 ppp (sin pasar de 6000 px).
function printScale(wPx: number, hPx: number, dpi: number): number {
  const want = dpi >= 300 ? 1 : 300 / dpi;
  const cap = 6000 / Math.max(wPx, hPx);
  return Math.max(0.25, Math.min(want, cap, 4));
}

async function pageJpeg(page: Doc, scale: number, quality = 0.92): Promise<string> {
  const canvas = await renderDocToCanvas(page, scale, '#ffffff');
  return canvas.toDataURL('image/jpeg', quality);
}

export type BleedFill = 'extend' | 'mirror';

// Amplía el lienzo `c` en `bp` px por lado repitiendo el borde o en espejo.
export function extendCanvas(c: HTMLCanvasElement, bp: number, mode: BleedFill): HTMLCanvasElement {
  const w = c.width;
  const h = c.height;
  const out = document.createElement('canvas');
  out.width = w + 2 * bp;
  out.height = h + 2 * bp;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(c, bp, bp);
  if (bp <= 0) return out;
  if (mode === 'mirror' && bp <= Math.min(w, h)) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        ctx.save();
        ctx.translate(bp + ox * w + (ox ? w : 0), bp + oy * h + (oy ? h : 0));
        ctx.scale(ox ? -1 : 1, oy ? -1 : 1);
        ctx.drawImage(c, 0, 0);
        ctx.restore();
      }
    }
    return out;
  }
  // Extender: se estira la fila/columna del borde y los píxeles de las esquinas.
  ctx.drawImage(c, 0, 0, w, 1, bp, 0, w, bp);
  ctx.drawImage(c, 0, h - 1, w, 1, bp, bp + h, w, bp);
  ctx.drawImage(c, 0, 0, 1, h, 0, bp, bp, h);
  ctx.drawImage(c, w - 1, 0, 1, h, bp + w, bp, bp, h);
  ctx.drawImage(c, 0, 0, 1, 1, 0, 0, bp, bp);
  ctx.drawImage(c, w - 1, 0, 1, 1, bp + w, 0, bp, bp);
  ctx.drawImage(c, 0, h - 1, 1, 1, 0, bp + h, bp, bp);
  ctx.drawImage(c, w - 1, h - 1, 1, 1, bp + w, bp + h, bp, bp);
  return out;
}

export interface BleedPdfOptions {
  dpi: 96 | 300; // a qué resolución se interpretan los px del diseño
  bleedMm: number; // 0–10
  crop: boolean;
  registration: boolean;
  fill: BleedFill;
}

// PDF a tamaño real: tamaño final + sangrado (la imagen se amplía repitiendo el
// borde) y marcas de corte y de registro opcionales. Una página por diseño.
export async function exportBleedPdf(pages: Doc[], o: BleedPdfOptions): Promise<Blob> {
  let pdf: jsPDF | null = null;
  const bleedMm = clampBleedMm(o.bleedMm);
  for (const page of pages) {
    const g = bleedPageGeometry(pxToMm(page.width, o.dpi), pxToMm(page.height, o.dpi), bleedMm, o.crop, o.registration);
    const s = printScale(page.width, page.height, o.dpi);
    const base = await renderDocToCanvas(page, s, '#ffffff');
    // sangrado en px del lienzo ya escalado
    const bp = Math.round(mmToPx(bleedMm, o.dpi) * s);
    const ext = extendCanvas(base, bp, o.fill);
    const url = ext.toDataURL('image/jpeg', 0.92);
    if (!pdf) pdf = newPdfMm(g.pageW, g.pageH);
    else addPageMm(pdf, g.pageW, g.pageH);
    pdf.addImage(url, 'JPEG', g.bleedRect.x, g.bleedRect.y, g.bleedRect.w, g.bleedRect.h);
    drawSegs(pdf, g.marks);
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.1);
    for (const r of g.registration) {
      pdf.circle(r.cx, r.cy, r.r, 'S');
      pdf.line(r.cx - r.r * 2, r.cy, r.cx + r.r * 2, r.cy);
      pdf.line(r.cx, r.cy - r.r * 2, r.cx, r.cy + r.r * 2);
    }
  }
  return (pdf as jsPDF).output('blob');
}

// PDF con marcadores (panel de «Marcadores» del lector): uno por página con su
// nombre. Los enlaces por capa necesitan un campo `link` en las capas, que el
// modelo aún no tiene: por ahora solo se crean los marcadores.
export async function exportBookmarkedPdf(pages: Doc[]): Promise<Blob> {
  let pdf: jsPDF | null = null;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const canvas = await renderDocToCanvas(page, 1, '#ffffff');
    const url = canvas.toDataURL('image/jpeg', 0.92);
    const orientation = page.width >= page.height ? 'landscape' : 'portrait';
    if (!pdf) pdf = new jsPDF({ orientation, unit: 'px', format: [page.width, page.height] });
    else pdf.addPage([page.width, page.height], orientation);
    pdf.addImage(url, 'JPEG', 0, 0, page.width, page.height);
    pdf.outline.add(null, page.title?.trim() || page.name?.trim() || `Página ${i + 1}`, { pageNumber: i + 1 });
  }
  return (pdf as jsPDF).output('blob');
}

export interface NUpPdfOptions {
  count: NUpCount;
  sheet: SheetId;
  gutterMm: number;
  marginMm: number;
  marks: boolean;
}

// Varias páginas del proyecto por hoja (2, 4, 6 o 9), con separación y marcas.
export async function exportNUpPdf(pages: Doc[], o: NUpPdfOptions): Promise<Blob> {
  const aspect = pages[0].width / pages[0].height;
  const lay = nUpLayout(o.count, o.sheet, o.gutterMm, o.marginMm, aspect, o.marks);
  const pdf = newPdfMm(lay.pageW, lay.pageH);
  const urls: string[] = [];
  for (const p of pages) urls.push(await pageJpeg(p, Math.min(2, 1600 / Math.max(p.width, p.height))));
  const sheets = Math.ceil(pages.length / o.count);
  for (let s = 0; s < sheets; s++) {
    if (s > 0) addPageMm(pdf, lay.pageW, lay.pageH);
    for (let k = 0; k < o.count; k++) {
      const i = s * o.count + k;
      if (i >= pages.length) break;
      const p = pages[i];
      const r = fitInCell(lay.cells[k], p.width / p.height);
      pdf.addImage(urls[i], 'JPEG', r.x, r.y, r.w, r.h);
      if (o.marks) drawSegs(pdf, cornerMarks(r, 1, 3));
    }
  }
  return pdf.output('blob');
}

export interface BookletPdfOptions {
  size: SignatureSize;
  sheet: SheetId;
}

// Imposición de folleto: hojas apaisadas con dos páginas por cara. Imprimir a
// doble cara volteando por el borde corto y plegar por la mitad.
export async function exportBookletPdf(pages: Doc[], o: BookletPdfOptions): Promise<Blob> {
  const s = SHEETS[o.sheet];
  const W = s.h; // hoja apaisada
  const H = s.w;
  const pdf = newPdfMm(W, H);
  const cells = [
    { x: 0, y: 0, w: W / 2, h: H },
    { x: W / 2, y: 0, w: W / 2, h: H },
  ];
  const urls = new Map<number, string>();
  const url = async (i: number) => {
    if (!urls.has(i)) {
      const p = pages[i];
      urls.set(i, await pageJpeg(p, Math.min(2, 1600 / Math.max(p.width, p.height))));
    }
    return urls.get(i)!;
  };
  const sheets = bookletAll(pages.length, o.size);
  let first = true;
  for (const sh of sheets) {
    for (const side of [sh.front, sh.back]) {
      if (!first) addPageMm(pdf, W, H);
      first = false;
      for (let k = 0; k < 2; k++) {
        const idx = side[k];
        if (idx === null) continue;
        const p = pages[idx];
        const r = fitInCell(cells[k], p.width / p.height);
        pdf.addImage(await url(idx), 'JPEG', r.x, r.y, r.w, r.h);
      }
      // Marcas de pliegue discretas.
      pdf.setDrawColor(180, 180, 180);
      pdf.setLineWidth(0.1);
      pdf.line(W / 2, 0, W / 2, 4);
      pdf.line(W / 2, H - 4, W / 2, H);
    }
  }
  return pdf.output('blob');
}

export interface StickerPdfOptions {
  dpi: 96 | 300;
  sheet: SheetId;
  marginMm: number;
  gutterMm: number;
  marks: boolean;
}

// Plancha de pegatinas/tarjetas: el diseño repetido en cuadrícula. Devuelve
// también cuántas piezas caben (0 = no cabe ni una).
export async function exportStickerSheetPdf(
  page: Doc,
  o: StickerPdfOptions,
): Promise<{ blob: Blob; count: number }> {
  const w = pxToMm(page.width, o.dpi);
  const h = pxToMm(page.height, o.dpi);
  const sr = stepRepeat(w, h, o.sheet, o.marginMm, o.gutterMm, o.marks);
  const pdf = newPdfMm(sr.pageW, sr.pageH);
  if (sr.count > 0) {
    const url = await pageJpeg(page, printScale(page.width, page.height, o.dpi));
    for (const c of sr.cells) {
      pdf.addImage(url, 'JPEG', c.x, c.y, c.w, c.h);
      if (o.marks) drawSegs(pdf, cornerMarks(c, 1, 3));
    }
  }
  return { blob: pdf.output('blob'), count: sr.count };
}
