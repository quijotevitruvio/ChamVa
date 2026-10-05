#!/usr/bin/env node
// Genera un src-tauri/ffmpeg-manifest.json CANDIDATO a partir de la plantilla del repo, del
// fragmento que saca la auditoría (--manifest-snippet) y de BUILD-INFO.json del paquete.
// El candidato sale con "status": "pending-review": la app y scripts/fetch-ffmpeg.mjs lo siguen
// tratando como BLOQUEADO. Solo una persona, tras revisar la auditoría y publicar el Release de
// fuentes, cambia el estado a "ok" (docs/release-ffmpeg.md).
//
//   node scripts/ffmpeg-build/candidate-manifest.mjs --template src-tauri/ffmpeg-manifest.json \
//     --snippet manifest-snippet.json --build-info BUILD-INFO.json --release-tag ffmpeg-lgpl-… \
//     --repo quijotevitruvio/ChamVa --out ffmpeg-manifest.candidate.json
import { readFile, writeFile } from 'node:fs/promises';

const argv = process.argv.slice(2);
const opt = (n) => {
  const i = argv.indexOf(n);
  if (i < 0 || !argv[i + 1]) throw new Error(`falta ${n}`);
  return argv[i + 1];
};
const TRIPLE = 'x86_64-pc-windows-msvc';

export function candidate(template, snippet, info, tag, repo) {
  if (!/^ffmpeg-lgpl-[A-Za-z0-9._-]{1,80}$/.test(tag)) throw new Error(`etiqueta no válida: ${tag}`);
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) throw new Error(`repositorio no válido: ${repo}`);
  if (!/^[0-9a-f]{64}$/.test(snippet.sha256 ?? '')) throw new Error('el fragmento no trae el SHA-256 del zip');
  const files = snippet.files ?? {};
  if (!Object.keys(files).length || !Object.values(files).every((h) => /^[0-9a-f]{64}$/.test(h))) throw new Error('el fragmento no trae los hashes de cada archivo');
  const rel = `https://github.com/${repo}/releases/tag/${tag}`;
  const url = `https://github.com/${repo}/releases/download/${tag}/${info.name}.zip`;
  return {
    ...template,
    status: 'pending-review',
    blockedReason: `Candidato generado por ffmpeg-build.yml (${info.ciRun}). Sigue BLOQUEADO: revisar audit.json, publicar el Release ${tag} con --prerelease --latest=false y, solo entonces, poner "status": "ok" (docs/release-ffmpeg.md).`,
    version: info.ffmpegVersion,
    license: 'LGPL-2.1-or-later',
    release: rel,
    sourceRelease: rel,
    ffmpegSource: `https://github.com/FFmpeg/FFmpeg/tree/${info.ffmpegCommit}`,
    buildScripts: `https://github.com/${repo}/blob/${info.chamvaCommit}/.github/workflows/ffmpeg-build.yml (BtbN/FFmpeg-Builds ${info.btbnCommit} + overlay de ChamVa)`,
    targets: {
      [TRIPLE]: { url, mirrors: [], sha256: snippet.sha256, archive: 'zip', binDir: 'bin', verified: true, files },
    },
    revoked: template.revoked ?? [],
  };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('candidate-manifest.mjs')) {
  const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
  const c = candidate(await read(opt('--template')), await read(opt('--snippet')), await read(opt('--build-info')), opt('--release-tag'), opt('--repo'));
  await writeFile(opt('--out'), JSON.stringify(c, null, 2) + '\n');
  console.log(`Manifiesto candidato (pending-review, BLOQUEADO hasta revisarlo): ${opt('--out')}`);
}
