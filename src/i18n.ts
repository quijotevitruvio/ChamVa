// Internacionalización mínima (es/en) sin dependencias.
// Español es el idioma fuente; el diccionario traduce las cadenas del "chrome"
// principal de la UI. t() devuelve la cadena en el idioma activo.
import { useSyncExternalStore } from 'react';

// 'es' y 'en' vienen de fábrica; cualquier otro código es un idioma importado
// por el usuario desde un JSON (ver importLangPack).
export type Lang = string;

const LS_KEY = 'chamva.lang';
const PACKS_KEY = 'chamva.langPacks';

export type LangPack = Record<string, string>;

function loadPacks(): Record<string, LangPack> {
  try {
    const v = JSON.parse(localStorage.getItem(PACKS_KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
let packs: Record<string, LangPack> = loadPacks();

let current: Lang = (() => {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved === 'es' || saved === 'en' || (saved && packs[saved])) return saved;
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
  'Reglas': 'Rulers',
  'Vista': 'View',
  'Buscar': 'Search',
  'Guardar como plantilla': 'Save as template',
  'Tema': 'Theme',
  'Sistema': 'System',
  'Claro': 'Light',
  'Oscuro': 'Dark',
  'Cuadrícula': 'Grid',
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
  'Instalar ChamVa': 'Install ChamVa',
  'Editar': 'Edit',
  '¿Qué vas a crear hoy?': 'What will you create today?',
  'Redes sociales': 'Social media',
  'Impresión': 'Print',
  'Trabajo': 'Work',
  'Tamaño personalizado': 'Custom size',
  'Tamaños de papel': 'Paper sizes',
  'Tamaños de papel…': 'Paper sizes…',
  'Papel': 'Paper',
  'Pantalla y redes': 'Screen and social',
  'Cambiar a vertical': 'Switch to portrait',
  'Cambiar a horizontal': 'Switch to landscape',
  'Ancho': 'Width',
  'Alto': 'Height',
  'Unidad': 'Unit',
  'Resolución': 'Resolution',
  'Mantener la proporción': 'Keep proportions',
  'Crear': 'Create',
  'Seguir con el último diseño': 'Continue last design',
  'Editar una foto': 'Edit a photo',
  'Sin elegir medidas: el lienzo mide lo mismo que la foto': 'No size to pick: the canvas matches the photo',
  'Suelta la foto para editarla': 'Drop the photo to edit it',
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
  // Interfaz y accesibilidad
  'Modo concentración': 'Focus mode',
  'Salir': 'Exit',
  'Alto contraste': 'High contrast',
  'Tamaño de la interfaz': 'Interface size',
  'Vista previa': 'Preview',
  'Atajos': 'Shortcuts',
  'Cambiar': 'Change',
  'Sin atajo': 'None',
  'Pulsa la combinación…': 'Press the combination…',
  'ya lo usa': 'already used by',
  'Teclas fijas': 'Fixed keys',
  'Restablecer todos los atajos': 'Reset all shortcuts',
  'Puedes cambiar estos atajos en Ajustes → Atajos.': 'You can change these shortcuts in Settings → Shortcuts.',
  'Exportar idioma actual (JSON)': 'Export current language (JSON)',
  'Importar idioma': 'Import language',
  'Idioma importado': 'Language imported',
  'Quitar este idioma': 'Remove this language',
  'Todo local': 'All local',
  'Procesado en tu dispositivo': 'Processed on your device',
  'sin conexión': 'offline',
  'Descargando modelo…': 'Downloading model…',
  'Algo salió mal': 'Something went wrong',
  'Copiar informe del error': 'Copy error report',
  'Informe copiado': 'Report copied',
  'Abrir incidencia en GitHub': 'Open GitHub issue',
  'El informe no incluye tu diseño ni datos personales.': 'The report does not include your design or personal data.',
  'Tu diseño nunca sale de este dispositivo. Solo se usa internet para descargar modelos de IA, iconos y actualizaciones, y solo cuando tú lo pides.':
    'Your design never leaves this device. The internet is only used to download AI models, icons and updates, and only when you ask.',
  // Herramientas de texto
  'Buscar fuente': 'Find font',
  'Fuentes': 'Fonts',
  'Cerrar': 'Close',
  'Buscar fuente…': 'Search fonts…',
  '★ Favoritas': '★ Favorites',
  'Mía': 'Mine',
  'Mis fuentes': 'My fonts',
  'Manuscrita': 'Handwriting',
  'Monoespaciada': 'Monospace',
  'Ninguna fuente coincide.': 'No matching fonts.',
  'Aún no has usado ninguna fuente.': "You haven't used any font yet.",
  'Marca fuentes con la estrella para verlas aquí.': 'Star fonts to see them here.',
  'Quitar de favoritas': 'Remove from favorites',
  'Añadir a favoritas': 'Add to favorites',
  '↑ ↓ para moverte · Intro para elegir · Esc para cerrar': '↑ ↓ to move · Enter to pick · Esc to close',
  'Buscar y elegir fuente': 'Find and pick a font',
  'Falta la fuente': 'Missing font',
  'Se usa una genérica: puedes sustituirla desde el panel de texto.': 'A generic one is used: replace it from the text panel.',
  'Fuente sustituida por': 'Font replaced by',
  'La fuente': 'The font',
  'no está disponible; se dibuja con una genérica.': 'is not available; a generic one is drawn instead.',
  'Sustituir por': 'Replace with',
  'Sustituir por…': 'Replace with…',
  'Usa una fuente parecida': 'Uses a similar font',
  'Buscar y reemplazar': 'Find and replace',
  'Buscar…': 'Find…',
  'Reemplazar por…': 'Replace with…',
  'Mayúsculas': 'Match case',
  'Palabra completa': 'Whole word',
  'Todas las páginas': 'All pages',
  'Escribe lo que buscas.': 'Type what to find.',
  'de': 'of',
  'Sin resultados': 'No results',
  'Anterior': 'Previous',
  'Siguiente': 'Next',
  'Reemplazar': 'Replace',
  'Reemplazar todo': 'Replace all',
  'reemplazo': 'replacement',
  'reemplazos': 'replacements',
  'en otras páginas no se puede deshacer': "can't be undone on other pages",
  'Insertar símbolo': 'Insert symbol',
  'Flechas': 'Arrows',
  'Matemáticos': 'Math',
  'Monedas': 'Currency',
  'Viñetas': 'Bullets',
  'Estrellas': 'Stars',
  'Marcas': 'Marks',
  'Texto de ejemplo': 'Sample text',
  'Texto de ejemplo…': 'Sample text…',
  '1 párrafo': '1 paragraph',
  '3 párrafos': '3 paragraphs',
  'Lista': 'List',
  'Capa de ejemplo': 'Sample layer',
  'Crear una capa nueva con texto de ejemplo': 'Create a new layer with sample text',
  'palabras': 'words',
  'caracteres': 'characters',
  'lectura': 'reading',
  'Sans serif': 'Sans serif',
  // Biblioteca de diseños, plantillas, formatos e instantáneas
  'Todos': 'All',
  'Carpeta': 'Folder',
  'Crear carpeta': 'Create folder',
  'Papelera': 'Trash',
  'Nombre de la carpeta': 'Folder name',
  'Renombrar carpeta': 'Rename folder',
  'Borrar carpeta': 'Delete folder',
  'Vaciar papelera': 'Empty trash',
  'Sí, borrar': 'Yes, delete',
  'Sí, vaciar': 'Yes, empty',
  'No': 'No',
  'Guardar': 'Save',
  'Buscar diseños…': 'Search designs…',
  'La papelera está vacía.': 'The trash is empty.',
  'Ningún diseño coincide.': 'No design matches.',
  'Aún no hay diseños guardados.': 'No saved designs yet.',
  'Borrar para siempre': 'Delete forever',
  'Carpeta y etiquetas': 'Folder and tags',
  'Quitar de recientes (va a la papelera)': 'Remove from recent (goes to trash)',
  'Sin carpeta': 'No folder',
  'Carpeta nueva': 'New folder',
  '(opcional)': '(optional)',
  'Etiquetas': 'Tags',
  'Buscar plantillas…': 'Search templates…',
  'Color dominante': 'Dominant color',
  'Limpiar': 'Clear',
  'Ninguna coincide.': 'None match.',
  'Redimensionar a varios formatos…': 'Resize to several formats…',
  'Redimensionar a varios formatos': 'Resize to several formats',
  'Marcar todos': 'Select all',
  'Ninguno': 'None',
  'tamaño actual': 'current size',
  'copias': 'copies',
  'Versiones…': 'Versions…',
  'Versiones del diseño': 'Design versions',
  'Guardar versión': 'Save version',
  'Versión guardada': 'Version saved',
  'Versión restaurada': 'Version restored',
  'Aún no hay versiones de este diseño.': 'No versions of this design yet.',
  'página(s)': 'page(s)',
};

export function t(es: string): string {
  if (current === 'es') return es;
  if (current === 'en') return EN[es] ?? es;
  return packs[current]?.[es] ?? es;
}

// ---- idiomas por archivo JSON ----

/** Idiomas disponibles: los de fábrica y los importados. */
export function listLangs(): { code: string; name: string; custom: boolean }[] {
  return [
    { code: 'es', name: 'Español', custom: false },
    { code: 'en', name: 'English', custom: false },
    ...Object.entries(packs).map(([code, p]) => ({ code, name: p.__nombre || code, custom: true })),
  ];
}

/** Diccionario del idioma activo como JSON: clave = texto en español. */
export function exportLangJson(lang: Lang = current): string {
  let dict: LangPack;
  if (lang === 'en') dict = { __nombre: 'English', ...EN };
  else if (lang !== 'es' && packs[lang]) dict = { ...packs[lang] };
  else dict = { __nombre: 'Mi idioma' };
  // En español (o paquetes vacíos) se ofrece la plantilla: clave → mismo texto.
  if (lang === 'es') for (const k of Object.keys(EN)) dict[k] = k;
  return JSON.stringify(dict, null, 2);
}

export function slugLang(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return 'x-' + (s || 'idioma');
}

/** Valida un JSON clave→texto; devuelve el paquete o el motivo del fallo. */
export function parseLangPack(text: string): { ok: true; code: string; pack: LangPack } | { ok: false; error: string } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, error: 'El archivo no es un JSON válido.' };
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'Se esperaba un objeto clave → texto.' };
  const pack: LangPack = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') pack[k] = val;
  }
  if (Object.keys(pack).filter((k) => k !== '__nombre').length === 0) return { ok: false, error: 'No hay traducciones en el archivo.' };
  pack.__nombre = (pack.__nombre || 'Importado').trim().slice(0, 40) || 'Importado';
  let code = slugLang(pack.__nombre);
  if (code === 'x-english' || code === 'x-espanol') code += '-2';
  return { ok: true, code, pack };
}

/** Guarda el idioma importado y lo activa. Devuelve su código. */
export function importLangPack(text: string): { ok: true; code: string; name: string } | { ok: false; error: string } {
  const r = parseLangPack(text);
  if (!r.ok) return r;
  packs = { ...packs, [r.code]: r.pack };
  try {
    localStorage.setItem(PACKS_KEY, JSON.stringify(packs));
  } catch {
    /* sin almacenamiento: vale para esta sesión */
  }
  setLang(r.code);
  return { ok: true, code: r.code, name: r.pack.__nombre };
}

export function removeLangPack(code: string) {
  if (!packs[code]) return;
  const { [code]: _drop, ...rest } = packs;
  packs = rest;
  try {
    localStorage.setItem(PACKS_KEY, JSON.stringify(packs));
  } catch {
    /* noop */
  }
  if (current === code) setLang('es');
  else listeners.forEach((fn) => fn());
}
