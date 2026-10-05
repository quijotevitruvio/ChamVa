// Modelo de «quitar fondo» de video (V9): MODNet, convertido a ONNX por Xenova para Transformers.js.
//
// Licencias VERIFICADAS el 2026-10-04 leyendo el origen (ver AUDITORIA.md §7):
//  - Código, modelos y demos de MODNet: Apache-2.0 (github.com/ZHKKKe/MODNet: LICENSE «Apache License Version 2.0» y
//    README §License: «The code, models, and demos in this repository … are released under the Apache License 2.0»).
//  - Pesos ONNX Xenova/modnet: «license: apache-2.0» en su ficha (README.md) y en la API de Hugging Face (cardData.license).
//
// FIJADO a un commit, con tamaño y huella de cada archivo (sha256 de LFS / sha1 de blob git): es la ÚNICA lista de lo que
// se puede descargar para esta función. Se descarga solo con consentimiento explícito que nombre el tamaño exacto
// (mismo patrón que Whisper, `src/ai/transcribe/store.ts`), y el worker de inferencia tiene la red cortada.
import { MODEL_CACHE, cachedSize, downloadFileAt, ConsentError, type StorageEnv } from '../../ai/transcribe/store';
import type { ModelFile } from '../../ai/transcribe/models';

export const MATTE_HOST = 'https://huggingface.co/';

export const MATTE_MODEL = {
  id: 'modnet' as const,
  label: 'MODNet (personas)',
  license: 'Apache-2.0',
  repo: 'Xenova/modnet',
  revision: 'fa2fa546052fba4c08921230a26cc69a333fca12',
  files: [
    { path: 'config.json', size: 83, gitSha1: '35db9b35faf0cd204d2d08629e52139f967da8e8' },
    { path: 'preprocessor_config.json', size: 365, gitSha1: 'dc007ec5904b57916c35d0314fb12da3a8250f1c' },
    { path: 'onnx/model.onnx', size: 25888640, sha256: '07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9' },
  ] as ModelFile[],
};

export { MODEL_CACHE };

export const matteFileUrl = (path: string) => `${MATTE_HOST}${MATTE_MODEL.repo}/resolve/${encodeURIComponent(MATTE_MODEL.revision)}/${path}`;
export const matteModelBytes = () => MATTE_MODEL.files.reduce((s, f) => s + f.size, 0);

export interface MatteModelStatus {
  installed: boolean;
  bytesTotal: number;
  bytesHave: number;
  bytesNeeded: number;
}

export async function matteModelStatus(env: StorageEnv): Promise<MatteModelStatus> {
  let have = 0;
  let ok = 0;
  for (const f of MATTE_MODEL.files) {
    const url = matteFileUrl(f.path);
    const c = await cachedSize(env, url);
    if (c === f.size) {
      have += f.size;
      ok++;
      continue;
    }
    const parts = await env.parts.get(url);
    have += Math.min(f.size, parts.reduce((s, b) => s + b.size, 0));
  }
  const total = matteModelBytes();
  return { installed: ok === MATTE_MODEL.files.length, bytesTotal: total, bytesHave: have, bytesNeeded: total - have };
}

export interface MatteDownloadPlan extends MatteModelStatus {
  fits: boolean;
  free?: number;
  consent: { model: 'modnet'; bytes: number };
}

/** Lo que habría que descargar (para el diálogo de consentimiento con el tamaño exacto). */
export async function matteDownloadPlan(env: StorageEnv): Promise<MatteDownloadPlan> {
  const st = await matteModelStatus(env);
  let free: number | undefined;
  try {
    const e = (await env.estimate?.()) ?? {};
    free = e.quota !== undefined && e.usage !== undefined ? e.quota - e.usage : undefined;
  } catch {
    /* sin estimación */
  }
  const fits = free === undefined ? true : free >= st.bytesNeeded * 2;
  return { ...st, fits, free, consent: { model: 'modnet', bytes: st.bytesNeeded } };
}

/** Descarga lo que falte. Exige el consentimiento del plan (mismos bytes o más); sin él, `ConsentError`. */
export async function downloadMatteModel(
  env: StorageEnv,
  o: { consent: { model: 'modnet'; bytes: number; accepted: true } | null | undefined; onProgress?: (ratio: number) => void; signal?: AbortSignal },
): Promise<MatteModelStatus> {
  const st = await matteModelStatus(env);
  if (st.installed) return st;
  const c = o.consent;
  if (!c || c.accepted !== true || c.model !== 'modnet' || c.bytes < st.bytesNeeded) throw new ConsentError();
  let base = 0;
  for (const f of MATTE_MODEL.files) {
    const url = matteFileUrl(f.path);
    if ((await cachedSize(env, url)) === f.size) {
      base += f.size;
      continue;
    }
    await downloadFileAt(env, url, f, (h) => o.onProgress?.((base + h) / st.bytesTotal), o.signal);
    base += f.size;
  }
  o.onProgress?.(1);
  return matteModelStatus(env);
}

export async function deleteMatteModel(env: StorageEnv): Promise<void> {
  for (const f of MATTE_MODEL.files) {
    const url = matteFileUrl(f.path);
    await env.cache.delete(url);
    await env.parts.clear(url);
  }
}
