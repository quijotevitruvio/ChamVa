import { describe, expect, it } from 'vitest';
import { buildResourceReport, dataUrlBytes, fontKind, reportToText } from './resourceReport';
import type { Doc } from '../editor/core/types';

const base = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, blendMode: 'normal', visible: true, locked: false };
const PNG = 'data:image/png;base64,' + 'A'.repeat(400);

const doc = {
  id: 'd',
  name: 'x',
  width: 1000,
  height: 1000,
  background: { type: 'solid', color: '#FFF' },
  layers: [
    { ...base, id: '1', name: 'Titulo', type: 'text', text: 'Hola', fontFamily: 'Montserrat', fill: '#ff0000', strokeWidth: 0, strokeColor: '#000', shadow: false },
    { ...base, id: '2', name: 'Vacío', type: 'text', text: '  ', fontFamily: 'Arial', fill: '#ff0000', strokeWidth: 0, strokeColor: '#000', shadow: false },
    { ...base, id: '3', name: 'Foto', type: 'image', src: PNG, naturalWidth: 100, naturalHeight: 50, scaleX: 4, scaleY: 4, shadow: false },
    { ...base, id: '4', name: 'Oculta', type: 'shape', shape: 'rect', width: 10, height: 10, fill: '#00ff00', stroke: '#000', strokeWidth: 0, visible: false, shadow: false },
    { ...base, id: '5', name: 'Rara', type: 'text', text: 'x', fontFamily: 'Fuente Inventada', fill: '#00f', strokeWidth: 0, strokeColor: '#000', shadow: false },
  ],
} as unknown as Doc;

describe('resourceReport', () => {
  it('clasifica fuentes', () => {
    expect(fontKind('Montserrat')).toBe('empaquetada');
    expect(fontKind('Arial')).toBe('sistema');
    expect(fontKind('Mi Fuente', ['Mi Fuente'])).toBe('propia');
    expect(fontKind('Otra')).toBe('desconocida');
  });
  it('peso de data URL', () => {
    expect(dataUrlBytes(PNG)).toBe(300);
    expect(dataUrlBytes('https://x')).toBe(0);
  });
  it('detecta problemas y cuenta recursos', () => {
    const r = buildResourceReport([doc]);
    expect(r.fonts.map((f) => f.name).sort()).toEqual(['Arial', 'Fuente Inventada', 'Montserrat']);
    expect(r.images[0]).toMatchObject({ naturalW: 100, shownW: 400, bytes: 300 });
    expect(r.uniqueImages).toBe(1);
    const txt = r.issues.map((i) => i.text).join('|');
    expect(txt).toContain('ampliada ×4.0');
    expect(txt).toContain('Capa de texto vacía');
    expect(txt).toContain('Capa oculta');
    expect(txt).toContain('Fuente no empaquetada');
    expect(r.colors.find((c) => c.hex === '#ff0000')?.uses).toBe(2);
    expect(r.colors.some((c) => c.hex === '#ffffff')).toBe(true); // #FFF normalizado
    expect(r.issues[0].level).toBe('aviso'); // avisos primero
  });
  it('texto del informe', () => {
    const t = reportToText(buildResourceReport([doc]), 'Prueba');
    expect(t).toContain('Informe de recursos — Prueba');
    expect(t).toContain('FUENTES (3)');
    expect(t).toContain('PROBLEMAS');
  });
});
