import { describe, expect, it, beforeEach } from 'vitest';
import {
  actionForEvent,
  canonical,
  eventToCombo,
  findConflicts,
  formatCombo,
  getShortcut,
  matchesCombo,
  parseCombo,
  validateCombo,
  _setOverridesForTest,
} from './shortcuts';

const ev = (key: string, o: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...o,
});

beforeEach(() => _setOverridesForTest({}));

describe('combinaciones', () => {
  it('parsea y formatea', () => {
    const c = parseCombo('ctrl+shift+g')!;
    expect(c).toEqual({ ctrl: true, alt: false, shift: true, key: 'G' });
    expect(formatCombo(c)).toBe('Ctrl+Shift+G');
    expect(parseCombo('')).toBeNull();
  });
  it('Mayús no cuenta en símbolos', () => {
    expect(canonical('Shift+?')).toBe('?');
    expect(eventToCombo(ev('?', { shiftKey: true }))).toBe('?');
    expect(canonical('Shift+F')).toBe('Shift+F');
  });
  it('ignora modificadores solos y normaliza teclas', () => {
    expect(eventToCombo(ev('Shift', { shiftKey: true }))).toBeNull();
    expect(eventToCombo(ev('Delete'))).toBe('Supr');
    expect(eventToCombo(ev('z', { ctrlKey: true }))).toBe('Ctrl+Z');
  });
  it('coincide con exactitud de modificadores', () => {
    expect(matchesCombo(ev('g', { ctrlKey: true }), 'Ctrl+G')).toBe(true);
    expect(matchesCombo(ev('G', { ctrlKey: true, shiftKey: true }), 'Ctrl+G')).toBe(false);
  });
  it('rechaza teclas reservadas', () => {
    expect(validateCombo('Esc')).not.toBeNull();
    expect(validateCombo('Supr')).not.toBeNull();
    expect(validateCombo('Ctrl+Supr')).toBeNull();
    expect(validateCombo('F')).toBeNull();
  });
});

describe('registro', () => {
  it('atajos por defecto y alias', () => {
    expect(actionForEvent(ev('k', { ctrlKey: true }))).toBe('palette');
    expect(actionForEvent(ev('z', { ctrlKey: true }))).toBe('undo');
    expect(actionForEvent(ev('z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(actionForEvent(ev('G', { ctrlKey: true, shiftKey: true }))).toBe('ungroup');
    expect(actionForEvent(ev('F1'))).toBe('shortcuts');
    expect(actionForEvent(ev('f'))).toBe('focus');
  });
  it('personalizado reemplaza al de fábrica', () => {
    _setOverridesForTest({ focus: 'Ctrl+Shift+F' });
    expect(getShortcut('focus')).toBe('Ctrl+Shift+F');
    expect(actionForEvent(ev('f'))).toBeNull();
    expect(actionForEvent(ev('F', { ctrlKey: true, shiftKey: true }))).toBe('focus');
    _setOverridesForTest({ focus: '' });
    expect(actionForEvent(ev('f'))).toBeNull();
  });
  it('detecta conflictos', () => {
    expect(findConflicts('focus', 'Ctrl+Z')).toEqual(['undo']);
    expect(findConflicts('focus', 'Ctrl+Shift+Z')).toEqual(['redo']);
    expect(findConflicts('undo', 'Ctrl+Z')).toEqual([]);
    expect(findConflicts('focus', 'Ctrl+Alt+Q')).toEqual([]);
  });
});
