// Internacionalización mínima (es/en) sin dependencias.
// Español es el idioma fuente; el diccionario traduce las cadenas del "chrome"
// principal de la UI. t() devuelve la cadena en el idioma activo.
import { useSyncExternalStore } from 'react';

export type Lang = 'es' | 'en';

const LS_KEY = 'chamva.lang';

let current: Lang = (() => {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved === 'es' || saved === 'en') return saved;
    return navigator.language?.startsWith('en') ? 'en' : 'es';
  } catch {
    return 'es';
  }
})();

const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(l: Lang) {
  current = l;
  try {
    localStorage.setItem(LS_KEY, l);
  } catch {
    /* noop */
  }
  listeners.forEach((fn) => fn());
}

// Hook: re-renderiza el componente cuando cambia el idioma.
export function useLang(): Lang {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}

// Diccionario: clave = texto en español (fuente), valor = traducción al inglés.
// Las cadenas sin entrada se muestran en español tal cual.
const EN: Record<string, string> = {
  // Toolbar
  'Archivo': 'File',
  'Abrir proyecto': 'Open project',
  'Guardar proyecto': 'Save project',
  'Deshacer': 'Undo',
  'Rehacer': 'Redo',
  'Quitar fondo': 'Remove background',
  'Preparar offline': 'Prepare offline',
  'Animar': 'Animate',
  'Presentar': 'Present',
  'Video': 'Video',
  'Descargar': 'Download',
  'Ajustes': 'Settings',
  'Descargando': 'Downloading',
  // Menú de descarga
  'Formato': 'Format',
  'Tamaño': 'Size',
  'Calidad': 'Quality',
  'Páginas': 'Pages',
  'Esta página': 'This page',
  'Todas': 'All',
  'Copiar al portapapeles': 'Copy to clipboard',
  'Copiado al portapapeles': 'Copied to clipboard',
  // Riel
  'Subir': 'Upload',
  'Texto': 'Text',
  'Elementos': 'Elements',
  'Fondo': 'Background',
  'Plantillas': 'Templates',
  'Capas': 'Layers',
  'Marca': 'Brand',
  'Subir imagen': 'Upload image',
  'Subir fuente': 'Upload font',
  'Caja de texto': 'Text box',
  'Buscar iconos': 'Search icons',
  'Código QR': 'QR code',
  'Guardar diseño actual': 'Save current design',
  'Prediseñadas': 'Presets',
  'Mis plantillas': 'My templates',
  'Exportar plantillas': 'Export templates',
  'Importar plantillas': 'Import templates',
  'Kit de Marca': 'Brand Kit',
  'Mis colores': 'My colors',
  'Recientes': 'Recent',
  'Aún no hay capas.': 'No layers yet.',
  // Propiedades
  'Propiedades': 'Properties',
  'Opacidad': 'Opacity',
  'Rotación': 'Rotation',
  'Girar 90°': 'Rotate 90°',
  'Mezcla': 'Blend',
  'Entrada': 'In',
  'Salida': 'Out',
  'Duración': 'Duration',
  'Subir capa': 'Bring forward',
  'Bajar capa': 'Send backward',
  'Bloquear': 'Lock',
  'Desbloquear': 'Unlock',
  'Duplicar': 'Duplicate',
  'Borrar capa': 'Delete layer',
  'Recortar': 'Crop',
  'Voltear H': 'Flip H',
  'Voltear V': 'Flip V',
  // Menú contextual
  'Traer al frente': 'Bring to front',
  'Enviar atrás': 'Send to back',
  'Ocultar': 'Hide',
  'Mostrar': 'Show',
  'Borrar': 'Delete',
  'Editar texto': 'Edit text',
  'Pegar': 'Paste',
  // Páginas
  'Agregar página': 'Add page',
  'Duplicar página': 'Duplicate page',
  'Alejar': 'Zoom out',
  'Acercar': 'Zoom in',
  'Ajustar': 'Fit',
  // Inicio
  '¿Qué quieres editar hoy?': 'What do you want to edit today?',
  'Editar imágenes': 'Edit images',
  'Editar video': 'Edit video',
  'Diseños, fotos, texto, formas, quitar fondo…':
    'Designs, photos, text, shapes, background removal…',
  'Recortar, audio, efectos de voz, exportar MP4…':
    'Trim, audio, voice effects, export MP4…',
  'Diseños recientes': 'Recent designs',
  'Nuevo diseño': 'New design',
  'Ajustes y licencia': 'Settings & license',
  // Ajustes
  'Aplicación': 'Application',
  'versión': 'version',
  'Autor': 'Author',
  'Idioma': 'Language',
  'Licencia': 'License',
  'Apoya el proyecto': 'Support the project',
  'Copias de seguridad': 'Backups',
  'Restaurar': 'Restore',
  'Modelos de IA sin internet': 'Offline AI models',
  'Descargar todos los modelos': 'Download all models',
  // Video
  'Volver al diseño': 'Back to design',
  'Editor de video': 'Video editor',
  'Grabar': 'Record',
  'Detener': 'Stop',
  'Reproducir todo': 'Play all',
  'Dividir aquí': 'Split here',
  'Exportando': 'Exporting',
  'Cancelar': 'Cancel',
};

export function t(es: string): string {
  if (current === 'es') return es;
  return EN[es] ?? es;
}
