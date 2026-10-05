// Orientación EXIF (etiqueta 0x0112) del ítem «Exif» de HEIF. Lógica pura y acotada.
// En HEIF la orientación válida es la de irot/imir; EXIF solo se usa si no las hay (ver transform.ts).

/** Datos del ítem Exif: u32 desplazamiento hasta la cabecera TIFF + bloque EXIF. */
export function exifOrientationFromItem(data: Uint8Array): number | null {
  if (data.length < 4) return null;
  const off = ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0;
  let start = 4 + off;
  // Algunas herramientas ponen «Exif\0\0» delante de la cabecera TIFF y otras no.
  if (start + 6 <= data.length && data[start] === 0x45 && data[start + 1] === 0x78 && data[start + 2] === 0x69 && data[start + 3] === 0x66) start += 6;
  return tiffOrientation(data, start);
}

export function tiffOrientation(d: Uint8Array, t: number): number | null {
  if (t < 0 || t + 8 > d.length) return null;
  const le = d[t] === 0x49 && d[t + 1] === 0x49;
  const be = d[t] === 0x4d && d[t + 1] === 0x4d;
  if (!le && !be) return null;
  const u16 = (o: number) => (o + 2 > d.length ? -1 : le ? d[o] | (d[o + 1] << 8) : (d[o] << 8) | d[o + 1]);
  const u32 = (o: number) =>
    o + 4 > d.length ? -1 : (le ? d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24) : (d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
  if (u16(t + 2) !== 42) return null;
  const ifd = t + u32(t + 4);
  const n = u16(ifd);
  if (n < 0 || n > 1000) return null;
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > d.length) return null;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}
