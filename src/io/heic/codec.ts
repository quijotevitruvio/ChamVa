// Cadenas de códec WebCodecs a partir de las cajas de configuración (ISO/IEC 14496-15 anexo E
// para HEVC; especificación de AV1-ISOBMFF para AV1). Lógica pura.
import { HeicError } from './errors';

const hex = (n: number) => n.toString(16).toUpperCase();

function reverseBits32(x: number): number {
  let r = 0;
  for (let i = 0; i < 32; i++) {
    r = (r << 1) | (x & 1);
    x >>>= 1;
  }
  return r >>> 0;
}

/** «hvc1.1.6.L93.B0» desde un HEVCDecoderConfigurationRecord (contenido de hvcC). */
export function hevcCodecString(hvcC: Uint8Array): string {
  if (hvcC.length < 23) throw new HeicError('corrupt', 'hvcC demasiado corto');
  const b1 = hvcC[1];
  const space = b1 >> 6;
  const tier = (b1 >> 5) & 1;
  const profile = b1 & 31;
  const compat = ((hvcC[2] << 24) | (hvcC[3] << 16) | (hvcC[4] << 8) | hvcC[5]) >>> 0;
  const cons = Array.from(hvcC.subarray(6, 12));
  const level = hvcC[12];
  while (cons.length && cons[cons.length - 1] === 0) cons.pop();
  const parts = [`hvc1`, `${['', 'A', 'B', 'C'][space]}${profile}`, hex(reverseBits32(compat)), `${tier ? 'H' : 'L'}${level}`];
  for (const c of cons) parts.push(hex(c));
  return parts.join('.');
}

/** Profundidad de bits de luma declarada en hvcC (8, 10…). */
export function hevcBitDepth(hvcC: Uint8Array): number {
  return hvcC.length > 20 ? (hvcC[20] & 7) + 8 : 8;
}

/** Croma de hvcC: 0 monocromo (4:0:0), 1 4:2:0, 2 4:2:2, 3 4:4:4. */
export function hevcChroma(hvcC: Uint8Array): number {
  return hvcC.length > 16 ? hvcC[16] & 3 : 1;
}

/** «av01.0.08M.08» desde av1C. */
export function av1CodecString(av1C: Uint8Array): string {
  if (av1C.length < 4) throw new HeicError('corrupt', 'av1C demasiado corto');
  const profile = av1C[1] >> 5;
  const level = av1C[1] & 31;
  const tier = av1C[2] >> 7;
  const high = (av1C[2] >> 6) & 1;
  const twelve = (av1C[2] >> 5) & 1;
  const depth = high ? (twelve && profile === 2 ? 12 : 10) : 8;
  return `av01.${profile}.${String(level).padStart(2, '0')}${tier ? 'H' : 'M'}.${String(depth).padStart(2, '0')}`;
}
