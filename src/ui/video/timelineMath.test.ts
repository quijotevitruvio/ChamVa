import { describe, expect, it } from 'vitest';
import * as VM from '../../video/model';
import * as T from './timelineMath';

function proj() {
  let p = VM.createProject();
  p = VM.addTrack(p, 'video', { id: 'V2', name: 'V2' });
  p = VM.addTrack(p, 'video', { id: 'V1' }); // V1 queda encima de V2 (índice 0)
  p = VM.addTrack(p, 'audio', { id: 'A1' });
  p = VM.addMedia(p, { id: 'm', kind: 'video', name: 'm', duration: 60 });
  p = VM.addClip(p, 'V1', VM.makeClip('video', { id: 'a', mediaId: 'm', start: 0, outP: 4 }));
  p = VM.addClip(p, 'V1', VM.makeClip('video', { id: 'b', mediaId: 'm', start: 6, outP: 3 }));
  p = VM.addClip(p, 'V2', VM.makeClip('video', { id: 'c', mediaId: 'm', start: 2, outP: 2 }));
  p = VM.addClip(p, 'A1', VM.makeClip('audio', { id: 'd', mediaId: 'm', start: 1, outP: 5 }));
  return p;
}

describe('escala tiempo ↔ píxeles', () => {
  it('convierte ida y vuelta y limita el zoom', () => {
    expect(T.timeToPx(2.5, 40)).toBe(100);
    expect(T.pxToTime(100, 40)).toBe(2.5);
    expect(T.clampPps(0.1)).toBe(T.MIN_PPS);
    expect(T.clampPps(99999)).toBe(T.MAX_PPS);
    expect(T.clampPps(NaN)).toBe(T.DEFAULT_PPS);
  });
  it('el zoom mantiene fijo el instante bajo el ancla', () => {
    const r = T.zoomAround(50, 2, 300, 100); // bajo el ancla: (100+300)/50 = 8 s
    expect(r.pps).toBe(100);
    expect((r.scrollLeft + 300) / r.pps).toBeCloseTo(8, 9);
  });
  it('el zoom en el borde izquierdo no da scroll negativo', () => {
    expect(T.zoomAround(100, 0.1, 500, 0).scrollLeft).toBeGreaterThanOrEqual(0);
  });
  it('ajustar a todo cabe en la vista', () => {
    const pps = T.fitPps(20, 1000, 20);
    expect(pps * 20).toBeLessThanOrEqual(1000 - 40 + 1e-9);
    expect(T.fitPps(0, 1000)).toBe(T.DEFAULT_PPS);
  });
});

describe('regla', () => {
  it('elige un paso con al menos 80 px entre marcas principales', () => {
    for (const pps of [3, 10, 60, 300, 800]) expect(T.rulerStep(pps) * pps).toBeGreaterThanOrEqual(80);
  });
  it('las marcas principales caen en múltiplos del paso', () => {
    const step = T.rulerStep(60);
    const ticks = T.rulerTicks(60, 0, 30);
    for (const k of ticks.filter((x) => x.major)) expect(Math.abs(k.t / step - Math.round(k.t / step))).toBeLessThan(1e-6);
    expect(ticks.some((k) => !k.major)).toBe(true);
    expect(ticks.every((k) => k.t >= 0)).toBe(true);
  });
  it('formatea tiempos', () => {
    expect(T.formatRuler(65, 5)).toBe('1:05');
    expect(T.formatRuler(1.5, 0.5)).toBe('0:01.5');
    expect(T.formatClock(75.34)).toBe('1:15.3');
    expect(T.formatClock(-3)).toBe('0:00.0');
  });
});

describe('virtualización', () => {
  it('visibleClips deja fuera lo que no se ve y conserva lo forzado', () => {
    const p = proj();
    const v1 = VM.findTrack(p, 'V1')!;
    expect(T.visibleClips(v1, { t0: 0, t1: 5 }, 9).map((c) => c.id)).toEqual(['a']);
    expect(T.visibleClips(v1, { t0: 5, t1: 20 }, 9).map((c) => c.id)).toEqual(['b']);
    expect(T.visibleClips(v1, { t0: 4.5, t1: 5.5 }, 9)).toEqual([]);
    expect(T.visibleClips(v1, { t0: 4.5, t1: 5.5 }, 9, new Set(['a'])).map((c) => c.id)).toEqual(['a']);
  });
  it('renderWindow no cambia dentro del mismo cubo de scroll', () => {
    const a = T.renderWindow(10, 800, 60);
    const b = T.renderWindow(150, 800, 60);
    expect(a.bucket).toBe(b.bucket);
    expect(a.t0).toBe(b.t0);
    expect(T.renderWindow(500, 800, 60).bucket).not.toBe(a.bucket);
  });
  it('la ventana siempre cubre lo visible', () => {
    for (const sl of [0, 123, 999, 5000]) {
      const w = T.renderWindow(sl, 800, 60);
      const vis = T.visibleRange(sl, 800, 60);
      expect(w.t0).toBeLessThanOrEqual(vis.t0 + 1e-9);
      expect(w.t1).toBeGreaterThanOrEqual(vis.t1 - 1e-9);
    }
  });
});

describe('filas y hit-testing', () => {
  const p = proj();
  const rows = T.rowLayout(p);
  const pps = 100;
  it('video arriba (en orden de capas) y audio abajo', () => {
    expect(rows.map((r) => r.trackId)).toEqual(['V1', 'V2', 'A1']);
    expect(rows[1].y).toBe(T.ROW_H.video);
    expect(rows[2].y).toBe(T.ROW_H.video * 2);
    expect(T.rowsHeight(rows)).toBe(T.ROW_H.video * 2 + T.ROW_H.audio);
    expect(T.rowAtY(rows, 10)?.trackId).toBe('V1');
    expect(T.rowAtY(rows, T.ROW_H.video + 5)?.trackId).toBe('V2');
    expect(T.rowAtY(rows, 9999)).toBeNull();
    expect(T.nearestRow(rows, -50)?.trackId).toBe('V1');
    expect(T.nearestRow(rows, 9999)?.trackId).toBe('A1');
  });
  it('acierta el clip y la zona', () => {
    expect(T.hitTest(p, rows, pps, 200, 10)).toEqual({ trackId: 'V1', clipId: 'a', zone: 'body' });
    expect(T.hitTest(p, rows, pps, 2, 10)?.zone).toBe('left');
    expect(T.hitTest(p, rows, pps, 399, 10)?.zone).toBe('right');
    expect(T.hitTest(p, rows, pps, 500, 10)).toBeNull(); // hueco entre a y b
    expect(T.hitTest(p, rows, pps, 250, T.ROW_H.video + 5)?.clipId).toBe('c');
    expect(T.hitTest(p, rows, pps, 150, T.ROW_H.video * 2 + 5)?.clipId).toBe('d');
  });
  it('en clips estrechos la zona de recorte se encoge y queda cuerpo', () => {
    expect(T.zoneAt(5, 15)).toBe('body');
    expect(T.zoneAt(1, 15)).toBe('left');
    expect(T.zoneAt(14, 15)).toBe('right');
  });
  it('un clip «hasta el final» llega al final del proyecto', () => {
    let q = VM.addTrack(p, 'video', { id: 'T', index: 0 });
    q = VM.addClip(q, 'T', VM.makeClip('text', { id: 't', text: 'x', start: 1, outP: 9999, toEnd: true }));
    const r = T.rowLayout(q);
    const dur = VM.projectDuration(q);
    expect(T.clipRect(VM.findClip(q, 't')!.clip, r[0], pps, dur).w).toBeCloseTo((dur - 1) * pps, 6);
  });
});

describe('selección', () => {
  const p = proj();
  const rows = T.rowLayout(p);
  it('caja: selecciona los clips que toca, en varias pistas', () => {
    const ids = T.clipsInBox(p, rows, 100, { x0: 350, y0: 5, x1: 650, y1: T.ROW_H.video + 20 }).sort();
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(T.clipsInBox(p, rows, 100, { x0: 450, y0: 5, x1: 550, y1: 40 })).toEqual([]);
  });
  it('la caja se puede arrastrar en cualquier sentido', () => {
    const a = T.clipsInBox(p, rows, 100, { x0: 0, y0: 5, x1: 50, y1: 20 });
    const b = T.clipsInBox(p, rows, 100, { x0: 50, y0: 20, x1: 0, y1: 5 });
    expect(a).toEqual(b);
    expect(a).toEqual(['a']);
  });
  it('replace / toggle / add', () => {
    expect(T.applySelection(['a', 'b'], 'c', 'replace')).toEqual(['c']);
    expect(T.applySelection(['a', 'b'], 'b', 'toggle')).toEqual(['a']);
    expect(T.applySelection(['a'], 'b', 'toggle')).toEqual(['a', 'b']);
    expect(T.applySelection(['a'], 'a', 'add')).toEqual(['a']);
    expect(T.applySelection(['a'], 'b', 'add')).toEqual(['a', 'b']);
  });
  it('caja con Shift suma; sin Shift sustituye', () => {
    expect(T.mergeBoxSelection(['x'], ['a', 'b'], true).sort()).toEqual(['a', 'b', 'x']);
    expect(T.mergeBoxSelection(['x'], ['a'], false)).toEqual(['a']);
  });
  it('quita ids borrados', () => {
    expect(T.pruneSelection(p, ['a', 'zzz', 'd'])).toEqual(['a', 'd']);
    const same = ['a'];
    expect(T.pruneSelection(p, same)).toBe(same);
  });
});

describe('imán en píxeles', () => {
  const p = proj();
  it('pega el inicio al fin de otro clip dentro de 8 px', () => {
    // 'b' acaba en 9 s; mover 'c' (dur 2) con inicio propuesto a 9,05 s (pps 100: 5 px)
    const r = T.snapMove(p, 'c', 9.05, 100, 50);
    expect(r.time).toBe(9);
    expect(r.target).toBe('clip');
  });
  it('no pega fuera del umbral (y zoom lejano pega más lejos)', () => {
    expect(T.snapMove(p, 'c', 9.2, 100, 50).target).toBeNull(); // 20 px
    expect(T.snapMove(p, 'c', 9.2, 10, 50).target).toBe('clip'); // 2 px
  });
  it('pega al cabezal y al 0', () => {
    expect(T.snapMove(p, 'c', 20.03, 100, 20).target).toBe('playhead');
    expect(T.snapMove(p, 'c', 0.04, 100, 50).time).toBe(0);
  });
  it('pega el FIN del clip arrastrado a un borde', () => {
    // 'c' dura 2 s: fin propuesto 5.97 → 6 (inicio de 'b') ⇒ inicio 4
    const r = T.snapMove(p, 'c', 3.97, 100, 50);
    expect(r.time).toBeCloseTo(4, 9);
  });
  it('desactivado no pega', () => {
    expect(T.snapMove(p, 'c', 9.01, 100, 50, false)).toEqual({ time: 9.01, target: null });
    expect(T.snapEdge(p, 'c', 6.02, 100, 0, false).target).toBeNull();
  });
  it('snapEdge pega un borde recortado', () => {
    expect(T.snapEdge(p, 'c', 6.04, 100, 0).time).toBe(6);
  });
  it('auto-scroll solo cerca de los bordes', () => {
    expect(T.autoScrollSpeed(500, 0, 1000)).toBe(0);
    expect(T.autoScrollSpeed(10, 0, 1000)).toBeLessThan(0);
    expect(T.autoScrollSpeed(995, 0, 1000)).toBeGreaterThan(0);
  });
});
