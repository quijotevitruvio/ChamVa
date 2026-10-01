// Pegar y arrastrar desde fuera de la app (Ctrl+V y soltar desde otra pestaña).
// Lógica PURA y probada: clasificar qué trae el portapapeles / el arrastre y
// decidir quién gana si también hay una capa copiada dentro del editor.

export type PasteKind =
  | { kind: 'image' } // hay archivos de imagen (capturas, «copiar imagen» del navegador)
  | { kind: 'svg'; svg: string } // texto que es un SVG completo
  | { kind: 'data-image'; url: string } // <img src="data:…"> en el HTML copiado
  | { kind: 'text'; text: string } // texto normal → capa de texto
  | { kind: 'none' };

export interface ClipboardSnapshot {
  imageTypes: string[]; // tipos MIME de los archivos del portapapeles
  text: string; // text/plain
  html: string; // text/html
}

const IMG_SRC = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

// Primer <img src> de un fragmento HTML (o null).
export function firstImgSrc(html: string): string | null {
  const m = IMG_SRC.exec(html ?? '');
  const v = m?.[1] ?? m?.[2];
  return v ? v.replace(/&amp;/g, '&').trim() : null;
}

export const isDataImageUrl = (s: string) => /^data:image\//i.test(s.trim());

export function classifyPaste(c: ClipboardSnapshot): PasteKind {
  if (c.imageTypes.some((t) => t.startsWith('image/'))) return { kind: 'image' };
  const text = (c.text ?? '').trim();
  if (/^<svg[\s>]/i.test(text) && /<\/svg>\s*$/i.test(text)) return { kind: 'svg', svg: text };
  // Solo se intenta recuperar una imagen del HTML si viene EMBEBIDA (data:):
  // una URL http(s) no se descarga (sin red nueva); si hay texto, se pega el texto.
  const src = firstImgSrc(c.html);
  if (src && isDataImageUrl(src)) return { kind: 'data-image', url: src };
  if (text) return { kind: 'text', text: c.text.replace(/\r\n?/g, '\n') };
  return { kind: 'none' };
}

// ---- Arrastre desde otra pestaña/ventana ----
export type DropKind =
  | { kind: 'embedded'; url: string } // data: o blob: → se puede leer sin red
  | { kind: 'remote'; url: string } // http(s) → avisar, guardar el archivo primero
  | { kind: 'none' };

export function classifyDrop(d: { uriList: string; html: string }): DropKind {
  const fromHtml = firstImgSrc(d.html);
  const firstUri =
    (d.uriList ?? '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#')) ?? '';
  const url = fromHtml || firstUri;
  if (!url) return { kind: 'none' };
  if (/^(data:image\/|blob:)/i.test(url)) return { kind: 'embedded', url };
  if (/^https?:\/\//i.test(url)) return { kind: 'remote', url };
  return { kind: 'none' };
}

// ¿Quién gana en Ctrl+V: la capa copiada dentro del editor o el portapapeles del sistema?
// Criterio simple: la capa interna gana mientras el usuario NO haya salido de la
// ventana desde que la copió (si se fue, pudo copiar algo fuera). Si salió pero el
// portapapeles no trae nada utilizable, se pega la capa interna igualmente.
export function choosePasteSource(opts: {
  hasInternal: boolean;
  leftAppSinceCopy: boolean;
  external: PasteKind['kind'];
}): 'internal' | 'external' | 'none' {
  const { hasInternal, leftAppSinceCopy, external } = opts;
  if (hasInternal && !leftAppSinceCopy) return 'internal';
  if (external !== 'none') return 'external';
  return hasInternal ? 'internal' : 'none';
}

// data:image/...;base64,XXXX (o con %-escapes) → Blob, sin fetch (funciona con la CSP).
export function dataUrlToBlob(url: string): Blob | null {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/i.exec(url);
  if (!m) return null;
  const mime = m[1] || 'application/octet-stream';
  const isB64 = /;base64/i.test(m[2]);
  try {
    if (isB64) {
      const bin = atob(m[3].replace(/\s/g, ''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(m[3])], { type: mime });
  } catch {
    return null;
  }
}
