import type { Doc } from '../editor/core/types';
import { renderDocToCanvas } from './export';

async function pngAtSize(doc: Doc, size: number): Promise<Uint8Array> {
  // Lienzo cuadrado size×size, con el diseño ajustado y centrado (transparente).
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const ctx = out.getContext('2d')!;
  const scale = Math.min(size / doc.width, size / doc.height);
  const full = await renderDocToCanvas(doc, 1);
  const dw = doc.width * scale;
  const dh = doc.height * scale;
  ctx.drawImage(full, (size - dw) / 2, (size - dh) / 2, dw, dh);
  const blob: Blob = await new Promise((res) =>
    out.toBlob((b) => res(b!), 'image/png'),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

// Construye un .ico con entradas PNG (soportado desde Windows Vista).
export async function exportIco(doc: Doc): Promise<Blob> {
  const sizes = [16, 32, 48, 256];
  const images = await Promise.all(sizes.map((s) => pngAtSize(doc, s)));

  const count = images.length;
  const header = 6 + count * 16;
  let offset = header;
  const total = images.reduce((a, b) => a + b.length, header);
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);

  view.setUint16(0, 0, true); // reservado
  view.setUint16(2, 1, true); // tipo: icono
  view.setUint16(4, count, true);

  images.forEach((img, i) => {
    const e = 6 + i * 16;
    const size = sizes[i];
    buf[e] = size >= 256 ? 0 : size; // ancho
    buf[e + 1] = size >= 256 ? 0 : size; // alto
    buf[e + 2] = 0; // paleta
    buf[e + 3] = 0; // reservado
    view.setUint16(e + 4, 1, true); // planos
    view.setUint16(e + 6, 32, true); // bits
    view.setUint32(e + 8, img.length, true); // tamaño
    view.setUint32(e + 12, offset, true); // offset
    buf.set(img, offset);
    offset += img.length;
  });

  return new Blob([buf], { type: 'image/x-icon' });
}
