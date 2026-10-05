// Iconos SVG de línea, modernos y consistentes (estilo Lucide, MIT).
// Usan currentColor, así que heredan el color del texto del botón.
import type { ReactElement } from 'react';

export type IconName =
  | 'upload'
  | 'text'
  | 'shapes'
  | 'palette'
  | 'templates'
  | 'layers'
  | 'star'
  | 'brush'
  | 'image'
  | 'video'
  | 'download'
  | 'undo'
  | 'redo'
  | 'crop'
  | 'copy'
  | 'trash'
  | 'lock'
  | 'unlock'
  | 'plus'
  | 'pointer'
  | 'hand'
  | 'zoom'
  | 'shapeRect'
  | 'shapeEllipse'
  | 'shapeLine'
  | 'eraser'
  | 'razor';

const PATHS: Record<IconName, ReactElement> = {
  upload: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v12" />
    </>
  ),
  text: (
    <>
      <path d="M4 7V4h16v3" />
      <path d="M9 20h6" />
      <path d="M12 4v16" />
    </>
  ),
  shapes: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <circle cx="17" cy="17" r="4" />
      <path d="M14 3h7v7" />
    </>
  ),
  palette: (
    <>
      <path d="M12 22a10 10 0 1 1 0-20 9 9 0 0 1 9 9 4 4 0 0 1-4 4h-2a2 2 0 0 0-1.6 3.2 1.8 1.8 0 0 1-1.4 2.8Z" />
      <circle cx="7.5" cy="10.5" r="1" />
      <circle cx="9.5" cy="6.5" r="1" />
      <circle cx="14.5" cy="6.5" r="1" />
      <circle cx="16.5" cy="10.5" r="1" />
    </>
  ),
  templates: (
    <>
      <rect x="3" y="3" width="18" height="4" rx="1" />
      <rect x="3" y="10" width="8" height="11" rx="1" />
      <rect x="15" y="10" width="6" height="11" rx="1" />
    </>
  ),
  layers: (
    <>
      <path d="M12.8 2.2a2 2 0 0 0-1.6 0L2.6 6.1a1 1 0 0 0 0 1.8l8.6 3.9a2 2 0 0 0 1.6 0l8.6-3.9a1 1 0 0 0 0-1.8Z" />
      <path d="M2 12.5l9.2 4.2a2 2 0 0 0 1.6 0L22 12.5" />
      <path d="M2 17l9.2 4.2a2 2 0 0 0 1.6 0L22 17" />
    </>
  ),
  star: (
    <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.1l1-5.8L3.5 9.2l5.9-.9Z" />
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="M21 15l-5-5L5 21" />
    </>
  ),
  video: (
    <>
      <path d="M22 8l-6 4 6 4V8z" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </>
  ),
  undo: <path d="M9 7H5v4 M5 7a9 9 0 1 1-2 5.7" />,
  redo: <path d="M15 7h4v4 M19 7a9 9 0 1 0 2 5.7" />,
  crop: (
    <>
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  unlock: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8-1" />
    </>
  ),
  brush: (
    <>
      <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
      <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
    </>
  ),
  plus: <path d="M12 5v14 M5 12h14" />,
  pointer: <path d="M4 3l7 17 2.5-7.5L21 10z" />,
  hand: (
    <>
      <path d="M18 11V6a2 2 0 0 0-4 0v1" />
      <path d="M14 10V4a2 2 0 0 0-4 0v2" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.4L3.4 16a2 2 0 0 1 3-2.7L8 15" />
    </>
  ),
  zoom: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
      <path d="M11 8v6 M8 11h6" />
    </>
  ),
  shapeRect: <rect x="4" y="5" width="16" height="14" rx="1.5" />,
  shapeEllipse: <ellipse cx="12" cy="12" rx="9" ry="7" />,
  shapeLine: <path d="M5 19L19 5" />,
  eraser: (
    <>
      <path d="M20 20H9l-5.3-5.3a1.5 1.5 0 0 1 0-2.1l8.9-8.9a1.5 1.5 0 0 1 2.1 0l5.3 5.3a1.5 1.5 0 0 1 0 2.1L12 20" />
      <path d="M8 8l8 8" />
    </>
  ),
  razor: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4L8.1 15.9 M14.5 14.5L20 20 M8.1 8.1L12 12" />
    </>
  ),
};

export function Icon({
  name,
  size = 22,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
