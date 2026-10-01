// Informe de errores copiable. NUNCA incluye contenido del diseño ni datos
// personales: se redactan correos, rutas de usuario, imágenes incrustadas y
// parámetros de URL, y solo se añaden contadores (capas, páginas).

const MAX_LINES = 20;
const MAX_LINE_LEN = 300;
const buffer: string[] = [];
let installed = false;

/** Quita de un texto lo que podría ser personal o pesado. */
export function redact(text: string): string {
  return String(text ?? '')
    .replace(/data:[a-z0-9.+/-]+;base64,[A-Za-z0-9+/=]+/gi, 'data:[omitido]')
    .replace(/blob:[^\s)'"]+/gi, 'blob:[omitido]')
    .replace(/[A-Za-z0-9+/=_-]{120,}/g, '[texto largo omitido]')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[correo]')
    .replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s)]+/gi, '$1<usuario>')
    .replace(/(\/(?:home|Users)\/)[^/\s)]+/g, '$1<usuario>')
    .replace(/(https?:\/\/[^\s)?#'"]+)\?[^\s)'"]*/gi, '$1?[…]');
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function fmtArg(a: unknown): string {
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  if (typeof a === 'string') return a;
  try {
    return JSON.stringify(a) ?? String(a);
  } catch {
    return String(a);
  }
}

/** Añade una línea al buffer circular de errores de consola. */
export function pushConsoleLine(line: string) {
  buffer.push(clip(redact(line).replace(/\s+/g, ' ').trim(), MAX_LINE_LEN));
  if (buffer.length > MAX_LINES) buffer.shift();
}

export function getConsoleLines(): string[] {
  return [...buffer];
}

/** Engancha console.error y los errores globales (una sola vez). */
export function installErrorCapture() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      pushConsoleLine(args.map(fmtArg).join(' '));
    } catch {
      /* el buffer nunca debe romper el log */
    }
    orig(...args);
  };
  window.addEventListener('error', (e) => pushConsoleLine(`window.onerror: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) =>
    pushConsoleLine(`Promesa rechazada: ${fmtArg((e as PromiseRejectionEvent).reason)}`),
  );
}

export interface ReportInfo {
  version: string;
  userAgent: string;
  lang: string;
  theme: string;
  layers: number;
  pages: number;
  memoryMB?: number;
  errorName: string;
  errorMessage: string;
  stack?: string;
  componentStack?: string;
  consoleLines: string[];
}

export function buildReport(i: ReportInfo): string {
  const out = [
    '## Informe de error de ChamVa',
    `Versión: ${i.version}`,
    `Navegador/WebView: ${redact(i.userAgent)}`,
    `Idioma: ${i.lang} · Tema: ${i.theme}`,
    `Diseño: ${i.pages} página(s), ${i.layers} capa(s) en total (sin contenido)`,
    `Memoria JS aprox.: ${i.memoryMB != null ? i.memoryMB + ' MB' : 'no disponible'}`,
    '',
    `Error: ${redact(i.errorName)}: ${redact(i.errorMessage)}`,
    '',
    'Pila:',
    clip(redact(i.stack ?? '(sin pila)'), 2000),
  ];
  if (i.componentStack) out.push('', 'Componentes:', clip(redact(i.componentStack), 800));
  out.push('', `Últimos errores de consola (${i.consoleLines.length}):`);
  out.push(...(i.consoleLines.length ? i.consoleLines.map((l) => '- ' + redact(l)) : ['(ninguno)']));
  return out.join('\n');
}

/** Recorta el informe para que quepa en una URL de «nueva incidencia». */
export function truncateReport(report: string, max = 1500): string {
  if (report.length <= max) return report;
  const note = '\n…(recortado; pega aquí el informe completo copiado)';
  return report.slice(0, max - note.length) + note;
}

export function issueUrl(repo: string, errorMessage: string, report: string, max = 1500): string {
  const title = clip(`Error: ${redact(errorMessage)}`.replace(/\s+/g, ' '), 100);
  return (
    `${repo.replace(/\/$/, '')}/issues/new?title=${encodeURIComponent(title)}` +
    `&body=${encodeURIComponent(truncateReport(report, max))}`
  );
}
