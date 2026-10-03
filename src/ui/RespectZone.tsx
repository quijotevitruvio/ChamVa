import { useEffect, useMemo, useRef } from 'react';
import { Layer, Rect } from 'react-konva';
import { useEditor } from '../editor/state/store';
import { invadesZone, respectFactor, respectZone, type Box } from '../editor/core/brandKits';
import { measureStyledText } from '../editor/core/styledText';
import type { Layer as DocLayer } from '../editor/core/types';
import { toast } from './toast';
import './brandkit.css';

const ctx = document.createElement('canvas').getContext('2d')!;

// Caja aproximada (sin rotación) de una capa, para detectar invasiones.
function boxOf(l: DocLayer): Box {
  if (l.type === 'image')
    return { x: l.x, y: l.y, w: l.naturalWidth * Math.abs(l.scaleX), h: l.naturalHeight * Math.abs(l.scaleY) };
  if (l.type === 'shape' || l.type === 'stroke') return { x: l.x, y: l.y, w: l.width * Math.abs(l.scaleX), h: l.height * Math.abs(l.scaleY) };
  const m = measureStyledText(ctx, l);
  return { x: l.x, y: l.y, w: m.width * Math.abs(l.scaleX), h: m.height * Math.abs(l.scaleY) };
}

interface Zone {
  logoId: string;
  name: string;
  zone: Box;
  invaded: string[]; // nombres de las capas que invaden
}

// Capa de ayuda (solo editor, no se exporta): dibuja la zona de respeto de los
// logos del kit colocados en el diseño y avisa si otra capa la invade.
export function RespectZone() {
  const showRespect = useEditor((s) => s.showRespect);
  const doc = useEditor((s) => s.doc);
  const kits = useEditor((s) => s.brandKits);

  const zones = useMemo<Zone[]>(() => {
    if (!showRespect) return [];
    // src del logo → factor de su kit (por si el mismo logo está en varios, gana el primero).
    const bySrc = new Map<string, number>();
    for (const k of kits) for (const lg of k.logos) if (!bySrc.has(lg.src)) bySrc.set(lg.src, respectFactor(k, lg.id));
    const out: Zone[] = [];
    for (const l of doc.layers) {
      if (l.type !== 'image' || !l.visible) continue;
      const f = bySrc.get(l.src);
      if (f === undefined) continue;
      const zone = respectZone(boxOf(l), f);
      const invaded = doc.layers
        .filter((o) => o.id !== l.id && o.visible && invadesZone(zone, boxOf(o)))
        .map((o) => o.name);
      out.push({ logoId: l.id, name: l.name, zone, invaded });
    }
    return out;
  }, [showRespect, doc.layers, kits]);

  // Aviso (con pausa para no avisar a cada fotograma de un arrastre).
  const lastKey = useRef('');
  useEffect(() => {
    const bad = zones.filter((z) => z.invaded.length);
    const key = bad.map((z) => z.logoId + ':' + z.invaded.join(',')).join('|');
    if (key === lastKey.current) return;
    const id = setTimeout(() => {
      lastKey.current = key;
      if (bad.length)
        toast(`«${bad[0].invaded[0]}» invade la zona de respeto del logo «${bad[0].name}»`, 'info');
    }, 500);
    return () => clearTimeout(id);
  }, [zones]);

  if (!showRespect || zones.length === 0) return null;
  return (
    <Layer listening={false}>
      {zones.map((z) => (
        <Rect
          key={z.logoId}
          x={z.zone.x}
          y={z.zone.y}
          width={z.zone.w}
          height={z.zone.h}
          fill="rgba(128,128,128,0.10)"
          stroke="#808080"
          strokeWidth={z.invaded.length ? 2 : 1}
          strokeScaleEnabled={false}
          dash={z.invaded.length ? undefined : [6, 4]}
        />
      ))}
    </Layer>
  );
}
