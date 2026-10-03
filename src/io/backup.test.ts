import { describe, expect, it } from 'vitest';
import {
  BACKUP_KIND,
  BACKUP_VERSION,
  isReminderDue,
  mergeBackup,
  parseBackupText,
  summarize,
  validateBackup,
  type BackupFile,
  type MergeState,
} from './backup';
import { MAX_DESIGNS } from './designs';

const doc = (id: string) => ({ id, name: id, width: 100, height: 100, layers: [], version: 1, background: { type: 'solid', color: '#fff' } }) as never;
const design = (id: string, extra: object = {}) => ({
  id,
  name: `Diseño ${id}`,
  updatedAt: 1,
  pageIndex: 0,
  pages: [doc(id)],
  thumb: 'data:image/jpeg;base64,AA',
  ...extra,
});
const HASH = 'asset:' + 'a'.repeat(32);

function sample(): BackupFile {
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    createdAt: 1_700_000_000_000,
    data: {
      designs: [design('d1', { folder: 'Marca', tags: ['x'] }), design('d2', { deletedAt: 5 })],
      designFolders: ['Marca'],
      templates: [{ id: 't1', name: 'T', thumb: '', doc: doc('t1') }] as never,
      uploads: [{ id: 'u1', name: 'u', src: HASH }] as never,
      brandKitLogos: { k1: [{ id: 'l1', name: 'l', src: HASH }] as never },
      snapshots: { d1: [{ id: 's1', name: 'v', ts: 10, pageIndex: 0, pages: [doc('d1')] }] as never },
    },
    fonts: [{ family: 'Mi fuente', dataUrl: 'data:font/ttf;base64,AAAA' }],
    assets: { [HASH]: 'data:image/png;base64,AAAA' },
    prefs: { 'chamva.theme': 'dark', 'chamva.brandKits': JSON.stringify([{ id: 'k1', name: 'Kit' }]) },
  };
}

describe('validateBackup', () => {
  it('acepta una copia sintética y la resume', () => {
    const text = JSON.stringify(sample());
    const r = parseBackupText(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = summarize(r.file);
    expect(s).toMatchObject({ designs: 1, trashed: 1, folders: 1, templates: 1, uploads: 1, brandKits: 1, logos: 1, fonts: 1, snapshots: 1, images: 1 });
  });

  it('rechaza JSON roto y otros formatos', () => {
    expect(parseBackupText('{no').ok).toBe(false);
    expect(validateBackup({ kind: 'otro' }).ok).toBe(false);
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup([]).ok).toBe(false);
  });

  it('rechaza versión futura', () => {
    const r = validateBackup({ ...sample(), version: BACKUP_VERSION + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/más nueva/);
  });

  it('rechaza archivos manipulados', () => {
    const bad = (mut: (f: BackupFile) => unknown) => {
      const f = sample();
      return validateBackup(mut(f) ?? f).ok;
    };
    expect(bad((f) => ((f.data.designs as unknown[])[0] = { id: 1 }))).toBe(false);
    expect(bad((f) => ((f as unknown as { data: unknown }).data = 'x'))).toBe(false);
    expect(bad((f) => ((f.data as Record<string, unknown>).extra = []))).toBe(false);
    expect(bad((f) => (f.assets['asset:../x'] = 'data:x'))).toBe(false);
    expect(bad((f) => (f.assets[HASH] = 'javascript:alert(1)'))).toBe(false);
    expect(bad((f) => (f.prefs['otra.clave'] = 'x'))).toBe(false);
    expect(bad((f) => (f.prefs['chamva.license'] = 'x'))).toBe(false);
    expect(bad((f) => (f.fonts[0].dataUrl = 'http://x/y.ttf'))).toBe(false);
    const withProto = JSON.stringify(sample()).replace('"brandKitLogos":{', '"brandKitLogos":{"__proto__":[],');
    expect(parseBackupText(withProto).ok).toBe(false);
  });
});

describe('identidad del diseño en copias (v0.6)', () => {
  it('una copia antigua (id = primera página, sin designName) se sigue importando igual', () => {
    // Formato v0.5 tal cual: sin designName ni campos nuevos.
    const r = parseBackupText(JSON.stringify(sample()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.data.designs?.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(r.file.data.designs?.[0].designName).toBeUndefined();
    const { next } = mergeBackup({ data: {}, fonts: [], prefs: {} }, { data: r.file.data, fonts: [], prefs: {} });
    expect(next.data.designs?.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(Object.keys(next.data.snapshots ?? {})).toEqual(['d1']); // versiones del mismo id
  });

  it('acepta diseños cuyo id ya no es el de su primera página y con nombre propio', () => {
    const f = sample();
    f.data.designs = [design('d1', { pages: [doc('p2'), doc('d1')], designName: 'Folleto' }) as never];
    const r = validateBackup(JSON.parse(JSON.stringify(f)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.data.designs?.[0]).toMatchObject({ id: 'd1', designName: 'Folleto' });
  });

  it('rechaza un designName que no es texto', () => {
    const f = sample();
    (f.data.designs as unknown[])[0] = design('d1', { designName: { x: 1 } });
    expect(validateBackup(f).ok).toBe(false);
  });
});

describe('mergeBackup (combinar no pisa)', () => {
  type F = { family: string; tag?: string };
  const state = (over: Partial<MergeState<F>> = {}): MergeState<F> => ({ data: {}, fonts: [], prefs: {}, ...over });

  it('no pisa diseños, plantillas ni fuentes existentes y añade los que faltan', () => {
    const cur = state({
      data: { designs: [design('d1', { name: 'LOCAL' }) as never], templates: [{ id: 't1', name: 'LOCAL', thumb: '', doc: doc('t1') }] as never },
      fonts: [{ family: 'A', tag: 'local' }],
      prefs: { 'chamva.theme': 'light' },
    });
    const inc = state({
      data: { designs: [design('d1', { name: 'COPIA' }), design('d3')] as never, templates: [{ id: 't1', name: 'COPIA' }, { id: 't2', name: 'N' }] as never },
      fonts: [{ family: 'A', tag: 'copia' }, { family: 'B' }],
      prefs: { 'chamva.theme': 'dark', 'chamva.otro': '1' },
    });
    const { next, stats } = mergeBackup(cur, inc);
    expect(next.data.designs?.map((d) => [d.id, d.name])).toEqual([['d1', 'LOCAL'], ['d3', 'Diseño d3']]);
    expect((next.data.templates as { id: string; name: string }[]).map((t) => [t.id, t.name])).toEqual([['t1', 'LOCAL'], ['t2', 'N']]);
    expect(next.fonts).toEqual([{ family: 'A', tag: 'local' }, { family: 'B' }]);
    expect(next.prefs).toEqual({ 'chamva.theme': 'light', 'chamva.otro': '1' });
    expect(stats).toMatchObject({ designsAdded: 1, templatesAdded: 1, fontsAdded: 1, prefsAdded: 1 });
  });

  it('combina kits de marca por id y crea las carpetas que falten', () => {
    const cur = state({ prefs: { 'chamva.brandKits': JSON.stringify([{ id: 'k1', name: 'Mío' }]) } });
    const inc = state({
      data: { designs: [design('d9', { folder: 'Nueva' })] as never, designFolders: ['nueva'] },
      prefs: { 'chamva.brandKits': JSON.stringify([{ id: 'k1', name: 'Otro' }, { id: 'k2', name: 'K2' }]) },
    });
    const { next } = mergeBackup(cur, inc);
    expect(JSON.parse(next.prefs['chamva.brandKits'])).toEqual([{ id: 'k1', name: 'Mío' }, { id: 'k2', name: 'K2' }]);
    expect(next.data.designFolders).toEqual(['nueva']);
  });

  it('respeta el tope de diseños', () => {
    const many = Array.from({ length: MAX_DESIGNS }, (_, i) => design(`c${i}`));
    const { next, stats } = mergeBackup(state({ data: { designs: many as never } }), state({ data: { designs: [design('x1'), design('x2', { deletedAt: 1 })] as never } }));
    expect(stats.designsSkippedLimit).toBe(1);
    expect(next.data.designs?.length).toBe(MAX_DESIGNS + 1); // la papelera no cuenta
  });

  it('versiones con nombre: por diseño y sin duplicar', () => {
    const snap = (id: string, ts: number) => ({ id, name: id, ts, pageIndex: 0, pages: [doc('d1')] });
    const cur = state({ data: { snapshots: { d1: [snap('a', 5)] as never } } });
    const inc = state({ data: { snapshots: { d1: [snap('a', 5), snap('b', 9)] as never, d2: [snap('c', 1)] as never } } });
    const { next } = mergeBackup(cur, inc);
    expect(next.data.snapshots?.d1.map((s) => s.id)).toEqual(['b', 'a']);
    expect(next.data.snapshots?.d2.length).toBe(1);
  });
});

describe('isReminderDue', () => {
  const day = 86_400_000;
  const base = { now: 100 * day, lastBackup: 0, firstUse: 0, hasData: true, enabled: true, snoozeUntil: 0 };
  it('avisa tras 30 días sin copia', () => {
    expect(isReminderDue({ ...base, lastBackup: 60 * day })).toBe(true);
    expect(isReminderDue({ ...base, lastBackup: 80 * day })).toBe(false);
  });
  it('usa el primer uso si nunca se hizo copia, y calla sin datos/desactivado/pospuesto', () => {
    expect(isReminderDue({ ...base, firstUse: 10 * day })).toBe(true);
    expect(isReminderDue({ ...base })).toBe(false);
    expect(isReminderDue({ ...base, firstUse: 10 * day, hasData: false })).toBe(false);
    expect(isReminderDue({ ...base, firstUse: 10 * day, enabled: false })).toBe(false);
    expect(isReminderDue({ ...base, firstUse: 10 * day, snoozeUntil: 101 * day })).toBe(false);
  });
});
