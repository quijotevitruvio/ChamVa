import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_SOUND_LICENSES, checkSoundIndex, filterSounds, fmtSoundDuration, foldText, SOUND_BUDGET_BYTES, soundPath, totalSoundBytes, type SoundEntry, type SoundIndex } from './soundIndex';

const DIR = join(process.cwd(), 'public', 'sounds');
const ix = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')) as SoundIndex;

const mk = (o: Partial<SoundEntry> = {}): SoundEntry => ({
  id: 'a', nombre: 'Prueba', categoria: 'c', duracion: 1, etiquetas: ['x'], autor: 'Yo', fuente: 'https://e.com/a', licencia: 'CC0-1.0',
  sha256: 'a'.repeat(64), archivo: 'a.ogg', bytes: 10, bucle: false, canales: 1, ...o,
});
const small = (s: SoundEntry[]): SoundIndex => ({ version: 1, verificado: 'x', licencias_permitidas: ['CC0-1.0'], presupuesto_bytes: 1000, categorias: [{ id: 'c', nombre: 'C' }], sonidos: s });

describe('biblioteca de sonidos incluida (public/sounds)', () => {
  it('el índice es válido: licencias CC0, sin duplicados, dentro del presupuesto', () => {
    expect(checkSoundIndex(ix)).toEqual([]);
    expect(ix.licencias_permitidas).toEqual([...ALLOWED_SOUND_LICENSES]);
    expect(totalSoundBytes(ix)).toBeLessThanOrEqual(SOUND_BUDGET_BYTES);
  });
  it('tamaño del catálogo: 60–100 efectos y 8–12 pistas de música', () => {
    const music = ix.sonidos.filter((s) => s.categoria === 'musica').length;
    expect(music).toBeGreaterThanOrEqual(8);
    expect(music).toBeLessThanOrEqual(12);
    expect(ix.sonidos.length - music).toBeGreaterThanOrEqual(60);
    expect(ix.sonidos.length - music).toBeLessThanOrEqual(100);
    for (const c of ix.categorias) expect(ix.sonidos.some((s) => s.categoria === c.id), c.id).toBe(true);
  });
  it('cada archivo existe, pesa lo declarado y su SHA-256 coincide', () => {
    for (const s of ix.sonidos) {
      const p = join(DIR, s.archivo);
      expect(existsSync(p), s.archivo).toBe(true);
      expect(statSync(p).size, s.archivo).toBe(s.bytes);
      expect(createHash('sha256').update(readFileSync(p)).digest('hex'), s.archivo).toBe(s.sha256);
    }
  });
  it('no sobra ningún .ogg sin índice y LICENCIAS.md cita todos los archivos', () => {
    const listed = new Set(ix.sonidos.map((s) => s.archivo));
    for (const f of readdirSync(DIR).filter((f) => f.endsWith('.ogg'))) expect(listed.has(f), f).toBe(true);
    const md = readFileSync(join(DIR, 'LICENCIAS.md'), 'utf8');
    for (const s of ix.sonidos) expect(md.includes('`' + s.archivo + '`'), s.archivo).toBe(true);
    expect(md).toContain('CC0');
  });
  it('cada archivo es OGG/Opus', () => {
    for (const s of ix.sonidos) {
      const b = readFileSync(join(DIR, s.archivo));
      expect(b.subarray(0, 4).toString('latin1'), s.archivo).toBe('OggS');
      expect(b.subarray(28, 36).toString('latin1'), s.archivo).toBe('OpusHead');
    }
  });
});

describe('checkSoundIndex', () => {
  it('detecta licencia no permitida, ids/archivos/contenido repetidos y exceso de peso', () => {
    expect(checkSoundIndex(small([mk()]))).toEqual([]);
    expect(checkSoundIndex(small([mk({ licencia: 'CC-BY-4.0' })])).join()).toMatch(/licencia no permitida/);
    expect(checkSoundIndex(small([mk(), mk()])).join()).toMatch(/id repetido/);
    expect(checkSoundIndex(small([mk(), mk({ id: 'b' })])).join()).toMatch(/archivo repetido/);
    expect(checkSoundIndex(small([mk(), mk({ id: 'b', archivo: 'b.ogg' })])).join()).toMatch(/contenido duplicado/);
    expect(checkSoundIndex(small([mk({ bytes: 2000 })]), { budget: 1000 }).join()).toMatch(/presupuesto/);
    expect(checkSoundIndex(small([mk({ archivo: '../x.ogg' })])).join()).toMatch(/nombre de archivo/);
    expect(checkSoundIndex(small([mk({ sha256: 'zz' })])).join()).toMatch(/SHA-256/);
    expect(checkSoundIndex(small([mk({ categoria: 'nada' })])).join()).toMatch(/categoría/);
    expect(checkSoundIndex(small([mk({ fuente: 'http://x' })])).join()).toMatch(/https/);
    expect(checkSoundIndex(small([]))).toContain('el índice está vacío');
  });
});

describe('búsqueda y filtrado', () => {
  const list = [
    mk({ id: 'risa-bruja', nombre: 'Risa de bruja', categoria: 'risas', etiquetas: ['risa', 'terror'] }),
    mk({ id: 'lluvia', nombre: 'Lluvia constante', categoria: 'naturaleza', etiquetas: ['lluvia', 'agua'] }),
    mk({ id: 'clic', nombre: 'Clic suave', categoria: 'clics', etiquetas: ['botón', 'interfaz'] }),
  ];
  it('ignora tildes y mayúsculas y exige todas las palabras', () => {
    expect(foldText('  Pájaros ÁRBOL ')).toBe('pajaros arbol');
    expect(filterSounds(list, { query: 'BOTON' }).map((s) => s.id)).toEqual(['clic']);
    expect(filterSounds(list, { query: 'risa terror' }).map((s) => s.id)).toEqual(['risa-bruja']);
    expect(filterSounds(list, { query: 'risa agua' })).toEqual([]);
  });
  it('filtra por categoría y la combina con el texto', () => {
    expect(filterSounds(list, { category: 'naturaleza' }).map((s) => s.id)).toEqual(['lluvia']);
    expect(filterSounds(list, { category: 'naturaleza', query: 'risa' })).toEqual([]);
    expect(filterSounds(list, {})).toHaveLength(3);
  });
  it('el catálogo real responde a búsquedas típicas', () => {
    expect(filterSounds(ix.sonidos, { query: 'lluvia' }).length).toBeGreaterThan(0);
    expect(filterSounds(ix.sonidos, { query: 'aplausos' }).length).toBeGreaterThan(0);
    expect(filterSounds(ix.sonidos, { query: 'sirena' }).length).toBeGreaterThan(0);
    expect(filterSounds(ix.sonidos, { query: 'swoosh', category: 'transiciones' }).length).toBeGreaterThan(3);
  });
  it('rutas y duraciones', () => {
    expect(soundPath(mk())).toBe('sounds/a.ogg?v=aaaaaaaaaa');
    expect(fmtSoundDuration(0.44)).toBe('0,4 s');
    expect(fmtSoundDuration(12.4)).toBe('12 s');
    expect(fmtSoundDuration(74)).toBe('1:14');
  });
});
