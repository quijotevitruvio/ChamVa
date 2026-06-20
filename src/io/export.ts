import { gradientPoints, type Doc } from '../editor/core/types';
import { needsProcessing, processImage } from '../editor/core/imageProcessing';
import { isStrokeOnly, shapePath } from '../editor/core/shapes';
import { layerAnimAt } from '../editor/core/animations';
import { drawCurvedText, measureCurved } from '../editor/core/curvedText';
import { drawStyledText } from '../editor/core/styledText';

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'avif';

const MIME: Record<ExportFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
};

const EXT: Record<ExportFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  avif: 'avif',
};

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

// Renderiza el documento a un canvas a resolución completa (× scale).
// `backing` rellena el fondo (para formatos sin alfa como JPG).
export async function renderDocToCanvas(
  doc: Doc,
  scale = 1,
  backing?: string,
  animTime?: number,
  animTotal = 1,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(doc.width * scale));
  canvas.height = Math.max(1, Math.round(doc.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  if (backing) {
    ctx.fillStyle = backing;
    ctx.fillRect(0, 0, doc.width, doc.height);
  }
  if (doc.background.type === 'solid') {
    ctx.fillStyle = doc.background.color;
    ctx.fillRect(0, 0, doc.width, doc.height);
  } else if (doc.background.type === 'gradient') {
    const g = doc.background.gradient;
    const p = gradientPoints(g.angle, doc.width, doc.height);
    const grad = ctx.createLinearGradient(p.x0, p.y0, p.x1, p.y1);
    for (const s of g.stops) grad.addColorStop(s.offset, s.color);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, doc.width, doc.height);
  }

  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    const a =
      animTime === undefined
        ? { dx: 0, dy: 0, scale: 1, opacity: 1 }
        : layerAnimAt(layer, animTime, animTotal);
    if (layer.type === 'image') {
      const img = await loadImg(layer.src);
      // Filtros/volteo horneados a resolución completa (idéntico al editor).
      const source = needsProcessing(layer) ? processImage(img, layer) : img;
      ctx.save();
      ctx.globalAlpha = layer.opacity * a.opacity;
      if (layer.blendMode !== 'normal') {
        ctx.globalCompositeOperation =
          layer.blendMode as GlobalCompositeOperation;
      }
      ctx.translate(layer.x + a.dx * doc.width, layer.y + a.dy * doc.height);
      ctx.rotate((layer.rotation * Math.PI) / 180);
      ctx.scale(layer.scaleX * a.scale, layer.scaleY * a.scale);
      if (layer.shadow) {
        ctx.shadowColor = layer.shadowColor;
        ctx.shadowBlur = layer.shadowBlur;
        ctx.shadowOffsetX = layer.shadowX;
        ctx.shadowOffsetY = layer.shadowY;
      }
      if (layer.maskShape) {
        ctx.save();
        shapePath(ctx, layer.maskShape, layer.naturalWidth, layer.naturalHeight, 0);
        ctx.clip();
        ctx.drawImage(source, 0, 0, layer.naturalWidth, layer.naturalHeight);
        ctx.restore();
      } else {
        ctx.drawImage(source, 0, 0, layer.naturalWidth, layer.naturalHeight);
      }
      ctx.restore();
    } else if (layer.type === 'text') {
      ctx.save();
      ctx.globalAlpha = layer.opacity * a.opacity;
      if (layer.blendMode !== 'normal') {
        ctx.globalCompositeOperation =
          layer.blendMode as GlobalCompositeOperation;
      }
      ctx.translate(layer.x + a.dx * doc.width, layer.y + a.dy * doc.height);
      ctx.rotate((layer.rotation * Math.PI) / 180);
      ctx.scale(layer.scaleX * a.scale, layer.scaleY * a.scale);
      if (layer.curve && layer.curve !== 0) {
        drawCurvedText(ctx, layer, measureCurved(ctx, layer).width);
        ctx.restore();
        continue;
      }
      drawStyledText(ctx, layer);
      ctx.restore();
    } else if (layer.type === 'shape') {
      ctx.save();
      ctx.globalAlpha = layer.opacity * a.opacity;
      if (layer.blendMode !== 'normal') {
        ctx.globalCompositeOperation =
          layer.blendMode as GlobalCompositeOperation;
      }
      ctx.translate(layer.x + a.dx * doc.width, layer.y + a.dy * doc.height);
      ctx.rotate((layer.rotation * Math.PI) / 180);
      ctx.scale(layer.scaleX * a.scale, layer.scaleY * a.scale);
      if (layer.shadow) {
        ctx.shadowColor = layer.shadowColor;
        ctx.shadowBlur = layer.shadowBlur;
        ctx.shadowOffsetX = layer.shadowX;
        ctx.shadowOffsetY = layer.shadowY;
      }
      shapePath(ctx, layer.shape, layer.width, layer.height, layer.cornerRadius);
      if (!isStrokeOnly(layer.shape)) {
        ctx.fillStyle = layer.fill;
        ctx.fill();
      }
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      if (layer.strokeWidth > 0 || isStrokeOnly(layer.shape)) {
        ctx.strokeStyle = layer.stroke;
        ctx.lineWidth = isStrokeOnly(layer.shape)
          ? Math.max(2, layer.strokeWidth)
          : layer.strokeWidth;
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  return canvas;
}

export interface ExportOptions {
  format: ExportFormat;
  quality?: number; // 0..1 (jpeg/webp)
  scale?: number; // 1, 2, 3...
}

export async function exportDoc(
  doc: Doc,
  { format, quality = 0.92, scale = 1 }: ExportOptions,
): Promise<Blob> {
  // JPG no tiene transparencia: si el lienzo es transparente, fondo blanco.
  const backing =
    format === 'jpeg' && doc.background.type === 'transparent'
      ? '#ffffff'
      : undefined;
  const canvas = await renderDocToCanvas(doc, scale, backing);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob falló'))),
      MIME[format],
      quality,
    );
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function suggestFilename(doc: Doc, format: ExportFormat): string {
  const base = (doc.name || 'chamva').replace(/[^\w\-]+/g, '_');
  return `${base}.${EXT[format]}`;
}
