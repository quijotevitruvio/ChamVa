import { describe, expect, it } from 'vitest';
import { canAddTab, moveTabBy, neighborTab, tabLabel } from './tabsNav';
import { MAX_TABS, type TabMeta } from './sessions';

const mk = (...ids: string[]): TabMeta[] => ids.map((id) => ({ id, save: 'saved' as const }));

describe('tabsNav', () => {
  it('límite de pestañas', () => {
    expect(canAddTab(MAX_TABS - 1)).toBe(true);
    expect(canAddTab(MAX_TABS)).toBe(false);
  });
  it('siguiente y anterior con vuelta', () => {
    const t = mk('a', 'b', 'c');
    expect(neighborTab(t, 'a', 1)).toBe('b');
    expect(neighborTab(t, 'c', 1)).toBe('a');
    expect(neighborTab(t, 'a', -1)).toBe('c');
    expect(neighborTab(mk('a'), 'a', 1)).toBeNull();
    expect(neighborTab(t, 'zz', 1)).toBe('a');
  });
  it('mover un puesto', () => {
    const t = mk('a', 'b', 'c');
    expect(moveTabBy(t, 'b', 1)).toEqual({ from: 1, to: 2 });
    expect(moveTabBy(t, 'a', -1)).toBeNull();
    expect(moveTabBy(t, 'c', 1)).toBeNull();
    expect(moveTabBy(t, 'x', 1)).toBeNull();
  });
  it('rótulo', () => {
    expect(tabLabel('  Mi logo ', 'x')).toBe('Mi logo');
    expect(tabLabel(null, 'Post')).toBe('Post');
    expect(tabLabel('', '  ')).toBe('Sin título');
  });
});
