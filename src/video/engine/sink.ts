// Destinos de escritura del archivo exportado, por trozos y con escrituras
// posicionales (el multiplexor vuelve atrás a corregir cabeceras al terminar):
//
// - Tauri (Windows/macOS/Linux/Android): archivo abierto con plugin-fs, seek+write.
// - Navegador con File System Access (Chromium): showSaveFilePicker + createWritable
//   (escribe a un archivo temporal en disco, no en RAM).
// - Resto: Blob por partes. Cada trozo se convierte en Blob en cuanto se completa
//   (el navegador puede llevarlos a disco) y nunca se junta todo en un ArrayBuffer.

export interface ByteSink {
  readonly kind: 'tauri' | 'fs-access' | 'blob';
  /** Encola una escritura de `data` en `position`. */
  write(data: Uint8Array, position: number): void;
  /** Bytes encolados aún sin escribir (para contrapresión). */
  readonly pending: number;
  /** Espera a que se vacíe la cola. */
  drain(): Promise<void>;
  /** Cierra el archivo. Devuelve el Blob (solo en modo Blob) o null. */
  close(): Promise<Blob | null>;
  /** Descarta lo escrito (cancelación o error). */
  abort(): Promise<void>;
  /** Ruta guardada (Tauri) para «Abrir carpeta». */
  readonly path?: string;
  readonly bytesWritten: number;
}

/** Cola de escrituras asíncronas en orden, con error pegajoso. */
class WriteQueue {
  private chain: Promise<void> = Promise.resolve();
  pending = 0;
  error: unknown = null;
  push(n: number, fn: () => Promise<void>) {
    this.pending += n;
    this.chain = this.chain.then(async () => {
      if (this.error) return;
      try {
        await fn();
      } catch (e) {
        this.error = e;
      } finally {
        this.pending -= n;
      }
    });
  }
  async drain() {
    await this.chain;
    if (this.error) throw this.error;
  }
}

// ---------- Blob por partes ----------

type Part = { start: number; data: Uint8Array | Blob };
const partSize = (p: Part) => (p.data instanceof Blob ? p.data.size : p.data.byteLength);

export class BlobPartsSink implements ByteSink {
  readonly kind = 'blob' as const;
  private parts: Part[] = [];
  private size = 0;
  private loose = 0; // bytes en Uint8Array aún no convertidos en Blob
  bytesWritten = 0;
  pending = 0;

  constructor(private mime: string, private sealEvery = 4 << 20) {}

  write(data: Uint8Array, position: number) {
    this.bytesWritten += data.byteLength;
    const end = position + data.byteLength;
    if (position === this.size) {
      this.parts.push({ start: position, data: data.slice() });
      this.size = end;
      this.loose += data.byteLength;
      if (this.loose >= this.sealEvery) this.seal();
      return;
    }
    if (position > this.size) {
      this.parts.push({ start: this.size, data: new Uint8Array(position - this.size) });
      this.size = position;
      this.write(data, position);
      return;
    }
    // Sobrescritura (cabeceras): se recortan las partes afectadas con slice() (perezoso).
    const out: Part[] = [];
    let inserted = false;
    for (const p of this.parts) {
      const ps = p.start;
      const pe = ps + partSize(p);
      if (pe <= position || ps >= end) {
        if (!inserted && ps >= end) {
          out.push({ start: position, data: data.slice() });
          inserted = true;
        }
        out.push(p);
        continue;
      }
      if (ps < position) out.push({ start: ps, data: sliceData(p.data, 0, position - ps) });
      if (!inserted) {
        out.push({ start: position, data: data.slice() });
        inserted = true;
      }
      if (pe > end) out.push({ start: end, data: sliceData(p.data, end - ps, pe - ps) });
    }
    if (!inserted) out.push({ start: position, data: data.slice() });
    this.parts = out;
    this.size = Math.max(this.size, end);
  }

  /** Convierte las partes sueltas en un Blob (la memoria pasa al almacén de Blobs del navegador). */
  private seal() {
    const out: Part[] = [];
    let run: Part[] = [];
    const flush = () => {
      if (run.length > 1) out.push({ start: run[0].start, data: new Blob(run.map((r) => r.data as BlobPart)) });
      else if (run.length === 1) out.push(run[0]);
      run = [];
    };
    for (const p of this.parts) {
      if (p.data instanceof Blob) {
        flush();
        out.push(p);
      } else run.push(p);
    }
    flush();
    this.parts = out;
    this.loose = 0;
  }

  async drain() {}
  async close(): Promise<Blob> {
    return new Blob(
      this.parts.map((p) => p.data as BlobPart),
      { type: this.mime },
    );
  }
  async abort() {
    this.parts = [];
    this.size = 0;
  }
}

function sliceData(d: Uint8Array | Blob, a: number, b: number): Uint8Array | Blob {
  return d instanceof Blob ? d.slice(a, b) : d.slice(a, b);
}

// ---------- File System Access ----------

export class WritableStreamSink implements ByteSink {
  readonly kind = 'fs-access' as const;
  private q = new WriteQueue();
  bytesWritten = 0;
  constructor(private stream: FileSystemWritableFileStream) {}
  get pending() {
    return this.q.pending;
  }
  write(data: Uint8Array, position: number) {
    this.bytesWritten += data.byteLength;
    const copy = data.slice();
    this.q.push(copy.byteLength, () => this.stream.write({ type: 'write', position, data: copy }));
  }
  drain() {
    return this.q.drain();
  }
  async close() {
    await this.q.drain();
    await this.stream.close();
    return null;
  }
  async abort() {
    try {
      await this.stream.abort();
    } catch {
      /* noop */
    }
  }
}

// ---------- Tauri (plugin-fs) ----------

interface TauriFile {
  write(data: Uint8Array): Promise<number>;
  seek(offset: number, whence: number): Promise<number>;
  close(): Promise<void>;
}

export class TauriFileSink implements ByteSink {
  readonly kind = 'tauri' as const;
  private q = new WriteQueue();
  private cursor = 0;
  bytesWritten = 0;
  constructor(
    private file: TauriFile,
    readonly path: string,
    private remove: () => Promise<void>,
    private seekStart: number,
  ) {}
  get pending() {
    return this.q.pending;
  }
  write(data: Uint8Array, position: number) {
    this.bytesWritten += data.byteLength;
    const copy = data.slice();
    this.q.push(copy.byteLength, async () => {
      if (position !== this.cursor) await this.file.seek(position, this.seekStart);
      let off = 0;
      while (off < copy.byteLength) off += await this.file.write(copy.subarray(off));
      this.cursor = position + copy.byteLength;
    });
  }
  drain() {
    return this.q.drain();
  }
  async close() {
    await this.q.drain();
    await this.file.close();
    return null;
  }
  async abort() {
    try {
      await this.file.close();
    } catch {
      /* noop */
    }
    await this.remove().catch(() => {});
  }
}

// ---------- Elegir destino ----------

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const isMobile = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent);

export interface OpenSinkOptions {
  filename: string;
  mime: string;
  /** Forzar Blob en memoria (banco de pruebas). */
  memory?: boolean;
}

/**
 * Pide dónde guardar y abre el destino. Llamarlo directamente desde el clic del
 * usuario (el selector de archivos del navegador exige un gesto reciente).
 * Devuelve null si el usuario cancela.
 */
export async function openSink(o: OpenSinkOptions): Promise<ByteSink | null> {
  if (o.memory) return new BlobPartsSink(o.mime);
  if (isTauri()) return openTauriSink(o);
  const w = window as Window & {
    showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>;
  };
  if (typeof w.showSaveFilePicker === 'function') {
    const ext = o.filename.split('.').pop() ?? '';
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: o.filename,
        types: [{ description: ext.toUpperCase(), accept: { [o.mime]: ['.' + ext] } }],
      });
      return new WritableStreamSink(await handle.createWritable());
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return null;
      // Sin permiso o sin gesto del usuario: se cae a Blob por partes.
      console.warn('[video] File System Access no disponible, se usa Blob por partes', e);
    }
  }
  return new BlobPartsSink(o.mime);
}

async function openTauriSink(o: OpenSinkOptions): Promise<ByteSink | null> {
  const fs = await import('@tauri-apps/plugin-fs');
  const nativeSave = await import('../../io/nativeSave');
  if (isMobile()) {
    await fs.mkdir('ChamVa', { baseDir: fs.BaseDirectory.Download, recursive: true }).catch(() => {});
    const rel = `ChamVa/${o.filename}`;
    const file = await fs.open(rel, { write: true, create: true, truncate: true, baseDir: fs.BaseDirectory.Download });
    return new TauriFileSink(file, `Descargas/${rel}`, () => fs.remove(rel, { baseDir: fs.BaseDirectory.Download }), fs.SeekMode.Start);
  }
  const { save } = await import('@tauri-apps/plugin-dialog');
  const ext = o.filename.split('.').pop() ?? '';
  const path = await save({
    defaultPath: nativeSave.joinPath(nativeSave.getLastDir(), o.filename),
    filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined,
  });
  if (!path) return null;
  const file = await fs.open(path, { write: true, create: true, truncate: true });
  return new TauriFileSink(file, path, () => fs.remove(path), fs.SeekMode.Start);
}
