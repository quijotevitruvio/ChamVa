// Muro de donantes. Andrés edita esta lista para agregar a quienes apoyan.
// Se muestra dentro de la app (Ajustes → Muro de donantes) para todos.
// Quien active su licencia también se ve a sí mismo automáticamente (local).

export type DonorType = 'natural' | 'institucion' | 'empresa';

export interface Donor {
  name: string;
  type: DonorType;
  date?: string; // AAAA-MM (opcional)
}

export const DONOR_TYPE_LABEL: Record<DonorType, string> = {
  natural: 'Persona',
  institucion: 'Institución',
  empresa: 'Empresa',
};

// 👇 Agrega aquí a cada donante (nombre, tipo y opcionalmente fecha).
export const DONORS: Donor[] = [
  // Ejemplo (borra o reemplaza):
  // { name: 'María Pérez', type: 'natural', date: '2026-06' },
];
