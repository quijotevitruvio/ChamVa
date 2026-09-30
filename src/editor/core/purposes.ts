// "¿Qué vas a crear?": tamaños por caso de uso (como el inicio de Canva).
// Los tamaños de impresión están a 300 ppp.
export interface DesignPurpose {
  id: string;
  label: string;
  hint: string; // medida legible
  icon: string;
  width: number;
  height: number;
  group: 'Redes sociales' | 'Impresión' | 'Trabajo';
}

export const PURPOSES: DesignPurpose[] = [
  { id: 'ig-post', label: 'Post de Instagram', hint: '1080 × 1080', icon: '📷', width: 1080, height: 1080, group: 'Redes sociales' },
  { id: 'ig-story', label: 'Historia / Reel', hint: '1080 × 1920', icon: '📱', width: 1080, height: 1920, group: 'Redes sociales' },
  { id: 'ig-portrait', label: 'Post vertical', hint: '1080 × 1350', icon: '🖼', width: 1080, height: 1350, group: 'Redes sociales' },
  { id: 'fb-post', label: 'Post de Facebook', hint: '1200 × 630', icon: '👍', width: 1200, height: 630, group: 'Redes sociales' },
  { id: 'fb-cover', label: 'Portada de Facebook', hint: '1640 × 624', icon: '🏞', width: 1640, height: 624, group: 'Redes sociales' },
  { id: 'yt-thumb', label: 'Miniatura de YouTube', hint: '1280 × 720', icon: '▶', width: 1280, height: 720, group: 'Redes sociales' },
  { id: 'li-post', label: 'Post de LinkedIn', hint: '1200 × 627', icon: '💼', width: 1200, height: 627, group: 'Redes sociales' },
  { id: 'wa-status', label: 'Estado de WhatsApp', hint: '1080 × 1920', icon: '💬', width: 1080, height: 1920, group: 'Redes sociales' },
  { id: 'flyer', label: 'Volante (A5)', hint: '14,8 × 21 cm', icon: '📄', width: 1748, height: 2480, group: 'Impresión' },
  { id: 'poster', label: 'Póster (A4)', hint: '21 × 29,7 cm', icon: '🪧', width: 2480, height: 3508, group: 'Impresión' },
  { id: 'card', label: 'Tarjeta de presentación', hint: '9 × 5 cm', icon: '🪪', width: 1063, height: 591, group: 'Impresión' },
  { id: 'invite', label: 'Invitación', hint: '5 × 7 pulgadas', icon: '💌', width: 1500, height: 2100, group: 'Impresión' },
  { id: 'certificate', label: 'Certificado / diploma', hint: 'A4 horizontal', icon: '🏅', width: 3508, height: 2480, group: 'Impresión' },
  { id: 'menu', label: 'Menú', hint: 'Carta, vertical', icon: '🍽', width: 2550, height: 3300, group: 'Impresión' },
  { id: 'slides', label: 'Presentación', hint: '1920 × 1080', icon: '🖥', width: 1920, height: 1080, group: 'Trabajo' },
  { id: 'cv', label: 'Hoja de vida', hint: 'A4', icon: '📋', width: 2480, height: 3508, group: 'Trabajo' },
  { id: 'logo', label: 'Logo', hint: '1000 × 1000', icon: '✳', width: 1000, height: 1000, group: 'Trabajo' },
  { id: 'banner', label: 'Banner web', hint: '1920 × 600', icon: '🌐', width: 1920, height: 600, group: 'Trabajo' },
];
