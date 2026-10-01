import { describe, it, expect } from 'vitest';
import { rankCommands, normalize } from './commandSearch';

const cmds = [
  { id: 'a', label: 'Descargar PNG', group: 'Archivo' },
  { id: 'b', label: 'Duplicar capa', group: 'Capa', keywords: 'copiar clonar' },
  { id: 'c', label: 'Alinear al centro', group: 'Capa' },
  { id: 'd', label: 'Insertar texto', group: 'Elementos' },
  { id: 'e', label: 'Cambiar fondo', group: 'Diseño' },
];
const ids = (q: string) => rankCommands(cmds, q).map((c) => c.id);

describe('rankCommands', () => {
  it('consulta vacía conserva el orden', () => {
    expect(ids('')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('ignora acentos y mayúsculas', () => {
    expect(normalize('DiseÑo Ácido')).toBe('diseno acido');
    expect(ids('DISENO')).toEqual(['e']);
    expect(ids('descárgar')).toEqual(['a']);
  });
  it('prefijo > subcadena > subsecuencia', () => {
    expect(ids('d')[0]).toBe('a'); // prefijo, orden estable
    const r = rankCommands(
      [
        { id: 'sub', label: 'Reducir texto' },
        { id: 'pre', label: 'Texto grande' },
        { id: 'seq', label: 'Tamaño exacto' },
      ],
      'tex',
    ).map((c) => c.id);
    expect(r).toEqual(['pre', 'sub', 'seq']);
    const r2 = rankCommands(
      [
        { id: 'seq', label: 'Cambiar fondo' },
        { id: 'sub', label: 'Subir fondo' },
      ],
      'fon',
    ).map((c) => c.id);
    expect(r2).toEqual(['seq', 'sub']); // ambos inicio de palabra -> orden estable
    expect(rankCommands([{ id: 'x', label: 'Duplicar capa' }, { id: 'y', label: 'Alinear capa' }], 'dpc').map((c) => c.id)).toEqual(['x']);
  });
  it('busca en keywords y grupo', () => {
    expect(ids('clonar')).toEqual(['b']);
    expect(ids('archivo')).toEqual(['a']);
  });
  it('sin resultados', () => {
    expect(ids('zzzq')).toEqual([]);
  });
});
