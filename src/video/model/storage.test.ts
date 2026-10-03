import { describe, expect, it } from 'vitest';
import { VIDEO_BACKUP_KEY, VIDEO_KEY, VideoProjectStore, loadUndo, saveUndo, type KvIo } from './storage';
import { addMedia, appendClip, makeClip, removeClip } from './ops';

/** IndexedDB de mentira: guarda una copia estructurada (como el navegador) y puede fallar a propósito. */
class FakeKv implements KvIo {
  data = new Map<string, unknown>();
  failSet = new Set<string>();
  corruptReadBack = false;
  log: string[] = [];
  async get<T>(k: string) {
    this.log.push('get ' + k);
    const v = this.data.get(k);
    if (this.corruptReadBack && k === VIDEO_KEY && v && (v as any).v === 2) return { ...(v as any), tracks: [] } as T;
    return v === undefined ? null : (structuredClone(v) as T);
  }
  async set(k: string, v: unknown) {
    this.log.push('set ' + k);
    if (this.failSet.has(k)) return false;
    this.data.set(k, structuredClone(v));
    return true;
  }
  async delete(k: string) {
    this.log.push('delete ' + k);
    this.data.delete(k);
  }
}

const v1 = () => ({
  clips: [
    { id: 'a', type: 'video', blob: new Blob(['aaa']), inP: 0, outP: 2, duration: 2, speed: 1, volume: 1, effect: 'none', fadeIn: 0, fadeOut: 0, url: '' },
    { id: 'm', type: 'audio', blob: new Blob(['mmm']), inP: 0, outP: 5, duration: 5, speed: 1, volume: 1, effect: 'none', fadeIn: 0, fadeOut: 0, url: '' },
  ],
  overlays: [{ id: 't', kind: 'text', text: 'hola', color: '#fff', size: 60, xf: 0.5, yf: 0.5, start: 0, end: 9999 }],
  eq: { low: 0, mid: 0, high: 0 },
  normalize: false,
});

describe('guardado del proyecto de video', () => {
  it('cargar un v1 NO escribe nada; el primer guardado respalda, escribe v2, relee y retira la copia', async () => {
    const kv = new FakeKv();
    kv.data.set(VIDEO_KEY, v1());
    const store = new VideoProjectStore(kv);
    const res = await store.load();
    expect(res.from).toBe(1);
    expect(kv.log.filter((l) => !l.startsWith('get'))).toEqual([]);
    expect(await store.save(res.project)).toBe(true);
    expect(kv.log.filter((l) => !l.startsWith('get'))).toEqual(['set ' + VIDEO_BACKUP_KEY, 'set ' + VIDEO_KEY, 'delete ' + VIDEO_BACKUP_KEY]);
    expect(store.lastVerified).toBe(true);
    expect((kv.data.get(VIDEO_KEY) as any).v).toBe(2);
    // recargar: llega el v2 con el mismo contenido
    const again = await new VideoProjectStore(kv).load();
    expect(again.from).toBe(2);
    expect(again.project).toEqual(res.project);
    expect(await (again.project.media[again.project.tracks[1].clips[0].mediaId!].blob as Blob).text()).toBe('aaa');
  });

  it('si la copia de seguridad no se puede escribir, el v1 original NO se pisa', async () => {
    const kv = new FakeKv();
    const original = v1();
    kv.data.set(VIDEO_KEY, original);
    kv.failSet.add(VIDEO_BACKUP_KEY);
    const store = new VideoProjectStore(kv);
    const { project } = await store.load();
    expect(await store.save(project)).toBe(false);
    expect((kv.data.get(VIDEO_KEY) as any).v).toBeUndefined();
    expect((kv.data.get(VIDEO_KEY) as any).clips).toHaveLength(2);
  });

  it('si la relectura no cuadra, la copia v1 se queda; y se recupera si la principal desaparece', async () => {
    const kv = new FakeKv();
    kv.data.set(VIDEO_KEY, v1());
    kv.corruptReadBack = true;
    const store = new VideoProjectStore(kv);
    const { project } = await store.load();
    expect(await store.save(project)).toBe(true);
    expect(store.lastVerified).toBe(false);
    expect((kv.data.get(VIDEO_BACKUP_KEY) as any).clips).toHaveLength(2);
    kv.corruptReadBack = false;
    kv.data.delete(VIDEO_KEY);
    const rec = await new VideoProjectStore(kv).load();
    expect(rec.fromBackup).toBe(true);
    expect(rec.report.clips).toBe(2);
  });

  it('migración incompleta (datos irreconocibles): se respaldan y la copia NO se retira', async () => {
    const kv = new FakeKv();
    kv.data.set(VIDEO_KEY, 'algo raro');
    const store = new VideoProjectStore(kv);
    const { project, report } = await store.load();
    expect(report.complete).toBe(false);
    expect(await store.save(project)).toBe(true);
    expect(kv.data.get(VIDEO_BACKUP_KEY)).toBe('algo raro');
  });

  it('nunca pisa un proyecto de una versión futura', async () => {
    const kv = new FakeKv();
    kv.data.set(VIDEO_KEY, { v: 3, cosas: 1 });
    const store = new VideoProjectStore(kv);
    const { project, from } = await store.load();
    expect(from).toBe('future');
    expect(store.writable).toBe(false);
    expect(await store.save(project)).toBe(false);
    expect(await store.clear()).toBe(false);
    expect(kv.data.get(VIDEO_KEY)).toEqual({ v: 3, cosas: 1 });
  });

  it('«Nuevo» deja un v2 vacío (no resucita la copia) y conserva la copia de un v1 sin guardar', async () => {
    const kv = new FakeKv();
    kv.data.set(VIDEO_KEY, v1());
    const store = new VideoProjectStore(kv);
    await store.load();
    expect(await store.clear()).toBe(true);
    expect((kv.data.get(VIDEO_BACKUP_KEY) as any).clips).toHaveLength(2);
    const after = await new VideoProjectStore(kv).load();
    expect(after.from).toBe(2);
    expect(after.fromBackup).toBe(false);
    expect(after.project.tracks).toHaveLength(0);
  });

  it('el historial de deshacer se guarda y solo se recupera para el mismo proyecto', async () => {
    const kv = new FakeKv();
    kv.data.set(VIDEO_KEY, v1());
    const store = new VideoProjectStore(kv);
    const { project: p0 } = await store.load();
    const p1 = removeClip(p0, 'a'); // borra el video: su medio solo queda en el historial
    await store.save(p1);
    expect(await saveUndo(kv, [p0], p1)).toBe(true);
    const { project: loaded } = await new VideoProjectStore(kv).load();
    expect(Object.keys(loaded.media)).toHaveLength(1); // el guardado ya no tiene el video borrado
    const past = await loadUndo(kv, loaded);
    expect(past).toHaveLength(1);
    expect(past[0]).toEqual(p0); // deshacer tras recargar devuelve el clip CON su archivo
    expect(await (past[0].media['m-a'].blob as Blob).text()).toBe('aaa');
    expect(await loadUndo(kv, p0)).toEqual([]); // otro estado: no se aplica
  });

  it('guardados posteriores: sin relectura ni copia; borrar un clip quita su medio del guardado', async () => {
    const kv = new FakeKv();
    const store = new VideoProjectStore(kv);
    let { project } = await store.load();
    project = addMedia(project, { id: 'x', kind: 'video', name: 'x', duration: 3, blob: new Blob(['x']) });
    project = { ...project, tracks: [{ id: 'V', kind: 'video', name: 'V', muted: false, locked: false, hidden: false, magnet: true, clips: [] }] };
    project = appendClip(project, 'V', makeClip('video', { id: 'c', mediaId: 'x', outP: 3 }));
    expect(await store.save(project)).toBe(true);
    kv.log = [];
    expect(await store.save(removeClip(project, 'c'))).toBe(true);
    expect(kv.log).toEqual(['set ' + VIDEO_KEY]);
    expect((kv.data.get(VIDEO_KEY) as any).media).toEqual({});
  });
});
