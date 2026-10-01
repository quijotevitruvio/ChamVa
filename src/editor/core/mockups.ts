// Mockups en perspectiva: marcos dibujados por código (sin imágenes) donde se coloca una captura
// y se inclina el conjunto con una proyección suave. La geometría es pura y está probada;
// `renderMockup` usa canvas (DOM).
import { warpToQuad, type Pt } from './perspective';

export type MockupFrameId = 'phone' | 'laptop' | 'monitor' | 'card';

export interface MockupRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MockupFrame {
  id: MockupFrameId;
  label: string;
  w: number; // tamaño del marco en unidades propias
  h: number;
  screen: MockupRect; // hueco donde va la imagen
  screenRadius: number;
}

export const MOCKUP_FRAMES: MockupFrame[] = [
  { id: 'phone', label: 'Teléfono', w: 440, h: 900, screen: { x: 18, y: 18, w: 404, h: 864 }, screenRadius: 48 },
  { id: 'laptop', label: 'Portátil', w: 1200, h: 690, screen: { x: 128, y: 28, w: 944, h: 590 }, screenRadius: 6 },
  { id: 'monitor', label: 'Monitor', w: 1000, h: 770, screen: { x: 22, y: 22, w: 956, h: 540 }, screenRadius: 4 },
  { id: 'card', label: 'Tarjeta / póster', w: 600, h: 800, screen: { x: 28, y: 28, w: 544, h: 744 }, screenRadius: 2 },
];

export function getMockupFrame(id: MockupFrameId): MockupFrame {
  return MOCKUP_FRAMES.find((f) => f.id === id) ?? MOCKUP_FRAMES[0];
}

// Rectángulo `cover` (o `contain`) que ocupa una imagen srcW×srcH dentro de `dst`.
export function fitRect(
  srcW: number,
  srcH: number,
  dst: MockupRect,
  mode: 'cover' | 'contain',
): MockupRect {
  const k =
    mode === 'cover'
      ? Math.max(dst.w / srcW, dst.h / srcH)
      : Math.min(dst.w / srcW, dst.h / srcH);
  const w = srcW * k;
  const h = srcH * k;
  return { x: dst.x + (dst.w - w) / 2, y: dst.y + (dst.h - h) / 2, w, h };
}

// Proyección de un rectángulo w×h girado `yawDeg` (eje vertical) y `pitchDeg` (eje horizontal)
// con perspectiva suave. Devuelve las 4 esquinas (TL, TR, BR, BL) y el tamaño del lienzo que las
// contiene (esquinas desplazadas para empezar en `pad`). Con 0° y 0° es el rectángulo original.
export function tiltQuad(
  w: number,
  h: number,
  yawDeg: number,
  pitchDeg: number,
  perspective = 2.2,
  pad = 0,
): { quad: Pt[]; width: number; height: number } {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const d = Math.max(w, h) * Math.max(0.8, perspective); // distancia de la cámara
  const corners = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  const pts = corners.map(([x, y]) => {
    // Giro alrededor de Y (yaw) y luego de X (pitch).
    const x1 = x * Math.cos(yaw);
    const z1 = -x * Math.sin(yaw);
    const y2 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
    const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
    const s = d / (d - z2); // más cerca (z>0) = más grande
    return { x: x1 * s, y: y2 * s };
  });
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxX = Math.max(...pts.map((p) => p.x));
  const maxY = Math.max(...pts.map((p) => p.y));
  return {
    quad: pts.map((p) => ({ x: p.x - minX + pad, y: p.y - minY + pad })),
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

// Dibuja el cuerpo del marco (en unidades del marco). El hueco de pantalla se recorta fuera.
function drawBody(ctx: CanvasRenderingContext2D, f: MockupFrame) {
  const S = f.screen;
  if (f.id === 'phone') {
    rr(ctx, 0, 0, f.w, f.h, 64);
    ctx.fillStyle = '#1c1c1e';
    ctx.fill();
    ctx.strokeStyle = '#48484a';
    ctx.lineWidth = 3;
    ctx.stroke();
  } else if (f.id === 'laptop') {
    // Tapa
    rr(ctx, 100, 0, 1000, 640, 28);
    ctx.fillStyle = '#2b2b2d';
    ctx.fill();
    // Base
    ctx.beginPath();
    ctx.moveTo(0, 650);
    ctx.lineTo(1200, 650);
    ctx.lineTo(1170, 690);
    ctx.lineTo(30, 690);
    ctx.closePath();
    ctx.fillStyle = '#b9bac0';
    ctx.fill();
    ctx.fillStyle = '#8e8f95';
    rr(ctx, 520, 650, 160, 12, 6);
    ctx.fill();
  } else if (f.id === 'monitor') {
    ctx.beginPath();
    ctx.moveTo(430, 600);
    ctx.lineTo(570, 600);
    ctx.lineTo(600, 742);
    ctx.lineTo(400, 742);
    ctx.closePath();
    ctx.fillStyle = '#a3a4aa';
    ctx.fill();
    rr(ctx, 300, 742, 400, 28, 10);
    ctx.fillStyle = '#85868c';
    ctx.fill();
    rr(ctx, 0, 0, 1000, 620, 24);
    ctx.fillStyle = '#1d1d1f';
    ctx.fill();
  } else {
    // Tarjeta / póster
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(0, 0, f.w, f.h);
    ctx.strokeStyle = '#c9c9c9';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, f.w - 3, f.h - 3);
  }
  // Recorta el hueco de pantalla.
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  rr(ctx, S.x, S.y, S.w, S.h, f.screenRadius);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
  // Detalles encima de la pantalla.
  if (f.id === 'phone') {
    rr(ctx, f.w / 2 - 62, 34, 124, 36, 18);
    ctx.fillStyle = '#000';
    ctx.fill();
  }
}

export interface MockupOptions {
  frame: MockupFrameId;
  yaw: number; // grados, giro alrededor del eje vertical
  pitch: number; // grados, inclinación hacia delante/atrás
  fit: 'cover' | 'contain';
  background: string | null; // null = transparente
  maxSide?: number; // lado mayor máximo de la salida (px)
}

// Compone el mockup. `source` es la imagen a colocar en la pantalla.
export function renderMockup(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  opts: MockupOptions,
): HTMLCanvasElement {
  const f = getMockupFrame(opts.frame);
  const maxSide = opts.maxSide ?? 1800;
  const S = Math.min(2, maxSide / Math.max(f.w, f.h)) || 1;
  const flat = document.createElement('canvas');
  flat.width = Math.max(1, Math.round(f.w * S));
  flat.height = Math.max(1, Math.round(f.h * S));
  const fc = flat.getContext('2d')!;
  fc.scale(S, S);
  // 1) Captura dentro del hueco
  fc.save();
  rr(fc, f.screen.x, f.screen.y, f.screen.w, f.screen.h, f.screenRadius);
  fc.clip();
  if (opts.fit === 'contain') {
    fc.fillStyle = '#000';
    fc.fillRect(f.screen.x, f.screen.y, f.screen.w, f.screen.h);
  }
  const r = fitRect(srcW, srcH, f.screen, opts.fit);
  fc.drawImage(source, r.x, r.y, r.w, r.h);
  fc.restore();
  // 2) Marco encima (con el hueco recortado)
  const body = document.createElement('canvas');
  body.width = flat.width;
  body.height = flat.height;
  const bc = body.getContext('2d')!;
  bc.scale(S, S);
  drawBody(bc, f);
  fc.setTransform(1, 0, 0, 1, 0, 0);
  fc.drawImage(body, 0, 0);

  // 3) Inclinación en perspectiva de todo el conjunto
  const out = document.createElement('canvas');
  const oc = out.getContext('2d')!;
  if (!opts.yaw && !opts.pitch) {
    out.width = flat.width;
    out.height = flat.height;
    if (opts.background) {
      oc.fillStyle = opts.background;
      oc.fillRect(0, 0, out.width, out.height);
    }
    oc.drawImage(flat, 0, 0);
    return out;
  }
  const tq = tiltQuad(flat.width, flat.height, opts.yaw, opts.pitch, 2.2, 0);
  const ow = Math.max(1, Math.ceil(tq.width));
  const oh = Math.max(1, Math.ceil(tq.height));
  out.width = ow;
  out.height = oh;
  const warped = warpToQuad(fc.getImageData(0, 0, flat.width, flat.height), tq.quad, ow, oh);
  if (opts.background) {
    oc.fillStyle = opts.background;
    oc.fillRect(0, 0, ow, oh);
  }
  if (warped) {
    const tmp = document.createElement('canvas');
    tmp.width = ow;
    tmp.height = oh;
    tmp.getContext('2d')!.putImageData(new ImageData(warped.data as Uint8ClampedArray<ArrayBuffer>, ow, oh), 0, 0);
    oc.drawImage(tmp, 0, 0);
  }
  return out;
}
