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
  // Quitar fondo
  'Resultado del recorte': 'Cutout result',
  'Ver original': 'View original',
  'Bordes': 'Edges',
  'Automático': 'Automatic',
  'Foto (suave)': 'Photo (soft)',
  'Logo / texto (nítido)': 'Logo / text (sharp)',
  'Sin refinar': 'Unrefined',
  'Retocar con pincel': 'Touch up with brush',
  'Usar recorte': 'Use cutout',
  'JPG no admite transparencia; usa PNG o WebP.':
    'JPG has no transparency; use PNG or WebP.',
  // Actualizador
  'Nueva versión disponible': 'New version available',
  'Dale una estrella en GitHub': 'Star us on GitHub',
  'Invítame un café': 'Buy me a coffee',
  'Sobre el autor': 'About the author',
  'Actualizar ahora': 'Update now',
  'Más tarde': 'Later',
  'Buscar actualizaciones': 'Check for updates',
  'Estás en la última versión': "You're on the latest version",
  'Descargando actualización': 'Downloading update',
  // Tamaños personalizados
  'Guardar tamaño': 'Save size',
  'Mis tamaños': 'My sizes',
  // Pincel
  'Dureza': 'Hardness',
  'Pincel / máscara': 'Brush / mask',
  'Atajos de teclado': 'Keyboard shortcuts',
  'Editor de imágenes': 'Image editor',
  // v0.4: grupos, marcos, texto, kit de marca, inicio por propósito
  'Agrupar': 'Group',
  'Desagrupar': 'Ungroup',
  'Borrar selección': 'Delete selection',
  'Selección y grupo': 'Selection & group',
  'Marcos para fotos': 'Photo frames',
  'Poner una foto en el marco': 'Put a photo in the frame',
  'Marco': 'Frame',
  'Forma': 'Shape',
  'Gráficas y tablas': 'Charts & tables',
  'Gráfica': 'Chart',
  'Tabla': 'Table',
  'Editar gráfica': 'Edit chart',
  'Editar tabla': 'Edit table',
  'Logos': 'Logos',
  'Subir logo': 'Upload logo',
  'Colores de marca': 'Brand colors',
  'Añadir color': 'Add color',
  'Fuentes de marca': 'Brand fonts',
  'Añadir fuente de marca': 'Add brand font',
  'Editar foto': 'Edit photo',
  'Ajustes de luz y color': 'Light & color',
  'Desenfocar fondo (retrato)': 'Blur background (portrait)',
  'Espaciado, mayúsculas y listas': 'Spacing, case & lists',
  'Efectos de texto': 'Text effects',
  'Editar sobre el diseño': 'Edit on the design',
  'Posición, giro y transparencia': 'Position, rotation & opacity',
  'Animación': 'Animation',
  'Sombra': 'Shadow',
  'Más': 'More',
  'Editor de video': 'Video editor',
  'Previsualizar animaciones': 'Preview animations',
  'Modo presentación': 'Presentation mode',
  'Usar sin internet': 'Use offline',
  'Editar': 'Edit',
  '¿Qué vas a crear hoy?': 'What will you create today?',
  'Redes sociales': 'Social media',
  'Impresión': 'Print',
  'Trabajo': 'Work',
  'Tamaño personalizado': 'Custom size',
  'Crear': 'Create',
  'Seguir con el último diseño': 'Continue last design',
  'Nuevo': 'New',
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
