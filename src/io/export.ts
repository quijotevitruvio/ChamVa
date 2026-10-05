import type { Doc } from '../editor/core/types';
import { canvasGradient } from '../editor/core/gradients';
import { fillPatternBackground } from '../editor/core/patterns';
import { fillDither, fillGrain, grainActive } from '../editor/core/grain';
import { needsProcessing, processImageAsync } from '../editor/core/imageProcessing';
import { applyRetouch } from '../editor/core/retouchRender';
import { flushRetouch } from '../editor/core/retouchLive';
import { drawGroundFx, hasGroundFx } from '../editor/core/groundFx';
import { preloadFxImages } from '../editor/core/imageEffects';
import { drawStroke } from '../editor/core/brush';
import { isStrokeOnly, shapePath } from '../editor/core/shapes';
import { layerAnimAt } from '../editor/core/animations';
import { drawCurvedText, measureCurved } from '../editor/core/curvedText';
import { drawStyledText } from '../editor/core/styledText';
import { hasPathText, preloadTextFxImages } from '../editor/core/textFx';
import { fieldsForDoc } from '../editor/core/textMacros';
import { pagesForFields } from './docFields';
import { blendOp } from '../editor/core/blend';
import { isTauri, saveNative } from './nativeSave';
import { toast } from '../ui/toast';
import { withRegisteredMaster } from '../editor/core/master';
import { embedDpiInBlob, fileDpi } from './imageDpi';
import { contentBounds, drawImageBody, drawMaskedLayer, drawShapeBody, drawStrokeBody, drawTextBody, layerHasMask, prepareMask } from '../editor/core/maskRender';

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
  await flushRetouch(); // el último trazo de retoque ya está en el documento
  doc = withRegisteredMaster(doc); // capas de la página maestra detrás (solo lectura)
  const textFields = fieldsForDoc(doc, await pagesForFields());
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
    ctx.fillStyle = canvasGradient(ctx, doc.background.gradient, doc.width, doc.height);
    ctx.fillRect(0, 0, doc.width, doc.height);
    if (doc.background.gradient.dither) fillDither(ctx, doc.width, doc.height, scale);
  } else if (doc.background.type === 'pattern') {
    fillPatternBackground(ctx, doc.background.pattern, doc.width, doc.height, scale);
  }
  if (doc.background.type !== 'transparent' && grainActive(doc.background.grain)) {
    fillGrain(ctx, doc.background.grain, doc.width, doc.height, scale);
  }

  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    const a =
      animTime === undefined
        ? { dx: 0, dy: 0, scale: 1, opacity: 1 }
        : layerAnimAt(layer, animTime, animTotal);
    // Capa con máscara: el MISMO dibujo que el lienzo (maskRender.ts). Sin máscara, como siempre.
    if (layer.mask && layerHasMask(layer)) {
      await prepareMask(layer.mask);
      let source: CanvasImageSource | null = null;
      if (layer.type === 'image') {
        const img = await applyRetouch(await loadImg(layer.src), layer);
        await preloadFxImages(layer.adjust);
        source = needsProcessing(layer)
          ? await processImageAsync(img, layer, Infinity, { priority: 1, label: 'Exportando imagen' })
          : img;
      } else if (layer.type === 'text') await preloadTextFxImages(layer);
      ctx.save();
      ctx.globalAlpha = layer.opacity * a.opacity;
      ctx.globalCompositeOperation = blendOp(layer.blendMode);
      ctx.translate(layer.x + a.dx * doc.width, layer.y + a.dy * doc.height);
      ctx.rotate((layer.rotation * Math.PI) / 180);
      ctx.scale(layer.scaleX * a.scale, layer.scaleY * a.scale);
      if (layer.type === 'image' && source && hasGroundFx(layer)) {
        drawGroundFx(ctx, source, layer.naturalWidth, layer.naturalHeight, layer.maskShape, layer);
      }
      const L = layer;
      drawMaskedLayer(ctx, {
        mask: layer.mask,
        bounds: contentBounds(layer, textFields),
        maxSide: 16384,
        shadow: L.type === 'image' || L.type === 'shape' ? L : undefined,
        flipSign: { x: Math.sign(layer.scaleX) || 1, y: Math.sign(layer.scaleY) || 1 },
        body: (c) => {
          if (L.type === 'image' && source) drawImageBody(c, source, L.naturalWidth, L.naturalHeight, L.maskShape);
          else if (L.type === 'shape') drawShapeBody(c, L, scale);
          else if (L.type === 'text') drawTextBody(c, L, textFields);
          else if (L.type === 'stroke') drawStrokeBody(c, L);
        },
      });
      ctx.restore();
      continue;
    }
    if (layer.type === 'image') {
      const img = await applyRetouch(await loadImg(layer.src), layer);
      await preloadFxImages(layer.adjust); // doble exposición: imagen lista antes de hornear
      // Filtros/volteo horneados a resolución completa (idéntico al editor).
      // Píxeles en worker (cola, progreso, cancelación); espera el resultado completo a resolución final.
      const source = needsProcessing(layer)
        ? await processImageAsync(img, layer, Infinity, { priority: 1, label: 'Exportando imagen' })
        : img;
      ctx.save();
      ctx.globalAlpha = layer.opacity * a.opacity;
      ctx.globalCompositeOperation = blendOp(layer.blendMode);
      ctx.translate(layer.x + a.dx * doc.width, layer.y + a.dy * doc.height);
      ctx.rotate((layer.rotation * Math.PI) / 180);
      ctx.scale(layer.scaleX * a.scale, layer.scaleY * a.scale);
      // Reflejo en suelo y sombra proyectada (bajo la imagen).
      if (hasGroundFx(layer)) {
        drawGroundFx(ctx, source, layer.naturalWidth, layer.naturalHeight, layer.maskShape, layer);
      }
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
      ctx.globalCompositeOperation = blendOp(layer.blendMode);
      ctx.translate(layer.x + a.dx * doc.width, layer.y + a.dy * doc.height);
      ctx.rotate((layer.rotation * Math.PI) / 180);
      ctx.scale(layer.scaleX * a.scale, layer.scaleY * a.scale);
      await preloadTextFxImages(layer); // relleno de texto con imagen: lista antes de dibujar
      if ((layer.curve && layer.curve !== 0) || hasPathText(layer)) {
        const cm = measureCurved(ctx, layer);
        drawCurvedText(ctx, layer, cm.width, cm.height);
        ctx.restore();
        continue;
      }
      drawStyledText(ctx, layer, textFields);
      ctx.restore();
    } else if (layer.type === 'stroke') {
      ctx.save();
      ctx.globalAlpha = layer.opacity * a.opacity;
      ctx.globalCompositeOperation = blendOp(layer.blendMode);
      ctx.translate(layer.x + a.dx * doc.width, layer.y + a.dy * doc.height);
      ctx.rotate((layer.rotation * Math.PI) / 180);
      ctx.scale(layer.scaleX * a.scale, layer.scaleY * a.scale);
      drawStroke(ctx, layer);
      ctx.restore();
    } else if (layer.type === 'shape') {
      ctx.save();
      ctx.globalAlpha = layer.opacity * a.opacity;
      ctx.globalCompositeOperation = blendOp(layer.blendMode);
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
        ctx.fillStyle = layer.fillGradient
          ? canvasGradient(ctx, layer.fillGradient, layer.width, layer.height)
          : layer.fill;
        ctx.fill();
      }
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      if (layer.fillGradient?.dither && !isStrokeOnly(layer.shape)) {
        ctx.save();
        ctx.clip();
        fillDither(ctx, layer.width, layer.height, scale);
        ctx.restore();
      }
      if (layer.strokeWidth > 0 || isStrokeOnly(layer.shape)) {
        ctx.strokeStyle = layer.strokeGradient
          ? canvasGradient(ctx, layer.strokeGradient, layer.width, layer.height)
          : layer.stroke;
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
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob falló'))),
      MIME[format],
      quality,
    );
  });
  // DPI del documento dentro del archivo (PNG/JPG); WebP/AVIF se devuelven tal cual.
  return embedDpiInBlob(blob, fileDpi(doc.dpi, scale));
}

function downloadViaAnchor(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Descarga/guarda un archivo. En la app instalada usa el guardado nativo
// (Guardar como… / carpeta Descargas); en el navegador, <a download>.
export async function downloadBlob(blob: Blob, filename: string) {
  if (isTauri()) {
    try {
      const res = await saveNative(blob, filename);
      if (res.status === 'saved') toast(`Guardado: ${res.path}`, 'success');
      return;
    } catch (e) {
      console.warn('Guardado nativo falló, usando descarga web', e);
    }
  }
  downloadViaAnchor(blob, filename);
}

export function suggestFilename(doc: Doc, format: ExportFormat): string {
  const base = (doc.name || 'chamva').replace(/[^\w\-]+/g, '_');
  return `${base}.${EXT[format]}`;
}
