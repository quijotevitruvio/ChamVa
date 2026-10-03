import { describe, expect, it } from 'vitest';
import { REVERSE_BUDGET_BYTES, ReverseFrameCore, heldFramesFor, maxGopFrames, reverseCheck } from './reverse';

/** Tabla de muestras de mentira: GOP de `gop` fotogramas con B-frames (orden de decodificación ≠ presentación). */
function table(frames: number, gop: number, fps = 30, bframes = true) {
  const pts = new Float64Array(frames);
  const key = new Uint8Array(frames);
  for (let g = 0; g < frames; g += gop) {
    const n = Math.min(gop, frames - g);
    key[g] = 1;
    // decodificación: I P B P B …  → presentación: la P va dos puestos por delante de su B
    const order = Array.from({ length: n }, (_, i) => i);
    if (bframes)
      for (let i = 1; i + 1 < n; i += 2) {
        order[i] = i + 1;
        order[i + 1] = i;
      }
    for (let i = 0; i < n; i++) pts[g + i] = (g + order[i]) / fps;
  }
  return { count: frames, pts, key };
}

interface Fake {
  pts: number;
}

function harness(frames: number, gop: number, maxHeld: number) {
  const s = table(frames, gop);
  let alive = 0;
  let decodeCalls = 0;
  const core = new ReverseFrameCore<Fake>(
    s,
    async (i0, i1, on) => {
      decodeCalls++;
      for (let i = i0; i < i1; i++) {
        alive++;
        on(s.pts[i], { pts: s.pts[i] });
      }
    },
    () => {
      alive--;
    },
    maxHeld,
  );
  return { core, s, alive: () => alive, calls: () => decodeCalls };
}

describe('invertir por bloques de GOP', () => {
  it('devuelve en orden inverso el fotograma exacto de cada instante (con B-frames)', async () => {
    const { core } = harness(300, 30, 8);
    for (let i = 299; i >= 0; i--) {
      const r = await core.frameAt(i / 30);
      expect(r!.pts).toBeCloseTo(i / 30, 9);
    }
    core.close();
  });

  it('entre dos fotogramas devuelve el anterior (el visible) y antes de todo, el primero', async () => {
    const { core } = harness(60, 30, 8);
    expect((await core.frameAt(10.5 / 30))!.pts).toBeCloseTo(10 / 30, 9);
    expect((await core.frameAt(-5))!.pts).toBe(0);
    expect((await core.frameAt(999))!.pts).toBeCloseTo(59 / 30, 9);
    core.close();
  });

  it('MEMORIA ACOTADA: un clip de 20 000 fotogramas (11 min) con GOP de 250 nunca retiene más de maxHeld + 1 fotogramas vivos', async () => {
    const H = 12;
    const { core, alive, s } = harness(20000, 250, H);
    let peakRetained = 0;
    for (let i = s.count - 1; i >= 0; i -= 7) {
      const r = await core.frameAt(i / 30);
      expect(r!.pts).toBeCloseTo(i / 30, 9);
      peakRetained = Math.max(peakRetained, alive());
    }
    expect(peakRetained).toBeLessThanOrEqual(H + 1);
    expect(core.stats.peakAlive).toBeLessThanOrEqual(H + 1); // también en tránsito dentro de una pasada
    core.close();
    expect(alive()).toBe(0);
  });

  it('coste de decodificación acotado: ≲ GOP·(1 + GOP/maxHeld) por GOP al pedir todos los fotogramas', async () => {
    const gop = 60;
    const K = 10;
    const { core, s } = harness(1200, gop, K);
    for (let i = s.count - 1; i >= 0; i--) await core.frameAt(i / 30);
    const groups = 1200 / gop;
    expect(core.stats.decoded).toBeLessThanOrEqual(groups * gop * (1 + Math.ceil(gop / K)));
    expect(core.stats.passes).toBeLessThanOrEqual(groups * Math.ceil(gop / K) + groups);
    // con una ventana que cabe el GOP entero, una sola pasada por GOP
    const full = harness(1200, gop, 60);
    for (let i = 1199; i >= 0; i--) await full.core.frameAt(i / 30);
    expect(full.core.stats.passes).toBe(groups);
    full.core.close();
    core.close();
  });

  it('saltos (curva de velocidad / bucle) y peticiones repetidas también devuelven el fotograma correcto', async () => {
    const { core } = harness(900, 30, 6);
    for (const f of [850, 849, 849, 120, 121, 500, 10, 10, 899, 0]) expect((await core.frameAt(f / 30))!.pts).toBeCloseTo(f / 30, 9);
    core.close();
  });

  it('fotogramas por ventana según el tamaño: 1080p → 24 (tope), 4K → 7, 8K → mínimo 3', () => {
    expect(heldFramesFor(1920, 1080)).toBe(24);
    expect(heldFramesFor(3840, 2160)).toBe(Math.floor(REVERSE_BUDGET_BYTES / (3840 * 2160 * 1.5)));
    expect(heldFramesFor(3840, 2160)).toBeGreaterThanOrEqual(3);
    expect(heldFramesFor(7680, 4320)).toBe(3);
  });

  it('límites con aviso: tramos largos avisan, de más de 1 h no se permiten, GOP enormes avisan', () => {
    expect(reverseCheck(30)).toEqual({ ok: true, warnings: [] });
    const long = reverseCheck(900);
    expect(long.ok).toBe(true);
    expect(long.warnings[0]).toMatch(/lento/);
    expect(reverseCheck(7200).ok).toBe(false);
    expect(reverseCheck(60, 600).warnings[0]).toMatch(/fotogramas clave muy separados/);
    expect(maxGopFrames(table(100, 30))).toBe(30);
    expect(maxGopFrames({ count: 0, key: new Uint8Array(0) })).toBe(0);
  });
});
