// Banco de V6 (página de desarrollo: /dev/fx-bench.html): transiciones, efectos, croma, fusión, capas de ajuste y
// fotogramas clave con el motor REAL (`composeFrame`, `renderProject`, `PreviewEngine`), comprobados por píxeles.
// Todo cuelga de window.__fx para poder automatizarlo desde el navegador.
import * as VM from '../model';
import { composeFrame, type ComposeSources } from '../engine/compose';
import { renderProject } from '../engine/render';
import { BlobPartsSink } from '../engine/sink';
import { PreviewEngine } from '../../ui/video/previewEngine';
import { MediaCache } from '../../ui/video/mediaCache';
import { addAdjustClip, addFx, setBlend, setJunctionTransition, setKeyAt, setTransition } from '../fx/clipOps';
import { FX_DEFS, LOOKS, makeFx } from '../fx/effects';
import { makeTransition, TRANSITIONS } from '../fx/transitions';
import { makeSynthClip, PALETTE } from './synth';

const W = 1280;
const H = 720;
const FPS = 30;
const out = document.getElementById('out')!;
const log = (s: string) => {
  out.textContent += s + '\n';
};

type Rgb = [number, number, number];
const solid = (c: string, w = W, h = H) => {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  g.fillStyle = c;
  g.fillRect(0, 0, w, h);
  return cv;
};
const halves = (l: string, r: string) => {
  const cv = solid(l);
  const g = cv.getContext('2d')!;
  g.fillStyle = r;
  g.fillRect(W / 2, 0, W / 2, H);
  return cv;
};
/** Lienzo con degradado y formas (para medir el tiempo de cada efecto sobre algo que no sea plano). */
const textured = () => {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, W, H);
  gr.addColorStop(0, '#2a6fdb');
  gr.addColorStop(0.5, '#e8c547');
  gr.addColorStop(1, '#d1495b');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff';
  for (let i = 0; i < 12; i++) g.fillRect(60 + i * 95, 80 + (i % 4) * 140, 70, 70);
  g.fillStyle = '#111';
  g.beginPath();
  g.arc(W * 0.5, H * 0.5, 120, 0, Math.PI * 2);
  g.fill();
  return cv;
};

const target = () => {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  return { cv, g: cv.getContext('2d', { alpha: false, willReadFrequently: true })! };
};

/** Fuentes de imagen por id de medio (lienzos) y de video (lienzos como fotogramas). */
function sourcesOf(images: Record<string, HTMLCanvasElement>): ComposeSources {
  return {
    video: (c) => (c.mediaId && images[c.mediaId] ? { image: images[c.mediaId], width: W, height: H, rotation: 0 } : null),
    image: (c) => (c.mediaId ? ((images[c.mediaId] as unknown as HTMLImageElement) ?? null) : null),
  };
}

function track(p: VM.VideoProject, id: string, index?: number) {
  return VM.addTrack(p, 'video', { id, ...(index !== undefined ? { index } : {}) });
}
function stillClip(id: string, mediaId: string, start: number, dur: number, extra: Partial<VM.Clip> = {}) {
  return VM.makeClip('image', { id, mediaId, start, outP: dur, size: 1, ...extra });
}
function addImg(p: VM.VideoProject, id: string) {
  return VM.addMedia(p, { id, kind: 'image', name: id, duration: 0 });
}

function render(p: VM.VideoProject, images: Record<string, HTMLCanvasElement>, t: number) {
  const { g } = rend;
  composeFrame(g, p, t, VM.projectDuration(p), W, H, 'contain', sourcesOf(images));
  return g.getImageData(0, 0, W, H);
}
const rend = target();

const px = (d: ImageData, x: number, y: number): Rgb => {
  const i = (Math.round(y) * W + Math.round(x)) * 4;
  return [d.data[i], d.data[i + 1], d.data[i + 2]];
};
const near = (a: Rgb, b: Rgb, tol = 6) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
const meanDiff = (d: ImageData, c: Rgb) => {
  let s = 0;
  for (let i = 0; i < d.data.length; i += 4) s += (Math.abs(d.data[i] - c[0]) + Math.abs(d.data[i + 1] - c[1]) + Math.abs(d.data[i + 2] - c[2])) / 3;
  return s / (d.data.length / 4);
};
const share = (d: ImageData, pred: (r: number, g: number, b: number) => boolean) => {
  let n = 0;
  for (let i = 0; i < d.data.length; i += 4) if (pred(d.data[i], d.data[i + 1], d.data[i + 2])) n++;
  return n / (d.data.length / 4);
};
const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];
const isBlue = (r: number, _g: number, b: number) => b > 200 && r < 60;
const isRed = (r: number, _g: number, b: number) => r > 200 && b < 60;

interface Probe {
  name: string;
  x: number;
  y: number;
  want: 'A' | 'B' | Rgb;
}

/** Puntos de comprobación a mitad (p = 0,5) de cada transición; `A` = lo saliente (rojo), `B` = lo entrante (azul). */
const MID: Record<string, Probe[]> = {
  slideLeft: [{ name: 'izq=A', x: 0.25 * W, y: 0.5 * H, want: 'A' }, { name: 'der=B', x: 0.75 * W, y: 0.5 * H, want: 'B' }],
  slideRight: [{ name: 'izq=B', x: 0.25 * W, y: 0.5 * H, want: 'B' }, { name: 'der=A', x: 0.75 * W, y: 0.5 * H, want: 'A' }],
  slideUp: [{ name: 'arr=A', x: 0.5 * W, y: 0.25 * H, want: 'A' }, { name: 'abj=B', x: 0.5 * W, y: 0.75 * H, want: 'B' }],
  slideDown: [{ name: 'arr=B', x: 0.5 * W, y: 0.25 * H, want: 'B' }, { name: 'abj=A', x: 0.5 * W, y: 0.75 * H, want: 'A' }],
  pushLeft: [{ name: 'izq=A', x: 0.25 * W, y: 0.5 * H, want: 'A' }, { name: 'der=B', x: 0.75 * W, y: 0.5 * H, want: 'B' }],
  pushRight: [{ name: 'izq=B', x: 0.25 * W, y: 0.5 * H, want: 'B' }, { name: 'der=A', x: 0.75 * W, y: 0.5 * H, want: 'A' }],
  pushUp: [{ name: 'arr=A', x: 0.5 * W, y: 0.25 * H, want: 'A' }, { name: 'abj=B', x: 0.5 * W, y: 0.75 * H, want: 'B' }],
  pushDown: [{ name: 'arr=B', x: 0.5 * W, y: 0.25 * H, want: 'B' }, { name: 'abj=A', x: 0.5 * W, y: 0.75 * H, want: 'A' }],
  cover: [{ name: 'izq=A', x: 0.2 * W, y: 0.5 * H, want: 'A' }, { name: 'der=B', x: 0.75 * W, y: 0.5 * H, want: 'B' }],
  reveal: [{ name: 'izq=A', x: 0.25 * W, y: 0.5 * H, want: 'A' }, { name: 'der=B (descubierto)', x: 0.75 * W, y: 0.5 * H, want: 'B' }],
  wipe: [{ name: 'izq=B', x: 0.25 * W, y: 0.5 * H, want: 'B' }, { name: 'der=A', x: 0.75 * W, y: 0.5 * H, want: 'A' }],
  diagonal: [{ name: 'esq. sup. izq=B', x: 0.2 * W, y: 0.2 * H, want: 'B' }, { name: 'esq. inf. der=A', x: 0.8 * W, y: 0.8 * H, want: 'A' }],
  clock: [{ name: 'der=B', x: 0.75 * W, y: 0.5 * H, want: 'B' }, { name: 'izq=A', x: 0.25 * W, y: 0.5 * H, want: 'A' }],
  fadeBlack: [{ name: 'centro negro', x: 0.5 * W, y: 0.5 * H, want: [0, 0, 0] }],
  fadeWhite: [{ name: 'centro blanco', x: 0.5 * W, y: 0.5 * H, want: [255, 255, 255] }],
  flash: [{ name: 'centro blanco', x: 0.5 * W, y: 0.5 * H, want: [255, 255, 255] }],
  fade: [{ name: 'mezcla 50 %', x: 0.5 * W, y: 0.5 * H, want: [128, 0, 128] }],
  flip: [{ name: 'borde negro', x: 0.1 * W, y: 0.5 * H, want: [0, 0, 0] }],
};

const win = window as unknown as Record<string, unknown>;

const fx = {
  /** Las 27 transiciones: p=0 → A, p≈1 → B, y sondas a mitad; más el borde exacto de la cortina circular. */
  transitions() {
    let p = track(VM.createProject(), 'V');
    p = addImg(addImg(p, 'A'), 'B');
    p = VM.addClip(p, 'V', stillClip('a', 'A', 0, 3));
    p = VM.addClip(p, 'V', stillClip('b', 'B', 3, 3));
    const images = { A: solid('#f00'), B: solid('#00f') };
    const rows: Record<string, unknown>[] = [];
    for (const tr of TRANSITIONS) {
      const q = setJunctionTransition(p, 'b', makeTransition(tr.id, { dur: 1, ease: 'linear' }));
      const d0 = render(q, images, 2.5); // p = 0
      const dMid = render(q, images, 3.0); // p = 0,5
      const d1 = render(q, images, 3.49); // p ≈ 0,98
      const probes = (MID[tr.id] ?? []).map((pr) => {
        const got = px(dMid, pr.x, pr.y);
        const ok = near(got, pr.want === 'A' ? RED : pr.want === 'B' ? BLUE : pr.want, 8);
        return { probe: pr.name, got: got.join(','), ok };
      });
      rows.push({
        id: tr.id,
        startIsA: +meanDiff(d0, RED).toFixed(3),
        endIsB: +meanDiff(d1, BLUE).toFixed(3),
        midBluePct: +(100 * share(dMid, isBlue)).toFixed(1),
        midRedPct: +(100 * share(dMid, isRed)).toFixed(1),
        probes,
        pass: meanDiff(d0, RED) < 0.5 && meanDiff(d1, BLUE) < 12 && probes.every((x) => x.ok),
      });
    }
    // dissolve: ~50 % de los píxeles de cada una a mitad
    // (addTrack inserta al principio: la última pista creada queda ARRIBA)
    // borde exacto de la cortina circular (p = 0,5 → radio = ¼ de la diagonal)
    const qc = setJunctionTransition(p, 'b', makeTransition('circle', { dur: 1, ease: 'linear' }));
    const dc = render(qc, images, 3.0);
    const R = 0.25 * Math.hypot(W, H);
    const edge = (dx: number, dy: number) => {
      const len = Math.hypot(dx, dy);
      const ux = dx / len;
      const uy = dy / len;
      const inside = px(dc, W / 2 + ux * (R - 4), H / 2 + uy * (R - 4));
      const outside = px(dc, W / 2 + ux * (R + 4), H / 2 + uy * (R + 4));
      return { inside: inside.join(','), outside: outside.join(','), ok: near(inside, BLUE, 4) && near(outside, RED, 4) };
    };
    const circle = { radiusPx: +R.toFixed(1), center: px(dc, W / 2, H / 2).join(','), right: edge(1, 0), up: edge(0.4, -1), diag: edge(1, -0.5625) };
    // medidas del radio real: buscar a lo largo del eje horizontal el primer píxel rojo
    let rReal = 0;
    for (let x = 0; x < W / 2; x++) if (isRed(...px(dc, W / 2 + x, H / 2))) { rReal = x; break; }
    return { count: rows.length, allPass: rows.every((r) => r.pass) && circle.right.ok && circle.up.ok && circle.diag.ok, circle: { ...circle, radiusMeasured: rReal }, rows };
  },

  /** Croma, fusión, capas de ajuste, máscaras, borde, sombra y fotogramas clave por píxeles. */
  effects() {
    const res: Record<string, unknown> = {};
    // --- croma: izquierda verde (se quita → se ve lo de debajo, azul), derecha roja (se queda) ---
    {
      let p = track(track(VM.createProject(), 'BOT'), 'TOP');
      p = addImg(addImg(p, 'g'), 'bg');
      p = VM.addClip(p, 'BOT', stillClip('bot', 'bg', 0, 4));
      p = VM.addClip(p, 'TOP', stillClip('top', 'g', 0, 4));
      p = addFx(p, 'top', makeFx('chroma', { id: 'k', p: { color: '#00ff00', tol: 0.35, soft: 0.15, spill: 0 } }));
      const d = render(p, { g: halves('#00ff00', '#ff0000'), bg: solid('#0000ff') }, 1);
      res.chroma = { left: px(d, 0.25 * W, 0.5 * H).join(','), right: px(d, 0.75 * W, 0.5 * H).join(','), greenTransparent: near(px(d, 0.25 * W, 0.5 * H), BLUE, 3), redKept: near(px(d, 0.75 * W, 0.5 * H), RED, 3) };
    }
    // --- fusión ---
    {
      const mk = (mode: VM.BlendMode) => {
        let p = track(track(VM.createProject(), 'BOT'), 'TOP');
        p = addImg(addImg(p, 't'), 'b');
        p = VM.addClip(p, 'BOT', stillClip('bot', 'b', 0, 4));
        p = VM.addClip(p, 'TOP', stillClip('top', 't', 0, 4));
        return setBlend(p, 'top', mode);
      };
      const imgs = { t: solid('rgb(200,100,50)'), b: solid('rgb(128,128,128)') };
      const get = (m: VM.BlendMode) => px(render(mk(m), imgs, 1), 100, 100);
      const mul = get('multiply');
      const scr = get('screen');
      const add = get('add');
      const dif = get('difference');
      res.blend = {
        multiply: mul.join(','),
        multiplyOk: near(mul, [100, 50, 25], 2),
        screen: scr.join(','),
        screenOk: near(scr, [255 - ((255 - 200) * (255 - 128)) / 255, 255 - ((255 - 100) * 127) / 255, 255 - ((255 - 50) * 127) / 255].map(Math.round) as Rgb, 2),
        add: add.join(','),
        addOk: near(add, [255, 228, 178], 2),
        difference: dif.join(','),
        differenceOk: near(dif, [72, 28, 78], 2),
      };
    }
    // --- capa de ajuste: B/N sobre colores ---
    {
      let p = track(track(VM.createProject(), 'V'), 'ADJ');
      p = addImg(p, 'c');
      p = VM.addClip(p, 'V', stillClip('c1', 'c', 0, 4));
      p = addAdjustClip(p, 'ADJ', 1, 2, { id: 'adj', fx: [makeFx('look', { id: 'l', p: { preset: 'bw' } })] });
      const imgs = { c: halves('#e03020', '#2040e0') };
      const before = px(render(p, imgs, 0.5), 0.25 * W, 0.5 * H);
      const during = px(render(p, imgs, 1.5), 0.25 * W, 0.5 * H);
      const during2 = px(render(p, imgs, 1.5), 0.75 * W, 0.5 * H);
      const after = px(render(p, imgs, 3.5), 0.25 * W, 0.5 * H);
      const gray = (c: Rgb) => Math.abs(c[0] - c[1]) < 4 && Math.abs(c[1] - c[2]) < 4;
      res.adjust = { before: before.join(','), during: during.join(','), during2: during2.join(','), after: after.join(','), ok: !gray(before) && gray(during) && gray(during2) && !gray(after) };
    }
    // --- máscaras, borde y sombra ---
    {
      const mk = (type: string, params: Record<string, number | string>) => {
        let p = track(VM.createProject(), 'V');
        p = addImg(p, 'x');
        p = VM.addClip(p, 'V', stillClip('x1', 'x', 0, 4));
        return addFx(p, 'x1', makeFx(type, { id: 'f', p: params }));
      };
      const imgs = { x: solid('#20c040') };
      const G: Rgb = [32, 192, 64];
      const K: Rgb = [0, 0, 0];
      const circ = render(mk('mask', { shape: 'circle', size: 0.9 }), imgs, 1);
      const heart = render(mk('mask', { shape: 'heart', size: 0.9 }), imgs, 1);
      const star = render(mk('mask', { shape: 'star', size: 0.9 }), imgs, 1);
      const rounded = render(mk('mask', { shape: 'rounded', size: 0.8, round: 0.3 }), imgs, 1);
      const rect = render(mk('mask', { shape: 'rect', size: 0.5 }), imgs, 1);
      const bord = render(mk('border', { w: 20, color: '#ffffff' }), imgs, 1);
      res.mask = {
        circle: { center: near(px(circ, W / 2, H / 2), G, 3), corner: near(px(circ, 5, 5), K, 3), edgeIn: near(px(circ, W / 2 + 0.45 * H - 3, H / 2), G, 3), edgeOut: near(px(circ, W / 2 + 0.45 * H + 3, H / 2), K, 3) },
        heart: { center: near(px(heart, W / 2, H / 2), G, 3), corner: near(px(heart, 5, 5), K, 3), tipBottom: near(px(heart, W / 2, H / 2 + 0.33 * H), G, 3), notchTop: near(px(heart, W / 2, H / 2 - 0.4 * H), K, 3) },
        star: { center: near(px(star, W / 2, H / 2), G, 3), corner: near(px(star, 5, 5), K, 3), topPoint: near(px(star, W / 2, H / 2 - 0.4 * H), G, 3), betweenPoints: near(px(star, W / 2 + 0.2 * H, H / 2 - 0.3 * H), K, 3) },
        rounded: { center: near(px(rounded, W / 2, H / 2), G, 3), cornerOfBox: near(px(rounded, W / 2 - 0.4 * W + 3, H / 2 - 0.4 * H + 3), K, 3), midEdge: near(px(rounded, W / 2 - 0.4 * W + 4, H / 2), G, 3) },
        rect: { inside: near(px(rect, W / 2 + 0.24 * W, H / 2), G, 3), outside: near(px(rect, W / 2 + 0.26 * W, H / 2), K, 3) },
        border: { edge: near(px(bord, 5, H / 2), [255, 255, 255], 3), inner: near(px(bord, 40 * (H / 720) , H / 2), G, 3), center: near(px(bord, W / 2, H / 2), G, 3) },
      };
      // sombra: un cuadrado verde pequeño con sombra desplazada abajo a la derecha
      let p = track(VM.createProject(), 'V');
      p = addImg(p, 's');
      p = VM.addClip(p, 'V', stillClip('s1', 's', 0, 4, { size: 0.2 }));
      p = addFx(p, 's1', makeFx('shadow', { id: 'sh', p: { blur: 6, dx: 30, dy: 30, color: '#ff0000' } }));
      const ds = render(p, { s: solid('#ffffff', 100, 100) }, 1);
      // el cuadrado mide 0,2·1280 = 256 px, centrado; su esquina inf. der. está en (768, 488); la sombra se ve más allá
      const lum = (c: Rgb) => (c[0] + c[1] + c[2]) / 3;
      res.shadow = { inside: px(ds, W / 2, H / 2).join(','), shadowZone: px(ds, 768 + 12, 488 + 12).join(','), far: px(ds, 900, 600).join(','), ok: lum(px(ds, W / 2, H / 2)) > 250 && lum(px(ds, 780, 500)) < 255 && px(ds, 780, 500)[0] > 100 && px(ds, 780, 500)[1] < 40 && px(ds, 900, 600)[0] === 0 };
    }
    // --- fotogramas clave: escala 1 → 2 en 4 s; a los 2 s vale 1,5 (anchura medida en píxeles) ---
    {
      let p = track(VM.createProject(), 'V');
      p = addImg(p, 'r');
      p = VM.addClip(p, 'V', stillClip('r1', 'r', 0, 4, { size: 0.25 }));
      p = setKeyAt(p, 'r1', 'scale', 0, 1, { e: 'linear' });
      p = setKeyAt(p, 'r1', 'scale', 4, 2);
      const imgs = { r: solid('#ff0000', 200, 200) };
      const widthAt = (t: number) => {
        const d = render(p, imgs, t);
        let n = 0;
        for (let x = 0; x < W; x++) if (isRed(...px(d, x, H / 2))) n++;
        return n;
      };
      const w0 = widthAt(0);
      const w2 = widthAt(2);
      const w3 = widthAt(3);
      res.keyScale = { base: w0, mid: w2, ratioMid: +(w2 / w0).toFixed(4), t3: w3, ratioT3: +(w3 / w0).toFixed(4), ok: w0 === 320 && Math.abs(w2 - 480) <= 1 && Math.abs(w3 - 560) <= 1 };
    }
    // --- entrada de un clip sobre lo de debajo (transición sin vecino) ---
    {
      let p = track(track(VM.createProject(), 'BOT'), 'TOP');
      p = addImg(addImg(p, 't'), 'b');
      p = VM.addClip(p, 'BOT', stillClip('bot', 'b', 0, 6));
      p = VM.addClip(p, 'TOP', stillClip('top', 't', 1, 3));
      p = setTransition(p, 'top', 'in', makeTransition('wipe', { dur: 2, ease: 'linear' }));
      p = setTransition(p, 'top', 'out', makeTransition('fade', { dur: 1, ease: 'linear' }));
      const imgs = { t: solid('#ff0000'), b: solid('#0000ff') };
      const at = (t: number, x: number) => px(render(p, imgs, t), x, H / 2);
      res.entryExit = {
        before: at(0.5, W / 2).join(','),
        entryHalf: [at(2, 0.25 * W).join(','), at(2, 0.75 * W).join(',')],
        full: at(2.9, W / 2).join(','),
        exitHalf: at(3.5, W / 2).join(','),
        after: at(4.5, W / 2).join(','),
        ok: near(at(0.5, W / 2), BLUE, 2) && near(at(2, 0.25 * W), RED, 3) && near(at(2, 0.75 * W), BLUE, 3) && near(at(2.9, W / 2), RED, 3) && near(at(3.5, W / 2), [128, 0, 128], 3) && near(at(4.5, W / 2), BLUE, 2),
      };
    }
    return res;
  },

  /** Tiempo por efecto (ms, 1280×720) sobre una imagen con textura: cada tipo y cada preajuste de color. */
  fxTimes(reps = 3) {
    const t = textured();
    const rows: Record<string, unknown>[] = [];
    const run = (type: string, params: Record<string, number | string>) => {
      let p = track(VM.createProject(), 'V');
      p = addImg(p, 'x');
      p = VM.addClip(p, 'V', stillClip('x1', 'x', 0, 4));
      p = addFx(p, 'x1', makeFx(type, { id: 'f', p: params }));
      const base = render(VM.addClip(addImg(track(VM.createProject(), 'V'), 'x'), 'V', stillClip('x1', 'x', 0, 4)), { x: t }, 1);
      const before = new Uint8ClampedArray(base.data);
      render(p, { x: t }, 1); // calentamiento
      const t0 = performance.now();
      let d = base;
      for (let i = 0; i < reps; i++) d = render(p, { x: t }, 1 + i * 0.05);
      const ms = (performance.now() - t0) / reps;
      let diff = 0;
      for (let i = 0; i < d.data.length; i += 4) diff += Math.abs(d.data[i] - before[i]) + Math.abs(d.data[i + 1] - before[i + 1]) + Math.abs(d.data[i + 2] - before[i + 2]);
      return { ms: +ms.toFixed(1), changed: +(diff / (d.data.length / 4) / 3).toFixed(2) };
    };
    for (const def of FX_DEFS) {
      if (def.type === 'look') continue;
      rows.push({ type: def.type, ...run(def.type, {}) });
    }
    for (const l of LOOKS) rows.push({ type: 'look:' + l.id, ...run('look', { preset: l.id }) });
    const heavy = rows.filter((r) => (r.ms as number) > 25).map((r) => `${r.type} ${r.ms} ms`);
    const unchanged = rows.filter((r) => r.changed === 0).map((r) => r.type);
    return { count: rows.length, heavy, unchanged, rows };
  },

  /** Rendimiento de `composeFrame` a 720p/540p/360p con 3 pistas a pantalla completa y 2 efectos. */
  perf(frames = 90) {
    const sizes = [[1280, 720], [960, 540], [640, 360]];
    const result: Record<string, unknown> = {};
    for (const [w, h] of sizes) {
      const imgs = { a: solid('#c04030', w, h), b: solid('#3050c0', w, h), c: solid('#40c050', w, h) };
      const mk = (withFx: boolean, withTrans: boolean) => {
        let p = track(track(track(VM.createProject(), 'T3'), 'T2'), 'T1');
        p = addImg(addImg(addImg(p, 'a'), 'b'), 'c');
        p = VM.addClip(p, 'T1', stillClip('c1', 'a', 0, 6));
        p = VM.addClip(p, 'T2', stillClip('c2', 'b', 0, 6, { transform: { x: 0.5, y: 0.5, scale: 0.8, rotation: 0, opacity: 0.8 } }));
        p = VM.addClip(p, 'T3', stillClip('c3', 'c', 0, 3, { size: 0.5, transform: { x: 0.7, y: 0.3, scale: 1, rotation: 5, opacity: 1 } }));
        if (withFx) {
          p = addFx(p, 'c2', makeFx('look', { id: 'l', p: { preset: 'cine' } }));
          p = addFx(p, 'c2', makeFx('vignette', { id: 'v' }));
        }
        if (withTrans) {
          p = VM.addClip(p, 'T3', stillClip('c4', 'c', 3, 3, { size: 0.5 }));
          p = setJunctionTransition(p, 'c4', makeTransition('circle', { dur: 1 }));
        }
        return p;
      };
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const g = cv.getContext('2d', { alpha: false, willReadFrequently: true })!;
      const bench = (p: VM.VideoProject, t0: number) => {
        const times: number[] = [];
        const dur = VM.projectDuration(p);
        for (let i = 0; i < frames + 10; i++) {
          const t = t0 + (i / FPS) * 0.8;
          const s = performance.now();
          composeFrame(g, p, t, dur, w, h, 'contain', {
            video: () => null,
            image: (c) => (c.mediaId ? (imgs[c.mediaId as 'a'] as unknown as HTMLImageElement) : null),
          });
          g.getImageData(0, 0, 1, 1); // fuerza la ejecución pendiente
          if (i >= 10) times.push(performance.now() - s);
        }
        times.sort((x, y) => x - y);
        return { mean: +(times.reduce((x, y) => x + y, 0) / times.length).toFixed(2), p95: +times[Math.floor(times.length * 0.95)].toFixed(2), max: +times[times.length - 1].toFixed(2) };
      };
      result[`${w}x${h}`] = { noFx: bench(mk(false, false), 0.2), twoFx: bench(mk(true, false), 0.2), twoFxPlusTransition: bench(mk(true, true), 2.6) };
    }
    return result;
  },
};

// ---------- exportación real y vista previa vs exportación ----------

interface Synth {
  m1: Awaited<ReturnType<typeof makeSynthClip>>;
  m2: Awaited<ReturnType<typeof makeSynthClip>>;
}
let synth: Synth | null = null;
async function getSynth(): Promise<Synth> {
  if (synth) return synth;
  const m1 = await makeSynthClip({ container: 'mp4', width: 640, height: 360, fps: 24, seconds: 8, toneAmp: 0.4 });
  const m2 = await makeSynthClip({ container: 'mp4', width: 640, height: 360, fps: 24, seconds: 8, toneAmp: 0.4, colorOffset: 2 });
  synth = { m1, m2 };
  return synth;
}

/** V: A (m1, 0–4 desde 0 s del archivo) + B (m2, 4–8 desde 1 s) con transición `type` en el corte; sobre el cuadro, una capa con efecto y fotogramas. */
async function exportProject(type: string | null, withFx: boolean) {
  const s = await getSynth();
  let p = track(VM.createProject(), 'V');
  p = VM.addMedia(p, { id: 'm1', kind: 'video', name: 'm1', duration: 8, blob: s.m1.blob });
  p = VM.addMedia(p, { id: 'm2', kind: 'video', name: 'm2', duration: 8, blob: s.m2.blob });
  p = VM.addClip(p, 'V', VM.makeClip('video', { id: 'a', mediaId: 'm1', start: 0, inP: 0, outP: 4 }));
  p = VM.addClip(p, 'V', VM.makeClip('video', { id: 'b', mediaId: 'm2', start: 4, inP: 1, outP: 5 }));
  if (type) p = setJunctionTransition(p, 'b', makeTransition(type, { dur: 1, ease: 'linear' }));
  if (withFx) {
    p = addFx(p, 'a', makeFx('look', { id: 'L', p: { preset: 'bw' } }));
    p = addFx(p, 'b', makeFx('vignette', { id: 'V', p: { v: 0.6 } }));
    p = track(p, 'PIP', 0);
    p = addImgTo(p, await new Promise<Blob>((res) => solid('#ffffff', 100, 100).toBlob((b) => res(b!), 'image/png')));
    p = setKeyAt(p, 'pip', 'scale', 0, 0.5, { e: 'linear' });
    p = setKeyAt(p, 'pip', 'scale', 8, 1.5);
  }
  return p;
}
function addImgTo(p: VM.VideoProject, blob: Blob) {
  p = VM.addMedia(p, { id: 'sq', kind: 'image', name: 'sq', duration: 0, blob });
  return VM.addClip(p, 'PIP', VM.makeClip('image', { id: 'pip', mediaId: 'sq', start: 0, outP: 8, size: 0.2, transform: { x: 0.2, y: 0.78, scale: 1, rotation: 0, opacity: 1 } }));
}

async function exportTap(p: VM.VideoProject, idx: number[]) {
  const want = new Set(idx);
  const frames = new Map<number, ImageData>();
  const t0 = performance.now();
  const res = await renderProject(p, {
    container: 'mp4',
    sizes: [{ width: W, height: H, label: '720p' }],
    fps: FPS,
    sink: new BlobPartsSink('video/mp4'),
    tap: {
      frame: (i, ctx) => {
        if (want.has(i)) frames.set(i, ctx.getImageData(0, 0, W, H));
      },
    },
  });
  return { res, frames, ms: performance.now() - t0 };
}

let cache: MediaCache | null = null;
let engine: PreviewEngine | null = null;
function ensureEngine() {
  if (engine) return engine;
  cache = new MediaCache();
  engine = new PreviewEngine({ cache });
  const c = document.getElementById('cv') as HTMLCanvasElement;
  engine.attach(c);
  engine.setFormat('16:9', 'contain');
  engine.setQualityMode('high');
  return engine;
}
function diffImages(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let sum = 0;
  let big = 0;
  const n = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
    sum += d;
    if (d > 32) big++;
  }
  return { meanAbs: sum / n, pctBig: (100 * big) / n };
}

const exp = {
  /** Exporta con el motor real y mide por píxeles: márgenes de recorte en la unión, borde de la cortina circular, efectos y escala animada. */
  async export(type = 'circle') {
    const p = await exportProject(type, false);
    const times = [2.0, 3.6, 4.0, 4.4, 6.0];
    const idx = times.map((t) => Math.round(t * FPS));
    const ex = await exportTap(p, idx);
    const at = (t: number) => ex.frames.get(Math.round(t * FPS))!;
    const col = (secOfFile: number, off: number): Rgb => PALETTE[(Math.floor(secOfFile + 1e-6) + off) % PALETTE.length];
    const rows: Record<string, unknown>[] = [];
    // sondas en la zona lisa (x 0,4 · y 0,4 de la vista: lejos de barras, cuadrado verde y bits)
    const P = (d: ImageData, fx: number, fy: number) => px(d, fx * W, fy * H);
    // 2,0 s: solo A (archivo 2,0 → color nº 2)
    rows.push({ t: 2.0, what: 'solo A', got: P(at(2.0), 0.4, 0.4).join(','), want: col(2, 0).join(','), ok: near(P(at(2.0), 0.4, 0.4), col(2, 0), 14) });
    // 3,6 s: A (archivo 3,6 → nº 3) con B entrando (círculo, p = 0,1 → radio pequeño): centro = B ext (archivo 1 − 0,4 = 0,6 → nº 0 + off 2)
    const R = (p: number) => p * 0.5 * Math.hypot(W, H);
    rows.push({ t: 3.6, what: 'centro = B (pre-rollo: margen anterior)', got: P(at(3.6), 0.5, 0.5).join(','), want: col(0.6, 2).join(','), ok: near(P(at(3.6), 0.5, 0.5), col(0.6, 2), 14), radiusPx: +R(0.1).toFixed(1) });
    rows.push({ t: 3.6, what: 'fuera del círculo = A', got: P(at(3.6), 0.4, 0.4).join(','), want: col(3.6, 0).join(','), ok: near(P(at(3.6), 0.4, 0.4), col(3.6, 0), 14) });
    // 4,0 s: p = 0,5. A ext (archivo 4,0 → nº 4), B (archivo 1,0 → nº 1 + off 2)
    rows.push({ t: 4.0, what: 'centro = B (archivo 1,0)', got: P(at(4.0), 0.5, 0.5).join(','), want: col(1.0, 2).join(','), ok: near(P(at(4.0), 0.5, 0.5), col(1.0, 2), 14) });
    // la zona fuera del círculo a p=0,5 (radio = 367 px) sigue siendo A usando el margen POSTERIOR de A (archivo 4,0)
    rows.push({ t: 4.0, what: 'fuera = A ext (margen posterior)', got: P(at(4.0), 0.1, 0.55).join(','), want: col(4.0, 0).join(','), ok: near(P(at(4.0), 0.1, 0.55), col(4.0, 0), 14) });
    // borde exacto: a 4,0 s el radio es ¼ de la diagonal
    const Rpx = 0.25 * Math.hypot(W, H);
    const d4 = at(4.0);
    const cB = col(1.0, 2);
    const cA = col(4.0, 0);
    // se busca a lo largo de y = centro hacia la derecha, dentro de la zona lisa (x < 0,7·W): el borde cae en x = 640 + 367 = 1007 > 0,7·W → se mide hacia arriba (vertical)
    let up = 0;
    for (let dy = 0; dy < H / 2; dy++) if (!near(px(d4, W * 0.4, H / 2 - dy), cB, 14)) { up = dy; break; }
    // en vertical a x = 0,4·W (−256 px del centro): el borde está donde √(dx² + dy²) = R → dy = √(R² − 256²)
    const dxp = W / 2 - W * 0.4;
    const expectDy = Math.sqrt(Rpx * Rpx - dxp * dxp);
    rows.push({ t: 4.0, what: 'borde de la cortina circular (medido en vertical)', measured: up, expected: +expectDy.toFixed(1), ok: Math.abs(up - expectDy) <= 3, cA: cA.join(','), cB: cB.join(',') });
    // 6,0 s: solo B (archivo 1 + 2 = 3,0 → nº 3 + off 2)
    rows.push({ t: 6.0, what: 'solo B', got: P(at(6.0), 0.4, 0.4).join(','), want: col(3.0, 2).join(','), ok: near(P(at(6.0), 0.4, 0.4), col(3.0, 2), 14) });
    return { exportMs: Math.round(ex.ms), frames: ex.res.frames, fallbackFrames: ex.res.fallbackFrames, notices: ex.res.notices, allPass: rows.every((r) => r.ok), rows };
  },

  /** Exportación con efecto, croma y fotogramas clave sobre video real (por píxeles). */
  async exportFx() {
    const p = await exportProject('fade', true);
    const times = [0.5, 4.0, 7.5];
    const idx = times.map((t) => Math.round(t * FPS));
    const ex = await exportTap(p, idx);
    const at = (t: number) => ex.frames.get(Math.round(t * FPS))!;
    // el cuadrado blanco (pip) mide 0,2·1280 = 256 px de ancho a escala 1; a t=0,5 la escala es 0,5 + 1·0,5/8 = 0,5625 → 144 px, y a t=7,5 → 1,4375 → 368 px
    const whiteWidth = (t: number) => {
      const d = at(t);
      const y = 0.78 * H;
      let n = 0;
      for (let x = 0; x < 0.5 * W; x++) {
        const c = px(d, x, y);
        if (c[0] > 245 && c[1] > 245 && c[2] > 245) n++;
      }
      return n;
    };
    const w05 = whiteWidth(0.5);
    const w75 = whiteWidth(7.5);
    const vignetteEdge = px(at(6.0 > 4 ? 7.5 : 0.5), 4, 4); // viñeta de B oscurece las esquinas
    const cine = px(at(0.5), 0.4 * W, 0.4 * H);
    const plain = PALETTE[0];
    return {
      exportMs: Math.round(ex.ms),
      pipWidth: { at0_5: w05, expected0_5: Math.round(256 * 0.5625), at7_5: w75, expected7_5: Math.round(256 * 1.4375), ok: Math.abs(w05 - 144) <= 3 && Math.abs(w75 - 368) <= 4 },
      look: { cine: cine.join(','), plain: plain.join(','), changed: !near(cine, plain as Rgb, 6) },
      vignetteCorner: vignetteEdge.join(','),
    };
  },

  /** Vista previa (PreviewEngine.drawFrame) contra exportación, píxel a píxel, con transiciones y efectos. */
  async previewVsExport(type: string | null = 'circle', withFx = true, times = [1.0, 3.6, 4.0, 4.4, 6.5]) {
    const p = await exportProject(type, withFx);
    const e = ensureEngine();
    e.setProject(p);
    const idx = times.map((t) => Math.round(t * FPS));
    const ex = await exportTap(p, idx);
    const g = document.createElement('canvas');
    g.width = W;
    g.height = H;
    const gc = g.getContext('2d', { alpha: false })!;
    const rows: Record<string, unknown>[] = [];
    for (let k = 0; k < times.length; k++) {
      const t = idx[k] / FPS;
      e.seek(t);
      const ok = await e.settle(5000);
      await new Promise((r) => setTimeout(r, 80));
      gc.fillStyle = '#000';
      gc.fillRect(0, 0, W, H);
      e.drawFrame(gc, W, H, t);
      const d = diffImages(gc.getImageData(0, 0, W, H).data, ex.frames.get(idx[k])!.data);
      rows.push({ t, settled: ok, meanAbs: +d.meanAbs.toFixed(4), pctBig: +d.pctBig.toFixed(4) });
    }
    return { type, withFx, exportMs: Math.round(ex.ms), rows, worstMean: Math.max(...rows.map((r) => r.meanAbs as number)), worstPct: Math.max(...rows.map((r) => r.pctBig as number)) };
  },
};

Object.assign(win, { __fx: { ...fx, ...exp } });
log('Banco de V6 listo: window.__fx.transitions(), effects(), fxTimes(), perf(), export(), exportFx(), previewVsExport()');
