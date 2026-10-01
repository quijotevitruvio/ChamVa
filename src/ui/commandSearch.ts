export interface SearchableCommand {
  id: string;
  label: string;
  group?: string;
  keywords?: string;
}

/** Minúsculas y sin acentos/diacríticos. */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function isSubsequence(q: string, text: string): boolean {
  let i = 0;
  for (let j = 0; j < text.length && i < q.length; j++) if (text[j] === q[i]) i++;
  return i === q.length;
}

/** Puntuación (mayor = mejor) o 0 si no coincide. Prefijo > subcadena > subsecuencia. */
function scoreText(q: string, text: string): number {
  if (!text) return 0;
  if (text.startsWith(q)) return 300;
  // inicio de palabra
  if (text.split(/[\s\-_/]+/).some((w) => w.startsWith(q))) return 250;
  if (text.includes(q)) return 200;
  if (q.length >= 2 && isSubsequence(q, text)) return 100;
  return 0;
}

/** Filtra y ordena comandos por la consulta. Consulta vacía: orden original. Estable en empates. */
export function rankCommands<T extends SearchableCommand>(commands: T[], query: string): T[] {
  const q = normalize(query);
  if (!q) return commands.slice();
  const scored: { c: T; s: number; i: number }[] = [];
  commands.forEach((c, i) => {
    const label = scoreText(q, normalize(c.label));
    const kw = scoreText(q, normalize(c.keywords ?? ''));
    const grp = scoreText(q, normalize(c.group ?? ''));
    // la etiqueta pesa más que las palabras clave, y estas más que el grupo
    const s = Math.max(label * 3, kw * 2, grp);
    if (s > 0) scored.push({ c, s, i });
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return scored.map((x) => x.c);
}
