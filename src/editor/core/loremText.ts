// Texto de relleno (lorem ipsum) con saltos de línea duros: las capas de texto
// no ajustan a un ancho, así que el párrafo se corta aquí a ~maxChars.
export type LoremKind = 'p1' | 'p3' | 'list';

const SENTENCES = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum.',
  'Excepteur sint occaecat cupidatat non proident, sunt in culpa.',
  'Curabitur pretium tincidunt lacus, nulla gravida orci a odio.',
  'Vestibulum ante ipsum primis in faucibus orci luctus et ultrices.',
  'Integer posuere erat a ante venenatis dapibus posuere velit aliquet.',
];

const ITEMS = [
  'Lorem ipsum dolor sit amet',
  'Consectetur adipiscing elit',
  'Sed do eiusmod tempor',
  'Ut enim ad minim veniam',
  'Duis aute irure dolor',
];

// Corta un párrafo en líneas de como mucho `max` caracteres (por palabras).
export function wrapWords(text: string, max: number): string {
  const limit = Math.max(8, Math.floor(max));
  const lines: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + w).length > limit) {
      lines.push(line);
      line = w;
    } else line = line ? line + ' ' + w : w;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

export function loremText(kind: LoremKind, maxChars = 40): string {
  if (kind === 'list') return ITEMS.join('\n');
  const para = (offset: number) => {
    const n = 3 + (offset % 2);
    return wrapWords(
      Array.from({ length: n }, (_, i) => SENTENCES[(offset * 3 + i) % SENTENCES.length]).join(' '),
      maxChars,
    );
  };
  if (kind === 'p1') return para(0);
  return [para(0), para(1), para(2)].join('\n\n');
}
