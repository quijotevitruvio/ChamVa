import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-ignore node builtins (el proyecto no incluye @types/node)
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
// @ts-ignore
import { createHash } from "node:crypto";
// @ts-ignore
import { join, relative, resolve } from "node:path";

// PWA: tras el build escribe `asset-manifest.json` (archivos + tamaño, para el
// precacheo de public/sw.js) y fija la versión de caché de sw.js según el contenido.
function chamvaPwa() {
  let outDir = "dist";
  return {
    name: "chamva-pwa",
    apply: "build" as const,
    configResolved(c: { build: { outDir: string }; root: string }) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const files: { url: string; size: number }[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else {
            const url = relative(outDir, full).split("\\").join("/");
            // los sonidos (public/sounds) NO se precachean: se guardan al usarse (ver sw.js)
            if (url === "sw.js" || url === "asset-manifest.json" || url.endsWith(".map") || url.startsWith("sounds/")) continue;
            files.push({ url, size: statSync(full).size });
          }
        }
      };
      try {
        walk(outDir);
        files.sort((a, b) => a.url.localeCompare(b.url));
        const version = createHash("sha256").update(JSON.stringify(files)).digest("hex").slice(0, 10);
        writeFileSync(join(outDir, "asset-manifest.json"), JSON.stringify({ version, files }));
        const swPath = join(outDir, "sw.js");
        writeFileSync(swPath, readFileSync(swPath, "utf8").replace("const VERSION = 'dev';", `const VERSION = '${version}';`));
      } catch (e) {
        console.warn("[chamva-pwa] no se pudo generar el manifiesto de caché:", e);
      }
    },
  };
}

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), chamvaPwa()],

  // Ruta base: '/' para Tauri; la web pública se compila con CHAMVA_BASE=/app/.
  // @ts-expect-error process is a nodejs global
  base: process.env.CHAMVA_BASE || '/',

  // El worker de IA (src/ai/ai.worker.ts) usa import() dinámico → formato ES.
  worker: {
    format: "es" as const,
  },

  // Separar librerías pesadas en chunks aparte (carga más eficiente).
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          konva: ['konva', 'react-konva'],
          pdf: ['jspdf'],
          gif: ['gifenc'],
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
