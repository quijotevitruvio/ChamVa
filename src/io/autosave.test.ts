import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const idbSet = vi.fn(async (_k: string, _v: unknown) => true);
const pushBackup = vi.fn();
const upsertDesign = vi.fn();
const maybeSaveAutoVersion = vi.fn();
vi.mock('./idb', () => ({ idbSet: (k: string, v: unknown) => idbSet(k, v) }));
vi.mock('./assets', () => ({ dehydrateDocs: async (d: unknown[]) => d }));
vi.mock('./designs', () => ({ pushBackup: (...a: unknown[]) => pushBackup(...a), upsertDesign: (...a: unknown[]) => upsertDesign(...a) }));
vi.mock('./autoVersions', () => ({ maybeSaveAutoVersion: (...a: unknown[]) => maybeSaveAutoVersion(...a) }));
vi.mock('./export', () => ({ renderDocToCanvas: async () => ({ toDataURL: () => 'thumb' }) }));

import { AUTOSAVE_DEBOUNCE_MS, flushSave, scheduleSave, startAutosave, type AutosaveApi, type AutosaveState } from './autosave';
import { getSaveStatus, resetSaveStatus } from './saveStatus';

const mkDoc = (id: string, layers = 1) => ({ id, name: id, width: 10, height: 10, layers: Array(layers).fill({}) }) as never;

function makeApi(initial: Partial<AutosaveState> = {}) {
  let state: AutosaveState = { doc: mkDoc('a'), pages: [mkDoc('a')], pageIndex: 0, designId: 'a', designName: null, ...initial };
  const subs = new Set<(s: AutosaveState, p: AutosaveState) => void>();
  const api: AutosaveApi = {
    getState: () => state,
    subscribe: (fn) => (subs.add(fn), () => subs.delete(fn)),
  };
  const set = (patch: Partial<AutosaveState>) => {
    const prev = state;
    state = { ...state, ...patch };
    subs.forEach((f) => f(state, prev));
  };
  return { api, set };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  idbSet.mockReset().mockResolvedValue(true);
  pushBackup.mockReset();
  upsertDesign.mockReset();
  maybeSaveAutoVersion.mockReset();
  resetSaveStatus();
});
afterEach(() => vi.useRealTimers());

describe('startAutosave', () => {
  it('escribe 1,2 s después del último cambio (debounce) y pasa pending → saved', async () => {
    const { api, set } = makeApi();
    const stop = startAutosave(api);
    expect(getSaveStatus().state).toBe('pending');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(idbSet).not.toHaveBeenCalled();
    set({ doc: mkDoc('a', 2), pages: [mkDoc('a', 2)] }); // reinicia el retardo
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(idbSet).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(idbSet).toHaveBeenCalledTimes(1);
    expect(idbSet.mock.calls[0][0]).toBe('autosave');
    expect(getSaveStatus().state).toBe('saved');
    stop();
  });

  it('galería, copia y versión automática solo cada 30 s; el nombre propio se guarda', async () => {
    const { api, set } = makeApi({ designName: 'Mi cartel' });
    const stop = startAutosave(api);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(idbSet).toHaveBeenCalledTimes(1);
    expect(idbSet.mock.calls[0][1]).toMatchObject({ designId: 'a', designName: 'Mi cartel', index: 0 });
    expect(pushBackup).toHaveBeenCalledTimes(1);
    expect(upsertDesign).toHaveBeenCalledTimes(1);
    expect(upsertDesign.mock.calls[0][0]).toMatchObject({ id: 'a', name: 'Mi cartel', designName: 'Mi cartel' });
    expect(maybeSaveAutoVersion).toHaveBeenCalledTimes(1);

    set({ doc: mkDoc('a', 3), pages: [mkDoc('a', 3)] }); // 1,2 s después: autosave sí, galería no
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(idbSet).toHaveBeenCalledTimes(2);
    expect(pushBackup).toHaveBeenCalledTimes(1);
    expect(upsertDesign).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    set({ doc: mkDoc('a', 4), pages: [mkDoc('a', 4)] });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(idbSet).toHaveBeenCalledTimes(3);
    expect(pushBackup).toHaveBeenCalledTimes(2);
    expect(upsertDesign).toHaveBeenCalledTimes(2);
    stop();
  });

  it('con idbSet fallando queda en error; un reintento (flushSave) lo corrige', async () => {
    idbSet.mockResolvedValue(false);
    const { api } = makeApi();
    const stop = startAutosave(api);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(getSaveStatus().state).toBe('error');
    idbSet.mockResolvedValue(true);
    await flushSave();
    expect(getSaveStatus().state).toBe('saved');
    stop();
  });

  it('un cambio durante la escritura deja el estado en pending, no en guardado', async () => {
    let release: (v: boolean) => void = () => {};
    idbSet.mockImplementationOnce(() => new Promise<boolean>((r) => (release = r)));
    const { api } = makeApi();
    const stop = startAutosave(api);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(getSaveStatus().state).toBe('saving');
    scheduleSave();
    release(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(getSaveStatus().state).toBe('pending');
    stop();
  });

  it('flushSave lee el estado al llamarlo (cambiar de pestaña justo después guarda la saliente) y dice si guardó', async () => {
    const { api, set } = makeApi({ designId: 'A', doc: mkDoc('A'), pages: [mkDoc('A')] });
    const stop = startAutosave(api);
    const p = flushSave();
    set({ designId: 'B', doc: mkDoc('B'), pages: [mkDoc('B')] }); // «otra pestaña» en el mismo tick
    expect(await p).toBe(true);
    expect(idbSet.mock.calls[0][1]).toMatchObject({ designId: 'A' });
    expect(upsertDesign.mock.calls[0][0]).toMatchObject({ id: 'A' });
    // Fallo de la galería al «guardar ya» = no guardado.
    upsertDesign.mockResolvedValueOnce(false);
    expect(await flushSave()).toBe(false);
    // Fallo de la clave autosave = no guardado.
    idbSet.mockResolvedValue(false);
    expect(await flushSave()).toBe(false);
    stop();
    expect(await flushSave()).toBe(true); // sin autoguardado activo no hay nada pendiente
  });

  it('al detenerlo no queda nada programado', async () => {
    const { api } = makeApi();
    startAutosave(api)();
    await vi.advanceTimersByTimeAsync(5000);
    expect(idbSet).not.toHaveBeenCalled();
  });
});
