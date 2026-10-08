import { defineConfig } from 'vitest/config';

// Tests unitarios de la lógica pura (licencias, refinado de bordes, parseo de
// proyectos, i18n). Corren en Node: no necesitan navegador ni canvas.
export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20000, // bajo carga (suite completa en paralelo) las pruebas con archivos temporales pasaban de 5 s
    // scripts/*.test.mjs: auditoría de licencias del FFmpeg propio (la misma que corre el CI)
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    coverage: { provider: 'v8', include: ['src/license.ts', 'src/ai/bgcore.ts', 'src/io/project.ts', 'src/i18n.ts'] },
  },
});
