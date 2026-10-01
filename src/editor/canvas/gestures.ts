// Lógica pura de gestos táctiles (sin DOM): pellizco, giro, toques de 2/3 dedos,
// rechazo de palma y presión del lápiz. Las pruebas están en gestures.test.ts.

export interface Pt {
  x: number;
  y: number;
}

// Métricas de un pellizco: distancia, ángulo (grados, eje x hacia la derecha,
// y hacia abajo) y centro de los dos dedos.
export function pinchMetrics(a: Pt, b: Pt): { dist: number; angle: number; cx: number; cy: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return {
    dist: Math.hypot(dx, dy),
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
  };
}

// Factor de escala entre dos distancias (1 si no hay distancia previa válida).
export function pinchScale(prevDist: number, dist: number): number {
  if (!(prevDist > 0) || !(dist > 0)) return 1;
  return dist / prevDist;
}

// Diferencia de ángulo normalizada a (-180, 180] (cruza bien el salto ±180°).
export function angleDelta(prev: number, cur: number): number {
  let d = (cur - prev) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

// Ajusta un ángulo al múltiplo de `step` más cercano si queda a ≤ `tol` grados.
export function snapAngle(deg: number, step = 45, tol = 5): number {
  const nearest = Math.round(deg / step) * step;
  return Math.abs(deg - nearest) <= tol ? nearest : deg;
}

// Giro acumulado: no se aplica hasta superar `dead` grados (para que un paneo
// con dos dedos no gire la capa por el ruido del ángulo).
export function rotationAfterDeadzone(total: number, dead = 6): number {
  if (Math.abs(total) <= dead) return 0;
  return total - Math.sign(total) * dead;
}

// ---- Toques con 2 / 3 dedos (deshacer / rehacer) ----

export interface TouchTrack {
  id: number;
  x0: number;
  y0: number;
  t0: number;
  maxMove: number; // mayor distancia recorrida desde el inicio
}

export interface TapLimits {
  maxDuration: number; // ms desde el primer dedo hasta soltar
  maxSpread: number; // ms entre el primer y el último dedo en apoyarse
  maxMove: number; // px
}
export const TAP_LIMITS: TapLimits = { maxDuration: 280, maxSpread: 120, maxMove: 10 };

// Decide si un conjunto de dedos que se han soltado forma un toque múltiple.
// Devuelve 'undo' (2 dedos), 'redo' (3 dedos) o null (era otro gesto).
export function detectMultiTap(
  tracks: TouchTrack[],
  tEnd: number,
  limits: TapLimits = TAP_LIMITS,
): 'undo' | 'redo' | null {
  if (tracks.length !== 2 && tracks.length !== 3) return null;
  const starts = tracks.map((k) => k.t0);
  const first = Math.min(...starts);
  if (tEnd - first > limits.maxDuration) return null;
  if (Math.max(...starts) - first > limits.maxSpread) return null;
  if (tracks.some((k) => k.maxMove > limits.maxMove)) return null;
  return tracks.length === 2 ? 'undo' : 'redo';
}

// ---- Lápiz y palma ----

// Con el lápiz activo recientemente, un toque ancho (palma) se ignora.
export function isPalm(opts: {
  pointerType: string;
  width: number;
  height: number;
  penRecent: boolean;
  limit?: number;
}): boolean {
  if (opts.pointerType !== 'touch' || !opts.penRecent) return false;
  const lim = opts.limit ?? 30;
  return Math.max(opts.width, opts.height) > lim;
}

// ¿Sigue "activo" el lápiz? (se vio un evento de lápiz hace menos de `windowMs`).
export function penIsRecent(lastPenAt: number, now: number, windowMs = 2500): boolean {
  return lastPenAt > 0 && now - lastPenAt <= windowMs;
}

// Factor 0.15..1 según la presión del lápiz. Con ratón/dedo (o interruptor
// apagado) devuelve 1. Algunos lápices dan 0 al inicio: se trata como 0.5.
export function pressureFactor(pointerType: string, pressure: number, enabled: boolean): number {
  if (!enabled || pointerType !== 'pen') return 1;
  const p = pressure > 0 ? pressure : 0.5;
  return Math.max(0.15, Math.min(1, p));
}

// ---- Vista previa ligera al arrastrar ----

// ¿La capa tiene efectos costosos de redibujar (ajustes, sombras, texto con efectos)?
export function isHeavyLayer(l: {
  type: string;
  shadow?: boolean;
  filter?: string;
  adjust?: unknown;
  textEffect?: string;
  curve?: number;
  maskShape?: string;
}): boolean {
  if (l.shadow) return true;
  if (l.type === 'image') {
    if (l.filter && l.filter !== 'none') return true;
    if (l.maskShape) return true;
    const a = l.adjust as Record<string, unknown> | null | undefined;
    if (a) {
      for (const v of Object.values(a)) if (typeof v === 'number' && v !== 0) return true;
    }
    return false;
  }
  if (l.type === 'text') {
    if (l.textEffect && l.textEffect !== 'none') return true;
    if (l.curve) return true;
  }
  return false;
}

// Resolución (0.2..1) de la caché temporal según la escala de la vista.
export function dragCacheRatio(viewScale: number): number {
  return Math.max(0.2, Math.min(1, viewScale * 0.6));
}
