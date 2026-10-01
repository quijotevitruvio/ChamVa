// Marca de agua de la exportación: texto o imagen, en 9 posiciones o en mosaico.
// Se aplica SOLO al archivo exportado (nunca al diseño). La geometría es pura
// para poder probarla; el dibujo usa Canvas 2D y, en SVG, elementos <text>/<image>.

export type WmPos = 'tl' | 'tc' | 'tr' | 'ml' | 'c' | 'mr' | 'bl' | 'bc' | 'br' | 'tile';

export interface WatermarkCfg {
  enabled: boolean;
  kind: 'text' | 'image';
  text: string;
  color: string; // color del texto
  imageSrc?: string; // dataURL (reducida) de la imagen elegida
  imageW?: number; // tamaño natural de la imagen
  imageH?: number;
  position: WmPos;
  size: number; // ancho de la marca en % del ancho de la imagen exportada (3-80)
  opacity: number; // 0.05-1
  margin: number; // distancia al borde en % del lado menor (0-25)
}

export const DEFAULT_WATERMARK: WatermarkCfg = {
  enabled: false,
  kind: 'text',
  text: '© Mi nombre',
  color: '#ffffff',
  position: 'br',
  size: 22,
  opacity: 0.6,
  margin: 3,
};

export const WM_POSITIONS: { id: WmPos; label: string }[] = [
  { id: 'tl', label: 'Arriba izquierda' },
  { id: 'tc', label: 'Arriba centro' },
  { id: 'tr', label: 'Arriba derecha' },
  { id: 'ml', label: 'Centro izquierda' },
  { id: 'c', label: 'Centro' },
  { id: 'mr', label: 'Centro derecha' },
  { id: 'bl', label: 'Abajo izquierda' },
  { id: 'bc', label: 'Abajo centro' },
  { id: 'br', label: 'Abajo derecha' },
];

const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ¿Hay algo que dibujar?
export function watermarkActive(c: WatermarkCfg | undefined | null): c is WatermarkCfg {
  if (!c || !c.enabled) return false;
  return c.kind === 'text' ? !!c.text.trim() : !!c.imageSrc && !!c.imageW && !!c.imageH;
}

export interface MarkBox {
  w: number;
  h: number;
  fontSize: number; // solo texto
}

// Tamaño de la marca para un lienzo de ancho `cw`. `textWidth100` = ancho del
// texto a 100 px de cuerpo (medido por el llamador).
export function markBox(cw: number, cfg: WatermarkCfg, textWidth100: number): MarkBox {
  const w = Math.max(4, (cw * clampN(cfg.size, 3, 80)) / 100);
  if (cfg.kind === 'image' && cfg.imageW && cfg.imageH) {
    return { w, h: (w * cfg.imageH) / cfg.imageW, fontSize: 0 };
  }
  const fontSize = (w / Math.max(1, textWidth100)) * 100;
  return { w, h: fontSize * 1.2, fontSize };
}

export interface Placements {
  // Las posiciones son esquinas superior izquierda de cada marca, relativas a
  // (cx, cy) y giradas `angle` grados alrededor de ese punto.
  cx: number;
  cy: number;
  angle: number;
  items: { x: number; y: number }[];
}

export function watermarkPlacements(cw: number, ch: number, box: { w: number; h: number }, cfg: WatermarkCfg): Placements {
  if (cfg.position === 'tile') {
    // Mosaico girado -30° que cubre el lienzo entero (se rellena la diagonal).
    const D = Math.hypot(cw, ch);
    const stepX = box.w * 1.7;
    const stepY = box.h * 3.2;
    const items: { x: number; y: number }[] = [];
    let row = 0;
    for (let y = -D / 2; y < D / 2; y += stepY, row++) {
      const off = row % 2 ? stepX / 2 : 0;
      for (let x = -D / 2 - off; x < D / 2; x += stepX) items.push({ x, y });
    }
    return { cx: cw / 2, cy: ch / 2, angle: -30, items };
  }
  const m = (clampN(cfg.margin, 0, 25) / 100) * Math.min(cw, ch);
  const p = cfg.position;
  const col = p[1] === 'l' || p === 'tl' || p === 'bl' ? 'l' : p === 'tr' || p === 'br' || p === 'mr' ? 'r' : 'c';
  const row = p === 'tl' || p === 'tc' || p === 'tr' ? 't' : p === 'bl' || p === 'bc' || p === 'br' ? 'b' : 'm';
  const x = col === 'l' ? m : col === 'r' ? cw - box.w - m : (cw - box.w) / 2;
  const y = row === 't' ? m : row === 'b' ? ch - box.h - m : (ch - box.h) / 2;
  return { cx: 0, cy: 0, angle: 0, items: [{ x, y }] };
}

const FONT = 'bold {px}px Inter, "Segoe UI", system-ui, sans-serif';
const fontFor = (px: number) => FONT.replace('{px}', String(Math.max(1, Math.round(px * 100) / 100)));

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen de la marca de agua'));
    img.src = src;
  });
}

// Dibuja la marca sobre un canvas ya renderizado (modifica el canvas).
export async function applyWatermark(canvas: HTMLCanvasElement, cfg: WatermarkCfg): Promise<void> {
  if (!watermarkActive(cfg)) return;
  const ctx = canvas.getContext('2d')!;
  let img: HTMLImageElement | null = null;
  let tw100 = 100;
  if (cfg.kind === 'image') img = await loadImg(cfg.imageSrc!);
  else {
    ctx.save();
    ctx.font = fontFor(100);
    tw100 = ctx.measureText(cfg.text).width;
    ctx.restore();
  }
  const box = markBox(canvas.width, cfg, tw100);
  const pl = watermarkPlacements(canvas.width, canvas.height, box, cfg);
  ctx.save();
  ctx.globalAlpha = clampN(cfg.opacity, 0.05, 1);
  ctx.globalCompositeOperation = 'source-over';
  ctx.translate(pl.cx, pl.cy);
  ctx.rotate((pl.angle * Math.PI) / 180);
  if (img) {
    for (const it of pl.items) ctx.drawImage(img, it.x, it.y, box.w, box.h);
  } else {
    ctx.font = fontFor(box.fontSize);
    ctx.fillStyle = cfg.color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const it of pl.items) ctx.fillText(cfg.text, it.x, it.y + box.h / 2);
  }
  ctx.restore();
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Marca de agua como fragmento SVG para insertar antes de `</svg>`.
export function watermarkSvg(w: number, h: number, cfg: WatermarkCfg): string {
  if (!watermarkActive(cfg)) return '';
  let tw100 = 100;
  if (cfg.kind === 'text') {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = fontFor(100);
    tw100 = ctx.measureText(cfg.text).width;
  }
  const box = markBox(w, cfg, tw100);
  const pl = watermarkPlacements(w, h, box, cfg);
  const op = clampN(cfg.opacity, 0.05, 1);
  const items = pl.items
    .map((it) =>
      cfg.kind === 'image'
        ? `<image href="${cfg.imageSrc}" x="${it.x.toFixed(1)}" y="${it.y.toFixed(1)}" width="${box.w.toFixed(1)}" height="${box.h.toFixed(1)}"/>`
        : `<text x="${it.x.toFixed(1)}" y="${(it.y + box.h / 2).toFixed(1)}" font-family="Inter, 'Segoe UI', system-ui, sans-serif" font-weight="bold" font-size="${box.fontSize.toFixed(2)}" fill="${esc(cfg.color)}" dominant-baseline="central">${esc(cfg.text)}</text>`,
    )
    .join('');
  const tr = pl.angle ? ` transform="translate(${pl.cx} ${pl.cy}) rotate(${pl.angle})"` : '';
  return `<g opacity="${op}"${tr}>${items}</g>`;
}

// Reduce la imagen elegida para la marca (máx. 512 px) y la devuelve como dataURL PNG.
export async function prepareWatermarkImage(
  src: string,
): Promise<{ src: string; w: number; h: number }> {
  const img = await loadImg(src);
  const k = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return { src: c.toDataURL('image/png'), w, h };
}
