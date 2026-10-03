import type { Doc } from '../core/types';

// Identidad del diseño (lógica pura, sin el store).
//
// Antes, el diseño se identificaba por el id de su PRIMERA página: reordenar o
// borrar la primera cambiaba el id (diseño duplicado en Inicio, versiones y
// deshacer guardado huérfanos). Ahora el store guarda `designId` aparte y no lo
// toca ninguna operación de páginas.
//
// Migración perezosa y sin reescribir nada: lo guardado por versiones anteriores
// no trae `designId`, así que se usa el id de su primera página, que es
// exactamente el id con el que ya está en recientes, versiones y `undo:<id>`.
// Un diseño nuevo recibe como `designId` el id de su página inicial (mismo
// formato que siempre); a partir de ahí queda fijo.

export interface DesignMeta {
  designId?: string;
  name?: string; // nombre propio del diseño (si no, el de la primera página)
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** `designId`/`designName` del estado para unas páginas recién abiertas. */
export function resolveDesignMeta(pages: Doc[], meta?: DesignMeta | null): { designId: string; designName: string | null } {
  return {
    designId: nonEmpty(meta?.designId) ? meta!.designId! : pages[0]?.id ?? '',
    designName: nonEmpty(meta?.name) ? meta!.name!.trim() : null,
  };
}

/** Nombre visible del diseño: el propio o, como siempre, el de la primera página. */
export function designTitle(designName: string | null | undefined, pages: Doc[]): string {
  return (nonEmpty(designName) ? designName.trim() : '') || pages[0]?.name || 'Diseño sin título';
}

/** Lee los campos opcionales de identidad de un registro guardado (autoguardado, copia, proyecto). */
export function readDesignMeta(v: unknown): DesignMeta {
  if (!v || typeof v !== 'object') return {};
  const o = v as Record<string, unknown>;
  const out: DesignMeta = {};
  if (nonEmpty(o.designId)) out.designId = o.designId;
  if (nonEmpty(o.designName)) out.name = o.designName;
  return out;
}
