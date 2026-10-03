import { describe, expect, it } from 'vitest';
import type { Doc, Layer } from '../core/types';
import {
  SESSION_KEYS,
  STATE_CLASS,
  TRANSIENT_RESET,
  findTabByDesign,
  freshSession,
  isBlankSession,
  nextActiveAfterClose,
  park,
  reorderTabList,
  unpark,
  type SessionSnapshot,
  type TabMeta,
} from './sessions';

// Lógica pura de pestañas (sin el store). Las pruebas contra el store real están en
// storeSessions.test.ts.

const page = (id: string, layers: Layer[] = []): Doc =>
  ({ id, name: `Pág ${id}`, width: 100, height: 100, background: { type: 'solid', color: '#fff' }, layers, version: 1 }) as Doc;
const shape = (id: string) => ({ id, type: 'shape' }) as unknown as Layer;
const tabs = (...ids: string[]): TabMeta[] => ids.map((id) => ({ id, save: 'saved' }));

function session(over: Partial<SessionSnapshot> = {}): SessionSnapshot {
  const p = [page('A'), page('B')];
  return {
    doc: p[1],
    pages: p,
    pageIndex: 1,
    past: [page('B0')],
    future: [page('B2')],
    structUndo: { pages: [page('A')], pageIndex: 0, docAfter: p[1], pageIndexAfter: 1 },
    pageHist: { A: { past: [page('A0')], future: [], base: p[0], seq: 1 } },
    selectedId: 'l1',
    selectedIds: ['l1', 'l2'],
    zoom: 1.5,
    designId: 'D1',
    designName: 'Cartel',
    pageView: 'stack',
    ...over,
  };
}

describe('clasificación de claves', () => {
  it('cada clave tiene una clase válida', () => {
    for (const [k, c] of Object.entries(STATE_CLASS)) expect(['session', 'global', 'transient'], k).toContain(c);
  });

  it('las de sesión incluyen las de P1–P6 (designId, designName, pageHist, pageView…)', () => {
    for (const k of ['doc', 'pages', 'pageIndex', 'past', 'future', 'structUndo', 'pageHist', 'selectedId', 'selectedIds', 'zoom', 'designId', 'designName', 'pageView'])
      expect(STATE_CLASS[k as keyof typeof STATE_CLASS], k).toBe('session');
    expect([...SESSION_KEYS].sort()).toEqual(Object.keys(session()).sort());
  });

  it('lo global (biblioteca, marca, preferencias de vista, registro de pestañas) no es de sesión', () => {
    for (const k of ['uploads', 'templates', 'brandKits', 'activeBrandKitId', 'brandColors', 'brandLogos', 'brandFonts', 'customFonts', 'recentColors', 'showRulers', 'showGrid', 'showGuides', 'snapToGrid', 'showNotes', 'showLayout', 'showRespect', 'tabs', 'activeTabId', 'parked'])
      expect(STATE_CLASS[k as keyof typeof STATE_CLASS], k).toBe('global');
  });

  it('TRANSIENT_RESET cubre exactamente las claves transitorias', () => {
    const transient = Object.entries(STATE_CLASS).filter(([, c]) => c === 'transient').map(([k]) => k);
    expect(Object.keys(TRANSIENT_RESET).sort()).toEqual(transient.sort());
  });
});

describe('aparcar y desaparcar', () => {
  it('devuelve los MISMOS objetos por referencia (no clona nada)', () => {
    const s = session();
    const back = unpark(park(s));
    for (const k of SESSION_KEYS) expect(back[k], k).toBe(s[k]);
  });

  it('solo se lleva los campos de sesión: lo global queda fuera', () => {
    const uploads = [{ id: 'u' }];
    const state = { ...session(), uploads, showRulers: true, brandKits: [], tabs: tabs('t'), parked: {}, cropMode: true };
    const snap = park(state);
    expect(Object.keys(snap).sort()).toEqual([...SESSION_KEYS].sort());
    expect('uploads' in snap || 'showRulers' in snap || 'cropMode' in snap || 'parked' in snap).toBe(false);
    expect(state.uploads).toBe(uploads); // el origen no se toca
  });

  it('una sesión nueva no arrastra historial ni selección', () => {
    const p = [page('X')];
    const f = freshSession(p, 5, { designId: 'X', designName: null }, 'single');
    expect(f).toMatchObject({ doc: p[0], pages: p, pageIndex: 0, past: [], future: [], structUndo: null, pageHist: {}, selectedId: null, selectedIds: [], zoom: 1, designId: 'X' });
  });
});

describe('nextActiveAfterClose', () => {
  it('cerrar la activa elige la vecina derecha', () => {
    expect(nextActiveAfterClose(tabs('a', 'b', 'c'), 'b', 'b')).toBe('c');
  });
  it('si no hay derecha, la izquierda', () => {
    expect(nextActiveAfterClose(tabs('a', 'b', 'c'), 'c', 'c')).toBe('b');
  });
  it('cerrar otra no cambia la activa', () => {
    expect(nextActiveAfterClose(tabs('a', 'b', 'c'), 'a', 'c')).toBe('a');
  });
  it('la última: no queda ninguna', () => {
    expect(nextActiveAfterClose(tabs('a'), 'a', 'a')).toBeNull();
  });
  it('id desconocido: sin cambios', () => {
    expect(nextActiveAfterClose(tabs('a', 'b'), 'a', 'zz')).toBe('a');
  });
});

describe('findTabByDesign', () => {
  const st = {
    tabs: tabs('t1', 't2', 't3'),
    activeTabId: 't2',
    designId: 'D-activo',
    parked: { t1: session({ designId: 'D1' }), t3: session({ designId: 'D3' }) },
  };
  it('la activa se reconoce por su designId vivo', () => expect(findTabByDesign(st, 'D-activo')).toBe('t2'));
  it('una aparcada, por el de su aparcamiento', () => expect(findTabByDesign(st, 'D3')).toBe('t3'));
  it('no abierto o vacío: null', () => {
    expect(findTabByDesign(st, 'otro')).toBeNull();
    expect(findTabByDesign(st, '')).toBeNull();
  });
  it('un aparcamiento huérfano (sin pestaña) no cuenta', () => {
    expect(findTabByDesign({ ...st, tabs: tabs('t2') }, 'D1')).toBeNull();
  });
});

describe('isBlankSession', () => {
  const blank = () => freshSession([page('N')], 0, { designId: 'N', designName: null }, 'single');
  it('diseño nuevo sin tocar: vacío', () => expect(isBlankSession(blank())).toBe(true));
  it('con capas, historial, 2 páginas, nombre o notas: no', () => {
    const b = blank();
    expect(isBlankSession({ ...b, doc: page('N', [shape('l')]), pages: [page('N', [shape('l')])] })).toBe(false);
    expect(isBlankSession({ ...b, past: [page('N')] })).toBe(false);
    expect(isBlankSession({ ...b, future: [page('N')] })).toBe(false);
    expect(isBlankSession({ ...b, pages: [b.doc, page('M')] })).toBe(false);
    expect(isBlankSession({ ...b, designName: 'Mío' })).toBe(false);
    expect(isBlankSession({ ...b, pageHist: { M: { past: [], future: [page('M')], base: page('M'), seq: 1 } } })).toBe(false);
    const withNote = { ...b.doc, notes: [{ id: 'n', x: 0, y: 0, text: '', color: '#ff0' }] } as Doc;
    expect(isBlankSession({ ...b, doc: withNote, pages: [withNote] })).toBe(false);
  });
});

describe('reorderTabList', () => {
  it('mueve una pestaña', () => {
    expect(reorderTabList(tabs('a', 'b', 'c'), 0, 2).map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });
  it('fuera de rango o mismo sitio: la misma lista', () => {
    const t = tabs('a', 'b');
    expect(reorderTabList(t, 0, 5)).toBe(t);
    expect(reorderTabList(t, 1, 1)).toBe(t);
  });
});
