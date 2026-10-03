// Lectura de un archivo (Blob/File) por ventanas: nunca se carga entero en
// memoria. Blob.slice() es perezoso; solo se leen los bytes de la ventana.

export class BlobReader {
  private winStart = 0;
  private win: Uint8Array = new Uint8Array(0);
  readonly size: number;
  bytesRead = 0;

  constructor(private blob: Blob, private windowSize = 4 << 20) {
    this.size = blob.size;
  }

  /** Lee [offset, offset+length). Devuelve una vista: cópiala si la guardas. */
  async read(offset: number, length: number): Promise<Uint8Array> {
    const end = Math.min(this.size, offset + length);
    if (offset < 0 || offset >= end) return new Uint8Array(0);
    if (offset >= this.winStart && end <= this.winStart + this.win.length)
      return this.win.subarray(offset - this.winStart, end - this.winStart);
    const want = end - offset;
    const len = want > this.windowSize ? want : Math.min(this.windowSize, this.size - offset);
    const buf = new Uint8Array(await this.blob.slice(offset, offset + len).arrayBuffer());
    this.bytesRead += buf.length;
    if (want > this.windowSize) return buf; // lectura grande y suelta: no se guarda
    this.win = buf;
    this.winStart = offset;
    return this.win.subarray(0, want);
  }
}
