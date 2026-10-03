// Lógica pura de «Subtítulos automáticos» (V5b): alcance → rango de audio, opciones del diálogo → opciones del
// motor, textos de estado/errores legibles, tiempo restante y aplicación del resultado al proyecto en UN solo
// cambio (un paso de deshacer). Sin DOM ni motor: todo se prueba con Vitest.
import type { AudioRange } from '../../ai/transcribe/audio';
import { modelBytes, suggestModel, WHISPER_MODELS, type AsrDevice, type DeviceInfo, type WhisperSize } from '../../ai/transcribe/models';
import { formatBytes, formatClock, type SubtitleLayout } from '../../ai/transcribe/subtitles';
import type { AsrSegment } from '../../ai/transcribe/windows';
import * as VM from '../../video/model';
import type { Karaoke } from '../../video/model';
import { SUBTITLE_PRESETS } from '../../video/title/presets';
import type { Cue } from '../../video/title/srt';
import * as S from '../../video/title/subtitles';

export type AutoScope = 'project' | 'clip' | 'marks';

export interface Marks {
  in: number | null;
  out: number | null;
}

/** Normaliza las marcas: si están al revés se intercambian; devuelve null si falta alguna o el rango es vacío. */
export function marksRange(m: Marks): AudioRange | null {
  if (m.in === null || m.out === null || !Number.isFinite(m.in) || !Number.isFinite(m.out)) return null;
  const a = Math.min(m.in, m.out);
  const b = Math.max(m.in, m.out);
  return b - a >= 0.05 ? { start: Math.max(0, a), end: b } : null;
}

/** «m:ss,d» para avisos de marcas. */
export const fmtMark = (t: number) => `${formatClock(Math.floor(t))}${(t % 1).toFixed(1).slice(1).replace('.', ',')}`;

const AUDIBLE: VM.ClipKind[] = ['video', 'audio'];

/** ¿Algún clip de audio/video (de una pista sin silenciar) toca el rango? Sin audio no hay nada que transcribir. */
export function hasAudioIn(p: VM.VideoProject, range: AudioRange | null, trackId?: string): boolean {
  return p.tracks.some(
    (t) =>
      (!trackId ? !t.muted : t.id === trackId) &&
      t.kind !== 'subtitle' &&
      t.clips.some((c) => AUDIBLE.includes(c.kind) && !!c.mediaId && !p.media[c.mediaId]?.missing && (!range || (VM.clipEnd(c) > range.start && c.start < range.end))),
  );
}

export interface ScopePlan {
  ok: true;
  range?: AudioRange;
  trackId?: string;
  /** descripción para el diálogo («Todo el proyecto · 1:30») */
  label: string;
}
export interface ScopeError {
  ok: false;
  reason: string;
}

/** Primer clip de audio/video de la selección (el alcance «clip seleccionado»). */
export function selectedMediaClip(p: VM.VideoProject, selection: string[]) {
  for (const id of selection) {
    const l = VM.findClip(p, id);
    if (l && AUDIBLE.includes(l.clip.kind)) return l;
  }
  return null;
}

/** Alcance elegido → rango de línea de tiempo y pista a mezclar, o el motivo legible por el que no se puede. */
export function resolveScope(p: VM.VideoProject, scope: AutoScope, o: { selection: string[]; marks: Marks }): ScopePlan | ScopeError {
  const total = VM.projectDuration(p);
  if (scope === 'project') {
    if (!(total > 0)) return { ok: false, reason: 'El proyecto está vacío: añade un video o un audio con voz.' };
    if (!hasAudioIn(p, null)) return { ok: false, reason: 'No hay audio que transcribir: las pistas de audio y video están silenciadas o no hay ninguna.' };
    return { ok: true, label: `Todo el proyecto · ${formatClock(total)}` };
  }
  if (scope === 'clip') {
    const l = selectedMediaClip(p, o.selection);
    if (!l) return { ok: false, reason: 'Selecciona un clip de audio o de video en la línea de tiempo.' };
    if (!l.clip.mediaId || p.media[l.clip.mediaId]?.missing) return { ok: false, reason: 'El archivo de ese clip no está disponible.' };
    const end = Math.min(VM.clipEnd(l.clip), total);
    if (!(end - l.clip.start >= 0.05)) return { ok: false, reason: 'Ese clip queda después del final del video: lo que pasa de ahí no se exporta ni se transcribe.' };
    return { ok: true, range: { start: l.clip.start, end }, trackId: l.track.id, label: `Clip «${l.clip.name ?? p.media[l.clip.mediaId]?.name ?? 'seleccionado'}» · ${formatClock(end - l.clip.start)}` };
  }
  const r = marksRange(o.marks);
  if (!r) return { ok: false, reason: 'Pon dos marcas: la de entrada con I y la de salida con O (o usa los botones «Cabezal»).' };
  const range = { start: r.start, end: Math.min(r.end, total || r.end) };
  if (!(range.end > range.start)) return { ok: false, reason: 'Las marcas quedan fuera del proyecto.' };
  if (!hasAudioIn(p, range)) return { ok: false, reason: 'No hay audio entre las marcas: elige un rango donde se oiga una voz.' };
  return { ok: true, range, label: `Entre marcas · ${formatClock(range.start)} → ${formatClock(range.end)}` };
}

// ---------------- opciones ----------------

export interface AutoOptions {
  scope: AutoScope;
  /** código ISO o 'auto' */
  language: string;
  translate: boolean;
  size: WhisperSize;
  /** forzar CPU */
  cpuOnly: boolean;
  maxChars: number;
  maxLines: number;
  maxDur: number;
  karaoke: boolean;
  presetId: string;
}

export const DEFAULT_AUTO: AutoOptions = {
  scope: 'project',
  language: 'auto',
  translate: false,
  size: 'base',
  cpuOnly: false,
  maxChars: 42,
  maxLines: 2,
  maxDur: 6,
  karaoke: false,
  presetId: 's-clasico',
};

export const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

/** Opciones de diseño del subtítulo con límites sensatos (lo escrito en los campos puede ser cualquier cosa). */
export function layoutOf(o: Pick<AutoOptions, 'maxChars' | 'maxLines' | 'maxDur'>): Required<Pick<SubtitleLayout, 'maxChars' | 'maxLines' | 'maxDur'>> {
  return { maxChars: Math.round(clamp(o.maxChars, 12, 80)), maxLines: Math.round(clamp(o.maxLines, 1, 4)), maxDur: clamp(o.maxDur, 1, 12) };
}

/** Idioma y tarea para el motor. Al traducir se deja el idioma hablado (si se conoce) para orientar a Whisper. */
export function engineLanguage(o: Pick<AutoOptions, 'language' | 'translate'>): { language: string | null; translate: boolean } {
  return { language: o.language === 'auto' || !o.language ? null : o.language, translate: o.translate };
}

export const TRANSLATE_WARNING = 'Al traducir a inglés, los tiempos por palabra son menos fiables: el karaoke puede ir algo desfasado.';

export function karaokeWarning(o: Pick<AutoOptions, 'translate' | 'karaoke'>): string | null {
  return o.translate && o.karaoke ? TRANSLATE_WARNING : null;
}

// ---------------- modelos ----------------

export interface ModelChoice {
  size: WhisperSize;
  bytes: number;
  /** nota de recomendación */
  recommended: boolean;
  /** se puede elegir en este equipo */
  allowed: boolean;
}

/** Los tres modelos con su tamaño EXACTO en el dispositivo elegido, el recomendado y los que el equipo no soporta bien. */
export function modelChoices(info: DeviceInfo, device: AsrDevice): ModelChoice[] {
  const s = suggestModel(info);
  return (Object.keys(WHISPER_MODELS) as WhisperSize[]).map((size) => ({ size, bytes: modelBytes(size, device), recommended: size === s.suggested, allowed: s.allowed.includes(size) }));
}

/** Frase de consentimiento: tamaño exacto y de dónde viene. */
export function consentText(bytes: number): string {
  return `Descargar ${formatBytes(bytes)} desde huggingface.co. El audio nunca sale de tu equipo.`;
}

const SMALLER: Record<WhisperSize, WhisperSize | null> = { small: 'base', base: 'tiny', tiny: null };
export const smallerModel = (s: WhisperSize) => SMALLER[s];

// ---------------- progreso ----------------

const STAGE_TEXT: Record<string, string> = {
  audio: 'Preparando el audio',
  load: 'Cargando el modelo',
  language: 'Detectando el idioma',
  asr: 'Transcribiendo',
};
export const stageText = (stage: string) => STAGE_TEXT[stage] ?? 'Trabajando';

/** Tiempo restante estimado (s) a partir del avance global y el tiempo transcurrido; null si aún no es fiable. */
export function etaSeconds(overall: number, elapsedMs: number): number | null {
  if (!(overall > 0.04) || overall >= 1 || elapsedMs < 1500) return null;
  return Math.max(0, (elapsedMs / 1000) * ((1 - overall) / overall));
}

export function progressText(stage: string, overall: number, elapsedMs: number, windows?: { done: number; total: number }): string {
  const pct = Math.round(clamp(overall, 0, 1) * 100);
  const eta = etaSeconds(overall, elapsedMs);
  const win = windows && windows.total > 1 ? ` (ventana ${Math.min(windows.done + 1, windows.total)} de ${windows.total})` : '';
  return `${stageText(stage)}${win} · ${pct} %${eta !== null ? ` · quedan unos ${formatClock(Math.ceil(eta / 5) * 5)}` : ''}`;
}

/** Progreso de la etapa «asr» → ventana en curso (la etapa se reparte a partes iguales entre ventanas). */
export function windowOf(ratio: number, total: number): { done: number; total: number } {
  return { done: Math.min(total, Math.floor(clamp(ratio, 0, 1) * total)), total };
}

/** Aviso de velocidad: solo con CPU (WASM), con una cifra medida (V5a: ×0,2–0,4 el tiempo real en CPU de escritorio). */
export function speedWarning(device: AsrDevice, audioSeconds: number): string | null {
  if (device !== 'wasm') return null;
  const lo = Math.max(1, Math.round(audioSeconds * 0.25));
  const hi = Math.max(lo + 1, Math.round(audioSeconds * 1.5));
  return `Sin GPU la transcripción va por CPU: para ${formatClock(audioSeconds)} de audio puede tardar entre ${formatClock(lo)} y ${formatClock(hi)}. Puedes cancelar cuando quieras.`;
}

// ---------------- errores ----------------

export interface ErrorInfo {
  kind: 'cancelled' | 'missing-model' | 'no-audio' | 'webgpu' | 'memory' | 'consent' | 'integrity' | 'network' | 'other';
  title: string;
  hint?: string;
  /** modelo menor que se puede probar */
  trySize?: WhisperSize;
  /** probar en CPU */
  tryCpu?: boolean;
}

/** Cualquier fallo del motor/descarga → texto que entiende una persona y, si hay, la salida (modelo menor, CPU). */
export function describeError(err: unknown, ctx: { size: WhisperSize; device: AsrDevice }): ErrorInfo {
  const e = err as { name?: string; message?: string; code?: string } | null;
  const name = e?.name ?? '';
  const msg = (e?.message ?? String(err ?? '')).toString();
  const low = msg.toLowerCase();
  if (name === 'AbortError' || low === 'cancelado') return { kind: 'cancelled', title: 'Cancelado. No se ha cambiado nada en el proyecto.' };
  if (name === 'MissingModelError' || e?.code === 'missing-model') return { kind: 'missing-model', title: `El modelo «${ctx.size}» no está descargado en este equipo.`, hint: 'Descárgalo (con tu permiso) y vuelve a empezar.' };
  if (name === 'ConsentError') return { kind: 'consent', title: 'La descarga necesita tu permiso.', hint: 'Acepta el tamaño indicado para descargar el modelo.' };
  if (name === 'IntegrityError') return { kind: 'integrity', title: msg, hint: 'Vuelve a descargar el modelo.' };
  if (name === 'DownloadError' || /failed to fetch|networkerror|network error|load failed/.test(low)) return { kind: 'network', title: 'No se pudo descargar el modelo: revisa tu conexión.', hint: 'Lo ya descargado se conserva y se reanuda desde donde se quedó.' };
  if (/vacío|vacio|sin clips|no tiene clips/.test(low)) return { kind: 'no-audio', title: 'No hay audio que transcribir en ese alcance.', hint: 'Elige otro alcance o un rango con voz.' };
  if (/webgpu|\bgpu\b|adapter|wgsl/.test(low)) return { kind: 'webgpu', title: 'La GPU (WebGPU) no está disponible o falló en este equipo.', hint: 'Prueba con «Solo CPU»: es más lento, pero funciona en cualquier equipo.', tryCpu: true };
  if (e instanceof RangeError || /out of memory|memory|alloc|bad_alloc|oom/.test(low)) {
    const s = SMALLER[ctx.size];
    return { kind: 'memory', title: 'Se acabó la memoria del equipo.', hint: s ? `Prueba con el modelo «${s}», que necesita menos, o con un alcance más corto.` : 'Prueba con un alcance más corto (un clip o un rango).', trySize: s ?? undefined };
  }
  return { kind: 'other', title: 'No se pudo transcribir: ' + (msg || 'error desconocido'), hint: 'Prueba con otro modelo o con un alcance más corto.' };
}

/** Aviso cuando no salió ni una palabra. */
export const NO_SPEECH = { kind: 'no-audio', title: 'No se detectó voz en ese tramo.', hint: 'Elige otro alcance, otro idioma o un tramo donde se oiga hablar.' } satisfies ErrorInfo;

// ---------------- aplicar al proyecto ----------------

export const DEFAULT_KARAOKE: Karaoke = { color: '#ffd84d', scale: 1.15, keep: false };

export type ApplyMode = 'replace' | 'add';

export interface ApplyResult {
  p: VM.VideoProject;
  trackId: string;
  ids: string[];
  overlapsFixed: number;
}

/**
 * Pone los subtítulos en el proyecto (una sola función pura = un solo `commit` = un paso de deshacer).
 * `replace` sustituye lo de la pista indicada (o de la primera de subtítulos; si no hay, crea una);
 * `add` crea una pista nueva. El estilo del preajuste se aplica a la pista; el karaoke exige tiempos por palabra.
 */
export function applySubtitles(
  p: VM.VideoProject,
  cues: Cue[],
  o: { mode: ApplyMode; trackId?: string; karaoke: boolean; presetId: string; trackName?: string; ids?: { track?: string } },
): ApplyResult {
  const kept = cues.map((c) => (o.karaoke ? c : { start: c.start, end: c.end, text: c.text }));
  let base: { p: VM.VideoProject; id: string };
  const existing = o.mode === 'replace' ? (S.subtitleTracks(p).find((t) => t.id === o.trackId && !t.locked) ?? S.subtitleTracks(p).find((t) => !t.locked)) : undefined;
  if (existing) base = { p, id: existing.id };
  else base = S.newSubtitleTrack(p, { id: o.ids?.track, name: o.trackName });
  const r = S.replaceCues(base.p, base.id, kept);
  let out = r.p;
  const pr = SUBTITLE_PRESETS.find((x) => x.id === o.presetId);
  if (pr) {
    const kar = o.karaoke ? (pr.style.karaoke ?? DEFAULT_KARAOKE) : undefined;
    out = S.setSubtitleStyle(out, base.id, { ...pr.style, karaoke: kar });
  } else if (o.karaoke) out = S.setSubtitleStyle(out, base.id, { karaoke: DEFAULT_KARAOKE });
  else out = S.setSubtitleStyle(out, base.id, { karaoke: undefined });
  return { p: out, trackId: base.id, ids: r.ids, overlapsFixed: r.overlapsFixed };
}

/** ¿Hay palabras con tiempo para el karaoke? */
export const hasWordTimes = (segs: AsrSegment[]) => segs.some((s) => s.words.length > 0);
export const countWords = (segs: AsrSegment[]) => segs.reduce((n, s) => n + s.words.length, 0);
