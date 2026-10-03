// Cálculos puros del modo apilado (sin DOM): escala común y página más visible.

export interface PageSize {
  width: number;
  height: number;
}

export const STACK_PAD = 48; // margen del área, igual que el ajuste clásico
export const STACK_HEADER = 36; // alto reservado a la cabecera de una página

// Escala común a todas las páginas: la que hace caber la más grande en el área
// (así no salta al cambiar de página) × el zoom del usuario. Sin páginas: zoom.
export function stackScale(pages: PageSize[], area: { width: number; height: number }, zoom: number): number {
  if (!pages.length) return zoom;
  const maxW = Math.max(...pages.map((p) => p.width));
  const maxH = Math.max(...pages.map((p) => p.height));
  if (maxW <= 0 || maxH <= 0) return zoom;
  const sx = (area.width - STACK_PAD) / maxW;
  const sy = (area.height - STACK_PAD - STACK_HEADER) / maxH;
  return Math.max(0.02, Math.min(1, sx, sy)) * zoom;
}

export interface VRect {
  top: number;
  bottom: number;
}

// Índice de la página más visible: la de mayor solape vertical con la ventana
// [viewTop, viewBottom]. Empate: la de centro más cercano al de la ventana; si
// persiste, la primera. -1 si ninguna se ve.
export function mostVisibleIndex(rects: VRect[], viewTop: number, viewBottom: number): number {
  const mid = (viewTop + viewBottom) / 2;
  let best = -1;
  let bestOv = 0;
  let bestDist = Infinity;
  rects.forEach((r, i) => {
    const ov = Math.min(r.bottom, viewBottom) - Math.max(r.top, viewTop);
    if (ov <= 0) return;
    const dist = Math.abs((r.top + r.bottom) / 2 - mid);
    if (ov > bestOv + 0.5 || (Math.abs(ov - bestOv) <= 0.5 && dist < bestDist - 0.5)) {
      best = i;
      bestOv = ov;
      bestDist = dist;
    }
  });
  return best;
}

// Ancho/alto en pantalla de una página a la escala común (para reservar su hueco).
export function pageBox(p: PageSize, scale: number): { w: number; h: number } {
  return { w: Math.round(p.width * scale), h: Math.round(p.height * scale) };
}

// Escala de píxeles de la imagen de una página inactiva: la de pantalla × la
// densidad (máx. 2), sin pasar de `maxSide` px por lado (memoria de canvas).
export function stillPixelScale(p: PageSize, scale: number, dpr: number, maxSide = 4096): number {
  const s = scale * Math.min(Math.max(dpr, 1), 2);
  return Math.min(s, maxSide / Math.max(p.width, p.height, 1));
}
