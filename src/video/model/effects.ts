// Filtros de voz / limpieza / efectos de un clip (los del menú «Voz»). Los usan
// la vista previa (Web Audio) y el motor de exportación (dsp.ts), así que viven
// en el modelo y no en la interfaz.
import type { ClipAudioFx } from '../engine/dsp';

export interface VoiceEffect {
  id: string;
  label: string;
  hp: number;
  lp: number;
  echo: number;
  /** activa una compuerta de ruido (silencia por debajo de un umbral) */
  gate?: boolean;
}

export const EFFECTS: VoiceEffect[] = [
  { id: 'none', label: 'Ninguno', hp: 20, lp: 20000, echo: 0 },
  { id: 'clean', label: 'Limpiar voz', hp: 120, lp: 7000, echo: 0 },
  { id: 'denoise', label: 'Reducir ruido', hp: 100, lp: 9000, echo: 0, gate: true },
  { id: 'phone', label: 'Teléfono / Radio', hp: 500, lp: 3000, echo: 0 },
  { id: 'deep', label: 'Voz grave', hp: 20, lp: 1200, echo: 0 },
  { id: 'bright', label: 'Voz nítida', hp: 200, lp: 20000, echo: 0 },
  { id: 'echo', label: 'Eco', hp: 20, lp: 20000, echo: 0.4 },
];

/** Efecto por id; un id desconocido cuenta como «Ninguno» (igual que V1). */
export function effectById(id: string | undefined): VoiceEffect {
  return EFFECTS.find((e) => e.id === id) ?? EFFECTS[0];
}

/** Parámetros de audio de un clip: el efecto (o los valores a medida de `voice`) + el volumen. */
export function clipAudioFx(c: { effect: string; volume: number; voice?: Omit<ClipAudioFx, 'volume'> }): ClipAudioFx {
  const v = c.voice ?? effectById(c.effect);
  return { volume: c.volume, hp: v.hp, lp: v.lp, echo: v.echo, gate: !!v.gate };
}
