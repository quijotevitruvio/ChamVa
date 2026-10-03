import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Doc, Layer } from '../editor/core/types';

// IndexedDB falso en memoria (como assetsKits.test.ts). `failGet` simula una lectura fallida.
const db = new Map<string, unknown>();
const failGet = new Set<string>();
vi.mock('./idb', () => ({
  idbGet: async (k: string) => (failGet.has(k) ? null : (db.get(k) ?? null)),
  idbSet: async (k: string, v: unknown) => (db.set(k, structuredClone(v)), true),
  idbDelete: async (k: string) => void db.delete(k),
  idbKeys: async (prefix = '') => [...db.keys()].filter((k) => k.startsWith(prefix)),
}));
// Galería, versiones y miniatura no son de esta prueba (sin canvas en node).
vi.mock('./designs', async (orig) => ({ ...(await orig<typeof import('./designs')>()), upsertDesign: async () => true, pushBackup: () => {} }));
vi.mock('./autoVersions', () => ({ maybeSaveAutoVersion: () => {} }));
vi.mock('./export', () => ({ renderDocToCanvas: async () => ({ toDataURL: () => 'thumb' }) }));

import {
  loadTabs,
  parseIndex,
  removeTab,
  resetTabsStoreForTests,
  saveTab,
  saveTabsIndex,
  TABS_KEY,
  tabKey,
} from './tabsStore';
import { collectLiveRefs, collectRefs, dehydrateDocs, gcAssets, GC_KEYS, GC_PREFIXES } from './assets';
import { startAutosave, flushSave, type AutosaveApi, type AutosaveState } from './autosave';
import { parseBackupText, validateBackup, BACKUP_KIND, BACKUP_VERSION } from './backup';

const PNG_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const img = (id: string, src: string): Layer =>
  ({ id, type: 'image', name: id, src, naturalWidth: 1, naturalHeight: 1, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, visible: true, locked: false }) as unknown as Layer;
const page = (id: string, layers: Layer[] = []): Doc =>
  ({ id, name: `Pág ${id}`, width: 100, height: 100, background: { type: 'solid', color: '#fff' }, layers, version: 1 }) as Doc;

async function save(id: string, pages: Doc[], designId: string, index = 0, designName: string | null = null) {
  expect(await saveTab(id, { pages: await dehydrateDocs(pages), index, designId, designName })).toBe(true);
}

beforeEach(() => {
  // assets.ts recuerda en memoria qué imágenes ya están guardadas: se conservan las
  // `asset:*` entre pruebas (como en la app, donde nunca desaparecen solas).
  for (const k of [...db.keys()]) if (!k.startsWith('asset:')) db.delete(k);
  failGet.clear();
  resetTabsStoreForTests();
});

describe('tabsStore: ida y vuelta', () => {
  it('varias pestañas vuelven con su contenido, su orden y la activa (imágenes rehidratadas)', async () => {
    await save('t1', [page('a1', [img('i', PNG_A)])], 'A');
    await save('t2', [page('b1'), page('b2', [img('j', PNG_B)])], 'B', 1, 'Mi diseño B');
    await save('t3', [page('c1')], 'C');
    expect(await saveTabsIndex(['t3', 't1', 't2'], 't1')).toBe(true);
    // Lo guardado lleva referencias, no dataURL.
    expect(JSON.stringify(db.get(tabKey('t1')))).not.toContain('data:image');

    const r = await loadTabs();
    expect(r).not.toBeNull();
    expect(r!.tabs.map((t) => t.id)).toEqual(['t3', 't1', 't2']);
    expect(r!.activeId).toBe('t1');
    expect(r!.dropped).toEqual([]);
    const t1 = r!.tabs[1];
    expect((t1.pages[0].layers[0] as { src: string }).src).toBe(PNG_A);
    const t2 = r!.tabs[2];
    expect(t2).toMatchObject({ designId: 'B', designName: 'Mi diseño B', index: 1 });
    expect((t2.pages[1].layers[0] as { src: string }).src).toBe(PNG_B);
  });

  it('sin índice `tabs` devuelve null (el arranque recupera `autosave`) y no toca nada', async () => {
    db.set('autosave', { pages: [page('x')], index: 0, designId: 'X' });
    const before = JSON.stringify([...db.entries()]);
    expect(await loadTabs()).toBeNull();
    expect(JSON.stringify([...db.entries()])).toBe(before);
  });

  it('una pestaña dañada se descarta y se avisa; las demás sobreviven; nada se borra', async () => {
    await save('t1', [page('a1')], 'A');
    await save('t3', [page('c1')], 'C');
    db.set(tabKey('t2'), { id: 't2', pages: [{ basura: true }] }); // dañada
    await saveTabsIndex(['t1', 't2', 't3'], 't2'); // ¡y era la activa!
    const r = await loadTabs();
    expect(r!.tabs.map((t) => t.id)).toEqual(['t1', 't3']);
    expect(r!.dropped).toEqual(['t2']);
    expect(r!.activeId).toBe('t1'); // la activa dañada: pasa a la primera que queda
    expect(db.has(tabKey('t2'))).toBe(true); // el registro dañado no se borra al leer
  });

  it('un registro que falta (pestaña nueva sin guardar) se omite sin aviso', async () => {
    await save('t1', [page('a1')], 'A');
    await saveTabsIndex(['t1', 'nueva'], 'nueva');
    const r = await loadTabs();
    expect(r!.tabs.map((t) => t.id)).toEqual(['t1']);
    expect(r!.dropped).toEqual([]);
    expect(r!.activeId).toBe('t1');
  });

  it('todas dañadas → null (se cae a `autosave`)', async () => {
    db.set(tabKey('t1'), 'no es un registro');
    await saveTabsIndex(['t1'], 't1');
    expect(await loadTabs()).toBeNull();
  });

  it('dos pestañas con el mismo diseño: gana la activa; la otra queda en IDB sin tocar', async () => {
    await save('t1', [page('a1')], 'A');
    await save('t2', [page('a1')], 'A');
    await saveTabsIndex(['t1', 't2'], 't2');
    const r = await loadTabs();
    expect(r!.tabs.map((t) => t.id)).toEqual(['t2']);
    expect(db.has(tabKey('t1'))).toBe(true);
  });

  it('índice con ids repetidos, vacíos o más de 8: se sanea', () => {
    const order = ['a', 'a', '', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const idx = parseIndex({ order, activeId: 'zz' });
    expect(idx!.order).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(idx!.activeId).toBe('a');
    expect(parseIndex({ order: [] })).toBeNull();
    expect(parseIndex({ v: 99, order: ['a'] })).toBeNull(); // de una versión más nueva
  });
});

describe('tabsStore: escrituras solapadas y cierre', () => {
  it('una ronda vieja que llega tarde no pisa a la nueva', async () => {
    await saveTab('t1', { pages: [page('nuevo')], index: 0, designId: 'A' }, 5);
    await saveTab('t1', { pages: [page('viejo')], index: 0, designId: 'A' }, 4);
    expect((db.get(tabKey('t1')) as { pages: Doc[] }).pages[0].id).toBe('nuevo');
    await saveTabsIndex(['t1', 't2'], 't2', 5);
    await saveTabsIndex(['t1'], 't1', 4);
    expect(db.get(TABS_KEY)).toMatchObject({ order: ['t1', 't2'], activeId: 't2' });
  });

  it('removeTab quita del índice y borra el registro; una escritura tardía no la resucita', async () => {
    await save('t1', [page('a1')], 'A');
    await save('t2', [page('b1')], 'B');
    await saveTabsIndex(['t1', 't2'], 't2');
    await removeTab('t2', { order: ['t1'], activeId: 't1' });
    expect(db.has(tabKey('t2'))).toBe(false);
    expect(db.get(TABS_KEY)).toMatchObject({ order: ['t1'], activeId: 't1' });
    await saveTab('t2', { pages: [page('b1')], index: 0, designId: 'B' }, 99);
    await saveTabsIndex(['t1', 't2'], 't2', 99);
    expect(db.has(tabKey('t2'))).toBe(false);
    expect(db.get(TABS_KEY)).toMatchObject({ order: ['t1'], activeId: 't1' });
  });
});

describe('autosave escribe la pestaña activa y el índice (y `autosave` como siempre)', () => {
  function api(state: AutosaveState): AutosaveApi {
    return { getState: () => state, subscribe: () => () => {} };
  }
  it('con pestañas: `tab:<activa>`, `tabs` y `autosave`; quitar `tabs` = migración sin pérdida', async () => {
    const doc = page('p1', [img('i', PNG_A)]);
    const stop = startAutosave(
      api({ doc, pages: [doc], pageIndex: 0, designId: 'D', designName: 'Nombre', activeTabId: 'T', tabs: [{ id: 'X' }, { id: 'T' }] }),
    );
    expect(await flushSave()).toBe(true);
    stop();
    expect(db.get(TABS_KEY)).toMatchObject({ order: ['X', 'T'], activeId: 'T' });
    expect(db.get(tabKey('T'))).toMatchObject({ id: 'T', designId: 'D', designName: 'Nombre', index: 0 });
    expect(db.get('autosave')).toMatchObject({ designId: 'D', designName: 'Nombre', index: 0 });
    // La pestaña activa y `autosave` guardan lo mismo (compatibilidad hacia atrás).
    expect((db.get('autosave') as { pages: unknown }).pages).toEqual((db.get(tabKey('T')) as { pages: unknown }).pages);

    // «Quitar `tabs` de IDB y arrancar»: loadTabs → null y `autosave` tiene la activa entera.
    db.delete(TABS_KEY);
    expect(await loadTabs()).toBeNull();
    const auto = db.get('autosave') as { pages: Doc[] };
    expect(collectLiveRefs).toBeTypeOf('function');
    const refs = new Set<string>();
    collectRefs(auto, refs);
    expect(refs.size).toBe(1);
    expect(db.get([...refs][0])).toBe(PNG_A); // la imagen sigue en el almacén
  });

  it('sin campos de pestaña (una sola pestaña, API antigua) solo escribe `autosave`', async () => {
    const doc = page('p1');
    const stop = startAutosave(api({ doc, pages: [doc], pageIndex: 0, designId: 'D', designName: null }));
    await flushSave();
    stop();
    expect(db.has(TABS_KEY)).toBe(false);
    expect([...db.keys()].some((k) => k.startsWith('tab:'))).toBe(false);
    expect(db.has('autosave')).toBe(true);
  });
});

describe('gcAssets y las pestañas aparcadas', () => {
  it('GC_KEYS incluye `tabs` y se recorren las claves `tab:`', () => {
    expect(GC_KEYS).toContain('tabs');
    expect(GC_PREFIXES).toEqual(expect.arrayContaining(['undo:', 'tab:']));
  });

  it('una imagen que SOLO usa una pestaña aparcada no se borra; una huérfana sí', async () => {
    await save('activa', [page('a1')], 'A'); // sin imágenes
    await save('aparcada', [page('b1', [img('foto', PNG_B)])], 'B');
    await saveTabsIndex(['activa', 'aparcada'], 'activa');
    db.set('autosave', { pages: [page('a1')], index: 0, designId: 'A' }); // `autosave` = la activa
    db.set('asset:' + 'f'.repeat(32), 'data:x'); // huérfana

    const live = await collectLiveRefs();
    expect(live!.size).toBe(1);
    const [ref] = [...live!];
    expect(db.get(ref)).toBe(PNG_B);

    const orphan = 'asset:' + 'f'.repeat(32);
    await gcAssets();
    expect(db.has(orphan)).toBe(false);
    expect(db.get(ref)).toBe(PNG_B);
    const r = await loadTabs();
    expect((r!.tabs[1].pages[0].layers[0] as { src: string }).src).toBe(PNG_B);
  });

  it('si una clave que existe no se puede leer, el GC no borra nada', async () => {
    await save('aparcada', [page('b1', [img('foto', PNG_B)])], 'B');
    db.set('asset:' + 'f'.repeat(32), 'data:x');
    failGet.add(tabKey('aparcada'));
    expect(await collectLiveRefs()).toBeNull();
    expect(await gcAssets()).toBe(0);
    expect(db.has('asset:' + 'f'.repeat(32))).toBe(true);
  });
});

describe('copias de seguridad y las claves de pestañas', () => {
  const base = () => ({
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    createdAt: 1,
    data: { designs: [{ id: 'd1', name: 'D', updatedAt: 1, pageIndex: 0, pages: [page('d1')] }] },
    fonts: [],
    assets: {},
    prefs: {},
  });

  it('una copia antigua (sin pestañas) se importa igual', () => {
    const r = parseBackupText(JSON.stringify(base()));
    expect(r.ok).toBe(true);
  });

  it('claves de sesión (`tabs`, `tab:*`, `autosave`) se ignoran sin romper; otra clave desconocida se rechaza', () => {
    const withTabs = { ...base(), data: { ...base().data, tabs: { order: ['t'] }, 'tab:t': { id: 't' }, autosave: {} } };
    const r = validateBackup(withTabs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.file.data)).toEqual(['designs']); // nunca se escriben al importar
    expect(validateBackup({ ...base(), data: { ...base().data, otra: 1 } }).ok).toBe(false);
  });
});
