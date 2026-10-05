// Cálculos puros de «Redimensionar imagen» (sin DOM): tamaño nuevo con candado de proporción,
// límites del canvas y cómo queda la capa para que NO cambie de tamaño aparente en el diseño.
import type { ImageLayer } from './types';
import { CANVAS_MAX_AREA, CANVAS_MAX_SIDE } from './perspectiveLimit';

export interface Dim {
  w: number;
  h: number;
}

const clampInt = (v: number) => Math.max(1, Math.round(Number.isFinite(v) ? v : 1));

// Tamaño al escribir el ANCHO (con candado, el alto sigue la proporción de la imagen original).
export function dimFromWidth(w: number, src: Dim, lock: boolean, current: Dim): Dim {
  const nw = clampInt(w);
  return { w: nw, h: lock ? clampInt((nw * src.h) / src.w) : current.h };
}

export function dimFromHeight(h: number, src: Dim, lock: boolean, current: Dim): Dim {
  const nh = clampInt(h);
  return { w: lock ? clampInt((nh * src.w) / src.h) : current.w, h: nh };
}

export function dimFromPercent(pct: number, src: Dim): Dim {
  const k = Math.max(0.01, pct / 100);
  return { w: clampInt(src.w * k), h: clampInt(src.h * k) };
}

/** null si cabe; si no, el motivo en español. */
export function dimProblem(d: Dim): string | null {
  if (d.w > CANVAS_MAX_SIDE || d.h > CANVAS_MAX_SIDE) return `El lado mayor no puede pasar de ${CANVAS_MAX_SIDE} px.`;
  if (d.w * d.h > CANVAS_MAX_AREA) return `La imagen no puede pasar de ${Math.round(CANVAS_MAX_AREA / 1e6)} megapíxeles.`;
  return null;
}

// Nueva geometría de la capa tras remuestrear de src (px reales) a dst: las unidades naturales y
// la escala se compensan, así la caja en el diseño es idéntica; los ajustes/recorte se conservan.
export function layerGeometryAfterResize(
  layer: Pick<ImageLayer, 'naturalWidth' | 'naturalHeight' | 'scaleX' | 'scaleY'>,
  src: Dim,
  dst: Dim,
) {
  const kx = dst.w / src.w;
  const ky = dst.h / src.h;
  return {
    naturalWidth: layer.naturalWidth * kx,
    naturalHeight: layer.naturalHeight * ky,
    scaleX: layer.scaleX / kx,
    scaleY: layer.scaleY / ky,
  };
}
