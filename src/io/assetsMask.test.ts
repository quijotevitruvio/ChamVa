import { beforeEach, describe, expect, it, vi } from 'vitest';

// IDB falso en memoria: las máscaras ráster se guardan en el almacén como una imagen más, así el
// autoguardado y el historial guardado solo llevan una referencia corta.
const db = new Map<string, unknown>();
vi.mock('./idb', () => ({
  idbGet: async (k: string) => db.get(k) ?? null,
  idbSet: async (k: string, v: unknown) => (db.set(k, v), true),
  idbDelete: async (k: string) => void db.delete(k),
  idbKeys: async (prefix = '') => [...db.keys()].filter((k) => k.startsWith(prefix)),
}));

import { dehydrateDocs, rehydrateDocs } from './assets';
import { rasterMask } from '../editor/core/layerMask';
import type { Doc } from '../editor/core/types';

const noise = (n: number) => {
  let s = 1;
  return Uint8Array.from({ length: n }, () => ((s = (s * 1103515245 + 12345) >>> 0) >>> 24));
};

function doc(withMask: boolean): Doc {
  const mask = rasterMask({ x: 0, y: 0, w: 512, h: 512 }, 512, 512, noise(512 * 512), 0);
  return {
    id: 'p',
    name: 'd',
    width: 600,
    height: 600,
    background: { type: 'transparent' },
    version: 1,
    layers: [
      {
        id: 's',
        type: 'shape',
        name: 'forma',
        shape: 'rect',
        x: 0,
        y: 0,
        width: 512,
        height: 512,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: 1,
        blendMode: 'normal',
        visible: true,
        locked: false,
        fill: '#f00',
        stroke: '#000',
        strokeWidth: 0,
        cornerRadius: 0,
        shadow: false,
        shadowColor: '#000',
        shadowBlur: 0,
        shadowX: 0,
        shadowY: 0,
        ...(withMask ? { mask } : {}),
      },
    ],
  };
}

describe('máscaras en el almacén de imágenes', () => {
  beforeEach(() => db.clear());

  it('el documento persistido lleva una referencia corta y vuelve idéntico', async () => {
    const d = doc(true);
    const big = JSON.stringify(d).length;
    const [light] = await dehydrateDocs([d]);
    const persisted = JSON.stringify(light).length;
    expect(big).toBeGreaterThan(300_000); // máscara de ruido: el peor caso de compresión
    expect(persisted).toBeLessThan(2_000);
    expect(light.layers[0].mask!.data!.startsWith('asset:')).toBe(true);
    const [back] = await rehydrateDocs([light]);
    expect(back).toEqual(d);
  });

  it('un diseño sin máscara se guarda y vuelve exactamente igual', async () => {
    const d = doc(false);
    const [light] = await dehydrateDocs([d]);
    expect(light).toEqual(d);
    expect('mask' in light.layers[0]).toBe(false);
    const [back] = await rehydrateDocs([light]);
    expect(back).toEqual(d);
  });
});
