// Caché de fotogramas cercanos para el scrubbing: guarda copias reducidas (ImageBitmap) de
// fotogramas ya vistos, agrupadas por medio y ordenadas por tiempo de origen. Al arrastrar el
// cabezal se muestra al instante el más cercano y después se refina con el exacto. LRU por
// peso (bytes aproximados) y `onEvict` para liberar (ImageBitmap.close()).
export interface CachedEntry<V> {
  t: number;
  value: V;
  /** distancia en segundos al instante pedido */
  dist: number;
}

interface Slot<V> {
  group: string;
  t: number;
  value: V;
  weight: number;
  tick: number;
}

export class NearestCache<V> {
  private slots = new Map<string, Slot<V>>();
  private byGroup = new Map<string, number[]>(); // tiempos ordenados por grupo
  private weight = 0;
  private tick = 0;

  constructor(
    private maxWeight: number,
    private onEvict: (v: V) => void = () => {},
    /** resolución de tiempo (s): dos tiempos dentro del mismo cubo son el mismo fotograma */
    private quantum = 1 / 120,
  ) {}

  get size() {
    return this.slots.size;
  }
  get totalWeight() {
    return this.weight;
  }
  private key(group: string, t: number) {
    return `${group}@${Math.round(t / this.quantum)}`;
  }

  has(group: string, t: number): boolean {
    return this.slots.has(this.key(group, t));
  }

  put(group: string, t: number, value: V, weight = 1) {
    const k = this.key(group, t);
    const old = this.slots.get(k);
    if (old) {
      this.weight -= old.weight;
      if (old.value !== value) this.onEvict(old.value);
      old.value = value;
      old.weight = weight;
      old.tick = ++this.tick;
      this.weight += weight;
    } else {
      const arr = this.byGroup.get(group) ?? [];
      const i = lowerBound(arr, t);
      arr.splice(i, 0, t);
      this.byGroup.set(group, arr);
      this.slots.set(k, { group, t, value, weight, tick: ++this.tick });
      this.weight += weight;
    }
    while (this.weight > this.maxWeight && this.slots.size > 1) this.evictOldest(k);
  }

  /** El fotograma guardado más cercano a t dentro de la tolerancia (o null). */
  nearest(group: string, t: number, tol = Infinity): CachedEntry<V> | null {
    const arr = this.byGroup.get(group);
    if (!arr?.length) return null;
    const i = lowerBound(arr, t);
    let best: number | null = null;
    for (const c of [arr[i - 1], arr[i]]) if (c !== undefined && (best === null || Math.abs(c - t) < Math.abs(best - t))) best = c;
    if (best === null || Math.abs(best - t) > tol) return null;
    const s = this.slots.get(this.key(group, best));
    if (!s) return null;
    s.tick = ++this.tick;
    return { t: s.t, value: s.value, dist: Math.abs(s.t - t) };
  }

  private evictOldest(except: string) {
    let oldK: string | null = null;
    let old = Infinity;
    for (const [k, s] of this.slots)
      if (k !== except && s.tick < old) {
        old = s.tick;
        oldK = k;
      }
    if (oldK) this.remove(oldK);
  }

  private remove(k: string) {
    const s = this.slots.get(k);
    if (!s) return;
    this.slots.delete(k);
    this.weight -= s.weight;
    const arr = this.byGroup.get(s.group);
    if (arr) {
      const i = arr.indexOf(s.t);
      if (i >= 0) arr.splice(i, 1);
      if (!arr.length) this.byGroup.delete(s.group);
    }
    this.onEvict(s.value);
  }

  /** Olvida un grupo (un medio que ya no está en el proyecto). */
  dropGroup(group: string) {
    for (const [k, s] of [...this.slots]) if (s.group === group) this.remove(k);
  }
  groups(): string[] {
    return [...this.byGroup.keys()];
  }

  clear() {
    for (const s of this.slots.values()) this.onEvict(s.value);
    this.slots.clear();
    this.byGroup.clear();
    this.weight = 0;
  }
}

function lowerBound(a: number[], x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] < x) lo = m + 1;
    else hi = m;
  }
  return lo;
}
