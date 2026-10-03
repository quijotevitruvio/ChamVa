import { describe, expect, it } from 'vitest';
import type { Doc } from '../core/types';
import { designTitle, readDesignMeta, resolveDesignMeta } from './designIdentity';

const page = (id: string, name = id): Doc =>
  ({ id, name, width: 10, height: 10, background: { type: 'transparent' }, layers: [], version: 1 }) as unknown as Doc;

describe('designIdentity', () => {
  it('sin meta (datos de v0.5): id y nombre de la primera página, como siempre', () => {
    expect(resolveDesignMeta([page('P1'), page('P2')])).toEqual({ designId: 'P1', designName: null });
    expect(resolveDesignMeta([page('P1')], null)).toEqual({ designId: 'P1', designName: null });
  });

  it('con meta: se respeta aunque no coincida con ninguna página', () => {
    expect(resolveDesignMeta([page('P2')], { designId: 'P1', name: ' Cartel ' })).toEqual({ designId: 'P1', designName: 'Cartel' });
  });

  it('meta vacía o de otro tipo se ignora', () => {
    expect(resolveDesignMeta([page('A')], { designId: '  ', name: '' })).toEqual({ designId: 'A', designName: null });
    expect(resolveDesignMeta([page('A')], { designId: 5 as never, name: {} as never })).toEqual({ designId: 'A', designName: null });
  });

  it('designTitle: el propio o el de la primera página', () => {
    expect(designTitle(null, [page('a', 'Portada')])).toBe('Portada');
    expect(designTitle('Folleto', [page('a', 'Portada')])).toBe('Folleto');
    expect(designTitle('  ', [page('a', '')])).toBe('Diseño sin título');
    expect(designTitle(undefined, [])).toBe('Diseño sin título');
  });

  it('readDesignMeta lee autoguardado/copias/proyectos nuevos y antiguos', () => {
    expect(readDesignMeta({ pages: [], index: 0 })).toEqual({});
    expect(readDesignMeta({ designId: 'P1', designName: 'X' })).toEqual({ designId: 'P1', name: 'X' });
    expect(readDesignMeta({ designId: 3, designName: null })).toEqual({});
    expect(readDesignMeta(null)).toEqual({});
    expect(readDesignMeta('x')).toEqual({});
  });
});
