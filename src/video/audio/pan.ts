// Panorámica con ley de potencia constante. pan ∈ [−1 (izquierda), 1 (derecha)]; en el centro la
// ganancia es 1 en cada canal (sin saltos de nivel al empezar a panoramizar) y gL² + gR² = 2 siempre:
// la potencia total no cambia al mover el control. Con una fuente estéreo actúa como balance.

export function panGains(pan: number): [number, number] {
  const p = Math.max(-1, Math.min(1, Number.isFinite(pan) ? pan : 0));
  const th = ((p + 1) * Math.PI) / 4; // 0 .. π/2
  return [Math.SQRT2 * Math.cos(th), Math.SQRT2 * Math.sin(th)];
}

/** Aplica la panorámica en el sitio. pan = 0 no toca nada. */
export function applyPan(L: Float32Array, R: Float32Array, pan: number, n = L.length) {
  if (!pan) return;
  const [gl, gr] = panGains(pan);
  for (let i = 0; i < n; i++) {
    L[i] *= gl;
    R[i] *= gr;
  }
}
