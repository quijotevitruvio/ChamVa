import type { Doc, Layer } from './types';
import { normalizeFolders } from './folders';
import { normalizeStyles } from './sharedStyles';
import { isValidConstraints } from './constraints';

// Normaliza los campos de organización al abrir un proyecto (carpetas, estilos
// compartidos, restricciones, maestra). Un archivo antiguo pasa sin cambios.
export function normalizeOrganization(doc: Doc): Doc {
  let d = normalizeStyles(normalizeFolders(doc));
  if (d.layers.some((l) => l.constraints && !isValidConstraints(l.constraints))) {
    d = {
      ...d,
      layers: d.layers.map((l) => {
        if (!l.constraints || isValidConstraints(l.constraints)) return l;
        const rest = { ...l } as Layer;
        delete rest.constraints;
        return rest;
      }),
    };
  }
  const raw = d as { isMaster?: unknown; masterId?: unknown };
  if ((raw.isMaster !== undefined && raw.isMaster !== true) || (raw.masterId !== undefined && typeof raw.masterId !== 'string')) {
    d = { ...d };
    if (raw.isMaster !== true) delete d.isMaster;
    if (typeof raw.masterId !== 'string') delete d.masterId;
  }
  if (d.isMaster && d.masterId) {
    d = { ...d };
    delete d.masterId;
  }
  return d;
}
