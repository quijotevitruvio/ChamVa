// Errores legibles de la importación HEIC/HEIF (lógica pura, sin DOM).

export type HeicErrorCode =
  | 'no-decoder' // ni el navegador/SO ni WebCodecs pueden decodificar este códec aquí
  | 'unsupported' // estructura o códec que ChamVa no lee (overlay, JPEG en HEIF, VVC…)
  | 'corrupt' // contenedor dañado o incompleto
  | 'decode-failed' // el decodificador del sistema rechazó los datos
  | 'too-large'
  | 'aborted';

export class HeicError extends Error {
  readonly code: HeicErrorCode;
  readonly detail: string;
  constructor(code: HeicErrorCode, detail = '') {
    super(heicErrorReason(code, detail));
    this.name = 'HeicError';
    this.code = code;
    this.detail = detail;
  }
}

/** Guía corta para convertir la foto fuera de ChamVa (sin subir nada a internet). */
export const HEIC_CONVERT_TIP =
  'Ábrela en la app Fotos de Windows y usa «Guardar como» JPG (en Mac: Vista Previa › Exportar › JPEG; en iPhone: Ajustes › Cámara › Formatos › «Más compatible»)';

export function heicErrorReason(code: HeicErrorCode, detail = ''): string {
  switch (code) {
    case 'no-decoder':
      return `Este equipo no trae un decodificador HEIC que ChamVa pueda usar. ${HEIC_CONVERT_TIP}`;
    case 'unsupported':
      return `Esta foto HEIF usa un formato interno que ChamVa no lee${detail ? ` (${detail})` : ''}. ${HEIC_CONVERT_TIP}`;
    case 'corrupt':
      return `El archivo HEIC está dañado o incompleto${detail ? ` (${detail})` : ''}`;
    case 'decode-failed':
      return `El decodificador del sistema no pudo leer la foto HEIC${detail ? ` (${detail})` : ''}. ${HEIC_CONVERT_TIP}`;
    case 'too-large':
      return `La foto HEIC es demasiado grande para abrirla${detail ? ` (${detail})` : ''}`;
    case 'aborted':
      return 'Importación cancelada';
  }
}

export function isHeicError(e: unknown): e is HeicError {
  return !!e && typeof e === 'object' && (e as { name?: string }).name === 'HeicError' && 'code' in (e as object);
}
