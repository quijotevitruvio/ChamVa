import { describe, expect, it, beforeEach } from 'vitest';
import {
  BLEND_GROUPS,
  BLEND_HOTKEYS,
  BLEND_MODES,
  blendCss,
  blendFromActionId,
  blendActionId,
  blendOp,
  blendOpOrUndefined,
  blendSvgExact,
  commonBlend,
  isBlendMode,
  nextBlend,
  normalizeBlend,
  svgInexactBlends,
} from './blend';
import { ACTIONS, actionForEvent, findConflicts, getShortcut, _setOverridesForTest } from './shortcuts';
import { BLEND_MODES as VIDEO_MODES } from '../../video/fx/sanitize';

describe('lista de fusión', () => {
  it('tiene los 17 modos, agrupados y sin repetir', () => {
    expect(BLEND_MODES).toHaveLength(17);
    expect(new Set(BLEND_MODES).size).toBe(17);
    expect(BLEND_GROUPS.flatMap((g) => g.modes)).toEqual(BLEND_MODES);
    expect(BLEND_GROUPS.map((g) => g.label)).toEqual(['Normal', 'Oscurecer', 'Aclarar', 'Contraste', 'Comparar', 'Componentes']);
  });
  it('el video usa la misma lista (sin duplicar)', () => {
    expect(VIDEO_MODES).toBe(BLEND_MODES);
  });
  it('equivalencia modo → globalCompositeOperation', () => {
    expect(blendOp('normal')).toBe('source-over');
    expect(blendOp('multiply')).toBe('multiply');
    expect(blendOp('screen')).toBe('screen');
    expect(blendOp('dodge')).toBe('color-dodge');
    expect(blendOp('burn')).toBe('color-burn');
    expect(blendOp('softlight')).toBe('soft-light');
    expect(blendOp('hardlight')).toBe('hard-light');
    expect(blendOp('add')).toBe('lighter');
    for (const m of ['overlay', 'darken', 'lighten', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'] as const) {
      expect(blendOp(m)).toBe(m);
    }
  });
  it('Konva no recibe operación con «normal» y los diseños antiguos (sin blendMode) siguen igual', () => {
    expect(blendOpOrUndefined('normal')).toBeUndefined();
    expect(blendOpOrUndefined(undefined)).toBeUndefined();
    expect(blendOpOrUndefined('multiply')).toBe('multiply');
    expect(normalizeBlend(undefined)).toBe('normal');
    expect(normalizeBlend('inventado')).toBe('normal');
    expect(blendOp(undefined)).toBe('source-over');
    expect(blendCss(undefined)).toBe('normal');
  });
  it('los 6 modos antiguos conservan su identificador', () => {
    for (const m of ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten']) expect(isBlendMode(m)).toBe(true);
  });
  it('equivalencia modo → mix-blend-mode de SVG', () => {
    expect(blendCss('dodge')).toBe('color-dodge');
    expect(blendCss('softlight')).toBe('soft-light');
    expect(blendCss('hue')).toBe('hue');
  });
  it('avisa de los modos que el SVG no reproduce igual', () => {
    expect(blendSvgExact('multiply')).toBe(true);
    expect(blendSvgExact('add')).toBe(false);
    expect(svgInexactBlends([{ blendMode: 'add' }, { blendMode: 'multiply' }, { blendMode: 'add', visible: false }])).toEqual(['add']);
    expect(svgInexactBlends([{ blendMode: 'screen' }, {}])).toEqual([]);
  });
});

describe('recorrer modos', () => {
  it('siguiente y anterior dan la vuelta', () => {
    expect(nextBlend('normal', 1)).toBe('darken');
    expect(nextBlend('normal', -1)).toBe('luminosity');
    expect(nextBlend('luminosity', 1)).toBe('normal');
    expect(nextBlend(undefined, 1)).toBe('darken');
  });
  it('recorrer N veces vuelve al inicio', () => {
    let m = normalizeBlend('multiply');
    for (let i = 0; i < BLEND_MODES.length; i++) m = nextBlend(m, 1);
    expect(m).toBe('multiply');
  });
  it('modo común de una selección', () => {
    expect(commonBlend(['multiply', 'multiply'])).toBe('multiply');
    expect(commonBlend(['multiply', undefined])).toBe('mixed');
    expect(commonBlend([])).toBe('normal');
  });
  it('id de acción ida y vuelta', () => {
    expect(blendFromActionId(blendActionId('dodge'))).toBe('dodge');
    expect(blendFromActionId('blend:nada')).toBeNull();
    expect(blendFromActionId('undo')).toBeNull();
  });
});

describe('atajos de fusión en el registro', () => {
  beforeEach(() => _setOverridesForTest({}));
  const ev = (key: string, o: object = {}) => ({ key, ctrlKey: false, altKey: true, shiftKey: true, ...o });
  it('hay un atajo por modo, todos Alt+Shift+tecla y sin repetir', () => {
    const keys = BLEND_HOTKEYS.map((h) => h.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const h of BLEND_HOTKEYS) expect(getShortcut(blendActionId(h.mode))).toBe(`Alt+Shift+${h.key}`);
  });
  it('ninguna acción comparte combinación con otra (ni alias)', () => {
    const seen = new Map<string, string>();
    for (const a of ACTIONS) {
      for (const c of [getShortcut(a.id), ...(a.extra ?? [])].filter(Boolean)) {
        expect(seen.get(c), `${a.id} choca con ${seen.get(c)} en ${c}`).toBeUndefined();
        seen.set(c, a.id);
      }
    }
  });
  it('resuelve las teclas', () => {
    expect(actionForEvent(ev('ArrowDown'))).toBe('blendNext');
    expect(actionForEvent(ev('ArrowUp'))).toBe('blendPrev');
    expect(actionForEvent(ev('N'))).toBe('blend:normal');
    expect(actionForEvent(ev('M'))).toBe('blend:multiply');
    expect(actionForEvent(ev('s'))).toBe('blend:screen');
    expect(actionForEvent(ev('o'))).toBe('blend:overlay');
  });
  it('con Option en Mac (letra cambiada) usa la tecla física', () => {
    expect(actionForEvent({ ...ev('µ'), code: 'KeyM' })).toBe('blend:multiply');
  });
  it('sin Alt+Shift no cambia nada: las teclas de herramienta siguen siendo suyas', () => {
    expect(actionForEvent({ key: 'o', ctrlKey: false, altKey: false, shiftKey: false })).toBe('toolEllipse');
    expect(actionForEvent({ key: 'a', ctrlKey: true, altKey: false, shiftKey: false })).toBe('selectAll');
    expect(findConflicts('blend:multiply', 'Alt+Shift+M')).toEqual([]);
  });
});

describe('flechas con Alt', () => {
  it('Alt+↓ sin Shift no activa la fusión (la flecha distingue Mayús)', () => {
    _setOverridesForTest({});
    expect(actionForEvent({ key: 'ArrowDown', ctrlKey: false, altKey: true, shiftKey: false })).toBeNull();
    expect(getShortcut('blendNext')).toBe('Alt+Shift+↓');
  });
});
