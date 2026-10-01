// Efectos de texto avanzados (textFx.ts) en la exportación SVG.
//  · Texto sobre trazado SIN otros efectos: vectorial, con <textPath> (el texto sigue
//    siendo texto; estilo por palabra y degradado no se conservan).
//  · Cualquier otro efecto (relleno con imagen, extrusión, contornos, tinta,
//    resaltador): el texto se RASTERIZA a un <image> PNG (×2) idéntico al lienzo, por lo
//    que deja de ser texto editable en el SVG.
import type { TextLayer } from '../editor/core/types';
import { drawCurvedText, measureCurved } from '../editor/core/curvedText';
import { drawStyledText, measureStyledText } from '../editor/core/styledText';
import { fxMargin, hasPathText, hasTextFx, pathToSvgD, preloadTextFxImages } from '../editor/core/textFx';
import type { FieldValues } from '../editor/core/textMacros';
import { displayText } from '../editor/core/types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const RASTER_SCALE = 2;

/** SVG del texto con efectos, o null si la capa no usa ninguno (se exporta como siempre). */
export async function textFxSvg(l: TextLayer, fields?: Partial<FieldValues>): Promise<string | null> {
  if (hasTextFx(l)) return rasterText(l, fields);
  if (hasPathText(l)) return pathTextSvg(l);
  return null;
}

async function rasterText(l: TextLayer, fields?: Partial<FieldValues>): Promise<string> {
  await preloadTextFxImages(l);
  const measure = document.createElement('canvas').getContext('2d')!;
  const path = hasPathText(l) || (!!l.curve && l.curve !== 0);
  const box = path ? measureCurved(measure, l) : measureStyledText(measure, l, fields);
  const margin = fxMargin(l);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil((box.width + margin * 2) * RASTER_SCALE));
  canvas.height = Math.max(1, Math.ceil((box.height + margin * 2) * RASTER_SCALE));
  const ctx = canvas.getContext('2d')!;
  ctx.scale(RASTER_SCALE, RASTER_SCALE);
  ctx.translate(margin, margin);
  if (path) drawCurvedText(ctx, l, box.width, box.height);
  else drawStyledText(ctx, l, fields);
  const w = canvas.width / RASTER_SCALE;
  const h = canvas.height / RASTER_SCALE;
  return `<image href="${canvas.toDataURL('image/png')}" x="${-margin}" y="${-margin}" width="${w.toFixed(2)}" height="${h.toFixed(2)}"/>`;
}

function pathTextSvg(l: TextLayer): string {
  const id = `tp-${l.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const text = displayText({ ...l, listStyle: 'none' }).split('\n')[0] ?? '';
  const anchor = l.align === 'center' ? ' text-anchor="middle"' : l.align === 'right' ? ' text-anchor="end"' : '';
  const start = l.align === 'center' ? '50%' : l.align === 'right' ? '100%' : `${l.pathText!.offset ?? 0}`;
  const weight = l.bold ? ' font-weight="bold"' : '';
  const style = l.italic ? ' font-style="italic"' : '';
  const ls = l.letterSpacing ? ` letter-spacing="${l.letterSpacing}"` : '';
  const stroke = l.strokeWidth > 0 ? ` stroke="${l.strokeColor}" stroke-width="${l.strokeWidth}" paint-order="stroke"` : '';
  return (
    `<defs><path id="${id}" d="${pathToSvgD(l.pathText!.points)}"/></defs>` +
    `<text font-family="${esc(l.fontFamily)}" font-size="${l.fontSize}" fill="${l.fill}"${weight}${style}${ls}${stroke}${anchor} xml:space="preserve">` +
    `<textPath href="#${id}" startOffset="${start}">${esc(text)}</textPath></text>`
  );
}
