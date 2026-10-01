import type { Doc, Layer, SharedStyle } from './types';
import { stylePatch } from './layerStyle';

// Estilos de objeto compartidos («Estilo de objeto» con nombre).
// Un estilo es el parche de formato de layerStyle.stylePatch (relleno/degradado, borde,
// sombra, opacidad, fuente/tamaño…) más el tipo de la capa de origen (`_kind`), para que
// al aplicarlo a otra capa solo pase lo que tiene sentido entre ambos tipos.
// Las capas vinculadas llevan `styleId`; «Actualizar estilo» lo reaplica a todas.

export function getStyles(doc: Doc): SharedStyle[] {
  return doc.styles ?? [];
}

// Foto del estilo de una capa (sin valores undefined, para que sea JSON limpio).
export function captureStyle(layer: Layer): Record<string, unknown> {
  const patch = stylePatch(layer, layer);
  const out: Record<string, unknown> = { _kind: layer.type };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) out[k] = v;
  return out;
}

// Cambios que aplican `style` a `dst` (sin tocar contenido, posición, tamaño ni giro).
export function stylePatchFor(style: SharedStyle, dst: Layer): Record<string, unknown> {
  const { _kind, ...rest } = style.style;
  const pseudoSrc = { type: _kind ?? dst.type, opacity: 1, blendMode: 'normal', ...rest } as unknown as Layer;
  // Si el estilo no trae degradado, el relleno simple debe imponerse (undefined explícito).
  const patch = stylePatch(pseudoSrc, dst);
  patch.styleId = style.id;
  return patch;
}

export function applyStyle(style: SharedStyle, layer: Layer): Layer {
  return { ...layer, ...stylePatchFor(style, layer) } as Layer;
}

// Crea un estilo nuevo desde la capa y la vincula a él.
export function createStyle(doc: Doc, id: string, name: string, layer: Layer): Doc {
  const n = name.trim() || `Estilo ${getStyles(doc).length + 1}`;
  const style: SharedStyle = { id, name: n, style: captureStyle(layer) };
  return {
    ...doc,
    styles: [...getStyles(doc), style],
    layers: doc.layers.map((l) => (l.id === layer.id ? ({ ...l, styleId: id } as Layer) : l)),
  };
}

// Aplica un estilo a varias capas (las vincula).
export function applyStyleToLayers(doc: Doc, styleId: string, layerIds: string[]): Doc {
  const style = getStyles(doc).find((s) => s.id === styleId);
  if (!style) return doc;
  const ids = new Set(layerIds);
  return { ...doc, layers: doc.layers.map((l) => (ids.has(l.id) ? applyStyle(style, l) : l)) };
}

// «Actualizar estilo»: el estilo pasa a ser el de `layerId` y se reaplica a todas las vinculadas.
export function updateStyleFromLayer(doc: Doc, styleId: string, layerId: string): Doc {
  const styles = getStyles(doc);
  const src = doc.layers.find((l) => l.id === layerId);
  if (!src || !styles.some((s) => s.id === styleId)) return doc;
  const next: SharedStyle[] = styles.map((s) => (s.id === styleId ? { ...s, style: captureStyle(src) } : s));
  const updated = next.find((s) => s.id === styleId)!;
  return {
    ...doc,
    styles: next,
    layers: doc.layers.map((l) => (l.styleId === styleId && l.id !== layerId ? applyStyle(updated, l) : l)),
  };
}

export function renameStyle(doc: Doc, styleId: string, name: string): Doc {
  const n = name.trim();
  if (!n) return doc;
  return { ...doc, styles: getStyles(doc).map((s) => (s.id === styleId ? { ...s, name: n } : s)) };
}

// Desvincula capas de su estilo (conservan el aspecto actual).
export function unlinkStyle(doc: Doc, layerIds: string[]): Doc {
  const ids = new Set(layerIds);
  return {
    ...doc,
    layers: doc.layers.map((l) => {
      if (!ids.has(l.id) || !l.styleId) return l;
      const rest = { ...l } as Layer;
      delete rest.styleId;
      return rest;
    }),
  };
}

// Borra el estilo; las capas vinculadas se quedan como están, sin vínculo.
export function deleteStyle(doc: Doc, styleId: string): Doc {
  const styles = getStyles(doc).filter((s) => s.id !== styleId);
  const next: Doc = {
    ...doc,
    layers: doc.layers.map((l) => {
      if (l.styleId !== styleId) return l;
      const rest = { ...l } as Layer;
      delete rest.styleId;
      return rest;
    }),
  };
  if (styles.length) next.styles = styles;
  else delete next.styles;
  return next;
}

export function styleUsage(doc: Doc, styleId: string): number {
  return doc.layers.filter((l) => l.styleId === styleId).length;
}

// Limpia vínculos a estilos inexistentes (al abrir un proyecto).
export function normalizeStyles(doc: Doc): Doc {
  const raw = (doc as { styles?: unknown }).styles;
  const styles = Array.isArray(raw)
    ? (raw as Partial<SharedStyle>[])
        .filter((s): s is SharedStyle => !!s && typeof s.id === 'string' && typeof s.style === 'object' && !!s.style)
        .map((s) => ({ id: s.id, name: typeof s.name === 'string' && s.name ? s.name : 'Estilo', style: s.style }))
    : [];
  const ids = new Set(styles.map((s) => s.id));
  const layers = doc.layers.map((l) => {
    if (!l.styleId || ids.has(l.styleId)) return l;
    const rest = { ...l } as Layer;
    delete rest.styleId;
    return rest;
  });
  const next: Doc = { ...doc, layers };
  if (styles.length) next.styles = styles;
  else delete next.styles;
  return next;
}
