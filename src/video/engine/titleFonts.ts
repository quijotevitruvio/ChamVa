// Carga de las fuentes que usan los títulos y subtítulos de un proyecto. Un canvas no espera a que una
// fuente se descargue: si no está cargada, dibuja con la de respaldo. Hay que cargarlas ANTES de componer.
import type { VideoProject } from '../model/types';

/** Fuentes (familia + negrita + cursiva) distintas que usa el proyecto. */
export function titleFontsOf(p: VideoProject): { family: string; bold: boolean; italic: boolean }[] {
  const seen = new Map<string, { family: string; bold: boolean; italic: boolean }>();
  const add = (s: { fontFamily: string; bold: boolean; italic: boolean } | undefined) => {
    if (!s) return;
    const family = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    if (!family) return;
    const key = `${family}|${s.bold ? 1 : 0}|${s.italic ? 1 : 0}`;
    if (!seen.has(key)) seen.set(key, { family, bold: s.bold, italic: s.italic });
  };
  for (const t of p.tracks) {
    if (t.subStyle) add(t.subStyle.style);
    for (const c of t.clips) add(c.tstyle);
  }
  return [...seen.values()];
}

/** Descripción para `document.fonts.load` / `check`. */
export const fontDescriptor = (f: { family: string; bold: boolean; italic: boolean }) => `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}40px "${f.family}"`;

/** ¿Están ya cargadas todas las fuentes del proyecto? (true si no hay API de fuentes: nada que esperar) */
export function titleFontsReady(p: VideoProject): boolean {
  if (typeof document === 'undefined' || !document.fonts?.check) return true;
  try {
    return titleFontsOf(p).every((f) => document.fonts.check(fontDescriptor(f)));
  } catch {
    return true;
  }
}

/** Carga las fuentes de títulos y subtítulos; no falla nunca (una fuente que no carga se dibuja con la de respaldo). */
export async function ensureTitleFonts(p: VideoProject, timeoutMs = 4000): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  const fonts = titleFontsOf(p);
  if (!fonts.length) return;
  const all = Promise.allSettled(fonts.map((f) => document.fonts.load(fontDescriptor(f), 'AÁÉÍÓÚÑñ¿¡ abc 123')));
  await Promise.race([all, new Promise((r) => setTimeout(r, timeoutMs))]);
}
