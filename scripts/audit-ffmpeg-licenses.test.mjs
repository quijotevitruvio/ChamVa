// Pruebas de scripts/audit-ffmpeg-licenses.mjs (mismo chequeo que el CI de ffmpeg-build.yml).
// Los PE se construyen en memoria: no hace falta ningún binario real. Si en esta máquina está
// el zip BtbN descartado (%TEMP%/chamva-ffmpeg-release/binary/…), se comprueba además que la
// auditoría lo rechaza por FFTW y zvbi, como la auditoría manual de docs/seguridad-ffmpeg.md.
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  audit,
  auditDir,
  buildconfTokens,
  checkBuildconf,
  exportFamilies,
  importAllowed,
  isFFmpegBuildconf,
  loadAllow,
  manifestSnippet,
  parsePE,
  scanForbidden,
  splitBuildconf,
} from './audit-ffmpeg-licenses.mjs';

/** PE32+ x64 mínimo con una sección que contiene importaciones, exportaciones y cadenas extra. */
function makePE({ imports = [], delay = [], exports = [], dllName = 'x.dll', extra = [] } = {}) {
  const SEC_RVA = 0x1000;
  const SEC_RAW = 0x400;
  const data = [];
  let cur = 0;
  const put = (b) => {
    const at = cur;
    data.push(b);
    cur += b.length;
    return at;
  };
  const str = (s) => put(Buffer.from(s + '\0', 'latin1'));
  const align = () => {
    if (cur % 4) put(Buffer.alloc(4 - (cur % 4)));
  };
  // nombres
  const impNames = imports.map(str);
  const delayNames = delay.map(str);
  const expNames = exports.map(str);
  const dllNameOff = str(dllName);
  for (const e of extra) str(e);
  align();
  // tabla de importaciones (descriptor de 20 bytes; FirstThunk ≠ 0) + terminador
  const impDesc = Buffer.alloc((imports.length + 1) * 20);
  impNames.forEach((o, i) => {
    impDesc.writeUInt32LE(SEC_RVA + o, i * 20 + 12);
    impDesc.writeUInt32LE(SEC_RVA, i * 20 + 16);
  });
  const impOff = put(impDesc);
  const dlDesc = Buffer.alloc((delay.length + 1) * 32);
  delayNames.forEach((o, i) => {
    dlDesc.writeUInt32LE(1, i * 32);
    dlDesc.writeUInt32LE(SEC_RVA + o, i * 32 + 4);
  });
  const dlOff = put(dlDesc);
  const namePtrs = Buffer.alloc(exports.length * 4);
  expNames.forEach((o, i) => namePtrs.writeUInt32LE(SEC_RVA + o, i * 4));
  const namesOff = put(namePtrs);
  const expDir = Buffer.alloc(40);
  expDir.writeUInt32LE(SEC_RVA + dllNameOff, 12);
  expDir.writeUInt32LE(exports.length, 24);
  expDir.writeUInt32LE(SEC_RVA + namesOff, 32);
  const expOff = put(expDir);
  const body = Buffer.concat(data);

  const hdr = Buffer.alloc(SEC_RAW);
  hdr.writeUInt16LE(0x5a4d, 0);
  const pe = 0x80;
  hdr.writeUInt32LE(pe, 0x3c);
  hdr.writeUInt32LE(0x00004550, pe);
  hdr.writeUInt16LE(0x8664, pe + 4); // x64
  hdr.writeUInt16LE(1, pe + 6); // 1 sección
  hdr.writeUInt16LE(240, pe + 20); // tamaño de la cabecera opcional PE32+
  hdr.writeUInt16LE(0x2022, pe + 22); // DLL
  const opt = pe + 24;
  hdr.writeUInt16LE(0x20b, opt);
  hdr.writeUInt32LE(16, opt + 108); // NumberOfRvaAndSizes
  const dd = opt + 112;
  if (exports.length) hdr.writeUInt32LE(SEC_RVA + expOff, dd + 0 * 8);
  if (imports.length) hdr.writeUInt32LE(SEC_RVA + impOff, dd + 1 * 8);
  if (delay.length) hdr.writeUInt32LE(SEC_RVA + dlOff, dd + 13 * 8);
  const sec = opt + 240;
  hdr.write('.rdata', sec, 'latin1');
  hdr.writeUInt32LE(body.length, sec + 8);
  hdr.writeUInt32LE(SEC_RVA, sec + 12);
  hdr.writeUInt32LE(body.length, sec + 16);
  hdr.writeUInt32LE(SEC_RAW, sec + 20);
  return Buffer.concat([hdr, body]);
}

const GOOD_CONF =
  '--prefix=/ffbuild/prefix --pkg-config-flags=--static --pkg-config=pkg-config --cross-prefix=x86_64-w64-mingw32- --arch=x86_64 --target-os=mingw32 ' +
  '--disable-debug --enable-shared --disable-static --disable-gpl --disable-nonfree --disable-version3 --disable-network --disable-ffplay ' +
  '--disable-chromaprint --disable-libzvbi --disable-libaribb24 --disable-libopencore-amrnb --disable-libx264 --enable-mediafoundation ' +
  '--disable-w32threads --enable-pthreads --enable-iconv --enable-zlib --enable-lzma --enable-libdav1d --enable-libvpx --enable-libopus ' +
  '--enable-libzimg --enable-ffnvcodec --enable-cuda-llvm --enable-amf --enable-libvpl ' +
  "--extra-cflags='-DLIBTWOLAME_STATIC' --extra-version=chamva";

let allow;
let tmp;
beforeAll(async () => {
  allow = await loadAllow();
  tmp = await mkdtemp(path.join(tmpdir(), 'chamva-audit-test-'));
});
afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe('parsePE', () => {
  it('lee importaciones, diferidas y exportaciones', () => {
    const b = makePE({ imports: ['KERNEL32.dll', 'avutil-61.dll'], delay: ['mfplat.dll'], exports: ['av_a', 'av_b', 'vpx_codec_x'], dllName: 'avcodec-63.dll' });
    const pe = parsePE(b);
    expect(pe.machine).toBe(0x8664);
    expect(pe.is64).toBe(true);
    expect(pe.isDll).toBe(true);
    expect(pe.imports).toEqual(['KERNEL32.dll', 'avutil-61.dll']);
    expect(pe.delayImports).toEqual(['mfplat.dll']);
    expect(pe.dllName).toBe('avcodec-63.dll');
    expect(pe.exports).toEqual(['av_a', 'av_b', 'vpx_codec_x']);
  });
  it('rechaza lo que no es un PE', () => {
    expect(() => parsePE(Buffer.from('no soy un exe'.padEnd(80)))).toThrow(/MZ/);
    const b = makePE();
    b.writeUInt32LE(0x1234, 0x80);
    expect(() => parsePE(b)).toThrow(/firma PE/);
  });
  it('agrupa exportaciones por familia', () => {
    expect(exportFamilies(['av_x', 'av_y', 'fftw_codelet_n1', 'vpx_a', 'raro'])).toEqual({ av: 2, fftw: 1, vpx: 1, '(sin prefijo)': 1 });
  });
});

describe('línea de configuración', () => {
  it('separa la configuración aunque lleve bytes pegados delante', () => {
    const sp = splitBuildconf('@' + GOOD_CONF);
    expect(sp.before).toBe('@');
    expect(isFFmpegBuildconf(sp.conf)).toBe(true);
    expect(splitBuildconf('texto normal sin opciones')).toBeNull();
  });
  it('la de libvpx no se confunde con la de FFmpeg', () => {
    expect(isFFmpegBuildconf('--target=x86_64-win64-gcc --prefix=/opt/ffbuild --disable-shared --enable-static --enable-pic')).toBe(false);
  });
  it('tokens con comillas', () => {
    expect(buildconfTokens("--a=1 --extra-cflags='-O2 -g' --enable-x")).toEqual(['--a=1', "--extra-cflags='-O2 -g'", '--enable-x']);
  });
  it('la configuración buena pasa', () => {
    expect(checkBuildconf(GOOD_CONF, allow)).toEqual([]);
  });
  it('--enable-gpl, --enable-nonfree, --enable-version3, chromaprint y zvbi fallan', () => {
    for (const bad of ['--enable-gpl', '--enable-nonfree', '--enable-version3', '--enable-chromaprint', '--enable-libzvbi', '--enable-libx264', '--enable-libfdk-aac', '--enable-libaribb24', '--enable-libopencore-amrnb']) {
      const errs = checkBuildconf(GOOD_CONF + ' ' + bad, allow);
      expect(errs.some((e) => e.includes(bad) && e.includes('prohibido')), bad).toBe(true);
    }
  });
  it('un --enable-* fuera de la lista blanca falla', () => {
    expect(checkBuildconf(GOOD_CONF + ' --enable-libass', allow)).toEqual(['-buildconf lleva --enable-libass, que no está en la lista blanca']);
  });
  it('faltan obligatorios', () => {
    const errs = checkBuildconf(GOOD_CONF.replace(' --disable-network', '').replace(' --enable-mediafoundation', ''), allow);
    expect(errs).toContain('-buildconf no lleva --disable-network (obligatorio)');
    expect(errs).toContain('-buildconf no lleva --enable-mediafoundation (obligatorio)');
  });
});

describe('cadenas prohibidas', () => {
  const scan = (strings, file = 'avcodec-63.dll') => scanForbidden(Buffer.from(['\0', ...strings, ''].join('\0'), 'latin1'), allow, file);
  it.each([
    ['fftw', '(fftw-3.3.11 fftw_wisdom'],
    ['fftw', 'fftw_codelet_n1_64'],
    ['zvbi', 'zvbi 0.2.45'],
    ['zvbi', 'Setting default zvbi region to %i'],
    ['chromaprint', 'Failed to create chromaprint context.'],
    ['aribb24', 'Failed to initialize libaribb24!'],
    ['opencore-amr', 'Decoder_Interface_init error'],
    ['x264', 'x264 [error]: invalid'],
    ['x264', 'libx264'],
    ['x265', 'x265_encoder_open'],
    ['xvid', 'libxvid'],
    ['vidstab', 'vidstabdetect'],
    ['fdk-aac', 'libfdk_aac'],
    ['frei0r', 'frei0r_src'],
    ['postproc', 'postproc-59.dll'],
    ['gpl-config', 'algo --enable-gpl'],
  ])('detecta «%s» en %j', (id, s) => {
    expect(scan([s]).hits.map((h) => h.id)).toContain(id);
  });
  it('no confunde el FFmpeg nativo con bibliotecas GPL', () => {
    const native = ['x264 - core %d', 'x264_build', 'Assume this x264 version if no x264 version found in any SEI', 'xvid_ilace', 'xvidmmx', 'packed xvid', 'frmrtq_postproc=%i', 'Note: libopencore_amrnb supports dtx', 'h264_mf', 'libvpx-vp9', 'libopus', 'zscale'];
    expect(scan(native).hits).toEqual([]);
  });
  it('las excepciones se limitan a su archivo', () => {
    expect(scan(['libx264', 'libx265'], 'ffmpeg.exe').hits).toEqual([]);
    expect(scan(['libx264'], 'avcodec-63.dll').hits.map((h) => h.id)).toEqual(['x264']);
    expect(scan(['Note: libopencore_amrnb supports dtx'], 'avformat-63.dll').hits.map((h) => h.id)).toEqual(['opencore-amr']);
  });
  it('la línea de configuración se aparta (lleva los --disable-*) y se devuelve', () => {
    const r = scan(['@' + GOOD_CONF]);
    expect(r.hits).toEqual([]);
    expect(r.configs).toEqual([GOOD_CONF]);
  });
  it('lo que va pegado delante de la configuración sí se escanea', () => {
    expect(scan(['fftw_x' + GOOD_CONF]).hits.map((h) => h.id)).toEqual(['fftw']);
  });
  it('una configuración de otra biblioteca no oculta nada', () => {
    const r = scan(['--target=x86_64-win64-gcc --enable-static --enable-pic --with-fftw']);
    expect(r.configs).toEqual([]);
    expect(r.hits.map((h) => h.id)).toEqual(['fftw']);
  });
});

describe('importaciones', () => {
  it('Windows y las DLL propias sí; bibliotecas externas no', () => {
    const own = ['avutil-61.dll', 'swresample-7.dll'];
    for (const ok of ['KERNEL32.dll', 'api-ms-win-crt-heap-l1-1-0.dll', 'MFPlat.DLL', 'AVUTIL-61.dll']) expect(importAllowed(ok, allow, own), ok).toBe(true);
    for (const bad of ['libwinpthread-1.dll', 'libstdc++-6.dll', 'zlib1.dll', 'SDL2.dll', 'postproc-59.dll', 'libfftw3-3.dll', 'avutil-60.dll']) expect(importAllowed(bad, allow, own), bad).toBe(false);
  });
});

describe('auditDir / audit sobre un paquete sintético', () => {
  const sys = ['KERNEL32.dll', 'api-ms-win-crt-runtime-l1-1-0.dll'];
  async function mkPackage(name, { mutate } = {}) {
    const root = path.join(tmp, name, 'ffmpeg-n9.0.2-test-win64-chamva-lgpl-shared');
    const bin = path.join(root, 'bin');
    await mkdir(bin, { recursive: true });
    const files = {
      'ffmpeg.exe': makePE({ imports: [...sys, 'avcodec-63.dll'], extra: ['libx264', '@' + GOOD_CONF] }),
      'ffprobe.exe': makePE({ imports: [...sys, 'avformat-63.dll'], extra: [GOOD_CONF] }),
      'avcodec-63.dll': makePE({ imports: [...sys, 'avutil-61.dll', 'MFPlat.DLL'], exports: ['avcodec_open2', 'vpx_codec_version'], extra: [GOOD_CONF, 'x264 - core %d'] }),
      'avdevice-63.dll': makePE({ imports: sys, extra: [GOOD_CONF] }),
      'avfilter-12.dll': makePE({ imports: sys, extra: ['@' + GOOD_CONF, 'zscale'] }),
      'avformat-63.dll': makePE({ imports: sys, extra: [GOOD_CONF] }),
      'avutil-61.dll': makePE({ imports: sys, exports: ['av_malloc'], extra: [GOOD_CONF] }),
      'swresample-7.dll': makePE({ imports: sys, extra: [GOOD_CONF] }),
      'swscale-10.dll': makePE({ imports: sys, extra: [GOOD_CONF] }),
    };
    mutate?.(files);
    for (const [n, b] of Object.entries(files)) await writeFile(path.join(bin, n), b);
    await writeFile(path.join(root, 'LICENSE.txt'), 'GNU LESSER GENERAL PUBLIC LICENSE\nVersion 2.1, February 1999\n');
    for (const l of [...allow.libraries.map((l) => l.id), 'ffmpeg']) {
      await mkdir(path.join(root, 'licenses', l), { recursive: true });
      await writeFile(path.join(root, 'licenses', l, 'LICENSE'), 'x');
    }
    const sha = (b) => createHash('sha256').update(b).digest('hex');
    await writeFile(path.join(root, 'SHA256SUMS'), Object.entries(files).map(([n, b]) => `${sha(b)}  bin/${n}`).join('\n') + '\n');
    return root;
  }

  it('un paquete limpio pasa y da el fragmento del manifiesto', async () => {
    const root = await mkPackage('limpio');
    const r = await audit(path.dirname(root), allow);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.buildconf).toBe(GOOD_CONF);
    const avcodec = r.files.find((f) => f.file === 'avcodec-63.dll');
    expect(avcodec.imports).toContain('MFPlat.DLL');
    expect(avcodec.exportFamilies).toEqual({ avcodec: 1, vpx: 1 });
    const snip = manifestSnippet(r);
    expect(Object.keys(snip.files).sort()).toEqual(['avcodec-63.dll', 'avdevice-63.dll', 'avfilter-12.dll', 'avformat-63.dll', 'avutil-61.dll', 'ffmpeg.exe', 'ffprobe.exe', 'swresample-7.dll', 'swscale-10.dll']);
    expect(snip.verified).toBe(true);
  });

  it('FFTW dentro de avformat, una DLL de más y una importación externa hacen fallar', async () => {
    const root = await mkPackage('sucio', {
      mutate: (f) => {
        f['avformat-63.dll'] = makePE({ imports: [...sys, 'libwinpthread-1.dll'], exports: ['fftw_codelet_n1_64'], extra: [GOOD_CONF] });
        f['postproc-59.dll'] = makePE({ imports: sys, extra: [GOOD_CONF] });
      },
    });
    const r = await auditDir(root, allow);
    expect(r.ok).toBe(false);
    const all = r.errors.join('\n');
    expect(all).toMatch(/avformat-63\.dll: «fftw»/);
    expect(all).toMatch(/avformat-63\.dll importa libwinpthread-1\.dll/);
    expect(all).toMatch(/bin\/postproc-59\.dll no está en la lista blanca/);
  });

  it('dos configuraciones distintas (mezcla de builds) o una con --enable-gpl fallan', async () => {
    const root = await mkPackage('mezcla', {
      mutate: (f) => {
        f['swscale-10.dll'] = makePE({ imports: sys, extra: [GOOD_CONF.replace('--disable-gpl', '--enable-gpl')] });
      },
    });
    const r = await auditDir(root, allow);
    const all = r.errors.join('\n');
    expect(all).toMatch(/líneas de configuración distintas/);
    expect(all).toMatch(/--enable-gpl \(prohibido\)|«gpl-config»/);
  });

  it('SHA256SUMS que no cuadra y licencia que no es LGPL fallan', async () => {
    const root = await mkPackage('sumas');
    await writeFile(path.join(root, 'bin', 'ffprobe.exe'), makePE({ imports: sys, extra: [GOOD_CONF, 'cambiado'] }));
    await writeFile(path.join(root, 'LICENSE.txt'), 'GNU GENERAL PUBLIC LICENSE Version 2');
    const r = await auditDir(root, allow);
    const all = r.errors.join('\n');
    expect(all).toMatch(/SHA256SUMS: bin\/ffprobe\.exe no coincide/);
    expect(all).toMatch(/LICENSE\.txt no es la LGPL/);
  });
});

const BTBN_ZIP = path.join(process.env.TEMP ?? process.env.TMPDIR ?? tmpdir(), 'chamva-ffmpeg-release', 'binary', 'ffmpeg-n9.0.2-22-g46d8f462ee-win64-lgpl-shared-9.0.zip');
describe.skipIf(!existsSync(BTBN_ZIP))('build BtbN descartado (si está en esta máquina)', () => {
  it('se rechaza por FFTW, zvbi, chromaprint, aribb24 y opencore-amr', async () => {
    const r = await audit(BTBN_ZIP, allow);
    expect(r.ok).toBe(false);
    expect(r.zipSha256).toBe('feb93d768fe01ebb696d990c4f0c65add416c12e5e16fa73ad5643237e0e9e22');
    const ids = (f) => r.files.find((x) => x.file === f).forbidden.map((h) => h.id);
    expect(ids('avformat-63.dll')).toEqual(expect.arrayContaining(['fftw', 'chromaprint']));
    expect(ids('avcodec-63.dll')).toEqual(expect.arrayContaining(['zvbi', 'aribb24', 'opencore-amr']));
    expect(ids('ffmpeg.exe')).toEqual([]); // los nombres «libx264/libx265» de fftools son benignos
    const all = r.errors.join('\n');
    expect(all).toMatch(/--enable-chromaprint \(prohibido\)/);
    expect(all).toMatch(/--enable-libzvbi \(prohibido\)/);
  }, 60000);
});
