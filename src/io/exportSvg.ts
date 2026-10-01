import { svgGradientDef } from '../editor/core/gradients';
import {
  type Doc,
  type ShapeLayer,
  type TextLayer,
} from '../editor/core/types';
import { needsProcessing, processImage } from '../editor/core/imageProcessing';
import { isStrokeOnly, shapePath, shapeSvgPath } from '../editor/core/shapes';
import { baseStyle, runFont, styledLines } from '../editor/core/richText';

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function transform(l: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }) {
  return `translate(${l.x} ${l.y}) rotate(${l.rotation}) scale(${l.scaleX} ${l.scaleY})`;
}

function shadowStyle(l: {
  shadow?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
  shadowX?: number;
  shadowY?: number;
}) {
  return l.shadow
    ? ` style="filter:drop-shadow(${l.shadowX}px ${l.shadowY}px ${l.shadowBlur}px ${l.shadowColor})"`
    : '';
}

// Con relleno degradado se antepone su <defs> (id único por capa).
function shapeSvg(l: ShapeLayer): string {
  if (l.fillGradient && !isStrokeOnly(l.shape)) {
    const id = `sg-${l.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
    return `<defs>${svgGradientDef(id, l.fillGradient, l.width, l.height)}</defs>${shapeSvgBody(l, `url(#${id})`)}`;
  }
  return shapeSvgBody(l);
}

function shapeSvgBody(l: ShapeLayer, fillOverride?: string): string {
  const fill = fillOverride ?? (isStrokeOnly(l.shape) ? 'none' : l.fill);
  const strokeOn = l.strokeWidth > 0 || isStrokeOnly(l.shape);
  const sw = isStrokeOnly(l.shape) ? Math.max(2, l.strokeWidth) : l.strokeWidth;
  const stroke = strokeOn
    ? ` stroke="${l.stroke}" stroke-width="${sw}"`
    : '';
  const w = l.width;
  const h = l.height;
  switch (l.shape) {
    case 'rect':
      return `<rect width="${w}" height="${h}" rx="${l.cornerRadius}" fill="${fill}"${stroke}/>`;
    case 'ellipse':
      return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}"${stroke}/>`;
    case 'triangle':
      return `<polygon points="${w / 2},0 ${w},${h} 0,${h}" fill="${fill}"${stroke}/>`;
    case 'star': {
      const cx = w / 2;
      const cy = h / 2;
      const outer = Math.min(w, h) / 2;
      const inner = outer * 0.45;
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
      }
      return `<polygon points="${pts.join(' ')}" fill="${fill}"${stroke}/>`;
    }
    case 'line':
      return `<line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}"${stroke}/>`;
    case 'arrow': {
      const head = Math.min(h, w * 0.4);
      const my = h / 2;
      return `<path d="M0,${my} L${w - head},${my} M${w - head},${my - head / 2} L${w},${my} L${w - head},${my + head / 2}" fill="none"${stroke}/>`;
    }
    default:
      return `<path d="${shapeSvgPath(l.shape, w, h, l.cornerRadius)}" fill="${fill}"${stroke}/>`;
  }
}

// Texto con estilo por palabra: cada línea es un <tspan x y> y cada tramo
// con estilo propio un <tspan> anidado (peso, cursiva, color, subrayado).
function textSvg(l: TextLayer, measure: CanvasRenderingContext2D): string {
  (measure as any).letterSpacing = `${l.letterSpacing || 0}px`;
  const lines = styledLines(l);
  const base = baseStyle(l);
  const widths = lines.map((line) =>
    line.reduce((sum, run) => {
      measure.font = runFont(l, run);
      return sum + measure.measureText(run.text).width;
    }, 0),
  );
  const boxW = Math.max(0, ...widths);
  const lh = l.lineHeight ?? 1;
  const pad = l.textEffect === 'background' ? l.fontSize * 0.3 : 0;
  const weight = l.bold ? ' font-weight="bold"' : '';
  const style = l.italic ? ' font-style="italic"' : '';
  const deco = l.underline ? ' text-decoration="underline"' : '';
  const ls = l.letterSpacing ? ` letter-spacing="${l.letterSpacing}"` : '';
  const stroke =
    l.strokeWidth > 0
      ? ` stroke="${l.strokeColor}" stroke-width="${l.strokeWidth}" paint-order="stroke"`
      : '';
  const shadow = l.shadow
    ? ` style="filter:drop-shadow(${l.shadowX}px ${l.shadowY}px ${l.shadowBlur}px ${l.shadowColor})"`
    : '';
  const tspans = lines
    .map((line, i) => {
      let lx = pad;
      if (l.align === 'center') lx += (boxW - widths[i]) / 2;
      else if (l.align === 'right') lx += boxW - widths[i];
      const runs = line
        .map((run) => {
          const a: string[] = [];
          if (run.bold !== base.bold) a.push(`font-weight="${run.bold ? 'bold' : 'normal'}"`);
          if (run.italic !== base.italic) a.push(`font-style="${run.italic ? 'italic' : 'normal'}"`);
          if (run.underline !== base.underline) a.push(`text-decoration="${run.underline ? 'underline' : 'none'}"`);
          if (run.color !== base.color) a.push(`fill="${run.color}"`);
          const t = esc(run.text);
          return a.length ? `<tspan ${a.join(' ')}>${t}</tspan>` : t;
        })
        .join('');
      return `<tspan x="${lx.toFixed(1)}" y="${(pad + i * l.fontSize * lh).toFixed(1)}">${runs}</tspan>`;
    })
    .join('');
  const bgRect =
    l.textEffect === 'background'
      ? `<rect width="${(boxW + pad * 2).toFixed(1)}" height="${(lines.length * l.fontSize * lh + pad * 2).toFixed(1)}" rx="${(l.fontSize * 0.2).toFixed(1)}" fill="${l.effectColor ?? '#000000'}"/>`
      : '';
  return `${bgRect}<text font-family="${esc(l.fontFamily)}" font-size="${l.fontSize}" fill="${l.fill}"${weight}${style}${deco}${ls}${stroke}${shadow} dominant-baseline="text-before-edge" xml:space="preserve">${tspans}</text>`;
}

export async function exportDocToSvg(doc: Doc): Promise<string> {
  const measure = document.createElement('canvas').getContext('2d')!;
  const parts: string[] = [];

  // Fondo
  let defs = '';
  if (doc.background.type === 'solid') {
    parts.push(`<rect width="${doc.width}" height="${doc.height}" fill="${doc.background.color}"/>`);
  } else if (doc.background.type === 'gradient') {
    defs = `<defs>${svgGradientDef('bg', doc.background.gradient, doc.width, doc.height)}</defs>`;
    parts.push(`<rect width="${doc.width}" height="${doc.height}" fill="url(#bg)"/>`);
  }

  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    const op = layer.opacity !== 1 ? ` opacity="${layer.opacity}"` : '';
    if (layer.type === 'image') {
      const img = await loadImg(layer.src);
      let baked = needsProcessing(layer)
        ? processImage(img, layer).toDataURL('image/png')
        : layer.src;
      if (layer.maskShape) {
        const c = document.createElement('canvas');
        c.width = layer.naturalWidth;
        c.height = layer.naturalHeight;
        const cx = c.getContext('2d')!;
        shapePath(cx, layer.maskShape, layer.naturalWidth, layer.naturalHeight, 0);
        cx.clip();
        cx.drawImage(await loadImg(baked), 0, 0, layer.naturalWidth, layer.naturalHeight);
        baked = c.toDataURL('image/png');
      }
      parts.push(
        `<g transform="${transform(layer)}"${op}${shadowStyle(layer)}><image href="${baked}" width="${layer.naturalWidth}" height="${layer.naturalHeight}"/></g>`,
      );
    } else if (layer.type === 'shape') {
      parts.push(
        `<g transform="${transform(layer)}"${op}${shadowStyle(layer)}>${shapeSvg(layer)}</g>`,
      );
    } else if (layer.type === 'text') {
      parts.push(`<g transform="${transform(layer)}"${op}>${textSvg(layer, measure)}</g>`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">${defs}${parts.join('')}</svg>`;
}
