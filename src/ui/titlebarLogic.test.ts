import { describe, expect, it } from 'vitest';
import { TITLEBAR_H, TITLEBAR_H_NARROW, Z_TITLEBAR, Z_TOOLTIP, shouldShowWindowControls, titlebarHeightFor } from './titlebarLogic';
import { closeReasons, registerCloseGuard } from './windowClose';

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
