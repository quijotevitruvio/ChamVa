import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import type { Doc, ImageLayer } from '../core/types';
import { useEditor } from '../state/store';
import { isLayerLocked } from '../core/pageOps';
import {
  RetouchStroke,
  buildPatchJob,
  buildSpotJob,
  cloneOffsetForStroke,
  newCloneSource,
  setCloneOrigin,
  sourceMapper,
  unionRect,
  writeRegion,
  type CloneSource,
  type Rect,
  type RetouchTool,
  type Sampler,
  type SourceMapper,
} from '../core/retouch';
import { runPoissonAsync } from '../core/retouchAsync';
import { bumpLive, setShowBefore } from '../core/retouchLive';
import { closeSession, ensureSession, flushRegion, getSession, imageLayerAt, selectionLimit, strokeDone, useRetouchOpts, type RetouchSession } from '../state/retouchSession';
import { currentSel } from '../state/pixelOps';
import { selBounds } from '../core/selection';
import { renderDocToCanvas } from '../../io/export';
import { toast } from '../../ui/toast';
import '../../ui/brush.css';

// Retoque de píxeles sobre la capa de imagen bajo el puntero: Clonar (Alt+clic fija el origen), Curar
// (pincel corrector o parche con la selección), Eliminar mancha (clic), Esquivar/Quemar, Desenfocar,
// Enfocar y Dedo. Trabaja en píxeles de la FUENTE de la capa (la capa puede estar girada, recortada,
// volteada o con máscara). Cada trazo = un paso de deshacer del documento.

const FRAME_BUDGET_MS = 50;

interface Run {
  id: number;
  layer: ImageLayer;
  session: RetouchSession;
  mapper: SourceMapper;
  stroke: RetouchStroke;
  radius: number;
  offset: [number, number] | null;
  last: [number, number]; // última gota en píxeles de la fuente
  rest: number; // distancia pendiente hasta la próxima gota
  spacingMul: number;
  lastBump: number;
  dodgeSign: boolean;
}

interface PatchRun {
  id: number;
  layer: ImageLayer;
  session: RetouchSession;
  mapper: SourceMapper;
  start: [number, number]; // en documento
  rect: Rect; // caja de la selección en la fuente
  plane: Uint8Array;
  box: { x: number; y: number; w: number; h: number }; // caja de la selección en el documento
}

export function RetouchOverlay({ doc, scale, stageRef, tool }: { doc: Doc; scale: number; stageRef: React.RefObject<Konva.Stage | null>; tool: RetouchTool }) {
  const o = useRetouchOpts((s) => s.o);
  const hostRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const srcRingRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const patchBoxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const run = useRef<Run | null>(null);
  const patch = useRef<PatchRun | null>(null);
  const clone = useRef<{ layerId: string | null; cs: CloneSource }>({ layerId: null, cs: newCloneSource(true) });
  const abort = useRef<AbortController | null>(null);
  const flat = useRef<{ data: Uint8ClampedArray; w: number; h: number; k: number } | null>(null);
  const hover = useRef<{ clientX: number; clientY: number } | null>(null);
  const selectedId = useEditor((s) => s.selectedId);
  const locked = !!doc.locked;

  useLayoutEffect(() => {
    const c = stageRef.current?.container();
    if (c) setPos({ left: c.offsetLeft, top: c.offsetTop });
  }, [scale, doc.width, doc.height, stageRef]);

  // El origen alineado/fijo se sigue de las opciones.
  useEffect(() => {
    clone.current.cs = { ...clone.current.cs, aligned: o.aligned };
  }, [o.aligned]);

  // Calienta la sesión de la capa elegida (decodifica la fuente) para que el primer trazo no espere.
  useEffect(() => {
    const l = doc.layers.find((x) => x.id === selectedId);
    if (l && l.type === 'image') void ensureSession(l.id);
    if (clone.current.layerId !== selectedId) clone.current = { layerId: selectedId, cs: newCloneSource(o.aligned) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, doc.id]);

  // Al salir de la herramienta: se guarda lo pendiente y, tras unos segundos, se libera la memoria.
  useEffect(() => {
    return () => {
      abort.current?.abort();
      const ids = new Set<string>();
      for (const l of useEditor.getState().doc.layers) if (l.type === 'image') ids.add(l.id);
      window.setTimeout(() => {
        if (!document.querySelector('[data-testid="retouch-overlay"]')) for (const id of ids) void closeSession(id);
      }, 8000);
    };
  }, []);

  // Muestreo de «todas las capas»: documento aplanado (se refresca al cambiar las capas).
  useEffect(() => {
    if (!o.sampleAll || (tool !== 'clone' && tool !== 'heal')) {
      flat.current = null;
      return;
    }
    let dead = false;
    const t = window.setTimeout(async () => {
      try {
        const k = Math.min(1, 2048 / Math.max(doc.width, doc.height));
        const c = await renderDocToCanvas(doc, k);
        if (dead) return;
        flat.current = { data: c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height, k };
      } catch {
        flat.current = null;
      }
    }, 250);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [o.sampleAll, tool, doc]);

  // [ ] cambian el tamaño; «\» mantenido enseña la imagen sin retoque (antes/después).
  useEffect(() => {
    const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest('input,textarea,select,[contenteditable="true"]');
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (e.key === '\\') {
        e.preventDefault();
        setShowBefore(true);
        stageRef.current?.batchDraw();
      } else if ((e.key === '[' || e.key === ']') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const s = useRetouchOpts.getState();
        const n = s.o.size;
        s.set({ size: e.key === '[' ? Math.max(1, Math.min(n - 2, Math.round(n / 1.15))) : Math.min(2000, Math.max(n + 2, Math.round(n * 1.15))) });
      } else if (e.key === 'Escape') abort.current?.abort();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === '\\') {
        setShowBefore(false);
        stageRef.current?.batchDraw();
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      setShowBefore(false);
    };
  }, [stageRef]);

  const docPoint = (e: { clientX: number; clientY: number }): [number, number] => {
    const rc = hostRef.current!.getBoundingClientRect();
    return [(e.clientX - rc.left) / scale, (e.clientY - rc.top) / scale];
  };

  const flatSampler = (m: SourceMapper): Sampler | undefined => {
    const f = flat.current;
    if (!f) return undefined;
    return (x, y) => {
      const [dx, dy] = m.fromSrc(x + 0.5, y + 0.5);
      const ix = Math.min(f.w - 1, Math.max(0, Math.floor(dx * f.k)));
      const iy = Math.min(f.h - 1, Math.max(0, Math.floor(dy * f.k)));
      const i = (iy * f.w + ix) * 4;
      return [f.data[i], f.data[i + 1], f.data[i + 2], f.data[i + 3]];
    };
  };

  // --- anillos y vista previa del origen --------------------------------------------------
  const place = (el: HTMLElement | null, cx: number, cy: number, d: number) => {
    if (!el) return;
    el.style.width = el.style.height = `${d}px`;
    el.style.transform = `translate(${cx - d / 2}px, ${cy - d / 2}px)`;
    el.style.opacity = '1';
  };

  const updateRings = (clientX: number, clientY: number) => {
    const host = hostRef.current;
    if (!host) return;
    const rc = host.getBoundingClientRect();
    const d = Math.max(6, useRetouchOpts.getState().o.size * scale);
    const cx = clientX - rc.left;
    const cy = clientY - rc.top;
    place(ringRef.current, cx, cy, d);
    const withSrc = tool === 'clone' || tool === 'heal';
    const src = srcRingRef.current;
    const mark = markRef.current;
    const prev = previewRef.current;
    if (!withSrc) {
      if (src) src.style.opacity = '0';
      if (mark) mark.style.opacity = '0';
      if (prev) prev.style.opacity = '0';
      return;
    }
    const cs = clone.current.cs;
    const l = (run.current?.layer ?? doc.layers.find((x) => x.id === clone.current.layerId)) as ImageLayer | undefined;
    const s = l ? useEditor.getState().doc.layers.find((x) => x.id === l.id) : null;
    if (!cs.src || !s || s.type !== 'image') {
      if (src) src.style.opacity = '0';
      if (mark) mark.style.opacity = '0';
      if (prev) prev.style.opacity = '0';
      return;
    }
    const sess = getSession(s.id);
    const m = sess ? sourceMapper(s, sess.w, sess.h) : null;
    if (!m) return;
    // Marca fija del origen (Alt+clic).
    const [mx, my] = m.fromSrc(cs.src[0], cs.src[1]);
    place(mark, mx * scale, my * scale, 14);
    // Anillo que sigue al pincel con el desplazamiento del origen (alineado o durante el trazo).
    const off = run.current?.offset ?? (cs.aligned ? cs.offset : null);
    const [px, py] = m.toSrc(cx / scale, cy / scale);
    const sx = off ? px + off[0] : cs.src[0];
    const sy = off ? py + off[1] : cs.src[1];
    const [sdx, sdy] = m.fromSrc(sx, sy);
    place(src, sdx * scale, sdy * scale, d);
    // Vista previa en vivo: lo que se va a copiar, dentro del círculo del origen.
    if (prev && sess) {
      const r = Math.max(1, useRetouchOpts.getState().o.size / 2) * m.pxPerDoc;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const side = Math.max(8, Math.round(d * dpr));
      if (prev.width !== side) {
        prev.width = side;
        prev.height = side;
      }
      prev.style.width = prev.style.height = `${d}px`;
      prev.style.transform = `translate(${cx - d / 2}px, ${cy - d / 2}px)`;
      const c = prev.getContext('2d')!;
      c.clearRect(0, 0, side, side);
      c.save();
      c.beginPath();
      c.arc(side / 2, side / 2, side / 2, 0, Math.PI * 2);
      c.clip();
      c.drawImage(sess.canvas, sx - r, sy - r, r * 2, r * 2, 0, 0, side, side);
      c.restore();
      prev.style.opacity = '0.55';
    }
  };

  // --- trazos ---------------------------------------------------------------------------------
  const redraw = () => stageRef.current?.batchDraw();

  const dab = (rn: Run, x: number, y: number): Rect | null => {
    const st = rn.stroke;
    switch (tool) {
      case 'clone':
        return st.clone(x, y, rn.offset![0], rn.offset![1]);
      case 'heal':
        return st.heal(x, y, rn.offset![0], rn.offset![1]);
      case 'dodge':
      case 'burn':
        return st.dodgeBurn(x, y, rn.dodgeSign);
      case 'blur':
        return st.filter(x, y, false);
      case 'sharpen':
        return st.filter(x, y, true);
      case 'smudge':
        return st.smudge(x, y);
      default:
        return null;
    }
  };

  const spacingFor = (rn: Run) => Math.max(1, rn.radius * (tool === 'smudge' ? 0.15 : 0.3) * rn.spacingMul);

  const advance = (rn: Run, to: [number, number]): Rect | null => {
    let dirty: Rect | null = null;
    const sp = spacingFor(rn);
    const dist = Math.hypot(to[0] - rn.last[0], to[1] - rn.last[1]);
    if (dist + rn.rest < sp) {
      rn.rest += dist;
      rn.last = to;
      return null;
    }
    // Gotas a lo largo del segmento, respetando la distancia sobrante del tramo anterior.
    let t = sp - rn.rest;
    const ux = (to[0] - rn.last[0]) / (dist || 1);
    const uy = (to[1] - rn.last[1]) / (dist || 1);
    while (t <= dist) {
      const r = dab(rn, rn.last[0] + ux * t, rn.last[1] + uy * t);
      dirty = unionRect(dirty, r);
      t += sp;
    }
    rn.rest = dist - (t - sp);
    rn.last = to;
    return dirty;
  };

  const onDown = async (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const host = e.currentTarget as HTMLElement;
    try {
      host.setPointerCapture(e.pointerId);
    } catch {
      /* sin captura */
    }
    if (locked) return toast('La página está bloqueada.', 'info');
    const st = useEditor.getState();
    const [dx, dy] = docPoint(e);
    const layer = imageLayerAt(st.doc, dx, dy, st.selectedId);
    if (!layer) return toast('El retoque actúa sobre una capa de imagen: haz clic sobre una foto.', 'info');
    if (isLayerLocked(st.doc, layer)) return toast('La capa está bloqueada.', 'info');
    if (st.selectedId !== layer.id) st.selectLayer(layer.id);
    if (clone.current.layerId !== layer.id) clone.current = { layerId: layer.id, cs: newCloneSource(useRetouchOpts.getState().o.aligned) };
    const id = e.pointerId;
    const altKey = e.altKey;
    const session = await ensureSession(layer.id);
    if (!session) return toast('No se pudo abrir la imagen para retocar.', 'error');
    const mapper = sourceMapper(layer, session.w, session.h);
    if (!mapper) return;
    const [sx, sy] = mapper.toSrc(dx, dy);
    const opts = useRetouchOpts.getState().o;
    const withOrigin = tool === 'clone' || tool === 'heal';

    // Alt+clic: fija el origen (clonar / curar con pincel).
    if (withOrigin && altKey && !(tool === 'heal' && opts.healMode === 'patch')) {
      clone.current.cs = setCloneOrigin(clone.current.cs, Math.round(sx), Math.round(sy));
      updateRings(e.clientX, e.clientY);
      return;
    }

    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const radius = Math.max(0.5, (opts.size / 2) * mapper.pxPerDoc);
    const limit = selectionLimit(layer, session.w, session.h);

    // Eliminar mancha: un clic.
    if (tool === 'spot') {
      const job = buildSpotJob(session.work, sx, sy, radius, Math.max(0.3, opts.hardness), limit);
      if (!job) return;
      try {
        const out = await runPoissonAsync(job, ctrl.signal);
        writeRegion(session.work, job.rect, out);
        flushRegion(session, job.rect);
        strokeDone(session, job.rect);
        bumpLive(layer.id);
        redraw();
      } catch (er) {
        if ((er as Error)?.name !== 'AbortError') toast('No se pudo eliminar la mancha.', 'error');
      }
      return;
    }

    // Parche: arrastra la selección sobre la zona de origen.
    if (tool === 'heal' && opts.healMode === 'patch') {
      const sel = currentSel();
      if (!sel) return toast('Para el parche, primero selecciona la zona con el lazo o la varita.', 'info');
      const b = selBounds(sel.data, sel.w, sel.h);
      if (!b) return;
      const box = { x: b.x / sel.scale, y: b.y / sel.scale, w: b.w / sel.scale, h: b.h / sel.scale };
      if (dx < box.x || dy < box.y || dx > box.x + box.w || dy > box.y + box.h) return toast('Empieza a arrastrar dentro de la selección.', 'info');
      const corners = [mapper.toSrc(box.x, box.y), mapper.toSrc(box.x + box.w, box.y), mapper.toSrc(box.x, box.y + box.h), mapper.toSrc(box.x + box.w, box.y + box.h)];
      const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))));
      const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))));
      const x1 = Math.min(session.w, Math.ceil(Math.max(...corners.map((c) => c[0]))));
      const y1 = Math.min(session.h, Math.ceil(Math.max(...corners.map((c) => c[1]))));
      const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      if (rect.w < 2 || rect.h < 2) return toast('La selección queda fuera de esta imagen.', 'info');
      if (rect.w * rect.h > 4_000_000) return toast('La selección es demasiado grande para el parche: acótala.', 'info');
      const lim = selectionLimit(layer, session.w, session.h)!;
      const plane = new Uint8Array(rect.w * rect.h);
      for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) plane[y * rect.w + x] = Math.round(lim(rect.x + x, rect.y + y) * 255);
      patch.current = { id, layer, session, mapper, start: [dx, dy], rect, plane, box };
      const pb = patchBoxRef.current;
      if (pb) {
        pb.style.width = `${box.w * scale}px`;
        pb.style.height = `${box.h * scale}px`;
        pb.style.transform = `translate(${box.x * scale}px, ${box.y * scale}px)`;
        pb.style.opacity = '1';
      }
      return;
    }

    // Pinceles.
    let offset: [number, number] | null = null;
    if (withOrigin) {
      const r = cloneOffsetForStroke(clone.current.cs, sx, sy);
      if (!r) return toast('Alt+clic para fijar el origen que se va a copiar.', 'info');
      clone.current.cs = r.state;
      offset = r.offset;
    }
    const stroke = new RetouchStroke(session.work, {
      tool,
      radius,
      hardness: opts.hardness,
      opacity: opts.opacity,
      range: opts.range,
      exposure: opts.exposure,
      limit,
      sampler: withOrigin && opts.sampleAll ? flatSampler(mapper) : undefined,
    });
    const rn: Run = { id, layer, session, mapper, stroke, radius, offset, last: [sx, sy], rest: 0, spacingMul: 1, lastBump: 0, dodgeSign: (tool === 'dodge') !== altKey };
    run.current = rn;
    const d0 = dab(rn, sx, sy);
    if (d0) flushRegion(session, d0);
    bumpLive(layer.id);
    redraw();
    updateRings(e.clientX, e.clientY);
  };

  const onMove = (e: React.PointerEvent) => {
    hover.current = { clientX: e.clientX, clientY: e.clientY };
    updateRings(e.clientX, e.clientY);
    const pr = patch.current;
    if (pr && pr.id === e.pointerId) {
      const [dx, dy] = docPoint(e);
      const pb = patchBoxRef.current;
      if (pb) pb.style.transform = `translate(${(pr.box.x + dx - pr.start[0]) * scale}px, ${(pr.box.y + dy - pr.start[1]) * scale}px)`;
      return;
    }
    const rn = run.current;
    if (!rn || rn.id !== e.pointerId) return;
    const t0 = performance.now();
    const native = e.nativeEvent as PointerEvent;
    const evs = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    let dirty: Rect | null = null;
    for (const ev of evs.length ? evs : [native]) {
      const [dx, dy] = docPoint(ev);
      dirty = unionRect(dirty, advance(rn, rn.mapper.toSrc(dx, dy)));
    }
    if (dirty) {
      flushRegion(rn.session, dirty);
      // Si un cuadro tarda demasiado, las gotas siguientes se espacian más (la interfaz no se congela).
      if (performance.now() - t0 > FRAME_BUDGET_MS) rn.spacingMul = Math.min(3, rn.spacingMul * 1.4);
      const now = performance.now();
      if (now - rn.lastBump > 100) {
        rn.lastBump = now;
        bumpLive(rn.layer.id);
      }
      redraw();
    }
  };

  const finish = async (e: React.PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ya liberado */
    }
    const pr = patch.current;
    if (pr && pr.id === e.pointerId) {
      patch.current = null;
      if (patchBoxRef.current) patchBoxRef.current.style.opacity = '0';
      const [dx, dy] = docPoint(e);
      const [s0x, s0y] = pr.mapper.toSrc(pr.start[0], pr.start[1]);
      const [s1x, s1y] = pr.mapper.toSrc(dx, dy);
      const ox = Math.round(s1x - s0x);
      const oy = Math.round(s1y - s0y);
      if (Math.abs(ox) + Math.abs(oy) < 2) return;
      const ctrl = new AbortController();
      abort.current?.abort();
      abort.current = ctrl;
      try {
        const job = buildPatchJob(pr.session.work, pr.rect, pr.plane, ox, oy);
        const out = await runPoissonAsync(job, ctrl.signal);
        writeRegion(pr.session.work, job.rect, out);
        flushRegion(pr.session, job.rect);
        strokeDone(pr.session, job.rect);
        bumpLive(pr.layer.id);
        redraw();
      } catch (er) {
        if ((er as Error)?.name !== 'AbortError') toast('No se pudo aplicar el parche.', 'error');
      }
      return;
    }
    const rn = run.current;
    if (!rn || rn.id !== e.pointerId) return;
    run.current = null;
    // Alineado: tras soltar, el origen sigue al pincel; fijo: vuelve al punto de origen.
    if (rn.stroke.dirty) {
      flushRegion(rn.session, rn.stroke.dirty);
      strokeDone(rn.session, rn.stroke.dirty);
    }
    bumpLive(rn.layer.id);
    redraw();
  };

  if (!pos) return null;
  return (
    <div
      ref={hostRef}
      className={`brush-overlay retouch-overlay${locked ? ' is-locked' : ''}`}
      style={{ left: pos.left, top: pos.top, width: doc.width * scale, height: doc.height * scale, cursor: 'none' }}
      role="application"
      aria-label={`Retoque: ${tool}`}
      data-testid="retouch-overlay"
      data-retouch-tool={tool}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onPointerLeave={() => {
        if (run.current || patch.current) return;
        for (const el of [ringRef.current, srcRingRef.current, previewRef.current]) if (el) el.style.opacity = '0';
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={previewRef} className="retouch-preview" aria-hidden style={{ opacity: 0, position: 'absolute', left: 0, top: 0, borderRadius: '50%', pointerEvents: 'none' }} />
      <div ref={srcRingRef} className="brush-ring retouch-src-ring" aria-hidden data-testid="retouch-src-ring" style={{ opacity: 0, borderColor: '#e11d48' }} />
      <div ref={markRef} className="brush-ring retouch-origin-mark" aria-hidden style={{ opacity: 0, borderColor: '#e11d48', borderStyle: 'dashed' }} />
      <div ref={ringRef} className="brush-ring" aria-hidden data-testid="retouch-ring" style={{ opacity: 0 }} />
      <div ref={patchBoxRef} aria-hidden style={{ opacity: 0, position: 'absolute', left: 0, top: 0, border: '1px dashed #e11d48', pointerEvents: 'none', background: 'rgba(225,29,72,.08)' }} />
    </div>
  );
}
