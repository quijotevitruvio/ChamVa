import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import * as VM from '../../video/model';
import { moveClips } from './editing';
import type { MediaCache } from './mediaCache';
import type { PreviewEngine } from './previewEngine';
import { ClipView } from './ClipView';
import { KeyRow } from './KeyRow';
import { resolveTransitions } from '../../video/fx/transitions';
import { applyPayload, decodePayload, dragKind, FX_MIME, fxDropTarget, junctionMarks, type FxDropTarget, type FxKind, type JunctionMark } from './fxUi';
import { TrackHeader } from './TrackHeader';
import { projectBeatMarks } from '../../video/audio/beatMarks';
import * as T from './timelineMath';

export interface TimelineApi {
  zoomBy: (factor: number) => void;
  fit: () => void;
  scrollToTime: (t: number) => void;
}

export const MEDIA_MIME = 'application/x-chamva-media';

interface Props {
  project: VM.VideoProject;
  engine: PreviewEngine;
  cache: MediaCache;
  selection: string[];
  setSelection: (ids: string[]) => void;
  pps: number;
  setPps: (pps: number) => void;
  commit: (fn: (p: VM.VideoProject) => VM.VideoProject, group?: string) => void;
  endGroup: () => void;
  snapOn: boolean;
  compact: boolean;
  apiRef: { current: TimelineApi | null };
  onDropMedia: (mediaId: string, trackId: string | null, t: number) => void;
  onDropFiles: (files: File[], trackId: string | null, t: number) => void;
  onAddTrack: (kind: VM.TrackKind) => void;
  /** marcas de entrada/salida (s): se dibujan en la regla */
  marks?: { in: number | null; out: number | null };
  /** menú contextual de un clip de audio/video */
  onClipMenu?: (clipId: string, x: number, y: number) => void;
}

type Drag =
  | { kind: 'move'; ids: string[]; primary: string; startX: number; startCX: number; startCY: number; origStart: number; base: VM.VideoProject; moved: boolean; clickedSelected: boolean; id: string }
  | { kind: 'trim'; id: string; edge: 'in' | 'out'; base: VM.VideoProject; moved: boolean }
  | { kind: 'box'; x0: number; y0: number; base: string[]; additive: boolean; moved: boolean }
  | { kind: 'scrub' };

interface Ptr {
  x: number;
  y: number;
  alt: boolean;
  shift: boolean;
}

const MOVE_THRESHOLD = 3;

// Los eventos sintéticos (pruebas, asistentes) no tienen un puntero activo: no deben romper el arrastre.
function capture(el: HTMLElement, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* sin puntero activo */
  }
}
function release(el: HTMLElement, id: number) {
  try {
    if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
  } catch {
    /* idem */
  }
}

export function Timeline({ project, engine, cache, selection, setSelection, pps, setPps, commit, endGroup, snapOn, compact, apiRef, onDropMedia, onDropFiles, onAddTrack, marks, onClipMenu }: Props) {
  const headerW = compact ? T.HEADER_W_COMPACT : T.HEADER_W;
  const scroller = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(800);
  const [bucket, setBucket] = useState(0);
  const [preview, setPreview] = useState<VM.VideoProject | null>(null);
  const previewRef = useRef<VM.VideoProject | null>(null);
  const setPrev = (p: VM.VideoProject | null) => {
    previewRef.current = p;
    setPreview(p);
  };
  const [guide, setGuide] = useState<number | null>(null);
  const [box, setBox] = useState<T.Box | null>(null);
  const [drop, setDrop] = useState<{ trackId: string | null; t: number } | null>(null);
  const [fxKind, setFxKind] = useState<FxKind | null>(null);
  const [fxDrop, setFxDrop] = useState<FxDropTarget | null>(null);
  const [activeIds, setActiveIds] = useState<ReadonlySet<string>>(new Set());
  const dragRef = useRef<Drag | null>(null);
  const lastPtr = useRef<Ptr | null>(null);
  const moveRaf = useRef(0);
  const autoRaf = useRef(0);
  const touches = useRef(new Map<string, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; pps0: number; anchorT: number } | null>(null);
  const pendingScroll = useRef<number | null>(null);

  // datos derivados de los medios: la vista se repinta cuando llega una miniatura u onda
  useSyncExternalStore(cache.subscribe, cache.getVersion);

  const shown = preview ?? project;
  const rows = useMemo(() => T.rowLayout(shown), [shown]);
  const tracks = useMemo(() => T.displayTracks(shown), [shown]);
  const dur = useMemo(() => VM.projectDuration(shown), [shown]);
  // uniones entre clips contiguos (símbolo / zona de soltar) y cuñas de entrada y salida de clips sueltos
  const fxInfo = useMemo(() => {
    const joins = new Map<string, JunctionMark[]>();
    const edges = new Map<string, { tin?: number; tout?: number }>();
    for (const t of shown.tracks) {
      if (t.kind !== 'video') continue;
      joins.set(t.id, junctionMarks(t, dur));
      for (const r of resolveTransitions(t, dur)) {
        if (r.kind === 'in' && r.b) edges.set(r.b.id, { ...edges.get(r.b.id), tin: r.dur });
        if (r.kind === 'out' && r.a) edges.set(r.a.id, { ...edges.get(r.a.id), tout: r.dur });
      }
    }
    return { joins, edges };
  }, [shown, dur]);
  const half = Math.max(80, viewW / 2);
  const win = T.renderWindow(bucket * half, viewW, pps);
  const laneW = Math.max(viewW - headerW, dur * pps + 40);
  const bodyH = T.rowsHeight(rows);

  // pide miniaturas / ondas de los medios que se usan (una sola vez por medio)
  useEffect(() => {
    for (const t of project.tracks) for (const c of t.clips) if (c.mediaId && project.media[c.mediaId]) cache.ensure(project.media[c.mediaId]);
  }, [project, cache]);

  // ---------- coordenadas ----------
  const contentX = (clientX: number) => {
    const el = scroller.current!;
    return clientX - el.getBoundingClientRect().left - headerW + el.scrollLeft;
  };
  const contentY = (clientY: number) => {
    const el = scroller.current!;
    return clientY - el.getBoundingClientRect().top - T.RULER_H + el.scrollTop;
  };

  // ---------- tamaño y scroll ----------
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setViewW(el.clientWidth)); // fuera del ciclo del observador: evita «ResizeObserver loop»
    });
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const b = Math.floor(el.scrollLeft / half);
    setBucket((prev) => (prev === b ? prev : b));
  }, [half]);

  // tras un zoom: restituye el scroll que mantiene fijo el instante bajo el ancla
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pendingScroll.current !== null) {
      el.scrollLeft = pendingScroll.current;
      pendingScroll.current = null;
      onScroll();
    }
  }, [pps, onScroll]);

  const applyZoom = useCallback(
    (factor: number, anchorPx?: number) => {
      const el = scroller.current;
      if (!el) return;
      const lane = el.clientWidth - headerW;
      const anchor = anchorPx ?? Math.max(0, Math.min(lane, engine.time * pps - el.scrollLeft)); // por defecto, el cabezal si se ve, si no el centro
      const a = anchorPx === undefined && (engine.time * pps < el.scrollLeft || engine.time * pps > el.scrollLeft + lane) ? lane / 2 : anchor;
      const z = T.zoomAround(pps, factor, a, el.scrollLeft);
      if (z.pps === pps) return;
      pendingScroll.current = z.scrollLeft;
      setPps(z.pps);
    },
    [engine, pps, setPps, headerW],
  );

  useEffect(() => {
    apiRef.current = {
      zoomBy: (f) => applyZoom(f),
      fit: () => {
        const el = scroller.current;
        if (!el) return;
        const d = Math.max(VM.projectDuration(project), 1);
        pendingScroll.current = 0;
        setPps(T.fitPps(d, el.clientWidth - headerW));
      },
      scrollToTime: (t) => {
        const el = scroller.current;
        if (!el) return;
        el.scrollLeft = Math.max(0, t * pps - 40);
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, applyZoom, project, pps, setPps, headerW]);

  // Ctrl + rueda = zoom (listener nativo no pasivo para poder cancelar el zoom del navegador)
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const px = e.clientX - el.getBoundingClientRect().left - headerW;
      applyZoom(Math.exp(-e.deltaY * 0.0018), Math.max(0, px));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyZoom, headerW]);

  // ---------- cabezal (se mueve sin repintar React) ----------
  const placePlayhead = useCallback(() => {
    const x = engine.time * pps;
    const tf = `translateX(${x}px)`;
    if (lineRef.current) lineRef.current.style.transform = tf;
    if (headRef.current) headRef.current.style.transform = tf;
  }, [engine, pps]);
  useLayoutEffect(placePlayhead, [placePlayhead, headerW]);
  useEffect(() => {
    return engine.subscribeTime(() => {
      placePlayhead();
      const el = scroller.current;
      if (!el || !engine.isPlaying || dragRef.current) return;
      const x = engine.time * pps;
      const lane = el.clientWidth - headerW;
      if (x > el.scrollLeft + lane - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80);
    });
  }, [engine, pps, placePlayhead, headerW]);

  // ---------- arrastres ----------
  const setActive = (ids: string[]) => setActiveIds(new Set(ids));

  const finishDrag = () => {
    dragRef.current = null;
    lastPtr.current = null;
    if (moveRaf.current) cancelAnimationFrame(moveRaf.current);
    if (autoRaf.current) cancelAnimationFrame(autoRaf.current);
    moveRaf.current = autoRaf.current = 0;
    setPrev(null);
    setGuide(null);
    setBox(null);
    setActiveIds(new Set());
  };

  /** Calcula la vista previa del arrastre según el puntero. */
  const processMove = () => {
    moveRaf.current = 0;
    const d = dragRef.current;
    const ptr = lastPtr.current;
    if (!d || !ptr) return;
    const x = contentX(ptr.x);
    const y = contentY(ptr.y);
    if (d.kind === 'scrub') {
      const s = snapOn && !ptr.alt ? VM.snapTime(project, x / pps, { threshold: T.snapSeconds(pps, 6) }) : { time: x / pps, target: null };
      engine.seek(Math.max(0, s.time));
      return;
    }
    if (d.kind === 'box') {
      if (!d.moved && Math.hypot(x - d.x0, y - d.y0) < MOVE_THRESHOLD) return;
      d.moved = true;
      const b = { x0: d.x0, y0: d.y0, x1: x, y1: y };
      setBox(b);
      setSelection(T.mergeBoxSelection(d.base, T.clipsInBox(project, T.rowLayout(project), pps, b), d.additive));
      return;
    }
    if (d.kind === 'move') {
      if (!d.moved && Math.hypot(ptr.x - d.startCX, ptr.y - d.startCY) < MOVE_THRESHOLD) return;
      d.moved = true;
      const dt = (x - d.startX) / pps; // d.startX está en coordenadas del contenido
      const snapped = T.snapMove(d.base, d.primary, d.origStart + dt, pps, engine.time, snapOn && !ptr.alt);
      const dt2 = snapped.time - d.origStart;
      let destTrack: string | undefined;
      if (d.ids.length === 1) {
        const row = T.nearestRow(T.rowLayout(d.base), y);
        const loc = VM.findClip(d.base, d.primary);
        const tr = row ? VM.findTrack(d.base, row.trackId) : null;
        if (tr && loc && !tr.locked && VM.fitsTrack(loc.clip, tr)) destTrack = tr.id;
      }
      setPrev(moveClips(d.base, d.ids, dt2, destTrack));
      if (snapped.target) {
        const loc = VM.findClip(d.base, d.primary)!;
        const len = VM.clipDuration(loc.clip);
        const atStart = VM.snapTime(d.base, snapped.time, { threshold: 1e-6, playhead: engine.time, exclude: d.primary }).target;
        setGuide(atStart ? snapped.time : snapped.time + len);
      } else setGuide(null);
      return;
    }
    if (d.kind === 'trim') {
      d.moved = true;
      const s = T.snapEdge(d.base, d.id, x / pps, pps, engine.time, snapOn && !ptr.alt);
      setPrev(VM.trimClip(d.base, d.id, d.edge, s.time, { ripple: ptr.shift }));
      setGuide(s.target ? s.time : null);
    }
  };
  const schedule = () => {
    if (!moveRaf.current) moveRaf.current = requestAnimationFrame(processMove);
  };

  const autoScroll = () => {
    autoRaf.current = 0;
    const el = scroller.current;
    const d = dragRef.current;
    const ptr = lastPtr.current;
    if (!el || !d || !ptr || d.kind === 'scrub') return;
    const r = el.getBoundingClientRect();
    const v = T.autoScrollSpeed(ptr.x, r.left + headerW, r.right);
    if (v === 0) return;
    el.scrollLeft = Math.max(0, el.scrollLeft + v);
    schedule();
    autoRaf.current = requestAnimationFrame(autoScroll);
  };

  const startPinch = () => {
    const pts = [...touches.current.values()];
    if (pts.length < 2) return;
    finishDrag();
    const el = scroller.current!;
    const d0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const cx = (pts[0].x + pts[1].x) / 2 - el.getBoundingClientRect().left - headerW;
    pinch.current = { d0: Math.max(1, d0), pps0: pps, anchorT: (el.scrollLeft + Math.max(0, cx)) / pps };
  };

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!onClipMenu) return;
    if ((e.target as HTMLElement).closest('.vx-th, .vx-tl-corner, [data-ruler]')) return;
    const hit = T.hitTest(project, T.rowLayout(project), pps, contentX(e.clientX), contentY(e.clientY));
    const loc = hit ? VM.findClip(project, hit.clipId) : null;
    if (!hit || !loc || (loc.clip.kind !== 'video' && loc.clip.kind !== 'audio')) return;
    e.preventDefault();
    setSelection([hit.clipId]);
    onClipMenu(hit.clipId, e.clientX, e.clientY);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = scroller.current!;
    const target = e.target as HTMLElement;
    if (target.closest('.vx-th, .vx-tl-corner, button, input, select, textarea')) return;
    if (e.pointerType === 'touch') {
      touches.current.set(String(e.pointerId), { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        startPinch();
        return;
      }
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const x = contentX(e.clientX);
    const y = contentY(e.clientY);
    lastPtr.current = { x: e.clientX, y: e.clientY, alt: e.altKey, shift: e.shiftKey };

    if (target.closest('[data-ruler], [data-ph]')) {
      dragRef.current = { kind: 'scrub' };
      capture(el, e.pointerId);
      processMoveNow();
      return;
    }
    // hit-testing puro (timelineMath.hitTest): clip y zona (borde izquierdo / derecho / cuerpo)
    const hit = T.hitTest(project, T.rowLayout(project), pps, x, y);
    if (hit) {
      const id = hit.clipId;
      const loc = VM.findClip(project, id);
      if (!loc) return;
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (additive) {
        setSelection(T.applySelection(selection, id, 'toggle'));
        return;
      }
      const wasSelected = selection.includes(id);
      const ids = wasSelected ? selection : [id];
      if (!wasSelected) setSelection([id]);
      if (loc.track.locked) return;
      const edge = hit.zone === 'left' ? 'in' : hit.zone === 'right' ? 'out' : null;
      // en pantallas táctiles, un clip sin seleccionar solo se selecciona (así se puede desplazar la línea con el dedo)
      if (e.pointerType === 'touch' && !wasSelected && !edge) return;
      capture(el, e.pointerId);
      if (edge) {
        dragRef.current = { kind: 'trim', id, edge, base: project, moved: false };
        setActive([id]);
      } else {
        dragRef.current = { kind: 'move', ids, primary: id, startX: x, startCX: e.clientX, startCY: e.clientY, origStart: loc.clip.start, base: project, moved: false, clickedSelected: wasSelected, id };
        setActive(ids);
      }
      return;
    }
    if (target.closest('.vx-tl-lane, .vx-tl-body')) {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!additive && selection.length) setSelection([]);
      if (e.pointerType === 'touch') return; // en táctil, el dedo desplaza; la caja es solo con ratón/lápiz
      capture(el, e.pointerId);
      dragRef.current = { kind: 'box', x0: x, y0: y, base: additive ? selection : [], additive, moved: false };
    }
  };

  const processMoveNow = () => {
    if (moveRaf.current) cancelAnimationFrame(moveRaf.current);
    processMove();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' && touches.current.has(String(e.pointerId))) {
      touches.current.set(String(e.pointerId), { x: e.clientX, y: e.clientY });
      const pz = pinch.current;
      if (pz && touches.current.size >= 2) {
        const pts = [...touches.current.values()];
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const el = scroller.current!;
        const next = T.clampPps(pz.pps0 * (d / pz.d0));
        const cx = Math.max(0, (pts[0].x + pts[1].x) / 2 - el.getBoundingClientRect().left - headerW);
        pendingScroll.current = Math.max(0, pz.anchorT * next - cx);
        if (next !== pps) setPps(next);
        return;
      }
    }
    if (!dragRef.current) return;
    lastPtr.current = { x: e.clientX, y: e.clientY, alt: e.altKey, shift: e.shiftKey };
    schedule();
    if (!autoRaf.current && dragRef.current.kind !== 'scrub') autoRaf.current = requestAnimationFrame(autoScroll);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') {
      touches.current.delete(String(e.pointerId));
      if (touches.current.size < 2) pinch.current = null;
    }
    const d = dragRef.current;
    const el = scroller.current;
    if (el) release(el, e.pointerId);
    if (!d) return;
    lastPtr.current = { x: e.clientX, y: e.clientY, alt: e.altKey, shift: e.shiftKey };
    if (e.type === 'pointerup') processMoveNow();
    if (d.kind === 'move' || d.kind === 'trim') {
      const result = e.type === 'pointerup' ? previewRef.current : null;
      if (d.moved && result && result !== d.base) {
        commit(() => result, d.kind === 'move' ? 'tl-move' : 'tl-trim');
        endGroup();
      } else if (d.kind === 'move' && !d.moved && d.clickedSelected && selection.length > 1) {
        setSelection([d.id]); // clic sin arrastrar sobre un clip de una selección múltiple
      }
    }
    finishDrag();
  };

  // Escape cancela el arrastre
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragRef.current && dragRef.current.kind !== 'scrub') {
        e.stopPropagation();
        finishDrag();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // ---------- soltar medios y archivos ----------
  const dropTarget = (e: ReactDragEvent) => {
    const row = T.rowAtY(rows, contentY(e.clientY));
    const raw = Math.max(0, contentX(e.clientX) / pps);
    const s = snapOn ? VM.snapTime(project, raw, { threshold: T.snapSeconds(pps), playhead: engine.time }) : { time: raw };
    return { trackId: row?.trackId ?? null, t: Math.max(0, s.time) };
  };
  const hasPayload = (e: ReactDragEvent) => e.dataTransfer.types.includes(MEDIA_MIME) || e.dataTransfer.types.includes('Files');
  /** destino de lo que se arrastra desde las pestañas de transiciones / efectos / ajustes */
  const fxTarget = (e: ReactDragEvent, k: FxKind) => fxDropTarget(project, rows, pps, contentX(e.clientX), contentY(e.clientY), k);
  const onDragOver = (e: ReactDragEvent) => {
    const fk = dragKind(e.dataTransfer.types);
    if (fk) {
      const tgt = fxTarget(e, fk);
      setFxKind(fk);
      setFxDrop(tgt);
      if (tgt) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
      return;
    }
    if (!hasPayload(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDrop(dropTarget(e));
  };
  const onDrop = (e: ReactDragEvent) => {
    const fk = dragKind(e.dataTransfer.types);
    if (fk) {
      e.preventDefault();
      const tgt = fxTarget(e, fk);
      const payload = decodePayload(e.dataTransfer.getData(FX_MIME));
      setFxDrop(null);
      setFxKind(null);
      if (tgt && payload) {
        const next = applyPayload(project, tgt.clipId, payload, tgt.mode === 'clip' ? 'auto' : tgt.mode);
        if (next !== project) {
          commit(() => next);
          setSelection([tgt.clipId]);
        }
      }
      return;
    }
    if (!hasPayload(e)) return;
    e.preventDefault();
    const tgt = dropTarget(e);
    setDrop(null);
    const id = e.dataTransfer.getData(MEDIA_MIME);
    if (id) onDropMedia(id, tgt.trackId, tgt.t);
    else if (e.dataTransfer.files.length) onDropFiles([...e.dataTransfer.files], tgt.trackId, tgt.t);
  };

  // ---------- pistas ----------
  const onTrackChange = useCallback(
    (id: string, patch: Parameters<typeof VM.updateTrack>[2]) => commit((p) => VM.updateTrack(p, id, patch), patch.name !== undefined ? 'tname:' + id : undefined),
    [commit],
  );
  const onTrackRemove = useCallback((id: string) => commit((p) => VM.removeTrack(p, id)), [commit]);

  const selSet = useMemo(() => new Set(selection), [selection]);
  const always = activeIds;
  const ticks = T.rulerTicks(pps, win.t0, win.t1);
  // V7: marcas de ritmo en la regla (solo las de la ventana visible)
  const showBeats = !!project.audio?.showBeats;
  const beatMarks = useMemo(() => (showBeats ? projectBeatMarks(project) : []), [showBeats, project]);
  const beatsShown = showBeats ? beatMarks.filter((b) => b >= win.t0 - 1 && b <= win.t1 + 1) : [];
  const step = T.rulerStep(pps);
  const ruleW = laneW;
  const mi = marks?.in ?? null;
  const mo = marks?.out ?? null;
  const markBand = mi === null && mo === null ? null : mi !== null && mo !== null ? { l: Math.min(mi, mo), w: Math.abs(mo - mi), title: 'Rango entre marcas (I / O)' } : { l: (mi ?? mo)!, w: 0, title: mi !== null ? 'Marca de entrada (I)' : 'Marca de salida (O)' };
  const empty = tracks.length === 0;

  return (
    <div className="vx-tl-wrap">
      <div
        ref={scroller}
        className={`vx-tl-scroll${compact ? ' compact' : ''}`}
        style={{ ['--hw' as string]: `${headerW}px`, ['--rh' as string]: `${T.RULER_H}px` }}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDrop(null);
            setFxDrop(null);
            setFxKind(null);
          }
        }}
        onDrop={onDrop}
        role="application"
        aria-label="Línea de tiempo multipista"
        data-testid="timeline"
      >
        <div className="vx-tl-inner" style={{ width: headerW + laneW, height: T.RULER_H + Math.max(bodyH, 60) }}>
          <div className="vx-tl-rulerrow">
            <div className="vx-tl-corner" style={{ width: headerW }}>
              <span className="vx-tl-count">{tracks.length} {tracks.length === 1 ? 'pista' : 'pistas'}</span>
            </div>
            <div className="vx-tl-ruler" data-ruler style={{ width: ruleW }}>
              {ticks.map((k) => (
                <div key={k.t} className={`vx-tick${k.major ? ' major' : ''}`} style={{ left: k.t * pps }}>
                  {k.major && <span>{T.formatRuler(k.t, step)}</span>}
                </div>
              ))}
              {beatsShown.map((b, i) => (
                <div key={`b${b}-${i}`} className="vx-beat" style={{ left: b * pps }} aria-hidden="true" />
              ))}
              {markBand && <div className="vx-marks" style={{ left: markBand.l * pps, width: Math.max(2, markBand.w * pps) }} title={markBand.title} />}
              <div ref={headRef} className="vx-ph-head" data-ph role="slider" aria-label="Cabezal" aria-valuemin={0} aria-valuemax={Math.round(dur * 10) / 10} aria-valuenow={Math.round(engine.time * 10) / 10} tabIndex={-1} />
            </div>
          </div>
          <div className="vx-tl-body" style={{ height: Math.max(bodyH, 60) }}>
            {rows.map((row) => {
              const track = VM.findTrack(shown, row.trackId)!;
              const vis = T.visibleClips(track, win, dur, always);
              const isDrop = drop?.trackId === row.trackId;
              return (
                <div key={row.trackId} className={`vx-tl-row k-${row.kind}${isDrop ? ' drop' : ''}${track.hidden ? ' hidden' : ''}${track.muted ? ' muted' : ''}${track.locked ? ' locked' : ''}`} style={{ height: row.h }}>
                  <TrackHeader track={track} onChange={onTrackChange} onRemove={onTrackRemove} />
                  <div className="vx-tl-lane" role="group" aria-label={`Clips de ${track.name}`} style={{ width: laneW }}>
                    {vis.map((c) => {
                      const m = c.mediaId ? shown.media[c.mediaId] : undefined;
                      return (
                        <ClipView
                          key={c.id}
                          clip={c}
                          trackKind={track.kind}
                          locked={track.locked}
                          selected={selSet.has(c.id)}
                          pps={pps}
                          end={T.drawEnd(c, dur)}
                          media={m}
                          strip={m ? cache.stripOf(m.id) : undefined}
                          wave={m ? cache.waveOf(m.id) : undefined}
                          active={activeIds.has(c.id)}
                          tinPx={(fxInfo.edges.get(c.id)?.tin ?? 0) * pps}
                          toutPx={(fxInfo.edges.get(c.id)?.tout ?? 0) * pps}
                        />
                      );
                    })}
                    {selection.length === 1 && vis.map((c) => (selSet.has(c.id) && c.keys ? <KeyRow key={'k' + c.id} clip={c} width={Math.max(2, (T.drawEnd(c, dur) - c.start) * pps)} pps={pps} engine={engine} commit={commit} locked={track.locked} /> : null))}
                    {(fxInfo.joins.get(track.id) ?? [])
                      .filter((m) => (m.dur > 0 || fxKind === 'transition') && m.cut >= win.t0 - 2 && m.cut <= win.t1 + 2)
                      .map((m) => {
                        const wpx = Math.max(24, m.dur * pps);
                        const hot = fxDrop?.mode === 'junction' && fxDrop.clipId === m.bId;
                        return (
                          <button
                            key={m.bId}
                            type="button"
                            className={`vx-jn${m.type ? ' has' : ''}${fxKind === 'transition' ? ' plus' : ''}${hot ? ' hot' : ''}`}
                            style={{ left: m.cut * pps - wpx / 2, width: wpx }}
                            onClick={() => setSelection([m.bId])}
                            title={m.type ? `Transición «${m.label}», ${m.dur.toFixed(2)} s (centrada en el corte). Clic: seleccionar el clip para editarla` : 'Unión sin transición: suelta aquí una transición'}
                            aria-label={m.type ? `Transición «${m.label}» de ${m.dur.toFixed(1)} segundos en la unión; seleccionar el clip siguiente` : 'Unión de dos clips: zona para soltar una transición'}
                          >
                            {m.type && <span className="vx-jn-win" style={{ width: m.dur * pps }} aria-hidden="true" />}
                            <span className="vx-jn-ic" aria-hidden="true">{m.type ? '◇' : '＋'}</span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              );
            })}
            {empty && (
              <div className="vx-tl-empty" style={{ left: headerW }}>
                Arrastra aquí video, imágenes o audio, o usa «＋ Importar».
                <div>
                  <button type="button" onClick={() => onAddTrack('video')}>＋ Pista de video</button> <button type="button" onClick={() => onAddTrack('audio')}>＋ Pista de audio</button>
                </div>
              </div>
            )}
            {drop && <div className="vx-drop-line" style={{ left: headerW + drop.t * pps }} />}
          </div>
          <div ref={lineRef} className="vx-ph-line" style={{ left: headerW }} />
          {fxDrop && <div className="vx-fxdrop" style={{ left: headerW + fxDrop.rect.x, top: T.RULER_H + fxDrop.rect.y, width: fxDrop.rect.w, height: fxDrop.rect.h }} />}
          {guide !== null && <div className="vx-guide" style={{ left: headerW + guide * pps }} />}
          {box && (
            <div
              className="vx-box"
              style={{
                left: headerW + Math.min(box.x0, box.x1),
                top: T.RULER_H + Math.min(box.y0, box.y1),
                width: Math.abs(box.x1 - box.x0),
                height: Math.abs(box.y1 - box.y0),
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
