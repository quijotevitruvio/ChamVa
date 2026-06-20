import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { webmToMp4 } from '../io/ffmpegConvert';
import { toast } from './toast';

type ClipType = 'video' | 'audio';

interface Clip {
  id: string;
  type: ClipType;
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

// Filtros de voz / limpieza / efectos (Web Audio).
// gate = activa una compuerta de ruido (silencia por debajo de un umbral).
const EFFECTS: {
  id: string;
  label: string;
  hp: number;
  lp: number;
  echo: number;
  gate?: boolean;
}[] = [
  { id: 'none', label: 'Ninguno', hp: 20, lp: 20000, echo: 0 },
  { id: 'clean', label: 'Limpiar voz', hp: 120, lp: 7000, echo: 0 },
  { id: 'denoise', label: 'Reducir ruido', hp: 100, lp: 9000, echo: 0, gate: true },
  { id: 'phone', label: 'Teléfono / Radio', hp: 500, lp: 3000, echo: 0 },
  { id: 'deep', label: 'Voz grave', hp: 20, lp: 1200, echo: 0 },
  { id: 'bright', label: 'Voz nítida', hp: 200, lp: 20000, echo: 0 },
  { id: 'echo', label: 'Eco', hp: 20, lp: 20000, echo: 0.4 },
];

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
  end: number; // s (desaparece)
}

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `clip-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

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

  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportRes, setExportRes] = useState(720); // alto en px (720 / 1080)
  const [exportFps, setExportFps] = useState(30);
  const [exportProgress, setExportProgress] = useState(0); // 0..1
  const [recording, setRecording] = useState(false);
  const [waveforms, setWaveforms] = useState<Record<string, number[]>>({});
  const [eq, setEqState] = useState({ low: 0, mid: 0, high: 0 });
  const [normalize, setNormState] = useState(false);

  // Fase B: capas (texto/imagen) superpuestas sobre el video.
  const overlayFileRef = useRef<HTMLInputElement>(null);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
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
    echo.connect(mix);
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
    comp.threshold.value = 0; // 0 = sin normalizar (se ajusta al activar)
    comp.ratio.value = 1;

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

  // Línea de tiempo global: cada clip de video ocupa su duración real (recorte/velocidad).
  const segments: { clip: Clip; start: number; end: number; dur: number }[] = [];
  for (const c of videoClips) {
    const start = segments.length ? segments[segments.length - 1].end : 0;
    const dur = Math.max(0.01, (c.outP - c.inP) / (c.speed ?? 1));
    segments.push({ clip: c, start, end: start + dur, dur });
  }
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
    const t = trimDrag.current;
    if (!t) return;
    const frac = (clientX - t.rect.left) / t.rect.width;
    const srcTime = t.inP0 + frac * (t.outP0 - t.inP0);
    if (t.edge === 'in') {
      const inP = Math.max(0, Math.min(srcTime, t.outP0 - 0.1));
      patch(t.clipId, { inP });
    } else {
      const outP = Math.max(t.inP0 + 0.1, Math.min(srcTime, t.duration));
      patch(t.clipId, { outP });
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

  useEffect(() => {
    return () => {
      clips.forEach((c) => URL.revokeObjectURL(c.url));
      if (gateRaf.current) cancelAnimationFrame(gateRaf.current);
      acRef.current?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onImport = async (files: FileList | null, type: ClipType) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const url = URL.createObjectURL(file);
      const duration = await getDuration(url, type);
      const clip: Clip = {
        id: uid(),
        type,
        url,
        name: file.name,
        duration,
        inP: 0,
        outP: duration,
        effect: 'none',
        volume: 1,
        speed: 1,
        fadeIn: 0,
        fadeOut: 0,
      };
      setClips((prev) => [...prev, clip]);
      if (type === 'video') {
        setSelectedId(clip.id);
        getVideoThumb(url).then(
          (thumb) => thumb && patch(clip.id, { thumb }),
        );
      } else {
        getWaveform(url).then(
          (peaks) =>
            peaks.length &&
            setWaveforms((w) => ({ ...w, [clip.id]: peaks })),
        );
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

  const patch = (id: string, p: Partial<Clip>) =>
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, ...p } : c)));

  const removeClip = (id: string) => {
    const c = clips.find((x) => x.id === id);
    if (c) URL.revokeObjectURL(c.url);
    setClips((prev) => prev.filter((x) => x.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  // Reordena un clip antes de otro (dentro del array global; mismo tipo en la práctica).
  const dragClipId = useRef<string | null>(null);
  const reorderClip = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setClips((prev) => {
      const from = prev.findIndex((c) => c.id === fromId);
      const to = prev.findIndex((c) => c.id === toId);
      if (from < 0 || to < 0) return prev;
      const arr = [...prev];
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      return arr;
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
        const url = URL.createObjectURL(blob);
        const duration = await getDuration(url, 'audio');
        const n = clips.filter((c) => c.type === 'audio').length + 1;
        const recClip: Clip = {
          id: uid(),
          type: 'audio',
          url,
          name: `Grabación ${n}`,
          duration,
          inP: 0,
          outP: duration,
          effect: 'none',
          volume: 1,
          speed: 1,
          fadeIn: 0,
          fadeOut: 0,
        };
        setClips((prev) => [...prev, recClip]);
        getWaveform(url).then(
          (peaks) =>
            peaks.length &&
            setWaveforms((w) => ({ ...w, [recClip.id]: peaks })),
        );
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
    const a: Clip = { ...selected, id: uid(), outP: t };
    const b: Clip = { ...selected, id: uid(), inP: t };
    setClips((prev) => prev.flatMap((c) => (c.id === selected.id ? [a, b] : [c])));
    setSelectedId(a.id);
  };

  const addTextOverlay = () => {
    const o: Overlay = {
      id: uid(),
      kind: 'text',
      text: 'Texto',
      color: '#ffffff',
      size: 60,
      xf: 0.5,
      yf: 0.85,
      start: 0,
      end: 9999,
    };
    setOverlays((p) => [...p, o]);
    setSelOverlay(o.id);
  };

  const addImageOverlay = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const src = URL.createObjectURL(file);
    const img = new window.Image();
    img.src = src;
    await new Promise((r) => {
      img.onload = r;
      img.onerror = r;
    });
    const o: Overlay = {
      id: uid(),
      kind: 'image',
      text: '',
      color: '#fff',
      size: 0.3,
      src,
      img,
      xf: 0.5,
      yf: 0.5,
      start: 0,
      end: 9999,
    };
    setOverlays((p) => [...p, o]);
    setSelOverlay(o.id);
  };

  const updOverlay = (id: string, p: Partial<Overlay>) =>
    setOverlays((prev) => prev.map((o) => (o.id === id ? { ...o, ...p } : o)));
  const removeOverlay = (id: string) => {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
    if (selOverlay === id) setSelOverlay(null);
  };

  // Dibuja las capas superpuestas en el canvas (para la exportación).
  const drawOverlays = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    t?: number,
  ) => {
    for (const o of overlays) {
      if (t !== undefined && (t < o.start || t > o.end)) continue;
      const cx = o.xf * w;
      const cy = o.yf * h;
      if (o.kind === 'text') {
        ctx.fillStyle = o.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${o.size}px Arial`;
        ctx.fillText(o.text, cx, cy);
      } else if (o.img && o.img.naturalWidth) {
        const iw = o.size * w;
        const ih = iw * (o.img.naturalHeight / o.img.naturalWidth);
        ctx.drawImage(o.img, cx - iw / 2, cy - ih / 2, iw, ih);
      }
    }
  };

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

  // Graba la secuencia (vídeo + audio del grafo) en un Blob WebM.
  const recordWebM = async (): Promise<Blob> => {
    const canvas = document.createElement('canvas');
    canvas.height = exportRes;
    canvas.width = Math.round((exportRes * 16) / 9);
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
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
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
        const s = Math.min(canvas.width / v.videoWidth, canvas.height / v.videoHeight);
        const dw = v.videoWidth * s;
        const dh = v.videoHeight * s;
        ctx.globalAlpha = alpha;
        ctx.drawImage(v, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
        ctx.globalAlpha = 1;
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
      playSequence();
    });
    cancelAnimationFrame(raf);
    rec.stop();
    await stopped;
    setExportProgress(1);
    return new Blob(chunks, { type: 'video/webm' });
  };

  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const onExportWebm = async () => {
    if (videoClips.length === 0) return;
    setExporting(true);
    try {
      download(await recordWebM(), 'chamva-video.webm');
    } catch (e) {
      console.error(e);
      toast('No se pudo exportar el video: ' + (e as Error).message, 'error');
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  };

  const onExportMp4 = async () => {
    if (videoClips.length === 0) return;
    setExporting(true);
    try {
      const webm = await recordWebM();
      const mp4 = await webmToMp4(webm);
      download(mp4, 'chamva-video.mp4');
    } catch (e) {
      console.error(e);
      toast('No se pudo convertir a MP4: ' + (e as Error).message, 'error');
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  };

  return (
    <div className="video-overlay">
      <div className="video-toolbar">
        <button onClick={onClose}>← Volver al diseño</button>
        <span className="mask-title">🎬 Editor de video</span>
        <button onClick={() => videoFileRef.current?.click()}>🎬 Subir video</button>
        <button onClick={() => audioFileRef.current?.click()}>🎵 Subir audio</button>
        <button
          className={recording ? 'primary' : ''}
          onClick={recording ? stopRec : startRec}
        >
          {recording ? '⏹ Detener' : '🎤 Grabar'}
        </button>
        <button onClick={addTextOverlay}>➕ Texto</button>
        <button onClick={() => overlayFileRef.current?.click()}>
          ➕ Imagen
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
          ▶ Reproducir todo
        </button>
        <span className="spacer" />
        <select
          value={exportRes}
          onChange={(e) => setExportRes(Number(e.target.value))}
          disabled={exporting}
          title="Resolución de salida"
        >
          <option value={720}>720p</option>
          <option value={1080}>1080p</option>
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
          onClick={onExportWebm}
          disabled={videoClips.length === 0 || exporting}
          title="Exportar la secuencia a WebM"
        >
          {exporting ? '… Exportando' : '⬇ WebM'}
        </button>
        <button
          className="primary"
          onClick={onExportMp4}
          disabled={videoClips.length === 0 || exporting}
          title="Exportar a MP4 (descarga ffmpeg la 1ª vez)"
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
        <div className="vt-progress">
          <div
            className="vt-progress-fill"
            style={{ width: `${Math.round(exportProgress * 100)}%` }}
          />
          <span className="vt-progress-label">
            Exportando… {Math.round(exportProgress * 100)}%
          </span>
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
                setEqState((p) => ({ ...p, [band]: v }));
                setEq(band, v);
              }}
            />
          </label>
        ))}
        <button
          className={normalize ? 'primary' : ''}
          onClick={() => {
            const n = !normalize;
            setNormState(n);
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
                outline: selOverlay === o.id ? '1px dashed #6c8cff' : 'none',
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
                outline: selOverlay === o.id ? '1px dashed #6c8cff' : 'none',
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
                })
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
                })
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
                patch(selected.id, { volume });
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
                patch(selected.id, { speed });
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
                    patch(selected.id, { fadeIn: Number(e.target.value) })
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
                    patch(selected.id, { fadeOut: Number(e.target.value) })
                  }
                />
              </label>
            </>
          )}
          <button onClick={splitSelected}>✂ Dividir aquí</button>
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
                    onChange={(e) => updOverlay(o.id, { text: e.target.value })}
                  />
                  <input
                    type="color"
                    value={o.color}
                    onChange={(e) => updOverlay(o.id, { color: e.target.value })}
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
                    updOverlay(o.id, { size: Number(e.target.value) })
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
                    updOverlay(o.id, { xf: Number(e.target.value) })
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
                    updOverlay(o.id, { yf: Number(e.target.value) })
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
                    updOverlay(o.id, { start: Number(e.target.value) })
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
                    updOverlay(o.id, { end: Number(e.target.value) })
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
            <div
              className="vt-scrubber"
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
            <span className="vt-time">{fmt(totalTime)}</span>
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
                {waveforms[c.id] && (
                  <svg
                    className="vt-wave"
                    viewBox="0 0 100 24"
                    preserveAspectRatio="none"
                  >
                    {waveforms[c.id].map((p, i) => (
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
