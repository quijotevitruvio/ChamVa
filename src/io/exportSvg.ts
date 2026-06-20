import {
  canvasFont,
  gradientPoints,
  transformText,
  type Doc,
  type ShapeLayer,
  type TextLayer,
} from '../editor/core/types';
import { needsProcessing, processImage } from '../editor/core/imageProcessing';
import { isStrokeOnly } from '../editor/core/shapes';

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

function shapeSvg(l: ShapeLayer): string {
  const fill = isStrokeOnly(l.shape) ? 'none' : l.fill;
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
  }
}

function textSvg(l: TextLayer, measure: CanvasRenderingContext2D): string {
  measure.font = canvasFont(l);
  (measure as any).letterSpacing = `${l.letterSpacing || 0}px`;
  const lines = transformText(l.text, l.textTransform).split('\n');
  const widths = lines.map((line) => measure.measureText(line).width);
  const boxW = Math.max(0, ...widths);
  const weight = l.bold ? ' font-weight="bold"' : '';
  const style = l.italic ? ' font-style="italic"' : '';
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
      let lx = 0;
      if (l.align === 'center') lx = (boxW - widths[i]) / 2;
      else if (l.align === 'right') lx = boxW - widths[i];
      return `<tspan x="${lx.toFixed(1)}" y="${(i * l.fontSize).toFixed(1)}">${esc(line)}</tspan>`;
    })
    .join('');
  return `<text font-family="${esc(l.fontFamily)}" font-size="${l.fontSize}" fill="${l.fill}"${weight}${style}${ls}${stroke}${shadow} dominant-baseline="text-before-edge">${tspans}</text>`;
}

export async function exportDocToSvg(doc: Doc): Promise<string> {
  const measure = document.createElement('canvas').getContext('2d')!;
  const parts: string[] = [];

  // Fondo
  let defs = '';
  if (doc.background.type === 'solid') {
    parts.push(`<rect width="${doc.width}" height="${doc.height}" fill="${doc.background.color}"/>`);
  } else if (doc.background.type === 'gradient') {
    const g = doc.background.gradient;
    const p = gradientPoints(g.angle, doc.width, doc.height);
    const stops = g.stops
      .map((s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`)
      .join('');
    defs = `<defs><linearGradient id="bg" gradientUnits="userSpaceOnUse" x1="${p.x0}" y1="${p.y0}" x2="${p.x1}" y2="${p.y1}">${stops}</linearGradient></defs>`;
    parts.push(`<rect width="${doc.width}" height="${doc.height}" fill="url(#bg)"/>`);
  }

  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    const op = layer.opacity !== 1 ? ` opacity="${layer.opacity}"` : '';
    if (layer.type === 'image') {
      const img = await loadImg(layer.src);
      const baked = needsProcessing(layer)
        ? processImage(img, layer).toDataURL('image/png')
        : layer.src;
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
