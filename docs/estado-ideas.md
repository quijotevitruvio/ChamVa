# Estado de las 240 ideas (v0.5.0)

De `docs/ideas.md`: qué está hecho, qué quedó parcial y qué sigue pendiente. «Hecha» significa
implementada, con pruebas de la lógica y comprobada en pantalla en lo posible; los límites de cada
una están en el campo **Notas**.

**Resumen:** 125 hechas · 13 parciales · el resto (las 37 grandes, las 30 de IA, video y algunas
de las que exigen binarios o permisos nativos) pendiente para una próxima ronda.

## Pendiente por decisión (no es descuido)

- **Rama 7, IA local (30):** necesita descargar modelos nuevos con licencia permisiva y probarlos
  con datos reales. Se hace aparte, con auditoría de licencias.
- **Rama 5, video y audio (30):** la exportación con ffmpeg.wasm no se puede probar aquí sin riesgo
  de romper el editor que ya funciona. Se hace con pruebas de exportación reales.
- **Las 37 de esfuerzo L** (pincel de clonar, selección por lazo, máscaras de capa, componentes,
  auto-layout, booleanas, editor de nodos, importar SVG/PDF, PPTX…).
- Idea que exige binarios o permisos nativos: paquete de fuentes ampliado (2.3), biblioteca de
  sonidos (5.25), abrir `.chamva` con doble clic (8.9) y compartir desde Android (8.29), HEIC/TIFF
  (6.29), perfil de color de salida (6.24) y compartir por QR en red local (6.20).

## Rama 1 · Edición de imagen

| Idea | Estado | Notas |
|---|---|---|
| 1.1 Curvas de tono | Hecha | Spline monótona, RGB + canales. |
| 1.2 Niveles con histograma | Hecha | |
| 1.3 Mezclador HSL | Hecha | 8 familias de color. |
| 1.4 Corregir perspectiva | Hecha | Editor de 4 esquinas. |
| 1.5 Enderezar horizonte | Hecha | |
| 1.11 Comparador antes/después | Hecha | Solo en pantalla. |
| 1.13 Reducir ruido | Hecha | Puede tardar en fotos grandes. |
| 1.14 Quitar ojos rojos | Hecha | Zonas en coordenadas del resultado. |
| 1.15 Suavizar piel | Hecha | Detección por tono de piel, sin IA. |
| 1.17 Tilt-shift | Hecha | |
| 1.18 Desenfoque de movimiento, radial y zoom | Hecha | |
| 1.19 Aberración cromática y glitch | Hecha | Glitch determinista por semilla. |
| 1.20 Halftone | Hecha | |
| 1.21 Lápiz y cómic | Hecha | |
| 1.22 Distorsión de lente | Hecha | |
| 1.23 Quitar neblina | Hecha | Con fuerza alta puede haber algo de halo. |
| 1.24 Doble exposición | Hecha | La imagen elegida se guarda reducida dentro del ajuste. |
| 1.25 Censurar zona | Hecha | |
| 1.26 Reflejo en suelo | Hecha | Solo imágenes. |
| 1.27 Sombra proyectada | Parcial | Desenfoque uniforme, no crece con la distancia. |
| 1.28 Mockups en perspectiva | Hecha | 4 marcos dibujados por código. |
| 1.30 Texturas y superposiciones | Hecha | Procedurales, sin imágenes. |

## Rama 2 · Texto y tipografía

| Idea | Estado | Notas |
|---|---|---|
| 2.1 Buscador de fuentes · 2.2 Favoritas y recientes | Hecha | |
| 2.6 Kerning por pares | Hecha | |
| 2.7 Texto sobre trazado | Hecha | Editor de 4 puntos; usa la primera línea. |
| 2.9 Columnas · 2.10 Autoajuste · 2.11 Sangría · 2.12 Capitular | Hecha | Texto curvo ignora caja, columnas y capitular. |
| 2.13 Sup/sub/fracciones · 2.14 Tabulaciones · 2.15 Mayúsculas | Hecha | |
| 2.16 Relleno con imagen · 2.17 Extrusión · 2.18 Contornos · 2.19 Tinta | Hecha | En SVG salen rasterizados. |
| 2.20 Resaltador | Parcial | Se aplica a todo el texto, no por rango. |
| 2.22 Buscar y reemplazar | Parcial | En otras páginas no se puede deshacer. |
| 2.23 Texto de relleno · 2.24 Contador | Hecha | |
| 2.27 Selector de símbolos | Parcial | Sin probar en el editor sobre el diseño. |
| 2.28 Sustitución de fuente faltante · 2.30 Campos dinámicos | Hecha | |

## Rama 3 · Diseño, lienzo y organización

| Idea | Estado | Notas |
|---|---|---|
| 3.2 Estilos compartidos · 3.3 Carpetas de capas · 3.30 Búsqueda de capas | Hecha | Las carpetas no cambian el orden de dibujo. |
| 3.4 Página maestra · 3.25 Clasificador de páginas · 3.6 Restricciones | Hecha | |
| 3.8 Márgenes y sangrado · 3.9 Columnas · 3.15 Patrones | Hecha | Márgenes y sangrado solo en el editor. |
| 3.17 Notas del orador · 3.26 Notas adhesivas | Hecha | Las adhesivas no se exportan. |
| 3.19 Seleccionar similares · 3.20 Pegar solo el formato | Hecha | Ctrl+Alt+V. |
| 3.22 Varios formatos a la vez · 3.23 Carpetas y etiquetas · 3.24 Buscar plantillas | Hecha | |
| 3.27 Instantáneas con nombre · 3.29 Papelera de diseños | Hecha | |

## Rama 4 · Color, degradados y marca

| Idea | Estado | Notas |
|---|---|---|
| 4.1 Contraste · 4.2 Daltonismo · 4.3 Paletas por palabra · 4.15 Nombres · 4.25 Escala tonal | Hecha | |
| 4.5 Cónico · 4.6 Contornos con degradado · 4.28 Grano · 4.10 Recolorear · 4.29 Claro/oscuro | Hecha | En SVG el cónico y el grano son PNG. |
| 4.7 Prediseñados · 4.8 Guardados · 4.16/4.17 Importar y exportar paletas · 4.27 Recientes | Hecha | |
| 4.9 Sin bandas | Parcial | Solo lienzo e imagen, no SVG ni texto. |
| 4.11 Tema de paleta de una plantilla | Parcial | Se ofrece en «Recolorear», no al aplicar la plantilla. |
| 4.12 Mapa de degradado · 4.24 Resplandor | Hecha | |
| 4.18 Hoja de marca · 4.20 Varios kits · 4.21 Variantes · 4.22 Zona de respeto · 4.23 Recolorear SVG · 4.30 Combinaciones | Hecha | |

## Rama 6 · Exportación

| Idea | Estado | Notas |
|---|---|---|
| 6.1 Selección · 6.2 ZIP de páginas · 6.3 Varios tamaños · 6.5 Ajustes guardados · 6.6 Peso objetivo · 6.22 Capas · 6.26 Nombre | Hecha | |
| 6.16 Marca de agua | Parcial | No se aplica a PDF. |
| 6.17 Metadatos | Parcial | Solo PNG y JPG. |
| 6.4 Slices · 6.7 Sangrado y cortes · 6.9 Varias por hoja · 6.12 Sprites · 6.13 Iconos · 6.14 Favicon · 6.19 Pliegos | Hecha | Slices: cuadrícula N×M con líneas arrastrables. |
| 6.8 PDF con marcadores | Parcial | Marcadores sí; enlaces no (las capas no tienen enlace). |
| 6.11 Presentación HTML · 6.15 Lote · 6.18 Compartir · 6.21 Proyecto portátil · 6.25 Cola · 6.27 Carpeta · 6.28 CSS · 6.30 Informe | Hecha | La carpeta recordada es solo de la app instalada. |
| 6.23 APNG / WebP animado | Parcial | Sin Lottie; reproducción sin comprobar en todos los visores. |

## Rama 8 · Experiencia de uso

| Idea | Estado | Notas |
|---|---|---|
| 8.1 Atajos · 8.2 Tooltips · 8.7 Concentración · 8.11 Alto contraste · 8.13 Tamaño · 8.14 Idiomas · 8.27 «Todo local» · 8.28 Informe de error | Hecha | |
| 8.3 Gestos · 8.4 Lápiz · 8.6 Minimapa · 8.24 Dos dedos · 8.25 Barra contextual · 8.26 Zurdo | Hecha | Sin probar con dedos ni lápiz reales. |
| 8.5 Modo tablet · 8.17 Memoria · 8.18 Vista ligera al arrastrar | Parcial | Sin medir en dispositivos reales. |
| 8.10 Pegar desde fuera · 8.16 Miniaturas · 8.19 Cancelar · 8.20 PWA · 8.30 Arranque rápido | Hecha | La PWA solo en la web; en la app instalada no se registra. |
| 8.21 Copia completa · 8.22 Versiones automáticas · 8.23 Deshacer que sobrevive | Hecha | |
