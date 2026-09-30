import { defineConfig } from 'vitest/config';

// Tests unitarios de la lógica pura (licencias, refinado de bordes, parseo de
// proyectos, i18n). Corren en Node: no necesitan navegador ni canvas.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/license.ts', 'src/ai/bgcore.ts', 'src/io/project.ts', 'src/i18n.ts'] },
  },
});
