import type { Doc, Layer } from '../core/types';

// Lógica pura del historial de deshacer (sin dependencias del store).
// Línea de tiempo = [...past, doc, ...future]; el paso actual es past.length.

function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** Etiqueta legible del paso que lleva de `before` a `after`. */
export function describeStep(before: Doc, after: Doc): string {
  const bl = before.layers;
  const al = after.layers;
  if (al.length > bl.length) return 'Añadir capa';
  if (al.length < bl.length) return 'Borrar capa';
  if (before.width !== after.width || before.height !== after.height) return 'Cambiar tamaño';
  if (!sameJson(before.background, after.background)) return 'Cambiar fondo';
  if (before.name !== after.name) return 'Renombrar diseño';

  const changed: [Layer, Layer][] = [];
  for (let i = 0; i < al.length; i++) {
    if (bl[i] !== al[i] && bl[i].id === al[i].id) {
      if (!sameJson(bl[i], al[i])) changed.push([bl[i], al[i]]);
    } else if (bl[i].id !== al[i].id) {
      return 'Cambiar orden';
    }
  }
  if (changed.length === 0) return 'Cambio';
  const [b, a] = changed[0];
  const multi = changed.length > 1;
  const bb = b as unknown as Record<string, unknown>;
  const aa = a as unknown as Record<string, unknown>;
  const keys = Object.keys({ ...bb, ...aa }).filter((k) => !sameJson(bb[k], aa[k]));
  const has = (...ks: string[]) => keys.some((k) => ks.includes(k));
  if (keys.every((k) => ['x', 'y'].includes(k))) return multi ? 'Mover capas' : 'Mover capa';
  if (has('rotation') && !has('scaleX', 'scaleY')) return 'Girar capa';
  if (has('scaleX', 'scaleY', 'width', 'height', 'radius', 'fontSize')) return 'Redimensionar capa';
  if (has('opacity')) return 'Cambiar opacidad';
  if (has('fill', 'color', 'stroke', 'gradient')) return 'Cambiar color';
  if (has('text', 'spans', 'runs')) return 'Editar texto';
  if (has('visible')) return a.visible ? 'Mostrar capa' : 'Ocultar capa';
  if (has('locked')) return a.locked ? 'Bloquear capa' : 'Desbloquear capa';
  if (has('fontFamily', 'fontStyle', 'align', 'lineHeight', 'letterSpacing')) return 'Cambiar tipografía';
  return 'Cambio';
}

export interface HistoryItem {
  /** Posición en la línea de tiempo (0 = estado inicial). */
  index: number;
  label: string;
  current: boolean;
  /** Paso «futuro» (se recupera con rehacer). */
  future: boolean;
}

/** Lista de pasos, del más antiguo al más reciente. */
export function buildHistory(past: Doc[], doc: Doc, future: Doc[]): HistoryItem[] {
  const timeline = [...past, doc, ...future];
  return timeline.map((d, i) => ({
    index: i,
    label: i === 0 ? 'Estado inicial' : describeStep(timeline[i - 1], d),
    current: i === past.length,
    future: i > past.length,
  }));
}

/** Salta al punto `index` de la línea de tiempo; devuelve null si no es válido o ya es el actual. */
export function jumpInHistory(
  past: Doc[],
  doc: Doc,
  future: Doc[],
  index: number,
): { doc: Doc; past: Doc[]; future: Doc[] } | null {
  const timeline = [...past, doc, ...future];
  if (!Number.isInteger(index) || index < 0 || index >= timeline.length) return null;
  if (index === past.length) return null;
  return {
    doc: timeline[index],
    past: timeline.slice(0, index),
    future: timeline.slice(index + 1),
  };
}
