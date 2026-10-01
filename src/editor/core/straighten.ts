// Enderezar horizonte: giro a partir de una línea trazada y mayor rectángulo interior.
// Lógica pura (sin DOM).

export interface Pt {
  x: number;
  y: number;
}

// Grados que hay que girar la imagen (sentido horario en pantalla, y hacia abajo)
// para que la línea p1→p2 quede horizontal. Resultado en (-90, 90].
export function angleToLevel(p1: Pt, p2: Pt): number {
  let dx = p2.x - p1.x;
  let dy = p2.y - p1.y;
  if (dx === 0 && dy === 0) return 0;
  if (dx < 0) {
    dx = -dx;
    dy = -dy;
  }
  const a = (Math.atan2(dy, dx) * 180) / Math.PI; // ángulo de la línea en pantalla
  return -a || 0;
}

// Mayor rectángulo (de lados paralelos a los ejes, cualquier proporción) contenido en un
// rectángulo w×h girado `angleDeg` grados. Devuelve su ancho y alto.
export function largestInscribedRect(
  w: number,
  h: number,
  angleDeg: number,
): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: 0, h: 0 };
  let a = Math.abs(angleDeg) % 180;
  if (a > 90) a = 180 - a;
  const rad = (a * Math.PI) / 180;
  if (rad < 1e-9) return { w, h };
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const widthIsLonger = w >= h;
  const longSide = widthIsLonger ? w : h;
  const shortSide = widthIsLonger ? h : w;
  let wr: number;
  let hr: number;
  if (shortSide <= 2 * sin * cos * longSide || Math.abs(sin - cos) < 1e-10) {
    // Caso «semi-restringido»: dos esquinas tocan el lado largo.
    const x = 0.5 * shortSide;
    if (widthIsLonger) {
      wr = x / sin;
      hr = x / cos;
    } else {
      wr = x / cos;
      hr = x / sin;
    }
  } else {
    // Caso «totalmente restringido»: las cuatro esquinas tocan los lados.
    const cos2a = cos * cos - sin * sin;
    wr = (w * cos - h * sin) / cos2a;
    hr = (h * cos - w * sin) / cos2a;
  }
  return { w: Math.max(1, Math.min(w, wr)), h: Math.max(1, Math.min(h, hr)) };
}

// Tamaño del lienzo que contiene todo el rectángulo girado (sin recorte).
export function rotatedBounds(w: number, h: number, angleDeg: number): { w: number; h: number } {
  const r = (angleDeg * Math.PI) / 180;
  const s = Math.abs(Math.sin(r));
  const c = Math.abs(Math.cos(r));
  return { w: w * c + h * s, h: w * s + h * c };
}
