// Imágenes sintéticas de los marcadores de las plantillas (con DOM): un degradado con un rótulo grande. Se generan al aplicar
// la plantilla y se guardan como cualquier otro medio del proyecto; nada se descarga.
import type { Placeholder, VideoTemplate } from './templates';

export function makePlaceholderBlob(h: Placeholder): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = h.w;
  c.height = h.h;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, h.w, h.h);
  g.addColorStop(0, h.c1);
  g.addColorStop(1, h.c2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, h.w, h.h);
  // trama suave para que se note que es un marcador
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = Math.max(2, h.w / 400);
  const step = Math.max(40, Math.round(Math.min(h.w, h.h) / 8));
  for (let x = -h.h; x < h.w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, h.h);
    ctx.lineTo(x + h.h, 0);
    ctx.stroke();
  }
  const short = Math.min(h.w, h.h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `bold ${Math.round(short * 0.1)}px sans-serif`;
  ctx.fillText(h.label, h.w / 2, h.h * 0.5, h.w * 0.9);
  ctx.font = `${Math.round(short * 0.04)}px sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('Marcador: reemplázalo por tu medio', h.w / 2, h.h * 0.5 + short * 0.1, h.w * 0.9);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo crear la imagen del marcador.'))), 'image/png'));
}

export async function makePlaceholderBlobs(t: VideoTemplate): Promise<Record<string, Blob>> {
  const out: Record<string, Blob> = {};
  for (const h of t.placeholders) out[h.id] = await makePlaceholderBlob(h);
  return out;
}
