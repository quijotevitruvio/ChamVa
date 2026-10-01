// Lógica pura de imantado del lienzo (sin Konva): paso de cuadrícula, guías
// inteligentes, guías del usuario e imán a la cuadrícula.

export const SNAP_PX = 6; // umbral en píxeles de pantalla

const GRID_STEPS = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

// Paso de cuadrícula visible: el más pequeño que deja ≥ 18 px en pantalla.
// Lo usan IGUAL la cuadrícula dibujada y el imán.
export function gridStepFor(scale: number): number {
  return GRID_STEPS.find((g) => g * scale >= 18) ?? 1000;
}

export interface AxisSnap {
  delta: number; // desplazamiento a aplicar a la capa
  line: number; // posición de la línea de guía activa
}

// Primer objetivo (en orden) que queda a menos de `thr` de algún borde.
export function snapAxis(edges: number[], targets: number[], thr: number): AxisSnap | null {
  for (const p of targets)
    for (const edge of edges)
      if (Math.abs(p - edge) < thr) return { delta: p - edge, line: p };
  return null;
}

// Redondea al múltiplo de `step` más cercano.
export function snapToStep(v: number, step: number): number {
  return Math.round(v / step) * step;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapInput {
  box: Box; // caja de la capa arrastrada (coordenadas del documento)
  targetsX: number[]; // lienzo + otras capas
  targetsY: number[];
  guidesX?: number[]; // guías del usuario (tienen prioridad)
  guidesY?: number[];
  scale: number;
  gridStep?: number; // si se da, imán a la cuadrícula
}

export interface SnapResult {
  dx: number;
  dy: number;
  vx: number[]; // líneas verticales activas
  hy: number[]; // líneas horizontales activas
}

// Imanta una caja: guías de usuario y objetivos inteligentes primero; si ningún
// objetivo atrapó el eje, la esquina superior izquierda salta a la cuadrícula.
export function computeSnap(i: SnapInput): SnapResult {
  const thr = SNAP_PX / i.scale;
  const { box } = i;
  const edgesX = [box.x, box.x + box.width / 2, box.x + box.width];
  const edgesY = [box.y, box.y + box.height / 2, box.y + box.height];
  const sx = snapAxis(edgesX, [...(i.guidesX ?? []), ...i.targetsX], thr);
  const sy = snapAxis(edgesY, [...(i.guidesY ?? []), ...i.targetsY], thr);
  let dx = 0;
  let dy = 0;
  const vx: number[] = [];
  const hy: number[] = [];
  if (sx) {
    dx = sx.delta;
    vx.push(sx.line);
  } else if (i.gridStep) dx = snapToStep(box.x, i.gridStep) - box.x;
  if (sy) {
    dy = sy.delta;
    hy.push(sy.line);
  } else if (i.gridStep) dy = snapToStep(box.y, i.gridStep) - box.y;
  return { dx, dy, vx, hy };
}
