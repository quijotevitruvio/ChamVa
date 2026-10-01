/* Service worker de ChamVa (solo web instalable; en Tauri no se registra).
 *
 * Estrategias:
 *  - Instalación: descarga `asset-manifest.json` (lo genera vite.config.ts con la lista
 *    de archivos del build) y precachea el shell y los archivos pequeños; los grandes
 *    (wasm, motores) se guardan la primera vez que se usan (cache-first).
 *  - Archivos con hash (assets/…): cache-first (son inmutables).
 *  - Resto (index.html, manifest, iconos): stale-while-revalidate.
 *  - NO se cachean modelos de IA ni nada de otros orígenes (huggingface, etc.): eso lo
 *    gestionan el módulo de IA y IndexedDB.
 *  - La versión nueva espera a que se cierren las pestañas viejas (sin skipWaiting) para
 *    no romper una sesión abierta. Al activarse se borran las cachés viejas y las entradas con hash que ya no están
 *    en el manifiesto de la versión nueva.
 */
// vite.config.ts (plugin chamva-pwa) sustituye esta versión en cada build: así el
// navegador detecta un sw.js nuevo y rehace la caché.
const VERSION = 'dev';
const CACHE = 'chamva-' + VERSION;
const PRECACHE_MAX_BYTES = 4 * 1024 * 1024;

// Rutas relativas al propio sw.js (sirve con cualquier `base`).
const BASE = new URL('./', self.location.href);
const abs = (p) => new URL(p, BASE).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Shell mínimo: si falla algo, la instalación falla (mejor que un shell roto).
      await cache.addAll([abs('./'), abs('index.html'), abs('manifest.webmanifest')]);
      // Precarga de assets del build: tolerante a fallos (no bloquea la instalación).
      try {
        const res = await fetch(abs('asset-manifest.json'), { cache: 'no-store' });
        if (res.ok) {
          const m = await res.json();
          const files = (m.files || []).filter((f) => f.size <= PRECACHE_MAX_BYTES);
          await Promise.all(
            files.map((f) =>
              cache.add(abs(f.url)).catch(() => {
                /* se cacheará al usarse */
              }),
            ),
          );
          // Limpia entradas con hash de versiones anteriores.
          const keep = new Set((m.files || []).map((f) => abs(f.url)));
          const reqs = await cache.keys();
          await Promise.all(
            reqs
              .filter((r) => r.url.startsWith(abs('assets/')) && !keep.has(r.url))
              .map((r) => cache.delete(r)),
          );
        }
      } catch (_) {
        /* sin manifiesto: solo caché en uso */
      }
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith('chamva-') && n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

const isHashed = (url) => url.pathname.startsWith(BASE.pathname + 'assets/');

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // modelos de IA, iconify, etc.: no tocar
  if (url.pathname.endsWith('/sw.js')) return;
  if (req.headers.has('range')) return; // vídeo/audio con rangos: directo a red

  if (isHashed(url)) {
    event.respondWith(cacheFirst(req));
  } else if (req.mode === 'navigate') {
    event.respondWith(navigate(req));
  } else {
    event.respondWith(staleWhileRevalidate(req));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const net = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  if (hit) {
    net.catch(() => {});
    return hit;
  }
  return (await net) || Response.error();
}

// Navegación: siempre se sirve el shell cacheado (la app es de una sola página).
// El shell SOLO se actualiza al instalar una versión nueva del service worker, junto con
// sus archivos con hash: así nunca se mezcla un index.html nuevo con chunks viejos.
async function navigate(req) {
  const cache = await caches.open(CACHE);
  const shell = (await cache.match(abs('index.html'))) || (await cache.match(abs('./')));
  if (shell) return shell;
  return fetch(req).catch(() => Response.error());
}
