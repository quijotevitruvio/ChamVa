import { useMemo } from 'react';
import type { ImageLayer } from '../core/types';
import { useImage } from './useImage';
import { validRetouch } from '../core/retouch';
import { composeRetouch } from '../core/retouchRender';
import { getLive, showingBefore, useLiveRev } from '../core/retouchLive';

/**
 * Imagen de la capa YA con su capa de retoque (o la fuente sola si no tiene). Mientras se retoca, devuelve
 * el búfer en vivo de la sesión. `rev` cambia cuando el búfer cambia (úsalo como dependencia).
 */
export function useRetouchedImage(layer: ImageLayer): { image: CanvasImageSource | null; rev: number } {
  const base = useImage(layer.src);
  const ref = validRetouch(layer.retouch);
  const patch = useImage(ref?.src ?? '');
  const rev = useLiveRev(layer.id);
  const composed = useMemo(
    () => (base && ref && patch ? composeRetouch(base, patch, ref) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, patch, ref?.src, ref?.x, ref?.y, ref?.w, ref?.h, ref?.bw, ref?.bh],
  );
  if (showingBefore()) return { image: base, rev };
  const lv = getLive(layer.id);
  if (lv && lv.baseSrc === layer.src && (lv.pending || lv.committedSrc === ref?.src)) return { image: lv.canvas, rev };
  if (ref) return { image: composed ?? base, rev };
  return { image: base, rev };
}
