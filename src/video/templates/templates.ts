// Plantillas de proyecto de video (locales, sin descargas): 12 proyectos `VideoProject` v2 hechos con los modelos existentes
// (texto con estilo y animación, tercios inferiores, subtítulos karaoke, transiciones, pistas). Cada plantilla trae marcadores
// de posición: clips de imagen sintética (un degradado con su rótulo; se reemplazan por tus medios) y textos editables.
// Es lógica pura: las imágenes de los marcadores las pone quien aplica la plantilla (`blobs`), así se prueba sin canvas.
import * as VM from '../model';
import { DEFAULT_TITLE_STYLE } from '../title/style';
import { SUBTITLE_PRESETS, getTitlePreset } from '../title/presets';

export type TemplateAspect = '16:9' | '9:16';
export type TemplateMode = 'project' | 'insert';

export interface Placeholder {
  id: string;
  /** nombre del medio en la biblioteca */
  name: string;
  w: number;
  h: number;
  c1: string;
  c2: string;
  /** rótulo grande del marcador */
  label: string;
}

export interface BuildCtx {
  /** imagen de cada marcador por su id (en las pruebas, cualquier Blob) */
  blobs: Record<string, Blob>;
  /** ids únicos para pistas y clips (el medio de un marcador usa el id del marcador + sufijo de aplicación) */
  uid: () => string;
}

export interface VideoTemplate {
  id: string;
  name: string;
  category: 'Títulos' | 'Redes' | 'Presentación' | 'Intro y cierre' | 'Montaje';
  description: string;
  aspect: TemplateAspect;
  /** duración aproximada (s) */
  duration: number;
  /** `insert`: además de proyecto nuevo se puede insertar en el cabezal (intro, cierre…) */
  insertable: boolean;
  /** al insertar, el material de la pista de abajo (los fondos) se mete en la pista principal empujando lo que sigue */
  ripple: boolean;
  placeholders: Placeholder[];
  build: (ctx: BuildCtx) => VM.VideoProject;
}

const W16 = { w: 1920, h: 1080 };
const W9 = { w: 1080, h: 1920 };
const D = (aspect: TemplateAspect) => (aspect === '16:9' ? W16 : W9);

const ph = (aspect: TemplateAspect, id: string, label: string, c1: string, c2: string, size?: { w: number; h: number }): Placeholder => ({ id, name: `Marcador · ${label}`, ...(size ?? D(aspect)), c1, c2, label });

// ---------------- constructor ----------------

class B {
  p: VM.VideoProject = VM.createProject();
  private mediaIds = new Map<string, string>();
  constructor(
    private ctx: BuildCtx,
    t: VideoTemplate,
  ) {
    for (const h of t.placeholders) {
      const id = ctx.uid();
      this.mediaIds.set(h.id, id);
      this.p = VM.addMedia(this.p, { id, kind: 'image', name: h.name, duration: 0, blob: ctx.blobs[h.id] });
    }
  }
  /** pista de video nueva ENCIMA de las que ya hay (se construye de abajo arriba) */
  track(name: string, kind: 'video' | 'subtitle' = 'video'): string {
    const id = this.ctx.uid();
    this.p = VM.addTrack(this.p, kind, { id, name, index: kind === 'video' ? 0 : undefined });
    return id;
  }
  /** imagen de un marcador; `size` = fracción del ancho del encuadre */
  img(track: string, phId: string, start: number, dur: number, o: Partial<VM.Clip> & { size?: number } = {}): string {
    const id = this.ctx.uid();
    this.p = VM.addClip(this.p, track, VM.makeClip('image', { id, mediaId: this.mediaIds.get(phId), start, inP: 0, outP: dur, size: o.size ?? 1, ...o }));
    return id;
  }
  text(track: string, text: string, start: number, dur: number, o: { x?: number; y?: number; preset?: string; style?: Partial<VM.TitleStyle>; anim?: VM.TitleAnim; scale?: number; clip?: Partial<VM.Clip> } = {}): string {
    const id = this.ctx.uid();
    const pre = o.preset ? getTitlePreset(o.preset) : undefined;
    const style: VM.TitleStyle = { ...DEFAULT_TITLE_STYLE, maxWidth: 0.9, ...(pre?.style ?? {}), ...o.style } as VM.TitleStyle;
    const anim = o.anim ?? pre?.anim ?? { in: 'fade', out: 'fade', inDur: 0.4, outDur: 0.4 };
    const x = o.x ?? pre?.pos?.x ?? 0.5;
    const y = o.y ?? pre?.pos?.y ?? 0.5;
    this.p = VM.addClip(this.p, track, VM.makeClip('text', { id, text, color: style.fill, size: 60, start, outP: dur, tstyle: style, anim, transform: { ...VM.IDENTITY_TRANSFORM, x, y, scale: o.scale ?? 1 }, ...o.clip }));
    return id;
  }
}

const tr = (type: string, dur = 0.8): VM.TransitionSpec => ({ type, dur });

/** Texto con ajustes de estilo comunes, para no repetirlos. */
const S = (o: Partial<VM.TitleStyle>): Partial<VM.TitleStyle> => o;

// ---------------- las 12 plantillas ----------------

const T_TITULO: VideoTemplate = {
  id: 'titulo-animado',
  name: 'Título animado',
  category: 'Títulos',
  description: 'Título grande con entrada «pop» y subtítulo que sube. Cambia los textos y pon tu fondo.',
  aspect: '16:9',
  duration: 6,
  insertable: false,
  ripple: false,
  placeholders: [ph('16:9', 'bg', 'Fondo', '#1e3a8a', '#7c3aed')],
  build(ctx) {
    const b = new B(ctx, T_TITULO);
    const bg = b.track('Fondo');
    b.img(bg, 'bg', 0, 6, { name: 'Fondo', fadeIn: 0.4, fadeOut: 0.4 });
    const t = b.track('Título');
    b.text(t, 'TU TÍTULO AQUÍ', 0.4, 5.2, { preset: 'v-central', y: 0.44 });
    const s = b.track('Subtítulo');
    b.text(s, 'Un subtítulo que se puede editar', 1.2, 4.4, { y: 0.62, style: S({ fontFamily: 'Poppins', fontSize: 52, bold: false, letterSpacing: 1 }), anim: { in: 'slideUp', inDur: 0.6, out: 'fade', outDur: 0.4 } });
    return b.p;
  },
};

const T_TERCIOS: VideoTemplate = {
  id: 'tercios-inferiores',
  name: 'Tercios inferiores',
  category: 'Títulos',
  description: 'Tres rótulos de nombre y cargo sobre tu video: simple, doble con color y claro.',
  aspect: '16:9',
  duration: 12,
  insertable: false,
  ripple: false,
  placeholders: [ph('16:9', 'bg', 'Tu video aquí', '#111827', '#4b5563')],
  build(ctx) {
    const b = new B(ctx, T_TERCIOS);
    const bg = b.track('Video');
    b.img(bg, 'bg', 0, 12, { name: 'Tu video aquí' });
    const t = b.track('Tercios');
    b.text(t, 'Nombre Apellido', 1, 3.5, { preset: 'v-tercio-simple' });
    b.text(t, 'NOMBRE APELLIDO\nCargo o descripción', 5, 3.5, { preset: 'v-tercio-doble' });
    b.text(t, 'Lugar · Fecha', 9, 2.5, { preset: 'v-tercio-claro' });
    return b.p;
  },
};

const CUES = ['Cada palabra se ilumina', 'justo cuando la dices,', 'como en un karaoke.', 'Cambia estos textos', 'y ajusta los tiempos', 'en la pestaña Subtítulos.'];

const T_KARAOKE: VideoTemplate = {
  id: 'subtitulos-karaoke',
  name: 'Subtítulos karaoke',
  category: 'Redes',
  description: 'Subtítulos grandes con la palabra activa resaltada en amarillo, sobre tu video.',
  aspect: '16:9',
  duration: 8,
  insertable: false,
  ripple: false,
  placeholders: [ph('16:9', 'bg', 'Tu video aquí', '#0f172a', '#334155')],
  build(ctx) {
    const b = new B(ctx, T_KARAOKE);
    const bg = b.track('Video');
    b.img(bg, 'bg', 0, 8, { name: 'Tu video aquí' });
    const sid = b.track('Subtítulos', 'subtitle');
    const preset = SUBTITLE_PRESETS.find((s) => s.id === 's-karaoke')!;
    b.p = { ...b.p, tracks: b.p.tracks.map((t) => (t.id === sid ? { ...t, subStyle: JSON.parse(JSON.stringify(preset.style)) } : t)) };
    CUES.forEach((text, i) => {
      b.p = VM.addClip(b.p, sid, VM.makeClip('subtitle', { id: ctx.uid(), start: 0.4 + i * 1.25, inP: 0, outP: 1.15, text }));
    });
    return b.p;
  },
};

const T_INTRO: VideoTemplate = {
  id: 'intro',
  name: 'Intro con logo',
  category: 'Intro y cierre',
  description: 'Cuatro segundos: fondo oscuro, tu logo y el nombre del canal. Se puede insertar al principio.',
  aspect: '16:9',
  duration: 4,
  insertable: true,
  ripple: true,
  placeholders: [ph('16:9', 'bg', 'Fondo intro', '#0b1020', '#1d4ed8'), ph('16:9', 'logo', 'LOGO', '#f59e0b', '#ef4444', { w: 512, h: 512 })],
  build(ctx) {
    const b = new B(ctx, T_INTRO);
    const bg = b.track('Fondo intro');
    b.img(bg, 'bg', 0, 4, { name: 'Fondo intro', fadeIn: 0.3, fadeOut: 0.4 });
    const lg = b.track('Logo');
    b.img(lg, 'logo', 0.3, 3.4, { name: 'Logo', size: 0.22, fadeIn: 0.5, fadeOut: 0.3, transform: { ...VM.IDENTITY_TRANSFORM, y: 0.38 } });
    const t = b.track('Nombre');
    b.text(t, 'Nombre del canal', 0.9, 2.8, { y: 0.68, style: S({ fontSize: 96, letterSpacing: 2 }), anim: { in: 'slideUp', inDur: 0.6, out: 'fade', outDur: 0.4 } });
    return b.p;
  },
};

const T_OUTRO: VideoTemplate = {
  id: 'cierre',
  name: 'Cierre con recomendados',
  category: 'Intro y cierre',
  description: 'Seis segundos para despedirte, con dos huecos para videos recomendados. Se puede insertar al final.',
  aspect: '16:9',
  duration: 6,
  insertable: true,
  ripple: true,
  placeholders: [ph('16:9', 'bg', 'Fondo cierre', '#1f2937', '#7c3aed'), ph('16:9', 'rec1', 'Video 1', '#0ea5e9', '#1e293b', { w: 960, h: 540 }), ph('16:9', 'rec2', 'Video 2', '#f43f5e', '#1e293b', { w: 960, h: 540 })],
  build(ctx) {
    const b = new B(ctx, T_OUTRO);
    const bg = b.track('Fondo cierre');
    b.img(bg, 'bg', 0, 6, { name: 'Fondo cierre', fadeIn: 0.4, fadeOut: 0.5 });
    const r1 = b.track('Recomendado 1');
    b.img(r1, 'rec1', 0.6, 5, { name: 'Recomendado 1', size: 0.36, fadeIn: 0.4, transform: { ...VM.IDENTITY_TRANSFORM, x: 0.27, y: 0.62 } });
    const r2 = b.track('Recomendado 2');
    b.img(r2, 'rec2', 0.9, 4.7, { name: 'Recomendado 2', size: 0.36, fadeIn: 0.4, transform: { ...VM.IDENTITY_TRANSFORM, x: 0.73, y: 0.62 } });
    const t = b.track('Despedida');
    b.text(t, '¡Gracias por ver!', 0.3, 5.3, { y: 0.2, style: S({ fontSize: 120 }), anim: { in: 'pop', inDur: 0.6, out: 'fade', outDur: 0.4 } });
    return b.p;
  },
};

const T_HISTORIA: VideoTemplate = {
  id: 'historia-vertical',
  name: 'Historia vertical',
  category: 'Redes',
  description: 'Tres pantallas verticales 9:16 con título y texto, con transiciones. Ideal para historias y reels.',
  aspect: '9:16',
  duration: 15,
  insertable: false,
  ripple: false,
  placeholders: [ph('9:16', 'a', 'Pantalla 1', '#7c3aed', '#ec4899'), ph('9:16', 'b', 'Pantalla 2', '#0ea5e9', '#22d3ee'), ph('9:16', 'c', 'Pantalla 3', '#f97316', '#facc15')],
  build(ctx) {
    const b = new B(ctx, T_HISTORIA);
    const bg = b.track('Fondos');
    b.img(bg, 'a', 0, 5, { name: 'Pantalla 1' });
    b.img(bg, 'b', 5, 5, { name: 'Pantalla 2', tin: tr('slideUp', 0.6) });
    b.img(bg, 'c', 10, 5, { name: 'Pantalla 3', tin: tr('slideUp', 0.6) });
    const ti = b.track('Títulos');
    const bodyStyle = S({ fontFamily: 'Poppins', fontSize: 58, bold: false, strokeWidth: 0 });
    b.text(ti, 'TU TÍTULO', 0.3, 4.4, { y: 0.28, style: S({ fontSize: 120, strokeWidth: 8, strokeColor: '#00000066' }), anim: { in: 'slideDown', inDur: 0.5, out: 'fade', outDur: 0.3 } });
    b.text(ti, 'SEGUNDA IDEA', 5.3, 4.4, { y: 0.28, style: S({ fontSize: 120 }), anim: { in: 'slideDown', inDur: 0.5, out: 'fade', outDur: 0.3 } });
    b.text(ti, 'TERCERA IDEA', 10.3, 4.4, { y: 0.28, style: S({ fontSize: 120 }), anim: { in: 'slideDown', inDur: 0.5, out: 'fade', outDur: 0.3 } });
    const bo = b.track('Textos');
    b.text(bo, 'Explica aquí tu primera idea en una o dos líneas.', 0.8, 3.9, { y: 0.72, style: bodyStyle, anim: { in: 'fade', inDur: 0.5, out: 'fade', outDur: 0.3 } });
    b.text(bo, 'Aquí va el segundo punto de tu historia.', 5.8, 3.9, { y: 0.72, style: bodyStyle, anim: { in: 'fade', inDur: 0.5, out: 'fade', outDur: 0.3 } });
    b.text(bo, 'Y cierra con una llamada a la acción.', 10.8, 3.9, { y: 0.72, style: bodyStyle, anim: { in: 'fade', inDur: 0.5, out: 'fade', outDur: 0.3 } });
    const cta = b.track('Desliza');
    b.text(cta, 'Desliza ↑', 11, 3.7, { y: 0.88, style: S({ fontSize: 64 }), anim: { in: 'fade', inDur: 0.4, out: 'fade', outDur: 0.3, emphasis: 'float', emphasisSpeed: 0.8 } });
    return b.p;
  },
};

const T_PRESENTACION: VideoTemplate = {
  id: 'presentacion',
  name: 'Presentación 16:9',
  category: 'Presentación',
  description: 'Cuatro diapositivas claras con título y puntos, con transiciones de empuje.',
  aspect: '16:9',
  duration: 20,
  insertable: false,
  ripple: false,
  placeholders: [ph('16:9', 's1', 'Diapositiva 1', '#1e293b', '#334155'), ph('16:9', 's2', 'Diapositiva 2', '#f8fafc', '#e2e8f0'), ph('16:9', 's3', 'Diapositiva 3', '#f8fafc', '#dbeafe'), ph('16:9', 's4', 'Diapositiva 4', '#f8fafc', '#fde68a')],
  build(ctx) {
    const b = new B(ctx, T_PRESENTACION);
    const bg = b.track('Diapositivas');
    b.img(bg, 's1', 0, 5, { name: 'Diapositiva 1' });
    b.img(bg, 's2', 5, 5, { name: 'Diapositiva 2', tin: tr('pushLeft', 0.7) });
    b.img(bg, 's3', 10, 5, { name: 'Diapositiva 3', tin: tr('pushLeft', 0.7) });
    b.img(bg, 's4', 15, 5, { name: 'Diapositiva 4', tin: tr('pushLeft', 0.7) });
    const ti = b.track('Títulos');
    const dark = S({ fill: '#0f172a', fontSize: 84, align: 'left', shadow: false });
    b.text(ti, 'Título de la presentación', 0.3, 4.5, { y: 0.45, style: S({ fontSize: 110, shadow: false }), anim: { in: 'slideUp', inDur: 0.6, out: 'fade', outDur: 0.3 } });
    b.text(ti, 'Primer tema', 5.3, 4.5, { x: 0.5, y: 0.2, style: dark, anim: { in: 'slideRight', inDur: 0.5, out: 'fade', outDur: 0.3 } });
    b.text(ti, 'Segundo tema', 10.3, 4.5, { x: 0.5, y: 0.2, style: dark, anim: { in: 'slideRight', inDur: 0.5, out: 'fade', outDur: 0.3 } });
    b.text(ti, 'Conclusión', 15.3, 4.5, { x: 0.5, y: 0.2, style: dark, anim: { in: 'slideRight', inDur: 0.5, out: 'fade', outDur: 0.3 } });
    const bo = b.track('Puntos');
    const body = S({ fill: '#1e293b', fontSize: 56, bold: false, align: 'left', shadow: false, lineHeight: 1.5 });
    b.text(bo, 'Nombre del autor · Fecha', 1, 3.8, { y: 0.62, style: S({ fontSize: 48, fontFamily: 'Poppins', bold: false, fill: '#cbd5e1', shadow: false }), anim: { in: 'fade', inDur: 0.5, out: 'fade', outDur: 0.3 } });
    b.text(bo, '• Primer punto importante\n• Segundo punto\n• Tercer punto', 5.8, 3.9, { y: 0.52, style: body, anim: { in: 'fade', inDur: 0.5, out: 'fade', outDur: 0.3 } });
    b.text(bo, '• Dato clave\n• Ejemplo o cifra\n• Qué significa', 10.8, 3.9, { y: 0.52, style: body, anim: { in: 'fade', inDur: 0.5, out: 'fade', outDur: 0.3 } });
    b.text(bo, '• Resumen\n• Siguientes pasos\n• Gracias por tu tiempo', 15.8, 3.9, { y: 0.52, style: body, anim: { in: 'fade', inDur: 0.5, out: 'fade', outDur: 0.3 } });
    return b.p;
  },
};

const T_COLLAGE: VideoTemplate = {
  id: 'collage-3-clips',
  name: 'Montaje de 3 clips',
  category: 'Montaje',
  description: 'Tres clips seguidos con transiciones distintas y un título de apertura. Sustituye los marcadores por tus videos.',
  aspect: '16:9',
  duration: 12,
  insertable: false,
  ripple: false,
  placeholders: [ph('16:9', 'c1', 'Tu clip 1', '#0369a1', '#06b6d4'), ph('16:9', 'c2', 'Tu clip 2', '#be123c', '#fb7185'), ph('16:9', 'c3', 'Tu clip 3', '#15803d', '#84cc16')],
  build(ctx) {
    const b = new B(ctx, T_COLLAGE);
    const bg = b.track('Clips');
    b.img(bg, 'c1', 0, 4.4, { name: 'Tu clip 1' });
    b.img(bg, 'c2', 4.4, 4.4, { name: 'Tu clip 2', tin: tr('dissolve', 0.8) });
    b.img(bg, 'c3', 8.8, 3.2, { name: 'Tu clip 3', tin: tr('slideLeft', 0.8) });
    const t = b.track('Título');
    b.text(t, 'MEJORES MOMENTOS', 0.4, 2.8, { y: 0.5, preset: 'v-palabras' });
    return b.p;
  },
};

const T_CUENTA: VideoTemplate = {
  id: 'cuenta-regresiva',
  name: 'Cuenta regresiva',
  category: 'Intro y cierre',
  description: 'De 5 a 1 y «¡YA!», con un número por segundo. Se puede insertar donde quieras.',
  aspect: '16:9',
  duration: 6.5,
  insertable: true,
  ripple: true,
  placeholders: [ph('16:9', 'bg', 'Fondo cuenta', '#111827', '#dc2626')],
  build(ctx) {
    const b = new B(ctx, T_CUENTA);
    const bg = b.track('Fondo cuenta');
    b.img(bg, 'bg', 0, 6.5, { name: 'Fondo cuenta' });
    const t = b.track('Números');
    [5, 4, 3, 2, 1].forEach((n, i) => b.text(t, String(n), i, 1, { style: S({ fontFamily: 'Anton', fontSize: 520, bold: false }), anim: { in: 'pop', inDur: 0.35, out: 'fade', outDur: 0.2 } }));
    b.text(t, '¡YA!', 5, 1.5, { style: S({ fontFamily: 'Anton', fontSize: 380, bold: false, fill: '#fde047' }), anim: { in: 'bounce', inDur: 0.5, out: 'fade', outDur: 0.3, emphasis: 'pulse', emphasisSpeed: 1.2 } });
    return b.p;
  },
};

const T_SUSCRIBE: VideoTemplate = {
  id: 'recordatorio-suscripcion',
  name: 'Recordatorio de suscripción',
  category: 'Redes',
  description: 'Un botón rojo «SUSCRÍBETE» y la campana, de 5 s, para poner encima de tu video. Se inserta en el cabezal.',
  aspect: '16:9',
  duration: 5,
  insertable: true,
  ripple: false,
  placeholders: [],
  build(ctx) {
    const b = new B(ctx, T_SUSCRIBE);
    const t = b.track('Suscripción');
    b.text(t, 'SUSCRÍBETE', 0, 5, {
      x: 0.8,
      y: 0.86,
      style: S({ fontFamily: 'Montserrat', fontSize: 64, textEffect: 'background', effectColor: '#dc2626', shadow: false, letterSpacing: 2 }),
      anim: { in: 'pop', inDur: 0.5, out: 'fade', outDur: 0.4, emphasis: 'pulse', emphasisSpeed: 0.8 },
    });
    const c = b.track('Campana');
    b.text(c, '🔔 Activa la campana', 0.6, 4.4, { x: 0.8, y: 0.94, style: S({ fontFamily: 'Poppins', fontSize: 40, bold: false, strokeWidth: 5 }), anim: { in: 'slideUp', inDur: 0.4, out: 'fade', outDur: 0.3 } });
    return b.p;
  },
};

const T_CITA: VideoTemplate = {
  id: 'cita-destacada',
  name: 'Cita destacada',
  category: 'Títulos',
  description: 'Una frase grande que se escribe sola, con el nombre de quien la dijo.',
  aspect: '16:9',
  duration: 8,
  insertable: false,
  ripple: false,
  placeholders: [ph('16:9', 'bg', 'Fondo de la cita', '#292524', '#78350f')],
  build(ctx) {
    const b = new B(ctx, T_CITA);
    const bg = b.track('Fondo');
    b.img(bg, 'bg', 0, 8, { name: 'Fondo de la cita', fadeIn: 0.5, fadeOut: 0.5 });
    const t = b.track('Cita');
    const au = b.track('Autor');
    b.text(t, '“Escribe aquí la frase que quieres destacar.”', 0.6, 6.8, { y: 0.45, style: S({ fontFamily: 'Merriweather', italic: true, bold: false, fontSize: 88, lineHeight: 1.3, maxWidth: 0.8 }), anim: { in: 'typewriter', inDur: 2.4, out: 'fade', outDur: 0.5 } });
    b.text(au, '— Nombre del autor', 4, 3.4, { y: 0.74, style: S({ fontFamily: 'Poppins', fontSize: 52, bold: false, fill: '#fcd34d', shadow: false }), anim: { in: 'fade', inDur: 0.6, out: 'fade', outDur: 0.4 } });
    return b.p;
  },
};

const T_PIP: VideoTemplate = {
  id: 'imagen-en-imagen',
  name: 'Imagen en imagen',
  category: 'Montaje',
  description: 'Tu video principal con un segundo video pequeño en una esquina y un rótulo con el nombre.',
  aspect: '16:9',
  duration: 10,
  insertable: false,
  ripple: false,
  placeholders: [ph('16:9', 'main', 'Video principal', '#0f766e', '#134e4a'), ph('16:9', 'pip', 'Cámara', '#6d28d9', '#a78bfa', { w: 960, h: 540 })],
  build(ctx) {
    const b = new B(ctx, T_PIP);
    const bg = b.track('Principal');
    b.img(bg, 'main', 0, 10, { name: 'Video principal' });
    const pip = b.track('Imagen en imagen');
    b.img(pip, 'pip', 0.5, 9, { name: 'Cámara', size: 0.3, fadeIn: 0.3, fadeOut: 0.3, transform: { ...VM.IDENTITY_TRANSFORM, x: 0.83, y: 0.78 } });
    const t = b.track('Rótulo');
    b.text(t, 'Nombre · Cargo', 1, 4, { preset: 'v-tercio-simple', x: 0.2, y: 0.12 });
    return b.p;
  },
};

export const VIDEO_TEMPLATES: VideoTemplate[] = [T_TITULO, T_TERCIOS, T_KARAOKE, T_INTRO, T_OUTRO, T_HISTORIA, T_PRESENTACION, T_COLLAGE, T_CUENTA, T_SUSCRIBE, T_CITA, T_PIP];

export const getVideoTemplate = (id: string) => VIDEO_TEMPLATES.find((t) => t.id === id);

/** Construye el proyecto de una plantilla con ids nuevos. */
export function buildTemplate(t: VideoTemplate, blobs: Record<string, Blob>, uid: () => string = VM.uid): VM.VideoProject {
  return t.build({ blobs, uid });
}
