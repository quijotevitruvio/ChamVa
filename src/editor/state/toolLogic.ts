// Lógica pura de las herramientas de cursor (sin React ni Zustand): transiciones,
// prioridad del cursor, zoom a un recuadro y geometría de las formas arrastradas.

export type ToolId = 'select' | 'hand' | 'zoom' | 'text' | 'shape' | 'brush' | 'eraser' | 'wand' | 'lasso';
export type ShapeTool = 'rect' | 'ellipse' | 'line';

export interface ToolDef {
  id: ToolId;
  label: string;
  /** Acción del registro de atajos (`core/shortcuts.ts`). */
  action: string;
  key: string;
  icon: string;
  shape?: ShapeTool;
}

// Orden de la barra. «shape» se reparte en tres botones (rectángulo, elipse, línea).
export const TOOL_DEFS: ToolDef[] = [
  { id: 'select', label: 'Puntero', action: 'toolSelect', key: 'V', icon: 'pointer' },
  { id: 'hand', label: 'Mano', action: 'toolHand', key: 'H', icon: 'hand' },
  { id: 'zoom', label: 'Zoom', action: 'toolZoom', key: 'Z', icon: 'zoom' },
  { id: 'text', label: 'Texto', action: 'toolText', key: 'T', icon: 'text' },
  { id: 'shape', label: 'Rectángulo', action: 'toolRect', key: 'R', icon: 'shapeRect', shape: 'rect' },
  { id: 'shape', label: 'Elipse', action: 'toolEllipse', key: 'O', icon: 'shapeEllipse', shape: 'ellipse' },
  { id: 'shape', label: 'Línea', action: 'toolLine', key: 'L', icon: 'shapeLine', shape: 'line' },
  { id: 'brush', label: 'Pincel', action: 'toolBrush', key: 'B', icon: 'brush' },
  { id: 'eraser', label: 'Borrador', action: 'toolEraser', key: 'E', icon: 'eraser' },
  // Selección de píxeles. «L» ya es la línea: el lazo va en Mayús+L.
  { id: 'wand', label: 'Varita mágica', action: 'toolWand', key: 'W', icon: 'wand' },
  { id: 'lasso', label: 'Lazo', action: 'toolLasso', key: 'Shift+L', icon: 'lasso' },
];

/** Herramienta efectiva: mantener Espacio activa la mano de forma temporal. */
export function effectiveTool(base: ToolId, spaceHeld: boolean): ToolId {
  return spaceHeld ? 'hand' : base;
}

/** Esc: cualquier herramienta vuelve al puntero. */
export function toolOnEscape(_tool: ToolId): ToolId {
  return 'select';
}

/** Tras crear un elemento con texto/forma: vuelve al puntero salvo con Shift (persistente). */
export function toolAfterCreate(tool: ToolId, shift: boolean): ToolId {
  return shift ? tool : 'select';
}

/** Volver a pulsar la tecla del pincel/borrador activo lo apaga (comportamiento histórico de B/E). */
export function toggleTool(current: ToolId, next: ToolId): ToolId {
  return (next === 'brush' || next === 'eraser') && current === next ? 'select' : next;
}

export type OverLayer = 'none' | 'free' | 'locked';

export interface CursorCtx {
  tool: ToolId;
  spaceHeld?: boolean;
  /** Arrastrando con la mano (puño cerrado). */
  panning?: boolean;
  /** Alt pulsado con la herramienta de zoom: alejar. */
  altKey?: boolean;
  over?: OverLayer;
}

/**
 * Cursor CSS. Prioridad: 1) mano (Espacio o herramienta), 2) herramientas de
 * creación/zoom/pincel (reflejan SIEMPRE la herramienta, también sobre capas
 * bloqueadas), 3) puntero según lo que haya debajo.
 */
export function cursorFor(c: CursorCtx): string {
  const t = effectiveTool(c.tool, !!c.spaceHeld);
  switch (t) {
    case 'hand':
      return c.panning ? 'grabbing' : 'grab';
    case 'zoom':
      return c.altKey ? 'zoom-out' : 'zoom-in';
    case 'text':
      return 'text';
    case 'shape':
    case 'brush':
    case 'eraser':
    case 'wand':
    case 'lasso':
      return 'crosshair';
    default:
      if (c.over === 'locked') return 'not-allowed';
      if (c.over === 'free') return 'move';
      return 'default';
  }
}

/** Herramienta que corresponde a una acción del registro de atajos (o null). */
export function toolForAction(action: string): { tool: ToolId; shape?: ShapeTool } | null {
  const d = TOOL_DEFS.find((x) => x.action === action);
  return d ? { tool: d.id, shape: d.shape } : null;
}

// ---- zoom a un recuadro --------------------------------------------------

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 5;
export const ZOOM_STEP = 1.5;
export const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

/** Un clic con la herramienta de zoom: acerca; con Alt aleja. */
export function zoomAfterClick(zoom: number, out: boolean): number {
  return clampZoom(out ? zoom / ZOOM_STEP : zoom * ZOOM_STEP);
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Zoom a un recuadro. `box` está en píxeles de pantalla respecto al área visible
 * (w×h). Devuelve el zoom nuevo y el punto del contenido (en píxeles del contenido
 * actual) que debe quedar en el centro, ya como scroll: se aplica tras el cambio
 * de escala multiplicando por `ratio`.
 */
export function zoomToBox(
  zoom: number,
  box: Box,
  view: { w: number; h: number; scrollLeft: number; scrollTop: number },
): { zoom: number; ratio: number; scrollLeft: number; scrollTop: number } {
  const bw = Math.max(1, box.w);
  const bh = Math.max(1, box.h);
  const next = clampZoom(zoom * Math.min(view.w / bw, view.h / bh));
  const ratio = next / zoom;
  const cx = view.scrollLeft + box.x + bw / 2;
  const cy = view.scrollTop + box.y + bh / 2;
  return {
    zoom: next,
    ratio,
    scrollLeft: Math.max(0, cx * ratio - view.w / 2),
    scrollTop: Math.max(0, cy * ratio - view.h / 2),
  };
}

/** ¿El gesto fue un clic (casi sin movimiento) y no un arrastre? */
export function isClickGesture(dx: number, dy: number, slop = 4): boolean {
  return Math.hypot(dx, dy) < slop;
}

// ---- formas arrastradas --------------------------------------------------

export interface ShapeBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/**
 * Caja de una forma a partir de un arrastre (coordenadas del documento).
 * Rectángulo/elipse: caja entre los dos puntos (Shift = proporcional).
 * Línea: largo = distancia, rotación = ángulo (Shift = múltiplos de 15°), con el
 * trazo centrado sobre el punto inicial.
 * Sin arrastre (clic): tamaño por defecto centrado en el punto.
 */
export function shapeFromDrag(
  kind: ShapeTool,
  a: [number, number],
  b: [number, number],
  opts: { shift?: boolean; clickSize?: number; lineThickness?: number } = {},
): ShapeBox {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const clicked = Math.hypot(dx, dy) < 4;
  const base = opts.clickSize ?? 200;
  if (kind === 'line') {
    const th = opts.lineThickness ?? 6;
    let len = Math.hypot(dx, dy);
    let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (clicked) {
      len = base;
      ang = 0;
      a = [a[0] - base / 2, a[1]];
    } else if (opts.shift) ang = Math.round(ang / 15) * 15;
    const rad = (ang * Math.PI) / 180;
    // La línea se dibuja a media altura: se compensa para que arranque en `a`.
    return {
      x: a[0] + (th / 2) * Math.sin(rad),
      y: a[1] - (th / 2) * Math.cos(rad),
      width: Math.max(1, len),
      height: th,
      rotation: ang,
    };
  }
  if (clicked) return { x: a[0] - base / 2, y: a[1] - base / 2, width: base, height: base, rotation: 0 };
  let w = Math.abs(dx);
  let h = Math.abs(dy);
  if (opts.shift) w = h = Math.max(w, h);
  const x = dx < 0 ? a[0] - w : a[0];
  const y = dy < 0 ? a[1] - h : a[1];
  return { x, y, width: Math.max(1, w), height: Math.max(1, h), rotation: 0 };
}

/** ¿Se cruzan dos cajas? (caja de selección contra el rectángulo de una capa). */
export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Caja normalizada entre dos puntos. */
export function boxFromPoints(a: [number, number], b: [number, number]): Box {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
}

// ---- cuchilla del editor de video ---------------------------------------

export type VideoTool = 'select' | 'razor' | 'hand' | 'zoom';

export const VIDEO_TOOLS: { id: VideoTool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Puntero', key: 'V', icon: 'pointer' },
  { id: 'razor', label: 'Cuchilla', key: 'C', icon: 'razor' },
  { id: 'hand', label: 'Mano', key: 'H', icon: 'hand' },
  { id: 'zoom', label: 'Zoom', key: 'Z', icon: 'zoom' },
];

export function videoToolForKey(key: string): VideoTool | null {
  const k = key.toLowerCase();
  return VIDEO_TOOLS.find((t) => t.key.toLowerCase() === k)?.id ?? null;
}

export function videoCursor(tool: VideoTool, panning = false, alt = false): string {
  switch (tool) {
    case 'razor':
      return 'crosshair';
    case 'hand':
      return panning ? 'grabbing' : 'grab';
    case 'zoom':
      return alt ? 'zoom-out' : 'zoom-in';
    default:
      return 'default';
  }
}

/**
 * Instante de corte de la cuchilla: el punto del clic, con imán al cabezal si está
 * a menos de `snapPx` píxeles de él. `null` si el punto cae fuera del clip.
 */
export function razorTime(
  clickT: number,
  playhead: number,
  pxPerSec: number,
  clip: { start: number; duration: number },
  snapPx = 8,
): number | null {
  const t = Math.abs(clickT - playhead) * pxPerSec <= snapPx ? playhead : clickT;
  const eps = 1e-6;
  return t > clip.start + eps && t < clip.start + clip.duration - eps ? t : null;
}
