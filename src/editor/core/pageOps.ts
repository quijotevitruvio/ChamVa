import type { Doc } from './types';

// Operaciones puras sobre la lista de páginas (clasificador de páginas).

export type NewId = () => string;

// Mueve las páginas elegidas (índices) al principio o al final conservando su orden relativo.
export function moveIndicesTo(pages: Doc[], selected: number[], where: 'start' | 'end'): Doc[] {
  const sel = new Set(selected);
  const picked = pages.filter((_, i) => sel.has(i));
  const rest = pages.filter((_, i) => !sel.has(i));
  return where === 'start' ? [...picked, ...rest] : [...rest, ...picked];
}

// Mueve la página `from` a la posición `to` (arrastrar y soltar).
export function reorderOne(pages: Doc[], from: number, to: number): Doc[] {
  if (from === to || from < 0 || to < 0 || from >= pages.length || to >= pages.length) return pages;
  const arr = [...pages];
  const [m] = arr.splice(from, 1);
  arr.splice(to, 0, m);
  return arr;
}

// Duplica las páginas elegidas; cada copia va justo detrás de su original.
export function duplicateIndices(pages: Doc[], selected: number[], newId: NewId): Doc[] {
  const sel = new Set(selected);
  const out: Doc[] = [];
  pages.forEach((p, i) => {
    out.push(p);
    if (!sel.has(i)) return;
    const copy = JSON.parse(JSON.stringify(p)) as Doc;
    copy.id = newId();
    copy.name = `${p.name} (copia)`;
    copy.layers = copy.layers.map((l) => ({ ...l, id: newId() }));
    delete copy.isMaster; // la copia no es maestra: evita dos maestras iguales por accidente
    out.push(copy);
  });
  return out;
}

// Borra las páginas elegidas; siempre queda al menos una.
export function deleteIndices(pages: Doc[], selected: number[]): Doc[] {
  const sel = new Set(selected);
  const rest = pages.filter((_, i) => !sel.has(i));
  return rest.length ? rest : pages;
}

// Inserta `page` en la posición `index` (se limita a 0…pages.length: fuera de rango va al final o al principio).
export function insertAt(pages: Doc[], index: number, page: Doc): Doc[] {
  const i = Number.isFinite(index) ? Math.max(0, Math.min(pages.length, Math.trunc(index))) : pages.length;
  return [...pages.slice(0, i), page, ...pages.slice(i)];
}
