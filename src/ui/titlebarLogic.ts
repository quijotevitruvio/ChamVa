/**
 * Franja superior propia (ventana sin decoraciones nativas, Windows).
 * Valores y decisiones puras: el CSS (`--titlebar-h`, `--z-titlebar`) y la prueba de
 * `titlebarLogic.test.ts` se mantienen alineados con estas constantes.
 */

/** Alto de la franja (px) en escritorio. Debe coincidir con `html.custom-titlebar` en App.css. */
export const TITLEBAR_H = 38;
/** Alto de la franja (px) con ventana estrecha (≤ 768 px). */
export const TITLEBAR_H_NARROW = 36;
export const TITLEBAR_NARROW_MAX = 768;

/**
 * Escala de z-index (documentada también en App.css):
 *   0–99     contenido del editor, paneles y barras flotantes
 *   100–999  pantallas completas, diálogos y menús (Modal 140, inicio 120, video 90…)
 *   1000–3000 paletas, buscadores y editores modales
 *   9000     píldora de foco
 *   99000    FRANJA DE LA VENTANA (− ▢ ✕ y arrastre): por encima de todo lo anterior
 *   100000   tooltip propio (única capa por encima de la franja, para que sus botones lo muestren)
 */
export const Z_TITLEBAR = 99000;
export const Z_TOOLTIP = 100000;

export function titlebarHeightFor(viewportWidth: number): number {
  return viewportWidth <= TITLEBAR_NARROW_MAX ? TITLEBAR_H_NARROW : TITLEBAR_H;
}

/** Los botones − ▢ ✕ se pintan solo en una ventana de Tauri sin decoraciones nativas. */
export function shouldShowWindowControls(inTauri: boolean, decorated: boolean | null): boolean {
  return inTauri && decorated === false;
}
