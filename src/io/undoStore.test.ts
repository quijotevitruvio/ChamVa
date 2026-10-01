import { describe, expect, it } from 'vitest';
import type { Doc, Layer } from '../editor/core/types';
import {
  UNDO_SCHEMA,
  UNDO_STEPS,
  buildRecord,
  compactDocs,
  docFingerprint,
  expandDocs,
  pastFromRecord,
  staleDesigns,
} from './undoStore';

const layer = (id: string, x = 0): Layer =>
  ({ id, type: 'shape', kind: 'rect', x, y: 0, width: 50, height: 50, fill: '#123456', name: id, visible: true, locked: false, opacity: 1, rotation: 0 }) as unknown as Layer;

const mkDoc = (layers: Layer[], extra: Partial<Doc> = {}): Doc =>
  ({ id: 'p1', name: 'D', width: 800, height: 600, background: { type: 'solid', color: '#fff' }, layers, version: 1, ...extra }) as Doc;

// Historial inmutable: cada paso mueve UNA capa y reutiliza las demás por referencia.
function history(n: number, layerCount = 30) {
  let layers = Array.from({ length: layerCount }, (_, i) => layer(`l${i}`));
  const docs: Doc[] = [mkDoc(layers)];
  for (let s = 1; s <= n; s++) {
    layers = layers.map((l, i) => (i === s % layerCount ? { ...l, x: s } : l));
    docs.push(mkDoc(layers));
  }
  return docs;
}

describe('compactDocs / expandDocs', () => {
  it('va y vuelve sin perder nada', () => {
    const docs = history(5, 4);
    const back = expandDocs(JSON.parse(JSON.stringify(compactDocs(docs))));
    expect(back).toEqual(docs);
  });

  it('el pool solo guarda las capas distintas (mucho menos que los documentos enteros)', () => {
    const docs = history(20, 30);
    const c = compactDocs(docs);
    expect(c.pool.length).toBe(30 + 20); // 30 originales + 1 nueva por paso
    const naive = JSON.stringify(docs).length;
    const compact = JSON.stringify(c).length;
    expect(compact).toBeLessThan(naive / 5);
  });

  it('un índice roto devuelve null', () => {
    const c = compactDocs(history(2, 3));
    c.steps[1].l[0] = 999;
    expect(expandDocs(c)).toBeNull();
    expect(expandDocs(null as never)).toBeNull();
  });
});

describe('docFingerprint', () => {
  it('no depende del orden de claves ni de undefined', () => {
    const a = mkDoc([layer('a')]);
    const b = { layers: a.layers, version: 1, background: a.background, height: 600, width: 800, name: 'D', id: 'p1', guides: undefined } as unknown as Doc;
    expect(docFingerprint(a)).toBe(docFingerprint(b));
  });
  it('cambia si cambia el contenido', () => {
    expect(docFingerprint(mkDoc([layer('a', 1)]))).not.toBe(docFingerprint(mkDoc([layer('a', 2)])));
  });
});

describe('buildRecord / pastFromRecord', () => {
  const docs = history(30, 5);
  const past = docs.slice(0, -1);
  const cur = docs[docs.length - 1];

  it('sin pasos no hay registro', () => {
    expect(buildRecord('d1', [], cur)).toBeNull();
  });

  it('guarda como mucho los últimos 20 pasos y los restaura iguales', () => {
    const rec = buildRecord('d1', past, cur)!;
    expect(rec.hist.steps.length).toBe(UNDO_STEPS + 1);
    const back = pastFromRecord(JSON.parse(JSON.stringify(rec)), 'd1', cur)!;
    expect(back.length).toBe(UNDO_STEPS);
    expect(back).toEqual(past.slice(-UNDO_STEPS));
  });

  it('descarta si el documento abierto ya no coincide', () => {
    const rec = buildRecord('d1', past, cur)!;
    const changed = mkDoc(cur.layers.map((l, i) => (i === 0 ? { ...l, x: 9999 } : l)));
    expect(pastFromRecord(rec, 'd1', changed)).toBeNull();
  });

  it('descarta otro esquema, otro diseño u otra página', () => {
    const rec = buildRecord('d1', past, cur)!;
    expect(pastFromRecord({ ...rec, schema: UNDO_SCHEMA + 1 }, 'd1', cur)).toBeNull();
    expect(pastFromRecord(rec, 'otro', cur)).toBeNull();
    expect(pastFromRecord(rec, 'd1', { ...cur, id: 'p2' })).toBeNull();
    expect(pastFromRecord(null, 'd1', cur)).toBeNull();
  });

  it('descarta un registro con la huella manipulada', () => {
    const rec = buildRecord('d1', past, cur)!;
    expect(pastFromRecord({ ...rec, fp: 'x' }, 'd1', cur)).toBeNull();
  });
});

describe('staleDesigns', () => {
  it('quita los más viejos de 30 días y los que pasan de 15', () => {
    const now = 100 * 86_400_000;
    const idx: Record<string, number> = { viejo: now - 40 * 86_400_000 };
    for (let i = 0; i < 16; i++) idx[`d${i}`] = now - i * 1000;
    const gone = staleDesigns(idx, now);
    expect(gone).toContain('viejo');
    expect(gone).toContain('d15');
    expect(gone.length).toBe(2);
  });
});
