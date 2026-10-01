import type { Layer } from './types';

// Capa cuyo formato se pegará con «Pegar solo el formato» (Ctrl+Alt+V).
// Se rellena con Ctrl+C o con «Copiar formato» del menú contextual.
let styleSource: Layer | null = null;

export const setStyleSource = (l: Layer | null) => {
  styleSource = l;
};
export const getStyleSource = () => styleSource;
