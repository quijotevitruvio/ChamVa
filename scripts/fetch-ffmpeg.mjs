#!/usr/bin/env node
// Descarga el build de FFmpeg LGPL fijado en src-tauri/ffmpeg-manifest.json,
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
const target = manifest.targets[triple];
if (!target) {
  console.error(`No hay build LGPL fijado para ${triple}.`);
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
const archive = opt('--archive') ?? path.join(work, path.basename(new URL(target.url).pathname));

if (!existsSync(archive)) {
  console.log(`Descargando ${target.url}`);
  const res = await fetch(target.url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`descarga fallida: HTTP ${res.status}`);
  const part = archive + '.part';
  await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
  await copyFile(part, archive);
  await rm(part, { force: true });
}
const got = await sha256(archive);
if (got !== target.sha256) {
  await rm(archive, { force: true });
  console.error(`SHA-256 NO coincide.\n  esperado ${target.sha256}\n  obtenido ${got}\nSe ha borrado el archivo.`);
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
  const bad = ['--enable-gpl', '--enable-nonfree', '--enable-libx264', '--enable-libx265', '--enable-libvidstab', '--enable-libfdk-aac'].filter((f) => flags.includes(f));
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

FFmpeg es software libre bajo la GNU Lesser General Public License
versión 3 o posterior (LGPL-3.0-or-later); el texto completo está en
LICENSE.txt, en esta misma carpeta. Este build NO incluye componentes GPL
ni «nonfree» (sin x264, x265, vid.stab ni fdk-aac).

Código fuente de FFmpeg:          ${manifest.ffmpegSource}
Scripts del build (y fuentes de
las bibliotecas que incluye):      ${manifest.buildScripts}
Binario original:                  ${target.url}
SHA-256 del binario original:      ${target.sha256}

Puedes sustituir estos archivos por otra versión de FFmpeg compilada por ti:
las bibliotecas (DLL/.so) están separadas precisamente para permitirlo.
`,
);
// página de licencia del instalador: MIT de ChamVa + aviso de FFmpeg (UTF-8 con BOM para NSIS)
const BOM = String.fromCharCode(0xfeff);
const NL = String.fromCharCode(10);
const mit = await readFile(path.join(root, 'LICENSE'), 'utf8');
const aviso = await readFile(path.join(outDir, 'AVISO-FFMPEG.txt'), 'utf8');
await writeFile(
  path.join(root, 'src-tauri', 'binaries', 'LICENCIAS-INSTALADOR.txt'),
  [BOM + mit.trim(), '-'.repeat(72), aviso].join(NL + NL),
);
const st = await Promise.all(wanted.map((f) => stat(path.join(outDir, f))));
console.log(`Listo: ${wanted.length} archivos (${(st.reduce((a, s) => a + s.size, 0) / 1048576).toFixed(1)} MB) en ${path.relative(root, outDir)}`);
