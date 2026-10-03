// Fila de rombos de fotogramas clave sobre el bloque del clip seleccionado (una sola fila: un rombo por instante,
// con todas las propiedades que tienen un fotograma ahí). Clic: lleva el cabezal; arrastrar: lo mueve (un arrastre =
// un paso de deshacer); Supr: lo quita; ← →: lo mueven un fotograma.
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import * as VM from '../../video/model';
import { moveKeyTo, removeKeyAt } from '../../video/fx/clipOps';
import type { PreviewEngine } from './previewEngine';
import { keyClusters, keyIndexAt, propLabel, type KeyCluster } from './fxUi';

const FRAME = 1 / 30;

interface Props {
  clip: VM.Clip;
  /** ancho dibujado del clip (px) y escala */
  width: number;
  pps: number;
  engine: PreviewEngine;
  commit: (fn: (p: VM.VideoProject) => VM.VideoProject, group?: string) => unknown;
  locked: boolean;
}

export function KeyRow({ clip, width, pps, engine, commit, locked }: Props) {
  const clusters = keyClusters(clip);
  const [selT, setSelT] = useState<number | null>(null);
  const drag = useRef<{ cur: number; x0: number; moved: boolean; members: KeyCluster['members'] } | null>(null);
  if (!clusters.length) return null;

  /** Mueve todos los fotogramas del rombo de `from` a `to` (s locales). Se localiza cada uno por su instante: el orden puede cambiar. */
  const moveTo = (members: KeyCluster['members'], from: number, to: number) => {
    const id = clip.id;
    commit((p) => {
      let out = p;
      for (const m of members) {
        const c = VM.findClip(out, id)?.clip;
        if (!c) return p;
        const i = keyIndexAt(c, m.prop, c.start + from);
        if (i >= 0) out = moveKeyTo(out, id, m.prop, i, c.start + to);
      }
      return out;
    }, `kmove:${id}`);
  };
  const remove = (cl: KeyCluster) => {
    const id = clip.id;
    commit((p) => {
      let out = p;
      for (const m of cl.members) {
        const c = VM.findClip(out, id)?.clip;
        if (!c) return p;
        const i = keyIndexAt(c, m.prop, c.start + cl.t);
        if (i >= 0) out = removeKeyAt(out, id, m.prop, i);
      }
      return out;
    });
    setSelT(null);
  };

  const down = (cl: KeyCluster) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    drag.current = { cur: cl.t, x0: e.clientX, moved: false, members: cl.members };
    setSelT(cl.t);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* evento sintético */
    }
  };
  const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || locked) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return;
    d.moved = true;
    const row = e.currentTarget.parentElement!.getBoundingClientRect();
    const dur = VM.clipDuration(clip);
    const to = Math.max(0, Math.min(clip.toEnd ? Infinity : dur, (e.clientX - row.left) / pps));
    if (Math.abs(to - d.cur) < 1e-4) return;
    moveTo(d.members, d.cur, to);
    d.cur = to;
    setSelT(to);
    engine.seek(clip.start + to);
  };
  const up = (e: ReactPointerEvent<HTMLButtonElement>, cl: KeyCluster) => {
    const d = drag.current;
    drag.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* idem */
    }
    if (d && !d.moved && e.type === 'pointerup') engine.seek(clip.start + cl.t);
  };
  const key = (cl: KeyCluster) => (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      if (!locked) remove(cl);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      if (locked) return;
      const to = Math.max(0, cl.t + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : FRAME));
      moveTo(cl.members, cl.t, to);
      setSelT(to);
      engine.seek(clip.start + to);
    }
  };

  return (
    <div className="vx-keyrow" style={{ left: clip.start * pps, width }} role="group" aria-label="Fotogramas clave del clip">
      {clusters.map((cl) => {
        const names = cl.members.map((m) => propLabel(clip, m.prop)).join(', ');
        return (
          <button
            key={cl.members.map((m) => m.prop).join('|') + ':' + cl.t.toFixed(3)}
            type="button"
            data-kd=""
            className={`vx-kd${selT !== null && Math.abs(selT - cl.t) < 2e-3 ? ' sel' : ''}`}
            style={{ left: cl.t * pps }}
            onPointerDown={down(cl)}
            onPointerMove={move}
            onPointerUp={(e) => up(e, cl)}
            onPointerCancel={(e) => up(e, cl)}
            onKeyDown={key(cl)}
            title={`Fotograma en ${cl.t.toFixed(2)} s: ${names}. Clic: ir al cabezal · arrastrar: mover · Supr: quitar`}
            aria-label={`Fotograma clave a ${cl.t.toFixed(2)} s de ${names}`}
          >
            <i aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
