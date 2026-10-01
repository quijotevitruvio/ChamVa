import { beforeEach, describe, expect, it, vi } from 'vitest';

// IDB falso en memoria: gcAssets debe conservar las imágenes de TODOS los kits
// de marca (y del 'brandLogos' antiguo) y borrar las huérfanas.
const db = new Map<string, unknown>();
vi.mock('./idb', () => ({
  idbGet: async (k: string) => db.get(k) ?? null,
  idbSet: async (k: string, v: unknown) => (db.set(k, v), true),
  idbDelete: async (k: string) => void db.delete(k),
  idbKeys: async (prefix = '') => [...db.keys()].filter((k) => k.startsWith(prefix)),
}));

import { collectRefs, GC_KEYS, gcAssets } from './assets';

const logo = (ref: string) => ({ id: ref, src: ref, naturalWidth: 1, naturalHeight: 1, name: ref });

describe('gcAssets con varios kits de marca', () => {
  beforeEach(() => {
    db.clear();
    for (const r of ['asset:a', 'asset:b', 'asset:c', 'asset:legacy', 'asset:orphan']) db.set(r, 'data:x');
  });

  it('recorre la estructura nueva de kits', () => {
    expect(GC_KEYS).toContain('brandKitLogos');
    expect(GC_KEYS).toContain('brandLogos');
    const live = new Set<string>();
    collectRefs({ k1: [logo('asset:a')], k2: [logo('asset:b'), logo('asset:c')] }, live);
    expect([...live].sort()).toEqual(['asset:a', 'asset:b', 'asset:c']);
  });

  it('conserva los logos de todos los kits y del kit antiguo; borra solo huérfanas', async () => {
    db.set('brandKitLogos', { k1: [logo('asset:a')], k2: [logo('asset:b'), logo('asset:c')] });
    db.set('brandLogos', [logo('asset:legacy')]);
    const removed = await gcAssets();
    expect(removed).toBe(1);
    expect(db.has('asset:orphan')).toBe(false);
    for (const r of ['asset:a', 'asset:b', 'asset:c', 'asset:legacy']) expect(db.has(r)).toBe(true);
  });

  it('un logo quitado de un kit pasa a huérfano', async () => {
    db.set('brandKitLogos', { k1: [logo('asset:a')], k2: [] });
    await gcAssets();
    expect(db.has('asset:a')).toBe(true);
    expect(db.has('asset:b')).toBe(false);
    expect(db.has('asset:c')).toBe(false);
  });
});
