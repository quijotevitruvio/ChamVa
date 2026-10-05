#!/usr/bin/env node
// Auditoría de licencias de un build de FFmpeg para Windows (zip o carpeta ya extraída).
// Es EL MISMO chequeo que corre .github/workflows/ffmpeg-build.yml antes de subir el
// artefacto, y el que scripts/fetch-ffmpeg.mjs repite antes de empaquetar el instalador.
//
//   node scripts/audit-ffmpeg-licenses.mjs <zip | carpeta>                 # informe en texto
//   node scripts/audit-ffmpeg-licenses.mjs <zip> --json audit.json          # además, informe JSON
//   node scripts/audit-ffmpeg-licenses.mjs <zip> --manifest-snippet m.json  # hashes para ffmpeg-manifest.json
//   node scripts/audit-ffmpeg-licenses.mjs <zip> --allow otra-lista.json    # otra lista blanca
//
// NO ejecuta ningún binario: lee los PE (tabla de importaciones, de importaciones
// diferidas y de exportaciones) y las cadenas del archivo. Falla (código 1) si:
//   - hay archivos de más o de menos en bin/ (p. ej. postproc-*.dll, ffplay.exe, SDL2.dll);
//   - una DLL o EXE importa algo que no es de Windows ni de FFmpeg (zlib1.dll, libwinpthread…);
//   - aparecen cadenas/símbolos de bibliotecas GPL o incompatibles (fftw, zvbi, chromaprint,
//     x264, x265, xvid, vidstab, fdk-aac, opencore, aribb24…), fuera de la línea de configuración;
//   - el -buildconf incrustado (av*_configuration) lleva --enable-gpl/--enable-nonfree/
//     --enable-version3 o un --enable-* que no está en scripts/ffmpeg-allowed-libs.json,
//     o no es el mismo en todos los archivos, o le falta un --enable/--disable obligatorio;
//   - falta LICENSE.txt (LGPL) o el SHA256SUMS del paquete no cuadra.
// Código 2: uso incorrecto o archivo ilegible.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ALLOW = path.join(here, 'ffmpeg-allowed-libs.json');

// ---------------------------------------------------------------- PE (sin dependencias)

/** Lee la tabla de importaciones (normal y diferida) y la de exportaciones de un PE32/PE32+. */
export function parsePE(buf) {
  const fail = (m) => {
    throw new Error(`PE no válido: ${m}`);
  };
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) fail('sin cabecera MZ');
  const pe = buf.readUInt32LE(0x3c);
  if (pe + 24 > buf.length || buf.readUInt32LE(pe) !== 0x00004550) fail('sin firma PE');
  const machine = buf.readUInt16LE(pe + 4);
  const nsec = buf.readUInt16LE(pe + 6);
  const optSize = buf.readUInt16LE(pe + 20);
  const characteristics = buf.readUInt16LE(pe + 22);
  const opt = pe + 24;
  const magic = buf.readUInt16LE(opt);
  if (magic !== 0x10b && magic !== 0x20b) fail(`magic ${magic.toString(16)}`);
  const is64 = magic === 0x20b;
  const ddOff = opt + (is64 ? 112 : 96);
  const nDirs = buf.readUInt32LE(ddOff - 4);
  const dir = (i) => (i < nDirs ? { rva: buf.readUInt32LE(ddOff + i * 8), size: buf.readUInt32LE(ddOff + i * 8 + 4) } : { rva: 0, size: 0 });
  const secOff = opt + optSize;
  const sections = [];
  for (let i = 0; i < nsec; i++) {
    const s = secOff + i * 40;
    if (s + 40 > buf.length) fail('tabla de secciones truncada');
    sections.push({
      name: buf.toString('latin1', s, s + 8).replace(/\0+$/, ''),
      vsize: buf.readUInt32LE(s + 8),
      va: buf.readUInt32LE(s + 12),
      rawSize: buf.readUInt32LE(s + 16),
      raw: buf.readUInt32LE(s + 20),
    });
  }
  const off = (rva) => {
    for (const s of sections) {
      const span = Math.max(s.vsize, s.rawSize);
      if (rva >= s.va && rva < s.va + span) {
        const o = s.raw + (rva - s.va);
        if (o >= buf.length) fail(`RVA ${rva.toString(16)} fuera del archivo`);
        return o;
      }
    }
    fail(`RVA ${rva.toString(16)} sin sección`);
  };
  const cstr = (rva) => {
    const o = off(rva);
    let e = o;
    while (e < buf.length && buf[e] !== 0 && e - o < 4096) e++;
    return buf.toString('latin1', o, e);
  };
  const imports = [];
  const imp = dir(1);
  if (imp.rva) {
    for (let o = off(imp.rva); o + 20 <= buf.length; o += 20) {
      const nameRva = buf.readUInt32LE(o + 12);
      const thunk = buf.readUInt32LE(o + 16);
      if (!nameRva && !thunk) break;
      if (nameRva) imports.push(cstr(nameRva));
    }
  }
  const delayImports = [];
  const dl = dir(13);
  if (dl.rva) {
    for (let o = off(dl.rva); o + 32 <= buf.length; o += 32) {
      const attrs = buf.readUInt32LE(o);
      const nameRva = buf.readUInt32LE(o + 4);
      if (!attrs && !nameRva) break;
      if (nameRva) delayImports.push(cstr(nameRva));
    }
  }
  let dllName = null;
  const exports = [];
  const ex = dir(0);
  if (ex.rva) {
    const o = off(ex.rva);
    const nameRva = buf.readUInt32LE(o + 12);
    if (nameRva) dllName = cstr(nameRva);
    const nNames = buf.readUInt32LE(o + 24);
    const namesRva = buf.readUInt32LE(o + 32);
    if (nNames > 200000) fail('demasiadas exportaciones');
    if (nNames) {
      const t = off(namesRva);
      for (let i = 0; i < nNames; i++) exports.push(cstr(buf.readUInt32LE(t + i * 4)));
    }
  }
  return { machine, is64, isDll: (characteristics & 0x2000) !== 0, sections: sections.map((s) => s.name), imports, delayImports, dllName, exports };
}

// ---------------------------------------------------------------- cadenas

/** Cadenas imprimibles (ASCII) de al menos `min` caracteres, como `strings`. */
export function printableStrings(buf, min = 4) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= buf.length; i++) {
    const c = i < buf.length ? buf[i] : 0;
    if (c >= 0x20 && c <= 0x7e) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= min) out.push({ at: start, text: buf.toString('latin1', start, i) });
      start = -1;
    }
  }
  return out;
}

/** ¿Parece una línea de opciones de configure (de FFmpeg o de una biblioteca, p. ej. libvpx)? */
export function isBuildconfString(s) {
  return /^--[a-z]/.test(s) && /(^| )--(enable|disable)-[a-z0-9]/.test(s) && (s.match(/(^| )--[a-z]/g) ?? []).length >= 3;
}

/** ¿Es la de FFmpeg (FFMPEG_CONFIGURATION = lo que imprime -buildconf)? Empieza por --prefix= y lleva --target-os=. */
export function isFFmpegBuildconf(s) {
  return isBuildconfString(s) && s.startsWith('--prefix=') && / --target-os=/.test(s);
}

/** Separa una cadena en (texto previo, línea de configuración) si contiene una; el compilador
 * puede dejar bytes imprimibles pegados delante (p. ej. «@--prefix=…»). */
export function splitBuildconf(text) {
  const i = text.search(/--[a-z]/);
  if (i < 0) return null;
  const conf = text.slice(i);
  return isBuildconfString(conf) ? { before: text.slice(0, i), conf } : null;
}

/** Tokens `--opcion[=valor]` de una línea de configuración (respeta comillas simples o dobles). */
export function buildconfTokens(line) {
  const toks = [];
  const re = /(?:^|\s)(--[^\s'"=]+(?:=(?:'[^']*'|"[^"]*"|\S*))?)/g;
  let m;
  while ((m = re.exec(line))) toks.push(m[1]);
  return toks;
}

/** Comprueba la línea de configuración contra la lista blanca. Devuelve errores (vacío = bien). */
export function checkBuildconf(line, allow) {
  const errs = [];
  const toks = buildconfTokens(line).map((t) => t.split('=')[0]);
  const set = new Set(toks);
  const libEnables = new Set(allow.libraries.flatMap((l) => l.configure ?? []));
  const allowed = new Set([...allow.buildconf.allowedEnable, ...libEnables]);
  for (const t of toks) {
    if (allow.buildconf.forbiddenEnable.includes(t)) errs.push(`-buildconf lleva ${t} (prohibido)`);
    else if (t.startsWith('--enable-') && !allowed.has(t)) errs.push(`-buildconf lleva ${t}, que no está en la lista blanca`);
  }
  for (const r of [...allow.buildconf.requiredEnable, ...(allow.buildconf.requiredDisable ?? [])]) {
    if (!set.has(r)) errs.push(`-buildconf no lleva ${r} (obligatorio)`);
  }
  return errs;
}

/** Busca patrones prohibidos en un binario, ignorando la línea de configuración de FFmpeg (se
 * revisa aparte, token a token, porque lleva los --disable-* explícitos) y las excepciones
 * benignas de la lista blanca (que pueden limitarse a ciertos archivos con `files`). */
export function scanForbidden(buf, allow, fileName = '') {
  const strs = printableStrings(buf, 4);
  const configs = [];
  const otherConfigs = [];
  const exc = allow.benignExceptions
    .filter((e) => !e.files || new RegExp(e.files, 'i').test(fileName))
    .map((e) => new RegExp(e.regex, 'gi'));
  const rules = allow.forbiddenPatterns.map((p) => ({ ...p, re: new RegExp(p.regex, 'i') }));
  const hits = new Map();
  for (const s of strs) {
    let t = s.text;
    const sp = splitBuildconf(t);
    if (sp && isFFmpegBuildconf(sp.conf)) {
      configs.push(sp.conf);
      t = sp.before;
    } else if (sp) {
      otherConfigs.push(sp.conf); // p. ej. vpx_codec_build_config(): se escanea como texto normal
    }
    for (const e of exc) t = t.replace(e, ' ');
    for (const r of rules) {
      if (r.re.test(t)) {
        const h = hits.get(r.id) ?? { id: r.id, reason: r.reason, count: 0, examples: [] };
        h.count++;
        if (h.examples.length < 5) h.examples.push(s.text.slice(0, 160));
        hits.set(r.id, h);
      }
    }
  }
  return { hits: [...hits.values()], configs: [...new Set(configs)], otherConfigs: [...new Set(otherConfigs)] };
}

// ---------------------------------------------------------------- importaciones

const globRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');

/** ¿Puede un archivo del paquete importar esta DLL? (Windows o una DLL propia de FFmpeg del paquete) */
export function importAllowed(dll, allow, ownDlls) {
  const d = dll.toLowerCase();
  if (ownDlls.some((o) => o.toLowerCase() === d)) return true;
  return allow.imports.system.some((g) => globRe(g).test(d));
}

/** Familias de símbolos exportados (prefijo hasta el primer `_`): pista de qué bibliotecas estáticas entraron. */
export function exportFamilies(names) {
  const fam = {};
  for (const n of names) {
    const m = /^_*([A-Za-z][A-Za-z0-9]*)_/.exec(n);
    const k = m ? m[1].toLowerCase() : '(sin prefijo)';
    fam[k] = (fam[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(fam).sort((a, b) => b[1] - a[1]));
}

// ---------------------------------------------------------------- paquete

async function sha256File(p) {
  return createHash('sha256').update(await readFile(p)).digest('hex');
}

async function extractZip(zip) {
  const dir = await mkdtemp(path.join(tmpdir(), 'chamva-audit-'));
  const tries =
    process.platform === 'win32'
      ? [[path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', dir]]]
      : [
          ['bsdtar', ['-xf', zip, '-C', dir]],
          ['unzip', ['-q', zip, '-d', dir]],
        ];
  for (const [bin, args] of tries) {
    const r = spawnSync(bin, args, { stdio: 'inherit' });
    if (r.status === 0) return dir;
  }
  await rm(dir, { recursive: true, force: true });
  throw new Error(`no se pudo extraer ${zip} (hace falta tar.exe de Windows, bsdtar o unzip)`);
}

/** Carpeta raíz del paquete: la que contiene bin/ (directamente o un nivel por debajo). */
async function packageRoot(dir, binDir) {
  if (existsSync(path.join(dir, binDir))) return dir;
  const subs = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory());
  for (const s of subs) if (existsSync(path.join(dir, s.name, binDir))) return path.join(dir, s.name);
  throw new Error(`no hay carpeta ${binDir}/ en el paquete`);
}

/** Audita una carpeta de paquete ya extraída. No lanza por fallos de licencia: los devuelve. */
export async function auditDir(root, allow) {
  const errors = [];
  const warnings = [];
  const bin = path.join(root, allow.package.binDir);
  const names = (await readdir(bin)).sort();
  const dllRes = allow.package.dllPatterns.map((p) => new RegExp(p, 'i'));
  const own = names.filter((n) => dllRes.some((r) => r.test(n)));
  for (const f of allow.package.exactFiles) if (!names.includes(f)) errors.push(`falta bin/${f}`);
  for (const r of dllRes) if (!names.some((n) => r.test(n))) errors.push(`falta una DLL que cumpla ${r.source}`);
  const extra = names.filter((n) => !allow.package.exactFiles.includes(n) && !own.includes(n));
  for (const n of extra) errors.push(`bin/${n} no está en la lista blanca (archivo de más)`);

  const files = [];
  const configs = new Set();
  for (const n of names) {
    const p = path.join(bin, n);
    const st = await stat(p);
    if (!st.isFile()) {
      errors.push(`bin/${n} no es un archivo normal`);
      continue;
    }
    const buf = await readFile(p);
    const entry = { file: n, size: st.size, sha256: createHash('sha256').update(buf).digest('hex') };
    if (/\.(exe|dll)$/i.test(n)) {
      try {
        const pe = parsePE(buf);
        if (pe.machine !== 0x8664) errors.push(`bin/${n}: máquina ${pe.machine.toString(16)}, no x64`);
        entry.imports = [...pe.imports, ...pe.delayImports.map((d) => `${d} (diferida)`)];
        entry.exportCount = pe.exports.length;
        entry.exportFamilies = exportFamilies(pe.exports);
        for (const d of [...pe.imports, ...pe.delayImports]) {
          if (!importAllowed(d, allow, own)) errors.push(`bin/${n} importa ${d}: no es de Windows ni de FFmpeg (biblioteca no auditada)`);
        }
      } catch (e) {
        errors.push(`bin/${n}: ${e.message}`);
      }
      const scan = scanForbidden(buf, allow, n);
      entry.forbidden = scan.hits;
      if (scan.otherConfigs.length) entry.libraryConfigs = scan.otherConfigs;
      for (const h of scan.hits) errors.push(`bin/${n}: «${h.id}» ×${h.count} (${h.reason}); p. ej. ${JSON.stringify(h.examples[0])}`);
      for (const c of scan.configs) configs.add(c);
      entry.buildconfFound = scan.configs.length > 0;
    }
    files.push(entry);
  }

  let buildconf = null;
  if (configs.size === 0) errors.push('no se encontró la línea de configuración (-buildconf) en ningún binario');
  else if (configs.size > 1) errors.push(`hay ${configs.size} líneas de configuración distintas entre los binarios (mezcla de builds)`);
  if (configs.size >= 1) {
    buildconf = [...configs][0];
    for (const c of configs) errors.push(...checkBuildconf(c, allow));
  }
  for (const f of files.filter((f) => /\.dll$/i.test(f.file) && !f.buildconfFound)) {
    warnings.push(`bin/${f.file}: sin línea de configuración incrustada`);
  }

  // licencia de FFmpeg y del resto
  const lic = path.join(root, 'LICENSE.txt');
  if (!existsSync(lic)) errors.push('falta LICENSE.txt (texto de la LGPL de FFmpeg)');
  else if (!/GNU LESSER GENERAL PUBLIC LICENSE/i.test(await readFile(lic, 'latin1'))) errors.push('LICENSE.txt no es la LGPL');
  const licDir = path.join(root, 'licenses');
  if (existsSync(licDir)) {
    const have = new Set(await readdir(licDir));
    for (const l of allow.libraries) if (!have.has(l.id)) errors.push(`falta licenses/${l.id}/`);
    if (!have.has('ffmpeg')) errors.push('falta licenses/ffmpeg/');
  } else {
    errors.push('el paquete no trae licenses/ (licencia de cada biblioteca enlazada; BSD/MIT exigen acompañar el binario)');
  }

  // SHA256SUMS del paquete (si viene)
  const sums = path.join(root, 'SHA256SUMS');
  if (existsSync(sums)) {
    for (const line of (await readFile(sums, 'utf8')).split(/\r?\n/).filter(Boolean)) {
      const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
      if (!m) {
        errors.push(`SHA256SUMS: línea no válida ${JSON.stringify(line.slice(0, 80))}`);
        continue;
      }
      const rel = m[2].replace(/^\.\//, '');
      if (rel.split(/[\\/]/).includes('..') || path.isAbsolute(rel)) {
        errors.push(`SHA256SUMS: ruta no válida ${rel}`);
        continue;
      }
      const p = path.join(root, rel);
      if (!existsSync(p)) errors.push(`SHA256SUMS: falta ${rel}`);
      else if ((await sha256File(p)) !== m[1]) errors.push(`SHA256SUMS: ${rel} no coincide`);
    }
  }
  return { ok: errors.length === 0, root, errors, warnings, buildconf, files };
}

/** Audita un zip o una carpeta. */
export async function audit(input, allow) {
  const st = await stat(input);
  if (st.isDirectory()) return { input, ...(await auditDir(await packageRoot(input, allow.package.binDir), allow)) };
  const dir = await extractZip(input);
  try {
    const r = await auditDir(await packageRoot(dir, allow.package.binDir), allow);
    return { input, zipSha256: await sha256File(input), ...r, root: path.relative(dir, r.root) || '.' };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Fragmento de `targets["x86_64-pc-windows-msvc"]` para src-tauri/ffmpeg-manifest.json. */
export function manifestSnippet(result) {
  return {
    sha256: result.zipSha256 ?? null,
    archive: 'zip',
    binDir: 'bin',
    verified: true,
    files: Object.fromEntries(result.files.filter((f) => /\.(exe|dll)$/i.test(f.file)).map((f) => [f.file, f.sha256])),
  };
}

export function formatReport(r) {
  const out = [];
  out.push(`Auditoría de licencias de FFmpeg: ${r.input}`);
  if (r.zipSha256) out.push(`  SHA-256 del zip: ${r.zipSha256}`);
  out.push(`  -buildconf: ${r.buildconf ?? '(no encontrado)'}`);
  out.push('  Bibliotecas enlazadas por archivo (importaciones PE; familias de símbolos exportados):');
  for (const f of r.files) {
    if (!f.imports) continue;
    const fam = Object.entries(f.exportFamilies ?? {})
      .slice(0, 8)
      .map(([k, v]) => `${k}×${v}`)
      .join(' ');
    out.push(`    ${f.file} (${(f.size / 1048576).toFixed(1)} MB): ${f.imports.join(', ') || '(ninguna)'}${fam ? `  | exporta: ${fam}` : ''}`);
  }
  for (const w of r.warnings) out.push(`  AVISO: ${w}`);
  for (const e of r.errors) out.push(`  ✕ ${e}`);
  out.push(r.ok ? '  ✓ Sin bibliotecas GPL ni incompatibles: coincide con la lista blanca.' : `  ✕ AUDITORÍA FALLIDA (${r.errors.length} problemas)`);
  return out.join('\n');
}

export async function loadAllow(p = DEFAULT_ALLOW) {
  const a = JSON.parse(await readFile(p, 'utf8'));
  if (a.schema !== 1) throw new Error(`lista blanca con schema ${a.schema} desconocido`);
  return a;
}

// ---------------------------------------------------------------- CLI

async function main(argv) {
  const opt = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const valued = new Set(['--json', '--manifest-snippet', '--allow']);
  const pos = argv.filter((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1]));
  if (pos.length !== 1) {
    console.error('Uso: node scripts/audit-ffmpeg-licenses.mjs <zip | carpeta> [--json salida.json] [--manifest-snippet m.json] [--allow lista.json]');
    return 2;
  }
  let allow, r;
  try {
    allow = await loadAllow(opt('--allow') ?? DEFAULT_ALLOW);
    r = await audit(pos[0], allow);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    return 2;
  }
  console.log(formatReport(r));
  if (opt('--json')) await writeFile(opt('--json'), JSON.stringify(r, null, 2));
  if (opt('--manifest-snippet')) await writeFile(opt('--manifest-snippet'), JSON.stringify(manifestSnippet(r), null, 2));
  return r.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exit(await main(process.argv.slice(2)));
}
