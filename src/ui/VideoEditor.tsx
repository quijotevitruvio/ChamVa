import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { downloadBlob } from '../io/export';
import { canUseWebCodecs, probeExportSupport, type ExportSupport } from '../video/engine/encoderConfig';
import { ASPECTS, QUALITIES, lowerQuality, outputSize, type Aspect, type Container, type Quality } from '../video/engine/formats';
import { ExportUnsupportedError, renderProject } from '../video/engine/render';
import { openSink } from '../video/engine/sink';
import { drawOverlays as drawEngineOverlays, drawVideoFrame, type Fit } from '../video/engine/timeline';
import { MIME, deliver } from '../video/exportActions';
import * as VM from '../video/model';
import { EFFECTS } from '../video/model/effects';
import { idbGet, idbSet, idbDelete } from '../io/idb';
import { toast } from './toast';
import { t } from '../i18n';

type ClipType = 'video' | 'audio';

// Vista de un clip para esta interfaz (1 pista de video + 1 de audio). Los datos
// viven en el modelo v2 (src/video/model) y se leen/escriben a través de él.
interface Clip {
  id: string;
  type: ClipType;
  mediaId: string;
  url: string;
  name: string;
  duration: number;
  inP: number;
  outP: number;
  effect: string; // id de EFFECTS
  volume: number; // 0..2
  speed: number; // velocidad de reproducción (0.5, 1, 2…)
  fadeIn: number; // s de fundido de entrada (desde negro)
  fadeOut: number; // s de fundido de salida (a negro)
  thumb?: string; // miniatura (primer fotograma) para clips de video
}

const idbIo: VM.KvIo = { get: idbGet, set: idbSet, delete: idbDelete };

/** Pista principal de video: la de abajo (la última de video). */
function mainVideoTrack(p: VM.VideoProject): VM.Track | undefined {
  for (let i = p.tracks.length - 1; i >= 0; i--) if (p.tracks[i].kind === 'video') return p.tracks[i];
  return undefined;
}
const mainAudioTrack = (p: VM.VideoProject) => p.tracks.find((t) => t.kind === 'audio');

/** Garantiza la pista principal (con imán, como la secuencia de V1) y devuelve su id. */
function ensureMain(p: VM.VideoProject, kind: ClipType): { p: VM.VideoProject; id: string } {
  const have = kind === 'video' ? mainVideoTrack(p) : mainAudioTrack(p);
  if (have) return { p, id: have.id };
  const id = VM.uid();
  let lastVideo = -1;
  p.tracks.forEach((t, i) => t.kind === 'video' && (lastVideo = i));
  const index = kind === 'video' ? lastVideo + 1 : p.tracks.length;
  return { p: VM.addTrack(p, kind, { id, magnet: true, index, name: kind === 'video' ? 'Video' : 'Audio' }), id };
}

// Nodos de una cadena de efectos por pista (video o audio).
interface Chain {
  hp: BiquadFilterNode;
  lp: BiquadFilterNode;
  vol: GainNode;
  echo: GainNode;
  gate: GainNode; // compuerta de ruido (1 = abierto, ~0 = cerrado)
  analyser: AnalyserNode; // mide el nivel para la compuerta
  gateOn: boolean;
}

interface Overlay {
  id: string;
  kind: 'text' | 'image';
  text: string;
  color: string;
  size: number; // texto: px (ref 720px de alto) · imagen: fracción de ancho (0..1)
  src?: string;
  img?: HTMLImageElement | null;
  xf: number; // centro X (0..1)
  yf: number; // centro Y (0..1)
  start: number; // s (aparece)
  end: number; // s (desaparece); 9999 = hasta el final
}

const uid = VM.uid;

function getDuration(url: string, type: ClipType): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement(type === 'video' ? 'video' : 'audio');
    el.preload = 'metadata';
    el.onloadedmetadata = () => resolve(el.duration || 0);
    el.onerror = () => resolve(0);
    el.src = url;
  });
}

// Captura el primer fotograma de un video como miniatura (dataURL JPEG).
function getVideoThumb(url: string): Promise<string> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.src = url;
    const grab = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 160;
        c.height = 90;
        const g = c.getContext('2d');
        if (g && v.videoWidth) {
          const s = Math.min(c.width / v.videoWidth, c.height / v.videoHeight);
          const dw = v.videoWidth * s;
          const dh = v.videoHeight * s;
          g.fillStyle = '#000';
          g.fillRect(0, 0, c.width, c.height);
          g.drawImage(v, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
          resolve(c.toDataURL('image/jpeg', 0.5));
        } else resolve('');
      } catch {
        resolve('');
      }
    };
    v.onseeked = grab;
    v.onloadeddata = () => {
      try {
        v.currentTime = Math.min(0.1, (v.duration || 1) - 0.05);
      } catch {
        grab();
      }
    };
    v.onerror = () => resolve('');
  });
}

// Decodifica el audio y calcula picos para dibujar la forma de onda.
async function getWaveform(url: string, buckets = 100): Promise<number[]> {
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    const AC: typeof AudioContext =
      window.AudioContext ?? (window as any).webkitAudioContext;
    const ac = new AC();
    const audio = await ac.decodeAudioData(buf);
    const data = audio.getChannelData(0);
    const block = Math.floor(data.length / buckets) || 1;
    const peaks: number[] = [];
    for (let i = 0; i < buckets; i++) {
      let max = 0;
      for (let j = 0; j < block; j++) {
        const v = Math.abs(data[i * block + j] || 0);
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    ac.close().catch(() => {});
    const norm = Math.max(0.01, ...peaks);
    return peaks.map((p) => p / norm);
  } catch {
    return [];
  }
}

const fmt = (s: number) => {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

export function VideoEditor({ onClose }: { onClose: () => void }) {
  const videoFileRef = useRef<HTMLInputElement>(null);
  const audioFileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playAll = useRef(false);
  const playIdx = useRef(0);
  const endCb = useRef<null | (() => void)>(null);

  // Web Audio: grafo persistente para efectos + grabación.
  // Dos cadenas PARALELAS (video / audio) → mezcla común → EQ → comp → salida.
  // Así el efecto del clip de video y el del clip de audio suenan a la vez.
  const acRef = useRef<AudioContext | null>(null);
  const vSrcRef = useRef<MediaElementAudioSourceNode | null>(null);
  const aSrcRef = useRef<MediaElementAudioSourceNode | null>(null);
  const vChainRef = useRef<Chain | null>(null);
  const aChainRef = useRef<Chain | null>(null);
  const eqLowRef = useRef<BiquadFilterNode | null>(null);
  const eqMidRef = useRef<BiquadFilterNode | null>(null);
  const eqHighRef = useRef<BiquadFilterNode | null>(null);
  const compRef = useRef<DynamicsCompressorNode | null>(null);
  const recDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const gateRaf = useRef<number>(0);

  const micRec = useRef<MediaRecorder | null>(null);

  // ---- proyecto (modelo v2) + historial de deshacer ----
  const [hist, setHist] = useState(() => VM.createHistory(VM.createProject()));
  const histRef = useRef(hist);
  histRef.current = hist;
  const project = hist.present;
  /** Cambio con paso de deshacer. `group`: los cambios seguidos del mismo grupo (arrastre, deslizador) son UN paso. */
  const commitP = (fn: (p: VM.VideoProject) => VM.VideoProject, group?: string) => setHist((h) => VM.commit(h, fn(h.present), { group }));
  const endGroup = () => setHist((h) => VM.endGroup(h));
  const undoV = () => setHist((h) => VM.undo(h));
  const redoV = () => setHist((h) => VM.redo(h));
  /** Datos de un medio que llegan tarde (miniatura): en todas las instantáneas, sin paso. */
  const patchMediaEverywhere = (id: string, m: Partial<VM.MediaAsset>) => setHist((h) => VM.mapHistory(h, (p) => VM.updateMedia(p, id, m)));
  const storeRef = useRef<VM.VideoProjectStore | null>(null);
  storeRef.current ??= new VM.VideoProjectStore(idbIo);
  // URL de objeto e imágenes por medio (fuera del modelo: no se guardan ni se deshacen).
  const urlCache = useRef(new Map<string, string>());
  const imgCache = useRef(new Map<string, HTMLImageElement>());
  const [, bumpImages] = useState(0);
  const urlOf = (m: VM.MediaAsset | undefined): string => {
    if (!m?.blob) return '';
    let u = urlCache.current.get(m.id);
    if (!u) {
      u = URL.createObjectURL(m.blob);
      urlCache.current.set(m.id, u);
    }
    return u;
  };
  const imageOf = (m: VM.MediaAsset | undefined): HTMLImageElement | null => {
    if (!m?.blob) return null;
    let img = imgCache.current.get(m.id);
    if (!img) {
      img = new window.Image();
      img.onload = () => bumpImages((n) => n + 1);
      img.src = urlOf(m);
      imgCache.current.set(m.id, img);
    }
    return img;
  };

  const vTrack = mainVideoTrack(project);
  const aTrack = mainAudioTrack(project);
  const toView = (c: VM.Clip, type: ClipType): Clip => {
    const m = c.mediaId ? project.media[c.mediaId] : undefined;
    return {
      id: c.id,
      type,
      mediaId: c.mediaId ?? '',
      url: urlOf(m),
      name: c.name ?? m?.name ?? '',
      duration: m?.duration ?? 0,
      inP: c.inP,
      outP: c.outP,
      effect: c.effect,
      volume: c.volume,
      speed: c.speed,
      fadeIn: c.fadeIn,
      fadeOut: c.fadeOut,
      thumb: m?.thumb,
    };
  };
  const clips: Clip[] = [
    ...(vTrack?.clips.filter((c) => c.kind === 'video' && !project.media[c.mediaId ?? '']?.missing).map((c) => toView(c, 'video')) ?? []),
    ...(aTrack?.clips.filter((c) => !project.media[c.mediaId ?? '']?.missing).map((c) => toView(c, 'audio')) ?? []),
  ];
  // Capas = clips de texto/imagen de las demás pistas de video, de abajo arriba (orden de dibujo).
  const overlays: Overlay[] = [];
  for (const { track } of VM.videoTracksBottomUp(project)) {
    if (track === vTrack) continue;
    for (const c of track.clips) {
      if (c.kind !== 'text' && c.kind !== 'image') continue;
      const m = c.mediaId ? project.media[c.mediaId] : undefined;
      overlays.push({
        id: c.id,
        kind: c.kind,
        text: c.text ?? '',
        color: c.color ?? '#ffffff',
        size: c.size ?? (c.kind === 'text' ? 60 : 0.3),
        src: c.kind === 'image' ? urlOf(m) || undefined : undefined,
        img: c.kind === 'image' ? imageOf(m) : undefined,
        xf: c.transform.x,
        yf: c.transform.y,
        start: c.start,
        end: c.toEnd ? 9999 : VM.clipEnd(c),
      });
    }
  }
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportRes, setExportRes] = useState<Quality>(720); // lado corto en px (720 / 1080 / 4K)
  const [exportAspect, setExportAspect] = useState<Aspect>('16:9');
  const [exportFit, setExportFit] = useState<Fit>('contain');
  const [exportFps, setExportFps] = useState(30);
  const [exportProgress, setExportProgress] = useState(0); // 0..1
  const [exportLabel, setExportLabel] = useState('');
  const [support, setSupport] = useState<ExportSupport | null>(null);
  const exportAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    probeExportSupport().then(setSupport).catch(() => setSupport(null));
  }, []);
  const [recording, setRecording] = useState(false);
  const [waveforms, setWaveforms] = useState<Record<string, number[]>>({}); // por id de medio
  const eq = project.eq;
  const normalize = project.normalize;

  // Fase B: capas (texto/imagen) superpuestas sobre el video.
  const overlayFileRef = useRef<HTMLInputElement>(null);
  const [selOverlay, setSelOverlay] = useState<string | null>(null);

  // Construye una cadena de efectos: src → hp → lp → gate → vol → mezcla (+ eco).
  // El analizador toma el nivel ANTES de la compuerta para decidir abrir/cerrar.
  const buildChain = (ac: AudioContext, mix: AudioNode): Chain => {
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 20;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 20000;
    const gate = ac.createGain();
    gate.gain.value = 1;
    const analyser = ac.createAnalyser();
    analyser.fftSize = 1024;
    const vol = ac.createGain();
    vol.gain.value = 1;
    const echo = ac.createGain();
    echo.gain.value = 0;
    const delay = ac.createDelay(1);
    delay.delayTime.value = 0.28;
    const feedback = ac.createGain();
    feedback.gain.value = 0.35;

    hp.connect(lp);
    lp.connect(analyser); // medición (no suena)
    lp.connect(gate);
    gate.connect(vol);
    vol.connect(mix);
    // Cadena de eco
    vol.connect(echo);
    echo.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    // Antes era echo.connect(mix): sonaba una copia sin retardo (subía el volumen) en
    // vez de un eco. Ahora suena la línea de retardo, igual que en la exportación.
    delay.connect(mix);
    return { hp, lp, vol, echo, gate, analyser, gateOn: false };
  };

  // Bucle de la compuerta de ruido: silencia la pista cuando el nivel es bajo.
  const runGateLoop = () => {
    if (gateRaf.current) return;
    const buf = new Uint8Array(1024);
    const ac = acRef.current;
    const tick = () => {
      if (!ac) {
        gateRaf.current = 0;
        return;
      }
      for (const ch of [vChainRef.current, aChainRef.current]) {
        if (!ch) continue;
        const target = (() => {
          if (!ch.gateOn) return 1;
          ch.analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          return rms > 0.025 ? 1 : 0.02; // umbral de ruido
        })();
        ch.gate.gain.setTargetAtTime(target, ac.currentTime, 0.05);
      }
      gateRaf.current = requestAnimationFrame(tick);
    };
    gateRaf.current = requestAnimationFrame(tick);
  };

  // Crea (una vez) el grafo: dos cadenas (video/audio) → mezcla → EQ → comp → salida + grabación.
  const ensureAudio = () => {
    if (acRef.current) {
      if (acRef.current.state === 'suspended') acRef.current.resume();
      return acRef.current;
    }
    const ac = new AudioContext();
    const recDest = ac.createMediaStreamDestination();
    const mix = ac.createGain();

    const eqLow = ac.createBiquadFilter();
    eqLow.type = 'peaking';
    eqLow.frequency.value = 120;
    eqLow.Q.value = 1;
    const eqMid = ac.createBiquadFilter();
    eqMid.type = 'peaking';
    eqMid.frequency.value = 1000;
    eqMid.Q.value = 1;
    const eqHigh = ac.createBiquadFilter();
    eqHigh.type = 'peaking';
    eqHigh.frequency.value = 6000;
    eqHigh.Q.value = 1;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = normalize ? -24 : 0; // 0 = sin normalizar
    comp.ratio.value = normalize ? 4 : 1;
    comp.knee.value = normalize ? 30 : 0;
    // EQ recuperada de un proyecto guardado
    eqLow.gain.value = eq.low;
    eqMid.gain.value = eq.mid;
    eqHigh.gain.value = eq.high;

    mix.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(comp);
    comp.connect(ac.destination);
    comp.connect(recDest);

    const vChain = buildChain(ac, mix);
    const aChain = buildChain(ac, mix);

    const connectEl = (
      el: HTMLMediaElement | null,
      ref: { current: MediaElementAudioSourceNode | null },
      chain: Chain,
    ) => {
      if (!el || ref.current) return;
      try {
        ref.current = ac.createMediaElementSource(el);
        ref.current.connect(chain.hp);
      } catch {
        /* ya conectado */
      }
    };
    connectEl(videoRef.current, vSrcRef, vChain);
    connectEl(audioRef.current, aSrcRef, aChain);

    acRef.current = ac;
    vChainRef.current = vChain;
    aChainRef.current = aChain;
    eqLowRef.current = eqLow;
    eqMidRef.current = eqMid;
    eqHighRef.current = eqHigh;
    compRef.current = comp;
    recDestRef.current = recDest;
    runGateLoop();
    return ac;
  };

  const setEq = (band: 'low' | 'mid' | 'high', db: number) => {
    ensureAudio();
    const ref =
      band === 'low' ? eqLowRef : band === 'mid' ? eqMidRef : eqHighRef;
    if (ref.current) ref.current.gain.value = db;
  };

  const setNormalize = (on: boolean) => {
    ensureAudio();
    const c = compRef.current;
    if (!c) return;
    c.threshold.value = on ? -24 : 0;
    c.ratio.value = on ? 4 : 1;
    c.knee.value = on ? 30 : 0;
  };

  // Aplica el efecto de un clip a SU cadena (video o audio), sin afectar la otra.
  const applyEffect = (clip: Clip) => {
    ensureAudio();
    const ch = clip.type === 'video' ? vChainRef.current : aChainRef.current;
    if (!ch) return;
    const fx = EFFECTS.find((e) => e.id === clip.effect) ?? EFFECTS[0];
    ch.hp.frequency.value = fx.hp;
    ch.lp.frequency.value = fx.lp;
    ch.echo.gain.value = fx.echo;
    ch.vol.gain.value = clip.volume;
    ch.gateOn = !!fx.gate;
    if (!fx.gate) ch.gate.gain.value = 1;
  };

  const videoClips = clips.filter((c) => c.type === 'video');
  const seqDuration =
    videoClips.reduce((a, c) => a + (c.outP - c.inP), 0) || 30;
  const audioClips = clips.filter((c) => c.type === 'audio');
  const selected = clips.find((c) => c.id === selectedId) ?? null;
  const maxDur = Math.max(1, ...clips.map((c) => c.duration));

  // Tras deshacer/rehacer, la vista previa (Web Audio) vuelve a leer la EQ, «Normalizar»
  // y el efecto/volumen del clip seleccionado (antes solo se ponían al tocar el control).
  useEffect(() => {
    if (!acRef.current) return;
    if (eqLowRef.current) eqLowRef.current.gain.value = eq.low;
    if (eqMidRef.current) eqMidRef.current.gain.value = eq.mid;
    if (eqHighRef.current) eqHighRef.current.gain.value = eq.high;
    setNormalize(normalize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eq.low, eq.mid, eq.high, normalize]);
  useEffect(() => {
    if (acRef.current && selected) applyEffect(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.effect, selected?.volume]);

  // Línea de tiempo global: la del modelo (pista principal con imán = secuencia sin huecos).
  const segments: { clip: Clip; start: number; end: number; dur: number }[] = (vTrack?.clips ?? [])
    .filter((c) => c.kind === 'video' && !project.media[c.mediaId ?? '']?.missing)
    .map((c) => ({ clip: toView(c, 'video'), start: c.start, end: VM.clipEnd(c), dur: VM.clipDuration(c) }));
  const totalTime = segments.length ? segments[segments.length - 1].end : 0;
  const [playhead, setPlayhead] = useState(0); // posición del cabezal (s globales)
  const scrubRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  // Recorte arrastrando los bordes de un segmento en la línea de tiempo.
  const trimDrag = useRef<{
    clipId: string;
    edge: 'in' | 'out';
    rect: DOMRect;
    inP0: number;
    outP0: number;
    duration: number;
  } | null>(null);

  const onTrimMove = (clientX: number) => {
    const td = trimDrag.current;
    if (!td) return;
    const frac = (clientX - td.rect.left) / td.rect.width;
    let srcTime = td.inP0 + frac * (td.outP0 - td.inP0);
    // Imán: el borde recortado se pega al cabezal si queda cerca (~0.15 s).
    const seg = segments.find((sg) => sg.clip.id === td.clipId);
    if (seg && playhead >= seg.start - 0.5 && playhead <= seg.end + 0.5) {
      const sp = seg.clip.speed ?? 1;
      const srcAtPlayhead = seg.clip.inP + (playhead - seg.start) * sp;
      if (Math.abs(srcTime - srcAtPlayhead) < 0.15) srcTime = srcAtPlayhead;
    }
    if (td.edge === 'in') {
      const inP = Math.max(0, Math.min(srcTime, td.outP0 - 0.1));
      patch(td.clipId, { inP }, 'trim:' + td.clipId);
    } else {
      const outP = Math.max(td.inP0 + 0.1, Math.min(srcTime, td.duration));
      patch(td.clipId, { outP }, 'trim:' + td.clipId);
    }
  };

  // Salta a un tiempo global: ubica el clip y posiciona el <video> (en pausa).
  const seek = (global: number) => {
    if (!segments.length) return;
    const g = Math.max(0, Math.min(totalTime, global));
    const seg =
      segments.find((s) => g >= s.start && g <= s.end) ??
      segments[segments.length - 1];
    const v = videoRef.current;
    setSelectedId(seg.clip.id);
    applyEffect(seg.clip);
    setPlayhead(g);
    if (!v) return;
    const srcTime = seg.clip.inP + (g - seg.start) * (seg.clip.speed ?? 1);
    v.playbackRate = seg.clip.speed ?? 1;
    if (v.src !== seg.clip.url) {
      v.src = seg.clip.url;
      const onMeta = () => {
        v.currentTime = srcTime;
        v.removeEventListener('loadeddata', onMeta);
      };
      v.addEventListener('loadeddata', onMeta);
    } else {
      v.currentTime = srcTime;
    }
  };

  const scrubTo = (clientX: number) => {
    const el = scrubRef.current;
    if (!el || !totalTime) return;
    const r = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    seek(frac * totalTime);
  };

  // Zoom de la línea de tiempo (1 = ajustar al ancho).
  const [tlZoom, setTlZoom] = useState(1);

  // Atajos: espacio = play/pausa · ←/→ = fotograma a fotograma · S = dividir ·
  // Supr = borrar clip · Ctrl+Z = deshacer · Ctrl+Shift+Z / Ctrl+Y = rehacer.
  // En fase de CAPTURA y sin propagar: el editor de diseño (App) escucha las mismas
  // teclas en window y, si no, deshacía/borraba en el diseño que queda detrás.
  // (Se re-registra en cada render para leer estado fresco.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const v = videoRef.current;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (mod && k === 'z' && !e.shiftKey) {
        handled();
        undoV();
      } else if (mod && ((k === 'z' && e.shiftKey) || k === 'y')) {
        handled();
        redoV();
      } else if (e.code === 'Space') {
        handled();
        if (!v) return;
        if (v.paused) v.play().catch(() => {});
        else v.pause();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        handled();
        const step = e.shiftKey ? 1 : 1 / 30;
        seek(playhead + (e.key === 'ArrowRight' ? step : -step));
      } else if (k === 's' && !mod) {
        handled();
        splitSelected();
      } else if (e.key === 'Delete' && selectedId) {
        handled();
        removeClip(selectedId);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  useEffect(() => {
    const urls = urlCache.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
      if (gateRaf.current) cancelAnimationFrame(gateRaf.current);
      acRef.current?.close().catch(() => {});
    };
  }, []);

  // Persistencia del proyecto de video en IndexedDB (clave `videoProject`, modelo v2).
  // Un guardado de V1 se migra al cargar; el original se respalda antes del primer
  // guardado y se retira solo cuando el v2 se relee bien (src/video/model/storage.ts).
  const restored = useRef(false);
  useEffect(() => {
    (async () => {
      try {
        const store = storeRef.current!;
        const res = await store.load();
        if (res.from === 'future') toast('Este proyecto de video es de una versión más nueva de ChamVa: no se modificará.', 'error');
        if (res.from === 1 || res.from === 'unknown' || res.fromBackup) console.info('[video] proyecto migrado a v2', res.report);
        if (res.report.repaired.length) console.warn('[video] valores reparados al migrar:', res.report.repaired);
        const past = await VM.loadUndo(idbIo, res.project);
        setHist({ ...VM.createHistory(res.project), past });
        for (const m of Object.values(res.project.media)) {
          if (m.kind === 'audio' && m.blob)
            getWaveform(urlOf(m)).then((p) => p.length && setWaveforms((w) => ({ ...w, [m.id]: p })));
          if (m.kind === 'image') imageOf(m);
        }
        if (res.project.tracks.some((t) => t.clips.length)) toast('Proyecto de video recuperado', 'info');
      } finally {
        restored.current = true;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    const id = setTimeout(async () => {
      const store = storeRef.current!;
      if (!store.writable) return;
      if (await store.save(project)) await VM.saveUndo(idbIo, histRef.current.past, project);
    }, 2000);
    return () => clearTimeout(id);
  }, [project]);

  const newVideoProject = () => {
    urlCache.current.forEach((u) => URL.revokeObjectURL(u));
    urlCache.current.clear();
    imgCache.current.clear();
    setHist(VM.createHistory(VM.createProject()));
    setSelectedId(null);
    setSelOverlay(null);
    setWaveforms({});
    void storeRef.current!.clear();
  };

  /** Añade un archivo como clip al final de la pista principal (un paso de deshacer). */
  const addFileClip = (blob: Blob, name: string, duration: number, type: ClipType): { clipId: string; mediaId: string; url: string } => {
    const mediaId = uid();
    const clipId = uid();
    const url = URL.createObjectURL(blob);
    urlCache.current.set(mediaId, url);
    commitP((p0) => {
      let p = VM.addMedia(p0, { id: mediaId, kind: type, name, duration, blob });
      const main = ensureMain(p, type);
      p = main.p;
      return VM.appendClip(p, main.id, VM.makeClip(type, { id: clipId, mediaId, name, inP: 0, outP: duration }));
    });
    return { clipId, mediaId, url };
  };

  const onImport = async (files: FileList | null, type: ClipType) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const probeUrl = URL.createObjectURL(file);
      const duration = await getDuration(probeUrl, type);
      URL.revokeObjectURL(probeUrl);
      const { clipId, mediaId, url } = addFileClip(file, file.name, duration, type);
      if (type === 'video') {
        setSelectedId(clipId);
        getVideoThumb(url).then((thumb) => thumb && patchMediaEverywhere(mediaId, { thumb }));
      } else {
        getWaveform(url).then((peaks) => peaks.length && setWaveforms((w) => ({ ...w, [mediaId]: peaks })));
      }
    }
  };

  const selectClip = (c: Clip) => {
    setSelectedId(c.id);
    applyEffect(c);
    if (c.type === 'video' && videoRef.current) {
      videoRef.current.src = c.url;
      videoRef.current.currentTime = c.inP;
      videoRef.current.playbackRate = c.speed ?? 1;
    }
    if (c.type === 'audio' && audioRef.current) {
      audioRef.current.src = c.url;
      audioRef.current.currentTime = c.inP;
      audioRef.current.playbackRate = c.speed ?? 1;
    }
  };

  /** Cambia un clip a través del modelo. `group`: deslizadores/arrastres = un solo paso de deshacer. */
  const patch = (id: string, p: Partial<Pick<Clip, 'inP' | 'outP' | 'effect' | 'volume' | 'speed' | 'fadeIn' | 'fadeOut'>>, group?: string) =>
    commitP((pr) => VM.updateClip(pr, id, p), group);

  // El archivo NO se libera aquí: deshacer lo vuelve a necesitar.
  const removeClip = (id: string) => {
    commitP((p) => VM.removeClip(p, id));
    if (selectedId === id) setSelectedId(null);
  };

  // Reordena un clip antes de otro (dentro de su pista).
  const dragClipId = useRef<string | null>(null);
  const reorderClip = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    commitP((p) => {
      const a = VM.findClip(p, fromId);
      const b = VM.findClip(p, toId);
      if (!a || !b || a.track.id !== b.track.id) return p;
      return VM.moveClipToIndex(p, fromId, b.clipIndex);
    });
  };

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const probeUrl = URL.createObjectURL(blob);
        const duration = await getDuration(probeUrl, 'audio');
        URL.revokeObjectURL(probeUrl);
        const n = clips.filter((c) => c.type === 'audio').length + 1;
        const { mediaId, url } = addFileClip(blob, `Grabación ${n}`, duration, 'audio');
        getWaveform(url).then((peaks) => peaks.length && setWaveforms((w) => ({ ...w, [mediaId]: peaks })));
        setRecording(false);
      };
      micRec.current = rec;
      rec.start();
      setRecording(true);
    } catch (e) {
      toast('No se pudo acceder al micrófono: ' + (e as Error).message, 'error');
    }
  };

  const stopRec = () => {
    micRec.current?.stop();
    micRec.current = null;
  };

  // Divide el clip seleccionado por el punto de reproducción actual.
  const splitSelected = () => {
    if (!selected) return;
    const el = selected.type === 'video' ? videoRef.current : audioRef.current;
    const t = el?.currentTime ?? selected.inP + (selected.outP - selected.inP) / 2;
    if (t <= selected.inP + 0.05 || t >= selected.outP - 0.05) return;
    // tiempo del archivo → tiempo de la línea de tiempo (el modelo divide en la línea de tiempo)
    commitP((p) => {
      const loc = VM.findClip(p, selected.id);
      if (!loc) return p;
      const c = loc.clip;
      return VM.splitClip(p, c.id, c.start + (t - c.inP) / (c.speed || 1));
    });
  };

  /** Cada capa nueva va en su propia pista, encima de todo (como V1: la última se dibuja encima). */
  const addOverlayClip = (clip: VM.Clip, media?: VM.MediaAsset) => {
    const trackId = uid();
    commitP((p0) => {
      let p = media ? VM.addMedia(p0, media) : p0;
      p = VM.addTrack(p, 'video', { id: trackId, index: 0, name: clip.kind === 'text' ? 'Texto' : 'Imagen' });
      return VM.addClip(p, trackId, clip);
    });
    setSelOverlay(clip.id);
  };

  const addTextOverlay = () =>
    addOverlayClip(VM.makeClip('text', { text: 'Texto', color: '#ffffff', size: 60, start: 0, outP: 9999, toEnd: true, transform: { ...VM.IDENTITY_TRANSFORM, x: 0.5, y: 0.85 } }));

  const addImageOverlay = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const media: VM.MediaAsset = { id: uid(), kind: 'image', name: file.name, duration: 0, blob: file };
    const img = imageOf(media);
    if (img)
      await new Promise((r) => {
        if (img.complete) return r(null);
        img.addEventListener('load', r, { once: true });
        img.addEventListener('error', r, { once: true });
      });
    addOverlayClip(VM.makeClip('image', { mediaId: media.id, size: 0.3, start: 0, outP: 9999, toEnd: true }), media);
  };

  /** Cambia una capa (texto, color, tamaño, posición, inicio/fin) a través del modelo. */
  const updOverlay = (id: string, o: Partial<Overlay>, group?: string) =>
    commitP((p) => {
      const loc = VM.findClip(p, id);
      if (!loc) return p;
      const c = loc.clip;
      const patchC: Parameters<typeof VM.updateClip>[2] = {};
      if (o.text !== undefined) patchC.text = o.text;
      if (o.color !== undefined) patchC.color = o.color;
      if (o.size !== undefined) patchC.size = o.size;
      if (o.xf !== undefined || o.yf !== undefined) patchC.transform = { ...(o.xf !== undefined ? { x: o.xf } : {}), ...(o.yf !== undefined ? { y: o.yf } : {}) };
      const end = o.end ?? (c.toEnd ? null : VM.clipEnd(c));
      const start = o.start ?? c.start;
      if (o.start !== undefined || o.end !== undefined) {
        patchC.start = start;
        if (end === null || end > 9000) {
          patchC.toEnd = true;
        } else {
          patchC.toEnd = false;
          patchC.inP = 0;
          patchC.outP = Math.max(0, end - start);
        }
      }
      return VM.updateClip(p, id, patchC);
    }, group);
  const removeOverlay = (id: string) => {
    commitP((p0) => {
      const loc = VM.findClip(p0, id);
      if (!loc) return p0;
      const p = VM.removeClip(p0, id);
      const t = VM.findTrack(p, loc.track.id);
      return t && !t.clips.length ? VM.removeTrack(p, t.id) : p;
    });
    if (selOverlay === id) setSelOverlay(null);
  };

  // Dibuja las capas superpuestas: la MISMA función que el motor de exportación
  // (antes la ruta WebM usaba el tamaño en px sin escalar y la MP4 lo escalaba).
  const drawOverlays = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) =>
    drawEngineOverlays(ctx, w, h, overlays, t);

  // Reproduce los clips de video en orden, respetando el recorte.
  const playSequence = async () => {
    if (videoClips.length === 0) return;
    playAll.current = true;
    playIdx.current = 0;
    loadAndPlay(videoClips[0]);
    if (audioClips[0] && audioRef.current) {
      applyEffect(audioClips[0]); // efecto de la pista de audio (simultáneo)
      audioRef.current.src = audioClips[0].url;
      audioRef.current.currentTime = audioClips[0].inP;
      audioRef.current.playbackRate = audioClips[0].speed ?? 1;
      audioRef.current.play().catch(() => {});
    }
  };

  const loadAndPlay = (c: Clip) => {
    const v = videoRef.current;
    if (!v) return;
    setSelectedId(c.id);
    applyEffect(c);
    v.src = c.url;
    v.currentTime = c.inP;
    v.playbackRate = c.speed ?? 1;
    v.play().catch(() => {});
  };

  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || !selected || selected.type !== 'video') return;
    // Avanza el cabezal según el tiempo global del clip en reproducción.
    const seg = segments.find((s) => s.clip.id === selected.id);
    if (seg)
      setPlayhead(
        seg.start +
          Math.max(0, (v.currentTime - selected.inP) / (selected.speed ?? 1)),
      );
    if (v.currentTime >= selected.outP) {
      if (playAll.current) {
        playIdx.current += 1;
        if (playIdx.current < videoClips.length) {
          loadAndPlay(videoClips[playIdx.current]);
        } else {
          playAll.current = false;
          v.pause();
          endCb.current?.();
          endCb.current = null;
        }
      } else {
        v.pause();
      }
    }
  };

  // Ruta de respaldo SIN WebCodecs: graba la reproducción en tiempo real con
  // MediaRecorder (WebM, o MP4 si el navegador lo admite, como Safari).
  const recordFallback = async (mime: string, signal: AbortSignal): Promise<Blob> => {
    const canvas = document.createElement('canvas');
    const size = outputSize(exportAspect, exportRes > 1080 ? 1080 : exportRes);
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream(exportFps);
    // Duración real estimada (respeta recorte y velocidad de cada clip).
    const totalDur = Math.max(
      0.1,
      videoClips.reduce(
        (sum, c) => sum + (c.outP - c.inP) / (c.speed ?? 1),
        0,
      ),
    );
    setExportProgress(0);
    ensureAudio();
    recDestRef.current?.stream
      .getAudioTracks()
      .forEach((t) => stream.addTrack(t));
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise<void>((res) => {
      rec.onstop = () => res();
    });

    let raf = 0;
    const recStart = performance.now();
    const draw = () => {
      const v = videoRef.current;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (v && v.videoWidth) {
        // Fundido de entrada/salida del clip actual (alpha sobre negro).
        const clip = videoClips[playIdx.current];
        let alpha = 1;
        if (clip) {
          const sp = clip.speed ?? 1;
          const localReal = Math.max(0, (v.currentTime - clip.inP) / sp);
          const dur = Math.max(0.01, (clip.outP - clip.inP) / sp);
          if (clip.fadeIn > 0 && localReal < clip.fadeIn)
            alpha = localReal / clip.fadeIn;
          if (clip.fadeOut > 0 && dur - localReal < clip.fadeOut)
            alpha = Math.min(alpha, (dur - localReal) / clip.fadeOut);
          alpha = Math.max(0, Math.min(1, alpha));
        }
        drawVideoFrame(ctx, v, v.videoWidth, v.videoHeight, canvas.width, canvas.height, exportFit, 0, alpha);
      }
      const elapsed = (performance.now() - recStart) / 1000;
      drawOverlays(ctx, canvas.width, canvas.height, elapsed);
      setExportProgress(Math.min(0.99, elapsed / totalDur));
      raf = requestAnimationFrame(draw);
    };
    draw();
    rec.start();
    await new Promise<void>((res) => {
      endCb.current = res;
      signal.addEventListener('abort', () => {
        videoRef.current?.pause();
        playAll.current = false;
        res();
      });
      playSequence();
    });
    cancelAnimationFrame(raf);
    rec.stop();
    await stopped;
    if (signal.aborted) throw new DOMException('Exportación cancelada', 'AbortError');
    setExportProgress(1);
    return new Blob(chunks, { type: mime.split(';')[0] });
  };

  // Exportación con el motor (WebCodecs, en streaming a disco) o, si el
  // navegador no tiene WebCodecs, grabación en tiempo real con MediaRecorder.
  const onExport = async (container: Container) => {
    if (videoClips.length === 0 || exporting) return;
    const filename = `chamva-video.${container}`;
    const ac = new AbortController();
    exportAbort.current = ac;
    setExportProgress(0);
    setExportLabel('');
    if (!canUseWebCodecs()) {
      const mime =
        container === 'mp4'
          ? ['video/mp4;codecs=avc1,mp4a', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m))
          : ['video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
      if (!mime) {
        toast(
          container === 'mp4'
            ? 'Este navegador no puede crear MP4. Exporta en WebM.'
            : 'Este navegador no puede crear WebM. Exporta en MP4.',
          'error',
        );
        return;
      }
      setExporting(true);
      setExportLabel('grabando en tiempo real');
      try {
        downloadBlob(await recordFallback(mime, ac.signal), filename);
      } catch (e) {
        if ((e as DOMException)?.name !== 'AbortError') toast('No se pudo exportar el video: ' + (e as Error).message, 'error');
      } finally {
        setExporting(false);
        setExportProgress(0);
        exportAbort.current = null;
      }
      return;
    }
    // Pedir el destino primero (el selector de archivos exige el gesto del clic).
    let sink;
    try {
      sink = await openSink({ filename, mime: MIME[container] });
    } catch (e) {
      toast('No se pudo abrir el archivo de destino: ' + (e as Error).message, 'error');
      return;
    }
    if (!sink) return; // cancelado
    setExporting(true);
    const sizes: { width: number; height: number; label: string }[] = [];
    for (let q: Quality | null = exportRes; q; q = lowerQuality(q)) {
      const sz = outputSize(exportAspect, q);
      sizes.push({ ...sz, label: `${sz.width}×${sz.height}` });
    }
    try {
      // El motor exporta el proyecto v2 tal cual (todas las pistas, capas y mezcla).
      const images = new Map<string, HTMLImageElement>();
      imgCache.current.forEach((img, id) => img.naturalWidth && images.set(id, img));
      const res = await renderProject(project, {
        container,
        sizes,
        fps: exportFps,
        images,
        fit: exportFit,
        sink,
        signal: ac.signal,
        onNotice: (m) => toast(m, 'info'),
        onProgress: (p) => {
          setExportProgress(p.ratio);
          setExportLabel(
            p.stage === 'video'
              ? `fotograma ${p.frame}/${p.frames}${p.eta !== undefined ? ` · quedan ~${Math.ceil(p.eta)} s` : ''}`
              : p.stage,
          );
        },
      });
      deliver(sink, res.blob, filename);
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') toast('Exportación cancelada', 'info');
      else {
        console.error(e);
        toast(
          e instanceof ExportUnsupportedError ? e.message : 'No se pudo exportar el video: ' + (e as Error).message,
          'error',
        );
      }
    } finally {
      setExporting(false);
      setExportProgress(0);
      setExportLabel('');
      exportAbort.current = null;
    }
  };

  return (
    <div className="video-overlay" onPointerUp={endGroup}>
      <div className="video-toolbar">
        <button onClick={onClose}>← {t('Volver al diseño')}</button>
        <span className="mask-title">🎬 {t('Editor de video')}</span>
        <button
          onClick={newVideoProject}
          disabled={clips.length === 0 && overlays.length === 0}
          title="Vaciar el proyecto de video"
        >
          🗑 {t('Nuevo')}
        </button>
        <button onClick={undoV} disabled={!VM.canUndo(hist)} title="Deshacer (Ctrl+Z)">
          ↶
        </button>
        <button onClick={redoV} disabled={!VM.canRedo(hist)} title="Rehacer (Ctrl+Shift+Z / Ctrl+Y)">
          ↷
        </button>
        <button onClick={() => videoFileRef.current?.click()}>🎬 {t('Subir video')}</button>
        <button onClick={() => audioFileRef.current?.click()}>🎵 {t('Subir audio')}</button>
        <button
          className={recording ? 'primary' : ''}
          onClick={recording ? stopRec : startRec}
        >
          {recording ? `⏹ ${t('Detener')}` : `🎤 ${t('Grabar')}`}
        </button>
        <button onClick={addTextOverlay}>➕ {t('Texto')}</button>
        <button onClick={() => overlayFileRef.current?.click()}>
          ➕ {t('Imagen')}
        </button>
        <input
          ref={overlayFileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            addImageOverlay(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          className="primary"
          onClick={playSequence}
          disabled={videoClips.length === 0}
        >
          ▶ {t('Reproducir todo')}
        </button>
        <span className="spacer" />
        <select
          value={exportAspect}
          onChange={(e) => setExportAspect(e.target.value as Aspect)}
          disabled={exporting}
          title="Proporción del video"
        >
          {ASPECTS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        <select
          value={exportRes}
          onChange={(e) => setExportRes(Number(e.target.value) as Quality)}
          disabled={exporting}
          title="Resolución de salida (lado corto)"
        >
          {QUALITIES.map((q) => {
            const no4k = q.id === 2160 && !!support && !support.mp4_4k && !support.webm_4k;
            return (
              <option key={q.id} value={q.id} disabled={no4k}>
                {q.label}
                {no4k ? ' (no disponible en este equipo)' : ''}
              </option>
            );
          })}
        </select>
        <select
          value={exportFit}
          onChange={(e) => setExportFit(e.target.value as Fit)}
          disabled={exporting}
          title="Cómo encaja el video si su proporción no coincide"
        >
          <option value="contain">Encajar (bandas negras)</option>
          <option value="cover">Rellenar (recorta)</option>
        </select>
        <select
          value={exportFps}
          onChange={(e) => setExportFps(Number(e.target.value))}
          disabled={exporting}
          title="Cuadros por segundo"
        >
          <option value={24}>24 fps</option>
          <option value={30}>30 fps</option>
          <option value={60}>60 fps</option>
        </select>
        <button
          onClick={() => onExport('webm')}
          disabled={videoClips.length === 0 || exporting || (!!support && support.webcodecs && !support.webm)}
          title="Exportar a WebM (VP9 + Opus)"
        >
          {exporting ? `… ${t('Exportando')}` : '⬇ WebM'}
        </button>
        <button
          className="primary"
          onClick={() => onExport('mp4')}
          disabled={videoClips.length === 0 || exporting || (!!support && support.webcodecs && !support.mp4)}
          title={
            support && support.webcodecs && !support.mp4
              ? 'Este equipo no puede codificar H.264: usa WebM'
              : 'Exportar a MP4 (H.264 + AAC), sin descargas'
          }
        >
          {exporting ? '… Procesando' : '⬇ MP4'}
        </button>
        <input
          ref={videoFileRef}
          type="file"
          accept="video/*"
          multiple
          hidden
          onChange={(e) => {
            onImport(e.target.files, 'video');
            e.target.value = '';
          }}
        />
        <input
          ref={audioFileRef}
          type="file"
          accept="audio/*"
          multiple
          hidden
          onChange={(e) => {
            onImport(e.target.files, 'audio');
            e.target.value = '';
          }}
        />
      </div>

      {exporting && (
        <div className="vt-progress-row">
          <div className="vt-progress">
            <div
              className="vt-progress-fill"
              style={{ width: `${Math.round(exportProgress * 100)}%` }}
            />
            <span className="vt-progress-label">
              {t('Exportando')}… {Math.round(exportProgress * 100)}%{exportLabel ? ` · ${exportLabel}` : ''}
            </span>
          </div>
          <button onClick={() => exportAbort.current?.abort()} title="Cancelar la exportación">
            ✕ Cancelar
          </button>
        </div>
      )}

      <div className="video-eq">
        <span className="vt-name">🎚 EQ</span>
        {(['low', 'mid', 'high'] as const).map((band) => (
          <label key={band}>
            {band === 'low' ? 'Graves' : band === 'mid' ? 'Medios' : 'Agudos'}
            <input
              type="range"
              min={-12}
              max={12}
              step={1}
              value={eq[band]}
              onChange={(e) => {
                const v = Number(e.target.value);
                commitP((p) => VM.updateProject(p, { eq: { ...p.eq, [band]: v } }), 'eq:' + band);
                setEq(band, v);
              }}
              onPointerUp={endGroup}
            />
          </label>
        ))}
        <button
          className={normalize ? 'primary' : ''}
          onClick={() => {
            const n = !normalize;
            commitP((p) => VM.updateProject(p, { normalize: n }));
            setNormalize(n);
          }}
        >
          {normalize ? '✓ Normalizar' : 'Normalizar'}
        </button>
      </div>

      <div className="video-preview">
        <video
          ref={videoRef}
          controls
          onTimeUpdate={onTimeUpdate}
          onPlay={() => {
            const v = videoRef.current;
            if (v && selected && selected.type === 'video') {
              if (v.currentTime < selected.inP || v.currentTime >= selected.outP)
                v.currentTime = selected.inP;
            }
          }}
        />
        <audio ref={audioRef} />
        {overlays.map((o) =>
          o.kind === 'text' ? (
            <div
              key={o.id}
              onClick={() => setSelOverlay(o.id)}
              style={{
                position: 'absolute',
                left: `${o.xf * 100}%`,
                top: `${o.yf * 100}%`,
                transform: 'translate(-50%,-50%)',
                color: o.color,
                fontWeight: 700,
                fontSize: o.size * 0.55,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                outline: selOverlay === o.id ? '1px dashed #111111' : 'none',
              }}
            >
              {o.text}
            </div>
          ) : (
            <img
              key={o.id}
              src={o.src}
              alt=""
              onClick={() => setSelOverlay(o.id)}
              style={{
                position: 'absolute',
                left: `${o.xf * 100}%`,
                top: `${o.yf * 100}%`,
                transform: 'translate(-50%,-50%)',
                width: `${o.size * 100}%`,
                cursor: 'pointer',
                outline: selOverlay === o.id ? '1px dashed #111111' : 'none',
              }}
            />
          ),
        )}
        {clips.length === 0 && (
          <p className="video-empty">
            Sube un video o audio para empezar. Aquí lo previsualizas y recortas.
          </p>
        )}
      </div>

      {selected && (
        <div className="video-trim">
          <span className="vt-name">
            {selected.type === 'video' ? '🎬' : '🎵'} {selected.name}
          </span>
          <label>
            Inicio {fmt(selected.inP)}
            <input
              type="range"
              min={0}
              max={selected.duration}
              step={0.1}
              value={selected.inP}
              onChange={(e) =>
                patch(selected.id, {
                  inP: Math.min(Number(e.target.value), selected.outP - 0.1),
                }, 'in:' + selected.id)
              }
            />
          </label>
          <label>
            Fin {fmt(selected.outP)}
            <input
              type="range"
              min={0}
              max={selected.duration}
              step={0.1}
              value={selected.outP}
              onChange={(e) =>
                patch(selected.id, {
                  outP: Math.max(Number(e.target.value), selected.inP + 0.1),
                }, 'out:' + selected.id)
              }
            />
          </label>
          <label>
            Voz
            <select
              value={selected.effect}
              onChange={(e) => {
                patch(selected.id, { effect: e.target.value });
                applyEffect({ ...selected, effect: e.target.value });
              }}
            >
              {EFFECTS.map((fx) => (
                <option key={fx.id} value={fx.id}>
                  {fx.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Volumen
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={selected.volume}
              onChange={(e) => {
                const volume = Number(e.target.value);
                patch(selected.id, { volume }, 'vol:' + selected.id);
                const ch =
                  selected.type === 'video'
                    ? vChainRef.current
                    : aChainRef.current;
                if (ch) ch.vol.gain.value = volume;
              }}
            />
          </label>
          <label>
            Velocidad ×{(selected.speed ?? 1).toFixed(2)}
            <input
              type="range"
              min={0.25}
              max={3}
              step={0.05}
              value={selected.speed ?? 1}
              onChange={(e) => {
                const speed = Number(e.target.value);
                patch(selected.id, { speed }, 'speed:' + selected.id);
                const el =
                  selected.type === 'video'
                    ? videoRef.current
                    : audioRef.current;
                if (el) el.playbackRate = speed;
              }}
            />
          </label>
          {selected.type === 'video' && (
            <>
              <label>
                Fundido entrada {selected.fadeIn.toFixed(1)}s
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={0.1}
                  value={selected.fadeIn}
                  onChange={(e) =>
                    patch(selected.id, { fadeIn: Number(e.target.value) }, 'fadeIn:' + selected.id)
                  }
                />
              </label>
              <label>
                Fundido salida {selected.fadeOut.toFixed(1)}s
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={0.1}
                  value={selected.fadeOut}
                  onChange={(e) =>
                    patch(selected.id, { fadeOut: Number(e.target.value) }, 'fadeOut:' + selected.id)
                  }
                />
              </label>
            </>
          )}
          <button onClick={splitSelected}>✂ {t('Dividir aquí')} (S)</button>
        </div>
      )}

      {selOverlay &&
        (() => {
          const o = overlays.find((x) => x.id === selOverlay);
          if (!o) return null;
          return (
            <div className="video-trim">
              <span className="vt-name">
                {o.kind === 'text' ? '🅣 Capa texto' : '🖼 Capa imagen'}
              </span>
              {o.kind === 'text' && (
                <>
                  <input
                    type="text"
                    value={o.text}
                    onChange={(e) => updOverlay(o.id, { text: e.target.value }, 'text:' + o.id)}
                  />
                  <input
                    type="color"
                    value={o.color}
                    onChange={(e) => updOverlay(o.id, { color: e.target.value }, 'color:' + o.id)}
                  />
                </>
              )}
              <label>
                Tamaño
                <input
                  type="range"
                  min={o.kind === 'text' ? 20 : 0.05}
                  max={o.kind === 'text' ? 200 : 1}
                  step={o.kind === 'text' ? 2 : 0.01}
                  value={o.size}
                  onChange={(e) =>
                    updOverlay(o.id, { size: Number(e.target.value) }, 'size:' + o.id)
                  }
                />
              </label>
              <label>
                X
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={o.xf}
                  onChange={(e) =>
                    updOverlay(o.id, { xf: Number(e.target.value) }, 'x:' + o.id)
                  }
                />
              </label>
              <label>
                Y
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={o.yf}
                  onChange={(e) =>
                    updOverlay(o.id, { yf: Number(e.target.value) }, 'y:' + o.id)
                  }
                />
              </label>
              <label>
                Inicio {Math.round(o.start > 9000 ? 0 : o.start)}s
                <input
                  type="range"
                  min={0}
                  max={Math.max(5, seqDuration)}
                  step={0.5}
                  value={Math.min(o.start, seqDuration)}
                  onChange={(e) =>
                    updOverlay(o.id, { start: Number(e.target.value) }, 'start:' + o.id)
                  }
                />
              </label>
              <label>
                Fin {o.end > 9000 ? 'fin' : Math.round(o.end) + 's'}
                <input
                  type="range"
                  min={0}
                  max={Math.max(5, seqDuration)}
                  step={0.5}
                  value={Math.min(o.end, seqDuration)}
                  onChange={(e) =>
                    updOverlay(o.id, { end: Number(e.target.value) }, 'end:' + o.id)
                  }
                />
              </label>
              <button onClick={() => removeOverlay(o.id)}>🗑 Quitar capa</button>
            </div>
          );
        })()}

      <div className="video-timeline">
        {segments.length > 0 && (
          <div className="vt-scrub-row">
            <span className="vt-time">{fmt(playhead)}</span>
            <div className="vt-scroll">
            <div
              className="vt-scrubber"
              style={
                tlZoom === 1
                  ? undefined
                  : { width: `${Math.round(totalTime * 60 * tlZoom)}px` }
              }
              ref={scrubRef}
              onPointerDown={(e) => {
                scrubbing.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                scrubTo(e.clientX);
              }}
              onPointerMove={(e) => {
                if (scrubbing.current) scrubTo(e.clientX);
              }}
              onPointerUp={(e) => {
                scrubbing.current = false;
                e.currentTarget.releasePointerCapture(e.pointerId);
              }}
            >
              {segments.map((s) => {
                const startTrim = (edge: 'in' | 'out') => (
                  e: ReactPointerEvent,
                ) => {
                  e.stopPropagation();
                  const seg = (e.currentTarget as HTMLElement).parentElement;
                  if (!seg) return;
                  trimDrag.current = {
                    clipId: s.clip.id,
                    edge,
                    rect: seg.getBoundingClientRect(),
                    inP0: s.clip.inP,
                    outP0: s.clip.outP,
                    duration: s.clip.duration,
                  };
                  (e.currentTarget as HTMLElement).setPointerCapture(
                    e.pointerId,
                  );
                };
                const endTrim = (e: ReactPointerEvent) => {
                  if (trimDrag.current) {
                    const c = clips.find((x) => x.id === trimDrag.current!.clipId);
                    trimDrag.current = null;
                    if (c) selectClip(c);
                  }
                  (e.currentTarget as HTMLElement).releasePointerCapture(
                    e.pointerId,
                  );
                };
                return (
                  <div
                    key={s.clip.id}
                    className={`vt-seg ${s.clip.id === selectedId ? 'sel' : ''}`}
                    style={{
                      left: `${(s.start / totalTime) * 100}%`,
                      width: `${(s.dur / totalTime) * 100}%`,
                      backgroundImage: s.clip.thumb
                        ? `url(${s.clip.thumb})`
                        : undefined,
                    }}
                    title={`${s.clip.name} — arrastra los bordes para recortar`}
                  >
                    <div
                      className="vt-handle l"
                      onPointerDown={startTrim('in')}
                      onPointerMove={(e) =>
                        trimDrag.current && onTrimMove(e.clientX)
                      }
                      onPointerUp={endTrim}
                    />
                    <div
                      className="vt-handle r"
                      onPointerDown={startTrim('out')}
                      onPointerMove={(e) =>
                        trimDrag.current && onTrimMove(e.clientX)
                      }
                      onPointerUp={endTrim}
                    />
                  </div>
                );
              })}
              <div
                className="vt-playhead"
                style={{ left: `${(playhead / totalTime) * 100}%` }}
              />
            </div>
            </div>
            <span className="vt-time">{fmt(totalTime)}</span>
            <div className="vt-zoom">
              <button
                title="Alejar línea de tiempo"
                onClick={() => setTlZoom((z) => Math.max(1, z / 1.5))}
              >
                −
              </button>
              <button title="Ajustar" onClick={() => setTlZoom(1)}>
                ⤢
              </button>
              <button
                title="Acercar línea de tiempo"
                onClick={() => setTlZoom((z) => Math.min(16, z * 1.5))}
              >
                ＋
              </button>
            </div>
          </div>
        )}
        <div className="vt-track">
          <span className="vt-label">🎬 Video</span>
          <div className="vt-clips">
            {videoClips.length === 0 && <span className="vt-hint">Sin clips</span>}
            {videoClips.map((c) => (
              <div
                key={c.id}
                className={`vt-clip ${c.id === selectedId ? 'sel' : ''}`}
                style={{ width: `${Math.max(60, (c.duration / maxDur) * 320)}px` }}
                onClick={() => selectClip(c)}
                draggable
                onDragStart={() => (dragClipId.current = c.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragClipId.current) reorderClip(dragClipId.current, c.id);
                  dragClipId.current = null;
                }}
              >
                <span className="vt-clip-name">{c.name}</span>
                <span className="vt-clip-dur">{fmt(c.outP - c.inP)}</span>
                <button
                  className="vt-del"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeClip(c.id);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="vt-track">
          <span className="vt-label">🎵 Audio</span>
          <div className="vt-clips">
            {audioClips.length === 0 && <span className="vt-hint">Sin clips</span>}
            {audioClips.map((c) => (
              <div
                key={c.id}
                className={`vt-clip audio ${c.id === selectedId ? 'sel' : ''}`}
                style={{ width: `${Math.max(60, (c.duration / maxDur) * 320)}px` }}
                onClick={() => selectClip(c)}
                draggable
                onDragStart={() => (dragClipId.current = c.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragClipId.current) reorderClip(dragClipId.current, c.id);
                  dragClipId.current = null;
                }}
              >
                {waveforms[c.mediaId] && (
                  <svg
                    className="vt-wave"
                    viewBox="0 0 100 24"
                    preserveAspectRatio="none"
                  >
                    {waveforms[c.mediaId].map((p, i) => (
                      <rect
                        key={i}
                        x={i}
                        y={12 - p * 11}
                        width={0.8}
                        height={Math.max(0.5, p * 22)}
                      />
                    ))}
                  </svg>
                )}
                <span className="vt-clip-name">{c.name}</span>
                <span className="vt-clip-dur">{fmt(c.outP - c.inP)}</span>
                <button
                  className="vt-del"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeClip(c.id);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
