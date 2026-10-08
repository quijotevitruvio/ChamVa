import { describe, expect, it } from 'vitest';
import { TITLEBAR_H, TITLEBAR_H_NARROW, Z_TITLEBAR, Z_TOOLTIP, shouldShowWindowControls, titlebarHeightFor } from './titlebarLogic';
import { closeReasons, createCloseController, registerCloseGuard } from './windowClose';

// @ts-ignore node builtins (el proyecto no incluye @types/node)
import { readdirSync, readFileSync, statSync } from 'node:fs';

// Lee los CSS del proyecto tal cual (import ?raw los pasa por el procesador de CSS y llegan vacíos).
function readCss(dir: string, out: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir) as string[]) {
    if (name.includes('(1)')) continue;
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) readCss(full, out);
    else if (name.endsWith('.css')) out[full] = readFileSync(full, 'utf8') as string;
  }
  return out;
}
const css = readCss('src');

describe('franja de la ventana', () => {
  it('los botones solo se pintan en Tauri sin decoraciones', () => {
    expect(shouldShowWindowControls(true, false)).toBe(true);
    expect(shouldShowWindowControls(true, true)).toBe(false);
    expect(shouldShowWindowControls(true, null)).toBe(false);
    expect(shouldShowWindowControls(false, false)).toBe(false);
  });

  it('altura según el ancho y coherente con App.css', () => {
    expect(titlebarHeightFor(1280)).toBe(TITLEBAR_H);
    expect(titlebarHeightFor(768)).toBe(TITLEBAR_H_NARROW);
    expect(titlebarHeightFor(390)).toBe(TITLEBAR_H_NARROW);
    expect(Object.keys(css).length).toBeGreaterThan(20);
    const app = css['src/App.css'];
    expect(app).toContain(`--titlebar-h: ${TITLEBAR_H}px`);
    expect(app).toContain(`--titlebar-h: ${TITLEBAR_H_NARROW}px`);
    expect(app).toMatch(/:root\s*\{[^}]*--titlebar-h: 0px/);
    expect(app).toContain(`--z-titlebar: ${Z_TITLEBAR}`);
  });

  it('ningún z-index del CSS supera la franja salvo el tooltip', () => {
    const over: string[] = [];
    for (const [file, text] of Object.entries(css)) {
      if (file.includes('(1)')) continue;
      for (const m of text.matchAll(/z-index:\s*(\d+)/g)) {
        const z = Number(m[1]);
        if (z >= Z_TITLEBAR && z !== Z_TOOLTIP && !(file.endsWith('App.css') && z === Z_TITLEBAR)) over.push(`${file}:${z}`);
      }
    }
    expect(over).toEqual([]);
  });

  it('toda capa fija a pantalla completa nace bajo la franja', () => {
    const bad: string[] = [];
    for (const [file, text] of Object.entries(css)) {
      if (file.includes('(1)')) continue;
      for (const m of text.matchAll(/([^{}]+)\{([^{}]*position:\s*fixed[^{}]*)\}/g)) {
        if (/(^|[\s;])inset:\s*0\s*;/.test(m[2])) bad.push(`${file}: ${m[1].trim().slice(-40)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('las guardas de cierre reúnen motivos y se pueden retirar', () => {
    expect(closeReasons()).toEqual([]);
    const off = registerCloseGuard(() => 'grabando');
    const off2 = registerCloseGuard(() => null);
    const off3 = registerCloseGuard(() => {
      throw new Error('x');
    });
    expect(closeReasons()).toEqual(['grabando']);
    off();
    off2();
    off3();
    expect(closeReasons()).toEqual([]);
  });
});

describe('controlador del cierre de ventana', () => {
  const mk = (reasons: string[], over: Partial<Parameters<typeof createCloseController>[0]> = {}) => {
    const calls = { destroy: 0, flush: 0, prevented: 0 };
    const c = createCloseController({
      reasons: () => reasons,
      flush: async () => (calls.flush++, true),
      destroy: () => void calls.destroy++,
      flushTimeoutMs: 20,
      ...over,
    });
    const ev = { preventDefault: () => void calls.prevented++ };
    return { c, calls, ev };
  };

  it('sin motivos: guarda y cierra sin preguntar', async () => {
    const { c, calls, ev } = mk([]);
    await c.request(ev);
    expect(c.getPending()).toBeNull();
    expect(calls).toEqual({ destroy: 1, flush: 1, prevented: 1 });
  });

  it('con motivos: cancela el cierre, publica los motivos y no cierra', async () => {
    const { c, calls, ev } = mk(['grabando']);
    await c.request(ev);
    expect(c.getPending()).toEqual(['grabando']);
    expect(calls.destroy).toBe(0);
  });

  it('una segunda petición con el diálogo abierto no lo duplica ni cierra', async () => {
    const { c, calls, ev } = mk(['x']);
    await c.request(ev);
    await c.request(ev);
    expect(calls.destroy).toBe(0);
    expect(calls.flush).toBe(1);
  });

  it('cancelar mantiene la ventana y permite volver a preguntar', async () => {
    const { c, calls, ev } = mk(['x']);
    await c.request(ev);
    c.cancel();
    expect(c.getPending()).toBeNull();
    await c.request(ev);
    expect(c.getPending()).toEqual(['x']);
    expect(calls.destroy).toBe(0);
  });

  it('confirmar destruye una sola vez y las peticiones siguientes no bucle', async () => {
    const { c, calls, ev } = mk(['x']);
    await c.request(ev);
    await c.confirm();
    expect(calls.destroy).toBe(1);
    await c.request(ev); // eco del sistema: se deja pasar, no se pregunta de nuevo
    expect(c.getPending()).toBeNull();
    expect(calls.destroy).toBe(1);
  });

  it('un guardado colgado o roto no bloquea el cierre', async () => {
    const hang = mk([], { flush: () => new Promise<boolean>(() => {}) });
    await hang.c.request(hang.ev);
    expect(hang.calls.destroy).toBe(1);
    const bad = mk([], { flush: () => Promise.reject(new Error('x')) });
    await bad.c.request(bad.ev);
    expect(bad.calls.destroy).toBe(1);
  });
});
