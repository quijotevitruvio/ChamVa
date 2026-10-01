// Variantes automáticas de un logo: monocromo negro, monocromo blanco y versión
// invertida sobre fondo. La parte de píxeles es pura (trabaja sobre un objeto
// con forma de ImageData); la de canvas va aparte, al final.
import type { UploadedImage } from './types';

export interface RgbaBuf {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const BLACK: Rgb = { r: 0, g: 0, b: 0 };
export const WHITE: Rgb = { r: 255, g: 255, b: 255 };

// Sustituye el color de todos los píxeles por `rgb` conservando el alfa.
export function recolorMono(buf: RgbaBuf, rgb: Rgb): RgbaBuf {
  const out = new Uint8ClampedArray(buf.data.length);
  for (let i = 0; i < buf.data.length; i += 4) {
    out[i] = rgb.r;
    out[i + 1] = rgb.g;
    out[i + 2] = rgb.b;
    out[i + 3] = buf.data[i + 3];
  }
  return { data: out, width: buf.width, height: buf.height };
}

// Coloca la imagen sobre un fondo liso con un margen `pad` alrededor
// (composición «source-over» del logo sobre el color).
export function flattenOnColor(buf: RgbaBuf, bg: Rgb, pad: number): RgbaBuf {
  const w = buf.width + pad * 2;
  const h = buf.height + pad * 2;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = bg.r;
    out[i + 1] = bg.g;
    out[i + 2] = bg.b;
    out[i + 3] = 255;
  }
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const s = (y * buf.width + x) * 4;
      const d = ((y + pad) * w + (x + pad)) * 4;
      const a = buf.data[s + 3] / 255;
      out[d] = Math.round(buf.data[s] * a + out[d] * (1 - a));
      out[d + 1] = Math.round(buf.data[s + 1] * a + out[d + 1] * (1 - a));
      out[d + 2] = Math.round(buf.data[s + 2] * a + out[d + 2] * (1 - a));
    }
  }
  return { data: out, width: w, height: h };
}

export type VariantKind = 'negro' | 'blanco' | 'invertida';

export const VARIANT_LABELS: Record<VariantKind, string> = {
  negro: 'monocromo negro',
  blanco: 'monocromo blanco',
  invertida: 'sobre fondo oscuro',
};

// Nombre con sufijo: «logo» + negro → «logo (negro)». Quita la extensión.
export function variantName(name: string, kind: VariantKind): string {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/ \((negro|blanco|invertida)\)$/, '');
  return `${base} (${kind})`;
}

// Variante en píxeles según el tipo.
export function applyVariant(buf: RgbaBuf, kind: VariantKind): RgbaBuf {
  if (kind === 'negro') return recolorMono(buf, BLACK);
  if (kind === 'blanco') return recolorMono(buf, WHITE);
  const pad = Math.max(1, Math.round(Math.max(buf.width, buf.height) * 0.12));
  return flattenOnColor(recolorMono(buf, WHITE), { r: 23, g: 23, b: 23 }, pad);
}

// ---- Canvas (navegador) ----

const MAX_SIDE = 1024;

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar el logo'));
    img.src = src;
  });
}

// Genera las tres variantes de un logo como imágenes nuevas para el kit.
export async function makeLogoVariants(
  logo: UploadedImage,
  newId: () => string,
): Promise<UploadedImage[]> {
  const img = await loadImg(logo.src);
  const nw = img.naturalWidth || logo.naturalWidth;
  const nh = img.naturalHeight || logo.naturalHeight;
  const k = Math.min(1, MAX_SIDE / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * k));
  const h = Math.max(1, Math.round(nh * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Sin canvas 2D');
  ctx.drawImage(img, 0, 0, w, h);
  const src = ctx.getImageData(0, 0, w, h);
  const out: UploadedImage[] = [];
  for (const kind of ['negro', 'blanco', 'invertida'] as VariantKind[]) {
    const r = applyVariant({ data: src.data, width: w, height: h }, kind);
    const oc = document.createElement('canvas');
    oc.width = r.width;
    oc.height = r.height;
    const octx = oc.getContext('2d');
    if (!octx) continue;
    octx.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
    out.push({
      id: newId(),
      src: oc.toDataURL('image/png'),
      naturalWidth: r.width,
      naturalHeight: r.height,
      name: variantName(logo.name, kind),
    });
  }
  return out;
}
