#!/usr/bin/env node
// Descarga el build de FFmpeg fijado en src-tauri/ffmpeg-manifest.json,
// verifica su SHA-256 (y el de cada archivo si el manifiesto los fija),
// comprueba la licencia del binario (-L / -buildconf: sin --enable-gpl ni
// --enable-nonfree) y lo coloca en src-tauri/binaries/ffmpeg/ para empaquetarlo
// con `tauri build --config src-tauri/tauri.ffmpeg.conf.json`.
//
// NO se ejecuta solo: es para el desarrollador y para CI. La app es offline y
// nunca descarga nada por su cuenta. Los binarios NO van a git (.gitignore).
//
//   node scripts/fetch-ffmpeg.mjs              # plataforma actual
//   node scripts/fetch-ffmpeg.mjs --target x86_64-pc-windows-msvc
//   node scripts/fetch-ffmpeg.mjs --archive ruta/al/zip   # sin red: usa un archivo ya descargado
//   node scripts/fetch-ffmpeg.mjs --cache-dir DIR          # guarda/reutiliza el zip en DIR (CI: actions/cache)
//
// Orígenes, por orden: `mirrors` del manifiesto (Release propio de ChamVa, no
// caduca) y después `url` (BtbN). Se acepta el primero cuyo SHA-256 coincide
// con el manifiesto; si ninguno coincide, sale con error (el CI se detiene).
//
// BLOQUEO: si el manifiesto (o la entrada de la plataforma) tiene `status`
// distinto de "ok" (v0.9.0: "blocked-license", build BtbN con licencias
// mixtas), el script se niega ANTES de descargar o tocar nada (código 8).
// `-L`/`-buildconf` es condición necesaria, no suficiente: no ve las licencias
// de las bibliotecas externas (ver docs/seguridad-ffmpeg.md, «Auditoría»).
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'src-tauri', 'ffmpeg-manifest.json'), 'utf8'));
const outDir = path.join(root, 'src-tauri', 'binaries', 'ffmpeg');

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

function hostTriple() {
  const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`;
  if (process.platform === 'linux') return `${arch}-unknown-linux-gnu`;
  if (process.platform === 'darwin') return `${arch}-apple-darwin`;
  return `${arch}-${process.platform}`;
}

const triple = opt('--target') ?? hostTriple();
const blocks = (st) => st !== undefined && st !== null && st !== 'ok';
if (blocks(manifest.status) || blocks(manifest.targets[triple]?.status)) {
  console.error(`El build de FFmpeg del manifiesto está BLOQUEADO (${manifest.status ?? manifest.targets[triple]?.status}): no se descarga ni se empaqueta.`);
  if (manifest.blockedReason) console.error(manifest.blockedReason);
  process.exit(8);
}
const target = manifest.targets[triple];
if (!manifest.sourceRelease || !manifest.license) {
  console.error('El manifiesto no fija «sourceRelease» y «license»: sin oferta de código fuente no se empaqueta.');
  process.exit(3);
}
if (!target) {
  console.error(`No hay build fijado para ${triple}.`);
  if (triple.includes('apple')) console.error('macOS: BtbN no publica builds; hay que compilar FFmpeg LGPL en CI (ver docs/seguridad-ffmpeg.md).');
  process.exit(2);
}
if (!/lgpl/.test(target.url) || /-gpl/.test(target.url)) {
  console.error('El manifiesto apunta a un build que no es LGPL: se aborta.');
  process.exit(3);
}

async function sha256(file) {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

const work = path.join(tmpdir(), `chamva-ffmpeg-${target.sha256.slice(0, 12)}`);
await mkdir(work, { recursive: true });
const zipName = path.basename(new URL(target.url).pathname);
const cacheDir = opt('--cache-dir');
if (cacheDir) await mkdir(cacheDir, { recursive: true });
const archive = opt('--archive') ?? path.join(cacheDir ?? work, zipName);
const sources = [...(target.mirrors ?? []), target.url];
for (const u of sources) {
  // mismo nombre de archivo en todos los orígenes: así el SHA-256 fijado es el del mismo zip
  if (!u.startsWith('https://') || path.basename(new URL(u).pathname) !== zipName) {
    console.error(`Origen no válido en el manifiesto: ${u}`);
    process.exit(3);
  }
}

// un zip ya presente (caché de CI, --archive) se verifica igual que uno descargado
let got = existsSync(archive) ? await sha256(archive) : '';
if (got && got !== target.sha256) {
  console.warn(`El zip en caché no coincide (SHA-256 ${got}): se descarta.`);
  if (!opt('--archive')) await rm(archive, { force: true });
  else process.exit(4);
  got = '';
}
if (!got) {
  for (const u of sources) {
    const part = archive + '.part';
    try {
      console.log(`Descargando ${u}`);
      const res = await fetch(u, { redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
      const h = await sha256(part);
      if (h !== target.sha256) throw new Error(`SHA-256 NO coincide (esperado ${target.sha256}, obtenido ${h})`);
      await copyFile(part, archive);
      got = h;
      break;
    } catch (e) {
      console.warn(`  ✕ ${u}: ${e.message}`);
    } finally {
      await rm(part, { force: true });
    }
  }
}
if (got !== target.sha256) {
  console.error('Ningún origen dio el zip con el SHA-256 fijado en el manifiesto: se aborta.');
  process.exit(4);
}
console.log(`SHA-256 del archivo verificado: ${got}`);

// extraer (bsdtar de Windows 10+ abre .zip; GNU tar en Linux abre .tar.xz)
const ex = path.join(work, 'x');
await rm(ex, { recursive: true, force: true });
await mkdir(ex, { recursive: true });
const tarBin = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const r = spawnSync(tarBin, ['-xf', archive, '-C', ex], { stdio: 'inherit' });
if (r.status !== 0) throw new Error('no se pudo extraer el archivo');
const top = (await readdir(ex))[0];
const bin = path.join(ex, top, target.binDir ?? 'bin');

const isWin = triple.includes('windows');
const wanted = (await readdir(bin)).filter((f) =>
  isWin ? /^(ffmpeg|ffprobe)\.exe$|\.dll$/i.test(f) : /^(ffmpeg|ffprobe)$|\.so(\.\d+)*$/.test(f),
);
if (target.files) {
  const names = Object.keys(target.files).sort();
  if (JSON.stringify(names) !== JSON.stringify([...wanted].sort())) {
    console.error('Los archivos del build no coinciden con el manifiesto:', wanted, names);
    process.exit(5);
  }
  for (const [f, h] of Object.entries(target.files)) {
    const fh = await sha256(path.join(bin, f));
    if (fh !== h) {
      console.error(`SHA-256 de ${f} no coincide (esperado ${h}, obtenido ${fh})`);
      process.exit(6);
    }
  }
  console.log(`Hashes de los ${names.length} archivos verificados.`);
} else {
  console.warn(`AVISO: el manifiesto no fija los hashes de cada archivo para ${triple} (build «sin verificar» en ChamVa).`);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
for (const f of wanted) await copyFile(path.join(bin, f), path.join(outDir, f));
const lic = path.join(ex, top, 'LICENSE.txt');
if (existsSync(lic)) await copyFile(lic, path.join(outDir, 'LICENSE.txt'));

// licencia del binario concreto (solo si se puede ejecutar aquí)
const exe = path.join(outDir, isWin ? 'ffmpeg.exe' : 'ffmpeg');
let buildconf = '';
let licenseText = '';
let version = '';
if (triple === hostTriple()) {
  const run = (a) => spawnSync(exe, ['-hide_banner', ...a], { encoding: 'utf8', timeout: 20000 });
  licenseText = run(['-L']).stdout;
  buildconf = run(['-buildconf']).stdout;
  version = run(['-version']).stdout.split('\n')[0];
  const flags = buildconf.split(/\s+/);
  const bad = ['--enable-gpl', '--enable-nonfree', '--enable-libx264', '--enable-libx265', '--enable-libvidstab', '--enable-libfdk-aac', '--enable-libxvid'].filter((f) => flags.includes(f));
  if (!/GNU Lesser General Public License/.test(licenseText) || bad.length) {
    await rm(outDir, { recursive: true, force: true });
    console.error('El binario NO es LGPL limpio:', bad.join(' ') || 'falta la declaración LGPL en -L');
    process.exit(7);
  }
  console.log(`Licencia verificada: LGPL (${/version 3/.test(licenseText) ? 'v3' : 'v2.1'}+), sin --enable-gpl ni --enable-nonfree.\n${version}`);
} else {
  console.warn(`AVISO: no se puede ejecutar un binario de ${triple} en ${hostTriple()}: la licencia la comprobará la app al arrancar (-L / -buildconf).`);
}

await writeFile(
  path.join(outDir, 'BUILD-INFO.json'),
  JSON.stringify({ triple, url: target.url, sha256: target.sha256, version: version || manifest.version, verifiedFiles: !!target.files, buildconf: buildconf.trim().split(/\s+/).filter((s) => s.startsWith('--')), fetchedAt: new Date().toISOString() }, null, 2),
);
await writeFile(
  path.join(outDir, 'AVISO-FFMPEG.txt'),
  `ChamVa incluye FFmpeg ${manifest.version} como programa aparte (no enlazado con ChamVa).

Licencia de este build: ${manifest.license}. El texto completo está en
LICENSE.txt, en esta misma carpeta, junto con las licencias de las
bibliotecas que incluyen las DLL (auditadas antes de publicar: ver
docs/seguridad-ffmpeg.md en el repositorio de ChamVa).

OFERTA DE CÓDIGO FUENTE: el código fuente completo y correspondiente de
este build (FFmpeg en el commit exacto, los scripts con los que se compiló
y las fuentes de las bibliotecas que incluyen las DLL), junto con el binario
exacto, se ofrece sin coste en:
    ${manifest.sourceRelease}

Código fuente de FFmpeg:          ${manifest.ffmpegSource}
Scripts del build:                 ${manifest.buildScripts}
Binario original:                  ${target.url}
SHA-256 del binario original:      ${target.sha256}

FFmpeg es un programa aparte: puedes modificarlo, recompilarlo y sustituir
estas bibliotecas (DLL/.so separadas) para usarlo por tu cuenta. ChamVa, por
seguridad, solo ejecuta la compilación cuyo SHA-256 lleva fijado: trabaja con
una copia propia en su carpeta de datos y la restaura desde aquí si cambia.
`,
);
// página de licencia del instalador: MIT de ChamVa + aviso de FFmpeg. UTF-8 SIN BOM: el bundler de
// Tauri ya añade el BOM para NSIS, y WiX (MSI, página 1252) falla con U+FEFF (LGHT0311).
const NL = String.fromCharCode(10);
const mit = await readFile(path.join(root, 'LICENSE'), 'utf8');
const aviso = await readFile(path.join(outDir, 'AVISO-FFMPEG.txt'), 'utf8');
await writeFile(
  path.join(root, 'src-tauri', 'binaries', 'LICENCIAS-INSTALADOR.txt'),
  [mit.trim(), '-'.repeat(72), aviso].join(NL + NL),
);
const st = await Promise.all(wanted.map((f) => stat(path.join(outDir, f))));
console.log(`Listo: ${wanted.length} archivos (${(st.reduce((a, s) => a + s.size, 0) / 1048576).toFixed(1)} MB) en ${path.relative(root, outDir)}`);
