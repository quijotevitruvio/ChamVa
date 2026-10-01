// Plantilla de nombre de archivo para las descargas: «{nombre}-{pagina}-{fecha}».
// Lógica pura (sin DOM) para poder probarla.

export const DEFAULT_NAME_TEMPLATE = '{nombre}';

export interface NameVars {
  nombre: string;
  fecha: string; // AAAA-MM-DD
  pagina: number; // 1..N
  n: number; // número de orden del archivo dentro de la descarga (1..total)
  total: number;
  ancho: number;
  alto: number;
  escala: string; // «2x», «0.5x» o «1200w»
  formato: string; // extensión: png, jpg, webp…
}

export const NAME_VARIABLES = ['{nombre}', '{fecha}', '{pagina}', '{n}', '{ancho}', '{alto}', '{escala}', '{formato}'];

export function dateStamp(d = new Date()): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Quita lo que los sistemas de archivos no admiten y recorta el resultado.
export function sanitizeFileName(s: string): string {
  const clean = s
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 120)
    .replace(/[\s.]+$/g, '');
  return clean || 'chamva';
}

export function expandTemplate(tpl: string, v: NameVars): string {
  const digits = String(Math.max(1, v.total)).length;
  const map: Record<string, string> = {
    nombre: v.nombre,
    fecha: v.fecha,
    pagina: String(v.pagina),
    n: String(v.n).padStart(digits, '0'),
    ancho: String(v.ancho),
    alto: String(v.alto),
    escala: v.escala,
    formato: v.formato,
  };
  const out = (tpl.trim() || DEFAULT_NAME_TEMPLATE).replace(/\{(\w+)\}/g, (m, k: string) =>
    k in map ? map[k] : m,
  );
  return sanitizeFileName(out);
}

// Nombre final SIN extensión. Si hay varias páginas o tamaños y la plantilla no
// los distingue, se añade solo el sufijo (`_pagN`, `@2x`) para no pisar archivos.
export function buildFileName(
  tpl: string,
  v: NameVars,
  opts: { multiPages: boolean; multiScales: boolean },
): string {
  const t = tpl.trim() || DEFAULT_NAME_TEMPLATE;
  let base = expandTemplate(t, v);
  if (opts.multiPages && !/\{(pagina|n)\}/.test(t)) base += `_pag${v.pagina}`;
  if (opts.multiScales && !/\{escala\}/.test(t)) base += `@${v.escala}`;
  return sanitizeFileName(base);
}

// Evita nombres repetidos dentro de un ZIP: «a.png», «a (2).png»…
export function uniqueName(name: string, used: Set<string>): string {
  const key = (s: string) => s.toLowerCase();
  if (!used.has(key(name))) {
    used.add(key(name));
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) {
    const cand = `${stem} (${i})${ext}`;
    if (!used.has(key(cand))) {
      used.add(key(cand));
      return cand;
    }
  }
}
