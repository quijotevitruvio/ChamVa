import { MAX_PX, MIN_PX } from './units';

export interface PhotoCanvas {
  canvasW: number; // ancho del lienzo en px
  canvasH: number; // alto del lienzo en px
  scale: number; // escala de la capa de imagen (1 = tamaño natural)
  clamped: boolean; // true si la foto superó el máximo y se redujo
}

// Lienzo con exactamente las medidas de la foto. Si el lado mayor pasa de MAX_PX se
// reduce todo proporcionalmente; si un lado queda bajo MIN_PX se sube a MIN_PX (la capa
// conserva su escala y el lienzo queda algo más grande que ella).
export function photoCanvas(naturalW: number, naturalH: number): PhotoCanvas {
  const w = Math.max(1, naturalW);
  const h = Math.max(1, naturalH);
  const big = Math.max(w, h);
  const clamped = big > MAX_PX;
  const scale = clamped ? MAX_PX / big : 1;
  const fit = (v: number) => Math.min(MAX_PX, Math.max(MIN_PX, Math.round(v * scale)));
  return { canvasW: fit(w), canvasH: fit(h), scale, clamped };
}
