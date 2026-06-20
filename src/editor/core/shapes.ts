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
  }
}
