// ¿Parece HEIC/HEIF? Sin dependencias: se importa estáticamente desde io/import.ts y
// el resto del decodificador se carga bajo demanda (chunk propio).

const HEIF_EXT = new Set(['heic', 'heif', 'heics', 'heifs', 'hif']);
const HEIF_MIME = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);

export function isHeicLike(file: { name: string; type: string }): boolean {
  const ext = (/\.([^.\\/]+)$/.exec(file.name || '')?.[1] ?? '').toLowerCase();
  return HEIF_EXT.has(ext) || HEIF_MIME.has((file.type || '').toLowerCase());
}

/** Marcas `ftyp` de HEIF con imagen fija (no AVIF puro: ese lo abre el navegador). */
export const HEIF_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'mif2', 'msf1', 'avif', 'avis'];

/** Lee la caja `ftyp` de los primeros bytes. null si no es ISOBMFF. */
export function sniffFtyp(head: Uint8Array): { major: string; brands: string[] } | null {
  if (head.length < 12) return null;
  const t = String.fromCharCode(head[4], head[5], head[6], head[7]);
  if (t !== 'ftyp') return null;
  const size = ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0;
  const end = Math.min(size || head.length, head.length);
  const cc = (o: number) => String.fromCharCode(head[o], head[o + 1], head[o + 2], head[o + 3]);
  const major = cc(8);
  const brands: string[] = [major];
  for (let o = 16; o + 4 <= end; o += 4) brands.push(cc(o));
  return { major, brands };
}

export function isHeifBrand(head: Uint8Array): boolean {
  const f = sniffFtyp(head);
  return !!f && f.brands.some((b) => HEIF_BRANDS.includes(b));
}
