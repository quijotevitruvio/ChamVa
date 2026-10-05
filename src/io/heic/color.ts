// Color básico: qué primarias declara la foto (nclx o perfil ICC) para que el navegador
// convierta a sRGB al dibujar. Solo se reconoce Display P3 (iPhone) y sRGB/BT.709. Puro.
import type { HeifProp } from './isobmff';

export type Primaries = 'bt709' | 'smpte432' | 'bt2020' | 'smpte170m' | 'bt470bg' | null;
export type Transfer = 'bt709' | 'iec61966-2-1' | 'smpte170m' | 'pq' | 'hlg' | 'linear' | null;
export type Matrix = 'rgb' | 'bt709' | 'bt470bg' | 'smpte170m' | 'bt2020-ncl' | null;

export interface ColorInfo {
  primaries: Primaries;
  transfer: Transfer;
  matrix: Matrix;
  fullRange: boolean | null;
  source: 'nclx' | 'icc' | 'none';
  iccName: string | null;
}

const PRIM: Record<number, Primaries> = { 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m', 9: 'bt2020', 12: 'smpte432' };
const TRC: Record<number, Transfer> = { 1: 'bt709', 6: 'smpte170m', 8: 'linear', 13: 'iec61966-2-1', 16: 'pq', 18: 'hlg' };
const MAT: Record<number, Matrix> = { 0: 'rgb', 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m', 9: 'bt2020-ncl' };

/** Nombre del perfil ICC (etiqueta 'desc', v2 'desc' o v4 'mluc'). null si no se lee. */
export function iccDescription(icc: Uint8Array): string | null {
  if (icc.length < 132) return null;
  const u32 = (o: number) => (o + 4 > icc.length ? 0 : ((icc[o] << 24) | (icc[o + 1] << 16) | (icc[o + 2] << 8) | icc[o + 3]) >>> 0);
  const n = Math.min(u32(128), 200);
  for (let i = 0; i < n; i++) {
    const e = 132 + i * 12;
    if (e + 12 > icc.length) return null;
    const sig = String.fromCharCode(icc[e], icc[e + 1], icc[e + 2], icc[e + 3]);
    if (sig !== 'desc') continue;
    const off = u32(e + 4);
    const len = u32(e + 8);
    if (off + len > icc.length || len < 12) return null;
    const t = String.fromCharCode(icc[off], icc[off + 1], icc[off + 2], icc[off + 3]);
    if (t === 'desc') {
      const cnt = u32(off + 8);
      let s = '';
      for (let k = 0; k < cnt && off + 12 + k < off + len; k++) {
        const ch = icc[off + 12 + k];
        if (!ch) break;
        s += String.fromCharCode(ch);
      }
      return s || null;
    }
    if (t === 'mluc') {
      const recs = u32(off + 8);
      if (!recs) return null;
      const sLen = u32(off + 16 + 4);
      const sOff = u32(off + 16 + 8);
      let s = '';
      for (let k = 0; k + 1 < sLen && off + sOff + k + 1 < off + len; k += 2) s += String.fromCharCode((icc[off + sOff + k] << 8) | icc[off + sOff + k + 1]);
      return s || null;
    }
    return null;
  }
  return null;
}

export function colorInfo(props: HeifProp[]): ColorInfo {
  const nclx = props.find((p) => p.kind === 'colr-nclx') as Extract<HeifProp, { kind: 'colr-nclx' }> | undefined;
  const icc = props.find((p) => p.kind === 'colr-icc') as Extract<HeifProp, { kind: 'colr-icc' }> | undefined;
  const iccName = icc ? iccDescription(icc.data) : null;
  if (nclx)
    return {
      primaries: PRIM[nclx.primaries] ?? null,
      transfer: TRC[nclx.transfer] ?? null,
      matrix: MAT[nclx.matrix] ?? null,
      fullRange: nclx.fullRange,
      source: 'nclx',
      iccName,
    };
  if (iccName) {
    const n = iccName.toLowerCase();
    const p3 = n.includes('p3');
    const srgb = n.includes('srgb') || n.includes('iec61966');
    if (p3 || srgb)
      return { primaries: p3 ? 'smpte432' : 'bt709', transfer: 'iec61966-2-1', matrix: null, fullRange: null, source: 'icc', iccName };
  }
  return { primaries: null, transfer: null, matrix: null, fullRange: null, source: 'none', iccName };
}

/**
 * Espacio de color con el que reetiquetar un fotograma decodificado, o null si el que trae el
 * flujo HEVC ya coincide (el navegador convierte a sRGB al dibujarlo en el lienzo).
 */
export function colorOverride(
  info: ColorInfo,
  frame: { primaries: string | null; transfer: string | null; matrix: string | null; fullRange: boolean | null },
): { primaries: string | null; transfer: string | null; matrix: string | null; fullRange: boolean | null } | null {
  if (info.source === 'none') return null;
  // Con ICC (sin nclx) solo se corrigen primarias/transferencia; matriz y rango son del flujo.
  const nclx = info.source === 'nclx';
  const want = {
    primaries: info.primaries ?? frame.primaries,
    transfer: info.transfer ?? frame.transfer,
    matrix: nclx ? (info.matrix ?? frame.matrix) : frame.matrix,
    fullRange: nclx ? (info.fullRange ?? frame.fullRange) : frame.fullRange,
  };
  if (info.source === 'icc' && frame.primaries === want.primaries) return null;
  const same =
    want.primaries === frame.primaries && want.transfer === frame.transfer && want.matrix === frame.matrix && want.fullRange === frame.fullRange;
  return same ? null : want;
}
