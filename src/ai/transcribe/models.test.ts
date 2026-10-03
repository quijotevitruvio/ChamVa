import { describe, expect, it } from 'vitest';
import { chooseDevice, fileUrl, modelBytes, modelFiles, suggestModel, WHISPER_MODELS, type WhisperSize } from './models';

describe('manifiesto de modelos', () => {
  it('cada archivo tiene tamaño y huella, y la revisión es un commit', () => {
    for (const s of Object.keys(WHISPER_MODELS) as WhisperSize[]) {
      expect(WHISPER_MODELS[s].revision).toMatch(/^[0-9a-f]{40}$/);
      for (const d of ['wasm', 'webgpu'] as const)
        for (const f of modelFiles(s, d)) {
          expect(f.size).toBeGreaterThan(0);
          if (f.path.endsWith('.onnx')) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
          else expect(f.gitSha1).toMatch(/^[0-9a-f]{40}$/);
        }
    }
  });
  it('tamaños crecientes tiny < base < small', () => {
    expect(modelBytes('tiny', 'wasm')).toBeLessThan(modelBytes('base', 'wasm'));
    expect(modelBytes('base', 'wasm')).toBeLessThan(modelBytes('small', 'wasm'));
    expect(modelBytes('tiny', 'wasm')).toBe(43_622_127);
  });
  it('URL fijada al commit (la misma que pide Transformers.js)', () => {
    expect(fileUrl('tiny', 'onnx/encoder_model_quantized.onnx')).toBe(
      'https://huggingface.co/Xenova/whisper-tiny/resolve/5332fcc35e32a33b86612b9a57a89be7906102b1/onnx/encoder_model_quantized.onnx',
    );
  });
});

describe('dispositivo y modelo sugerido', () => {
  it('WebGPU si hay, WASM con aviso si no', () => {
    expect(chooseDevice({ webgpu: true })).toEqual({ device: 'webgpu' });
    const c = chooseDevice({ webgpu: false });
    expect(c.device).toBe('wasm');
    expect(c.warning).toMatch(/CPU/);
    expect(chooseDevice({ webgpu: true }, 'wasm').device).toBe('wasm');
    expect(chooseDevice({ webgpu: false }, 'webgpu').warning).toMatch(/no tiene WebGPU/);
  });
  it('sugiere según memoria y GPU', () => {
    expect(suggestModel({ webgpu: true, memoryGB: 8 }).suggested).toBe('small');
    expect(suggestModel({ webgpu: false, memoryGB: 8 }).suggested).toBe('base');
    expect(suggestModel({ webgpu: true, memoryGB: 4 }).suggested).toBe('tiny');
    const phone = suggestModel({ webgpu: false, memoryGB: 6, mobile: true });
    expect(phone.suggested).toBe('tiny');
    expect(phone.allowed).not.toContain('small');
    expect(suggestModel({ webgpu: false, memoryGB: 2 }).allowed).toEqual(['tiny']);
    expect(suggestModel({ webgpu: false }).allowed).toContain('small');
  });
});
