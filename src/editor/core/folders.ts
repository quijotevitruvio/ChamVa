import type { Doc, Layer, LayerFolder } from './types';

// Carpetas de capas: lógica pura sobre Doc.folders y Layer.folderId.
//
// MODELO (el más simple que no rompe selección ni reordenado):
//  - Las carpetas son solo metadato de organización. El orden de dibujo (z-order)
//    sigue siendo ÚNICAMENTE el orden de `doc.layers`.
//  - El panel agrupa por carpeta mostrando el orden relativo (arriba = delante).
//    Una carpeta aparece en la posición de su capa más alta (las vacías, al final).
//  - Ojo/candado de carpeta: se guardan en la carpeta (visible/locked) Y se aplican
//    a las capas de dentro (y subcarpetas), así lienzo y exportación no necesitan
//    saber nada de carpetas. Una capa que entra en una carpeta oculta/bloqueada
//    adopta ese estado.

export type TreeNode =
  | { kind: 'folder'; folder: LayerFolder; depth: number; children: TreeNode[] }
  | { kind: 'layer'; layer: Layer; depth: number };

export const MAX_FOLDER_DEPTH = 8;

export function getFolders(doc: Doc): LayerFolder[] {
  return doc.folders ?? [];
}

// Carpetas hijas directas de `parentId` (undefined = raíz).
function childFolders(folders: LayerFolder[], parentId: string | undefined): LayerFolder[] {
  return folders.filter((f) => (f.parentId ?? undefined) === parentId);
}

// Ids de carpeta que cuelgan (a cualquier nivel) de `id`, sin incluirla.
export function descendantFolderIds(folders: LayerFolder[], id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  const seen = new Set<string>([id]);
  while (stack.length) {
    const cur = stack.pop()!;
    for (const f of folders) {
      if (f.parentId === cur && !seen.has(f.id)) {
        seen.add(f.id);
        out.push(f.id);
        stack.push(f.id);
      }
    }
  }
  return out;
}

// Cadena de ancestros de una carpeta (de la más cercana a la raíz). Corta ciclos.
export function ancestorFolders(folders: LayerFolder[], id: string): LayerFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: LayerFolder[] = [];
  const seen = new Set<string>([id]);
  let cur = byId.get(id)?.parentId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const f = byId.get(cur);
    if (!f) break;
    out.push(f);
    cur = f.parentId;
  }
  return out;
}

export function folderDepth(folders: LayerFolder[], id: string): number {
  return ancestorFolders(folders, id).length;
}

// Ids de las capas dentro de una carpeta (incluye subcarpetas).
export function folderLayerIds(doc: Doc, id: string): string[] {
  const set = new Set([id, ...descendantFolderIds(getFolders(doc), id)]);
  return doc.layers.filter((l) => l.folderId && set.has(l.folderId)).map((l) => l.id);
}

// Árbol para el panel, de arriba (delante) hacia abajo (detrás).
export function buildTree(doc: Doc): TreeNode[] {
  const folders = getFolders(doc);
  const known = new Set(folders.map((f) => f.id));
  const visited = new Set<string>();

  const build = (parentId: string | undefined, depth: number): { node: TreeNode; key: number }[] => {
    const items: { node: TreeNode; key: number; order: number }[] = [];
    doc.layers.forEach((l, i) => {
      const fid = l.folderId && known.has(l.folderId) ? l.folderId : undefined;
      if (fid === parentId) items.push({ node: { kind: 'layer', layer: l, depth }, key: i, order: i });
    });
    childFolders(folders, parentId).forEach((f, fi) => {
      if (visited.has(f.id)) return; // protege contra ciclos en archivos corruptos
      visited.add(f.id);
      const kids = build(f.id, depth + 1);
      const key = kids.reduce((m, k) => Math.max(m, k.key), -1);
      items.push({
        node: { kind: 'folder', folder: f, depth, children: kids.map((k) => k.node) },
        key,
        order: -1 - fi,
      });
    });
    items.sort((a, b) => b.key - a.key || b.order - a.order);
    return items;
  };
  return build(undefined, 0).map((x) => x.node);
}

// Lista plana de filas visibles (respeta carpetas plegadas).
export function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      out.push(n);
      if (n.kind === 'folder' && !n.folder.collapsed) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

// ---------- Cambios sobre el documento (devuelven un Doc nuevo) ----------

function withParent(f: LayerFolder, parent: string | undefined): LayerFolder {
  const rest = { ...f };
  delete rest.parentId;
  return parent ? { ...rest, parentId: parent } : rest;
}

function withFolder(l: Layer, folderId: string | undefined): Layer {
  const rest = { ...l } as Layer;
  delete rest.folderId;
  return folderId ? ({ ...rest, folderId } as Layer) : rest;
}

export function addFolder(doc: Doc, id: string, name: string, parentId?: string): Doc {
  const folders = getFolders(doc);
  const parent = parentId && folders.some((f) => f.id === parentId) ? parentId : undefined;
  if (parent && folderDepth(folders, parent) + 1 >= MAX_FOLDER_DEPTH) return doc;
  const f: LayerFolder = { id, name: name.trim() || 'Carpeta', ...(parent ? { parentId: parent } : {}) };
  return { ...doc, folders: [...folders, f] };
}

export function renameFolder(doc: Doc, id: string, name: string): Doc {
  const n = name.trim();
  if (!n) return doc;
  return { ...doc, folders: getFolders(doc).map((f) => (f.id === id ? { ...f, name: n } : f)) };
}

export function toggleFolderCollapsed(doc: Doc, id: string): Doc {
  return {
    ...doc,
    folders: getFolders(doc).map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f)),
  };
}

// Borra la carpeta SIN borrar capas: capas y subcarpetas suben al padre.
export function deleteFolder(doc: Doc, id: string): Doc {
  const folders = getFolders(doc);
  const target = folders.find((f) => f.id === id);
  if (!target) return doc;
  const parent = target.parentId;
  const nextFolders = folders
    .filter((f) => f.id !== id)
    .map((f) => (f.parentId === id ? withParent(f, parent) : f));
  const layers = doc.layers.map((l) => (l.folderId === id ? withFolder(l, parent) : l));
  const next: Doc = { ...doc, layers };
  if (nextFolders.length) next.folders = nextFolders;
  else delete next.folders;
  return next;
}

// Mueve una carpeta dentro de otra (undefined = raíz). Evita ciclos y exceso de profundidad.
export function moveFolder(doc: Doc, id: string, parentId: string | undefined): Doc {
  const folders = getFolders(doc);
  if (!folders.some((f) => f.id === id)) return doc;
  if (parentId) {
    if (parentId === id) return doc;
    if (descendantFolderIds(folders, id).includes(parentId)) return doc;
    if (!folders.some((f) => f.id === parentId)) return doc;
    if (folderDepth(folders, parentId) + 1 >= MAX_FOLDER_DEPTH) return doc;
  }
  return { ...doc, folders: folders.map((f) => (f.id === id ? withParent(f, parentId) : f)) };
}

// Mueve capas a una carpeta (undefined = sacarlas a la raíz). No toca el z-order.
// Si la carpeta está oculta/bloqueada (o lo está algún ancestro), las capas adoptan el estado.
export function moveLayersToFolder(doc: Doc, layerIds: string[], folderId: string | undefined): Doc {
  const folders = getFolders(doc);
  if (folderId && !folders.some((f) => f.id === folderId)) return doc;
  const ids = new Set(layerIds);
  const chain = folderId ? [folders.find((f) => f.id === folderId)!, ...ancestorFolders(folders, folderId)] : [];
  const hidden = chain.some((f) => f.visible === false);
  const locked = chain.some((f) => f.locked === true);
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (!ids.has(l.id)) return l;
    changed = true;
    let n = withFolder(l, folderId);
    if (hidden) n = { ...n, visible: false } as Layer;
    if (locked) n = { ...n, locked: true } as Layer;
    return n;
  });
  return changed ? { ...doc, layers } : doc;
}

// «Mover a carpeta nueva» desde la selección.
export function moveToNewFolder(
  doc: Doc,
  layerIds: string[],
  folderId: string,
  name: string,
  parentId?: string,
): Doc {
  if (!layerIds.length) return doc;
  const withF = addFolder(doc, folderId, name, parentId);
  if (withF === doc) return doc;
  return moveLayersToFolder(withF, layerIds, folderId);
}

// Ojo / candado de carpeta: se guarda en la carpeta y se aplica a sus capas y subcarpetas.
export function setFolderFlag(doc: Doc, id: string, flag: 'visible' | 'locked', value: boolean): Doc {
  const folders = getFolders(doc);
  if (!folders.some((f) => f.id === id)) return doc;
  const set = new Set([id, ...descendantFolderIds(folders, id)]);
  const nextFolders = folders.map((f) => {
    if (!set.has(f.id)) return f;
    const rest = { ...f };
    delete rest[flag];
    // Estado por defecto (visible / no bloqueada) = se omite el campo.
    const isDefault = flag === 'visible' ? value : !value;
    return isDefault ? rest : { ...rest, [flag]: value };
  });
  const layers = doc.layers.map((l) =>
    l.folderId && set.has(l.folderId) ? ({ ...l, [flag]: value } as Layer) : l,
  );
  return { ...doc, folders: nextFolders, layers };
}

// Estado mostrado por el ojo/candado: lo guardado en la carpeta o en algún ancestro.
export function folderHidden(folders: LayerFolder[], id: string): boolean {
  const f = folders.find((x) => x.id === id);
  if (!f) return false;
  return f.visible === false || ancestorFolders(folders, id).some((a) => a.visible === false);
}
export function folderLocked(folders: LayerFolder[], id: string): boolean {
  const f = folders.find((x) => x.id === id);
  if (!f) return false;
  return f.locked === true || ancestorFolders(folders, id).some((a) => a.locked === true);
}

// Quita referencias rotas (capas con carpeta inexistente, ciclos, nombres vacíos).
// Se usa al abrir un proyecto: un archivo antiguo o editado a mano no debe romper el panel.
export function normalizeFolders(doc: Doc): Doc {
  const raw = (doc as { folders?: unknown }).folders;
  let folders: LayerFolder[] = [];
  if (Array.isArray(raw)) {
    const seen = new Set<string>();
    for (const f of raw as Partial<LayerFolder>[]) {
      if (!f || typeof f.id !== 'string' || seen.has(f.id)) continue;
      seen.add(f.id);
      folders.push({
        id: f.id,
        name: typeof f.name === 'string' && f.name ? f.name : 'Carpeta',
        ...(typeof f.parentId === 'string' ? { parentId: f.parentId } : {}),
        ...(f.collapsed ? { collapsed: true } : {}),
        ...(f.visible === false ? { visible: false } : {}),
        ...(f.locked === true ? { locked: true } : {}),
      });
    }
    const ids = new Set(folders.map((f) => f.id));
    folders = folders.map((f) => (f.parentId && !ids.has(f.parentId) ? withParent(f, undefined) : f));
    // Rompe ciclos: si subiendo por los padres se vuelve a la propia carpeta, sube a la raíz.
    for (const f of [...folders]) {
      let cur: string | undefined = f.parentId;
      const path = new Set<string>([f.id]);
      while (cur) {
        if (path.has(cur)) {
          folders = folders.map((x) => (x.id === f.id ? withParent(x, undefined) : x));
          break;
        }
        path.add(cur);
        cur = folders.find((x) => x.id === cur)?.parentId;
      }
    }
  }
  const ids = new Set(folders.map((f) => f.id));
  const layers = doc.layers.map((l) => (l.folderId && !ids.has(l.folderId) ? withFolder(l, undefined) : l));
  const next: Doc = { ...doc, layers };
  if (folders.length) next.folders = folders;
  else delete next.folders;
  return next;
}

// ---------- Búsqueda y filtros del panel de capas ----------

export type LayerKindFilter = 'text' | 'image' | 'shape' | 'hidden' | 'locked';

export interface LayerFilter {
  query: string;
  kinds: LayerKindFilter[]; // vacío = todos; varios = cualquiera de ellos
  folderId?: string; // solo capas de esa carpeta (con subcarpetas)
}

export function layerLabel(l: Layer): string {
  return l.type === 'text' ? l.text || 'Texto' : l.name;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Capas que cumplen búsqueda + filtros, de arriba (delante) hacia abajo.
export function filterLayers(doc: Doc, f: LayerFilter): Layer[] {
  const q = norm(f.query.trim());
  const inFolder = f.folderId ? new Set(folderLayerIds(doc, f.folderId)) : null;
  const out = doc.layers.filter((l) => {
    if (inFolder && !inFolder.has(l.id)) return false;
    if (f.kinds.length) {
      const ok = f.kinds.some((k) => (k === 'hidden' ? !l.visible : k === 'locked' ? l.locked : l.type === k));
      if (!ok) return false;
    }
    if (q) {
      const hay = norm(l.name) + ' ' + (l.type === 'text' ? norm(l.text) : '');
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  return out.reverse();
}

export function isFilterActive(f: LayerFilter): boolean {
  return !!(f.query.trim() || f.kinds.length || f.folderId);
}

// Arrastrar una capa sobre otra en el panel: queda justo encima de la capa de destino
// (cambia el z-order, como el reordenado de siempre) y entra en su misma carpeta.
export function dropLayerOnLayer(doc: Doc, id: string, targetId: string): Doc {
  if (id === targetId) return doc;
  const moved = doc.layers.find((l) => l.id === id);
  const target = doc.layers.find((l) => l.id === targetId);
  if (!moved || !target) return doc;
  const without = doc.layers.filter((l) => l.id !== id);
  const ti = without.findIndex((l) => l.id === targetId);
  const layers = [...without];
  layers.splice(ti + 1, 0, moved); // justo delante (encima) del destino
  const reordered: Doc = { ...doc, layers };
  return moveLayersToFolder(reordered, [id], target.folderId);
}
