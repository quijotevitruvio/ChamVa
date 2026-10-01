// «Copiar CSS» de una capa al portapapeles (la conversión pura está en layerCss.ts).
import type { Layer } from '../editor/core/types';
import { toast } from '../ui/toast';
import { layerToCss } from './layerCss';

export async function copyLayerCss(layer: Layer): Promise<void> {
  try {
    await navigator.clipboard.writeText(layerToCss(layer));
    toast('CSS copiado al portapapeles', 'success');
  } catch {
    toast('No se pudo copiar el CSS', 'error');
  }
}
