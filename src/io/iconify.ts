// Búsqueda de iconos en Iconify (API abierta y gratuita, sin clave).
const API = 'https://api.iconify.design';

export async function searchIcons(query: string, limit = 60): Promise<string[]> {
  try {
    const r = await fetch(
      `${API}/search?query=${encodeURIComponent(query)}&limit=${limit}`,
    );
    const j = await r.json();
    return (j.icons as string[]) ?? [];
  } catch {
    return [];
  }
}

// URL de previsualización de un icono (uso directo en <img>).
export function iconPreviewUrl(name: string, size = 48): string {
  const [prefix, icon] = name.split(':');
  return `${API}/${prefix}/${icon}.svg?height=${size}`;
}

// Descarga el icono como SVG y lo devuelve listo para añadir como capa de imagen.
export async function fetchIconAsImage(
  name: string,
  size = 300,
  color = '#000000',
): Promise<{ src: string; naturalWidth: number; naturalHeight: number; name: string }> {
  const [prefix, icon] = name.split(':');
  const url = `${API}/${prefix}/${icon}.svg?height=${size}&color=${encodeURIComponent(color)}`;
  const svg = await (await fetch(url)).text();
  const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        src,
        naturalWidth: img.naturalWidth || size,
        naturalHeight: img.naturalHeight || size,
        name: icon,
      });
    img.onerror = () =>
      resolve({ src, naturalWidth: size, naturalHeight: size, name: icon });
    img.src = src;
  });
}
