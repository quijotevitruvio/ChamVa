import type { ShapeKind } from './types';

// Las formas que solo se dibujan con trazo (sin relleno).
export function isStrokeOnly(kind: ShapeKind): boolean {
  return kind === 'line' || kind === 'arrow';
}

// Construye el contorno de la forma dentro de la caja (0,0,w,h).
// Funciona tanto con Konva.Context como con CanvasRenderingContext2D.
export function shapePath(
  ctx: any,
  kind: ShapeKind,
  w: number,
  h: number,
  cornerRadius = 0,
) {
  ctx.beginPath();
  switch (kind) {
    case 'rect': {
      const r = Math.max(0, Math.min(cornerRadius, w / 2, h / 2));
      if (r <= 0) {
        ctx.rect(0, 0, w, h);
      } else {
        ctx.moveTo(r, 0);
        ctx.lineTo(w - r, 0);
        ctx.quadraticCurveTo(w, 0, w, r);
        ctx.lineTo(w, h - r);
        ctx.quadraticCurveTo(w, h, w - r, h);
        ctx.lineTo(r, h);
        ctx.quadraticCurveTo(0, h, 0, h - r);
        ctx.lineTo(0, r);
        ctx.quadraticCurveTo(0, 0, r, 0);
        ctx.closePath();
      }
      break;
    }
    case 'ellipse': {
      const k = 0.5522847498;
      const ox = (w / 2) * k;
      const oy = (h / 2) * k;
      const xe = w;
      const ye = h;
      const xm = w / 2;
      const ym = h / 2;
      ctx.moveTo(0, ym);
      ctx.bezierCurveTo(0, ym - oy, xm - ox, 0, xm, 0);
      ctx.bezierCurveTo(xm + ox, 0, xe, ym - oy, xe, ym);
      ctx.bezierCurveTo(xe, ym + oy, xm + ox, ye, xm, ye);
      ctx.bezierCurveTo(xm - ox, ye, 0, ym + oy, 0, ym);
      ctx.closePath();
      break;
    }
    case 'triangle': {
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      break;
    }
    case 'star': {
      const cx = w / 2;
      const cy = h / 2;
      const outer = Math.min(w, h) / 2;
      const inner = outer * 0.45;
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const px = cx + r * Math.cos(a);
        const py = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'line': {
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      break;
    }
    case 'arrow': {
      const head = Math.min(h, w * 0.4);
      const my = h / 2;
      ctx.moveTo(0, my);
      ctx.lineTo(w - head, my);
      ctx.moveTo(w - head, my - head / 2);
      ctx.lineTo(w, my);
      ctx.lineTo(w - head, my + head / 2);
      break;
    }
    default:
      tracePolygonal(ctx, kind, w, h, cornerRadius);
  }
}

const K = 0.5522847498; // constante de Bézier para cuartos de elipse

// Polígono regular de n lados ajustado (y estirado) a la caja w×h.
function regularPoly(n: number, w: number, h: number, offsetDeg = 0, innerRatio = 1): [number, number][] {
  const total = innerRatio === 1 ? n : n * 2;
  const pts: [number, number][] = [];
  for (let i = 0; i < total; i++) {
    const r = innerRatio !== 1 && i % 2 === 1 ? innerRatio : 1;
    const a = ((offsetDeg - 90) * Math.PI) / 180 + (2 * Math.PI * i) / total;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return pts.map(([x, y]) => [
    ((x - minX) / (maxX - minX)) * w,
    ((y - minY) / (maxY - minY)) * h,
  ]);
}

function poly(ctx: any, pts: [number, number][]) {
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

// Elipse con 4 curvas de Bézier; ccw=true la recorre al revés (para agujeros con relleno nonzero).
function ellipsePath(ctx: any, cx: number, cy: number, rx: number, ry: number, ccw: boolean) {
  const ox = rx * K;
  const oy = ry * K;
  if (!ccw) {
    ctx.moveTo(cx - rx, cy);
    ctx.bezierCurveTo(cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry);
    ctx.bezierCurveTo(cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy);
    ctx.bezierCurveTo(cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry);
    ctx.bezierCurveTo(cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy);
  } else {
    ctx.moveTo(cx - rx, cy);
    ctx.bezierCurveTo(cx - rx, cy + oy, cx - ox, cy + ry, cx, cy + ry);
    ctx.bezierCurveTo(cx + ox, cy + ry, cx + rx, cy + oy, cx + rx, cy);
    ctx.bezierCurveTo(cx + rx, cy - oy, cx + ox, cy - ry, cx, cy - ry);
    ctx.bezierCurveTo(cx - ox, cy - ry, cx - rx, cy - oy, cx - rx, cy);
  }
  ctx.closePath();
}

// Formas añadidas en v0.4 (todas rellenables y estirables con w/h).
function tracePolygonal(ctx: any, kind: ShapeKind, w: number, h: number, cornerRadius: number) {
  switch (kind) {
    case 'pentagon':
      poly(ctx, regularPoly(5, w, h));
      break;
    case 'hexagon':
      poly(ctx, regularPoly(6, w, h));
      break;
    case 'octagon':
      poly(ctx, regularPoly(8, w, h, 22.5));
      break;
    case 'star6':
      poly(ctx, regularPoly(6, w, h, 0, 0.55));
      break;
    case 'diamond':
      poly(ctx, [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
      break;
    case 'cross': {
      const x1 = w * 0.33;
      const x2 = w * 0.67;
      const y1 = h * 0.33;
      const y2 = h * 0.67;
      poly(ctx, [[x1, 0], [x2, 0], [x2, y1], [w, y1], [w, y2], [x2, y2], [x2, h], [x1, h], [x1, y2], [0, y2], [0, y1], [x1, y1]]);
      break;
    }
    case 'doubleArrow': {
      const hl = Math.min(w * 0.3, h * 0.5);
      const t = h * 0.3;
      const b = h * 0.7;
      poly(ctx, [[0, h / 2], [hl, 0], [hl, t], [w - hl, t], [w - hl, 0], [w, h / 2], [w - hl, h], [w - hl, b], [hl, b], [hl, h]]);
      break;
    }
    case 'blockArrow': {
      const hl = Math.min(w * 0.4, h * 0.6);
      const t = h * 0.3;
      const b = h * 0.7;
      poly(ctx, [[0, t], [w - hl, t], [w - hl, 0], [w, h / 2], [w - hl, h], [w - hl, b], [0, b]]);
      break;
    }
    case 'trapezoid':
      poly(ctx, [[w * 0.2, 0], [w * 0.8, 0], [w, h], [0, h]]);
      break;
    case 'parallelogram':
      poly(ctx, [[w * 0.25, 0], [w, 0], [w * 0.75, h], [0, h]]);
      break;
    case 'semicircle':
      ctx.moveTo(0, h);
      ctx.bezierCurveTo(0, h - h * K, w / 2 - (w / 2) * K, 0, w / 2, 0);
      ctx.bezierCurveTo(w / 2 + (w / 2) * K, 0, w, h - h * K, w, h);
      ctx.closePath();
      break;
    case 'ring':
      ellipsePath(ctx, w / 2, h / 2, w / 2, h / 2, false);
      ellipsePath(ctx, w / 2, h / 2, w * 0.3, h * 0.3, true); // agujero en sentido contrario
      break;
    case 'heart':
      ctx.moveTo(w * 0.5, h);
      ctx.bezierCurveTo(w * 0.1, h * 0.68, 0, h * 0.42, 0, h * 0.27);
      ctx.bezierCurveTo(0, h * 0.1, w * 0.12, 0, w * 0.27, 0);
      ctx.bezierCurveTo(w * 0.4, 0, w * 0.47, h * 0.08, w * 0.5, h * 0.18);
      ctx.bezierCurveTo(w * 0.53, h * 0.08, w * 0.6, 0, w * 0.73, 0);
      ctx.bezierCurveTo(w * 0.88, 0, w, h * 0.1, w, h * 0.27);
      ctx.bezierCurveTo(w, h * 0.42, w * 0.9, h * 0.68, w * 0.5, h);
      ctx.closePath();
      break;
    case 'cloud':
      ctx.moveTo(w * 0.22, h * 0.92);
      ctx.bezierCurveTo(w * 0.05, h * 0.92, 0, h * 0.72, w * 0.1, h * 0.58);
      ctx.bezierCurveTo(w * 0.02, h * 0.42, w * 0.1, h * 0.22, w * 0.28, h * 0.25);
      ctx.bezierCurveTo(w * 0.3, h * 0.05, w * 0.55, 0, w * 0.65, h * 0.18);
      ctx.bezierCurveTo(w * 0.85, h * 0.05, w, h * 0.25, w * 0.9, h * 0.42);
      ctx.bezierCurveTo(w, h * 0.55, w * 0.98, h * 0.85, w * 0.78, h * 0.92);
      ctx.closePath();
      break;
    case 'moon':
      ctx.moveTo(w, 0);
      ctx.bezierCurveTo(w * 0.45, 0, 0, h * 0.22, 0, h * 0.5);
      ctx.bezierCurveTo(0, h * 0.78, w * 0.45, h, w, h);
      ctx.bezierCurveTo(w * 0.7, h, w * 0.4, h * 0.78, w * 0.4, h * 0.5);
      ctx.bezierCurveTo(w * 0.4, h * 0.22, w * 0.7, 0, w, 0);
      ctx.closePath();
      break;
    case 'bubble': {
      const bh = h * 0.8; // alto del cuerpo; el resto es el piquito
      const r = Math.max(0, Math.min(cornerRadius > 0 ? cornerRadius : Math.min(w, h) * 0.15, w * 0.2, bh / 2));
      ctx.moveTo(r, 0);
      ctx.lineTo(w - r, 0);
      ctx.quadraticCurveTo(w, 0, w, r);
      ctx.lineTo(w, bh - r);
      ctx.quadraticCurveTo(w, bh, w - r, bh);
      ctx.lineTo(w * 0.45, bh);
      ctx.lineTo(w * 0.18, h);
      ctx.lineTo(w * 0.25, bh);
      ctx.lineTo(r, bh);
      ctx.quadraticCurveTo(0, bh, 0, bh - r);
      ctx.lineTo(0, r);
      ctx.quadraticCurveTo(0, 0, r, 0);
      ctx.closePath();
      break;
    }
  }
}

// Atributo `d` de un <path> SVG equivalente a shapePath (mismo trazado).
export function shapeSvgPath(kind: ShapeKind, w: number, h: number, cornerRadius = 0): string {
  const f = (n: number) => Number(n.toFixed(2));
  let d = '';
  const sink = {
    beginPath() {},
    moveTo: (x: number, y: number) => (d += `M${f(x)} ${f(y)} `),
    lineTo: (x: number, y: number) => (d += `L${f(x)} ${f(y)} `),
    quadraticCurveTo: (a: number, b: number, x: number, y: number) =>
      (d += `Q${f(a)} ${f(b)} ${f(x)} ${f(y)} `),
    bezierCurveTo: (a: number, b: number, c: number, e: number, x: number, y: number) =>
      (d += `C${f(a)} ${f(b)} ${f(c)} ${f(e)} ${f(x)} ${f(y)} `),
    rect: (x: number, y: number, rw: number, rh: number) =>
      (d += `M${f(x)} ${f(y)} H${f(x + rw)} V${f(y + rh)} H${f(x)} Z `),
    closePath: () => (d += 'Z '),
    arc() {
      throw new Error('arc no soportado en shapeSvgPath');
    },
  };
  shapePath(sink, kind, w, h, cornerRadius);
  return d.trim();
}
