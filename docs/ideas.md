# ChamVa: 240 ideas nuevas

Cómo leerlo: son 8 ramas con 30 ideas cada una, todas **nuevas** (no están en el README ni en la cola actual: paleta Ctrl+K, historial, recorrido, panel corto, estilos de texto, texto con degradado, guías arrastrables, cuentagotas/armonías, colores de la foto, vista previa de exportación). Cada línea lleva esfuerzo **S** (horas o un par de días), **M** (una o dos semanas) o **L** (semanas, con riesgo técnico) e impacto bajo/medio/alto para el usuario. Todo funciona offline y sin cuentas; lo que necesitaría servidor está marcado «requiere servidor». Al final de cada rama van las 3 que haría primero. Las ideas de una rama no se repiten en otra: si algo toca dos ramas, vive en la que más lo necesita.

| Rama | Nº ideas | Las 3 primeras |
|---|---|---|
| 1. Edición de imagen y fotos | 30 | Curvas de tono; Máscaras de capa no destructivas; Pincel de clonar y curar |
| 2. Texto y tipografía | 30 | Buscador de fuentes con vista previa; Texto autoajustable al cuadro; Relleno de texto con imagen |
| 3. Diseño, lienzo y organización | 30 | Página maestra; Componentes reutilizables; Combinar datos desde CSV |
| 4. Color, degradados y marca | 30 | Comprobador de contraste; Recolorear todo el diseño; Tokens de marca |
| 5. Video y audio | 30 | Subtítulos con editor y SRT; Transiciones entre clips; Keyframes de propiedades |
| 6. Exportación, formatos y compartir | 30 | Exportar páginas y selección en lote; Marca de agua en la exportación; Optimizar a un peso objetivo |
| 7. Inteligencia artificial local | 30 | Transcripción con Whisper local; Quitar objeto con inpaint IA; OCR a texto editable |
| 8. Experiencia, rendimiento, accesibilidad y móvil | 30 | Atajos personalizables; Pegar y arrastrar desde fuera; Renderizado por zonas para diseños grandes |

## 1. Edición de imagen y fotos

1. **Curvas de tono** — curva editable por RGB y por canal (rojo, verde, azul) con puntos arrastrables. (esfuerzo: M) (impacto: alto)
2. **Niveles con histograma** — histograma en vivo con tres tiradores (negros, medios, blancos) para corregir contraste a ojo. (esfuerzo: S) (impacto: medio)
3. **Mezclador por color (HSL)** — cambia tono, saturación y luminosidad solo de rojos, naranjas, azules, etc. (esfuerzo: M) (impacto: alto)
4. **Corregir perspectiva** — arrastra cuatro esquinas de un documento o fachada y se endereza. (esfuerzo: M) (impacto: alto)
5. **Enderezar horizonte** — traza una línea sobre el horizonte y la foto gira lo justo, recortando los bordes vacíos. (esfuerzo: S) (impacto: medio)
6. **Pincel de clonar y curar** — copia píxeles de una zona a otra y fusiona la textura para borrar granos, cables o motas. (esfuerzo: L) (impacto: alto)
7. **Pintura a mano alzada** — capa de píxeles con pincel, goma y suavizado, para dibujar o retocar. (esfuerzo: L) (impacto: alto)
8. **Selección por lazo y varita** — selecciona por contorno libre o por color similar para aplicar ajustes o borrar solo ahí. (esfuerzo: L) (impacto: alto)
9. **Máscaras de capa no destructivas** — oculta o muestra partes de una imagen con un pincel o degradado sin perder el original. (esfuerzo: L) (impacto: alto)
10. **Ajustes como capas de ajuste** — luz, color o filtros aplicados como capa independiente que se puede apagar, reordenar y enmascarar. (esfuerzo: L) (impacto: alto)
11. **Comparador antes/después deslizante** — barra arrastrable sobre el lienzo para ver la foto original frente a la editada. (esfuerzo: S) (impacto: medio)
12. **Licuar** — empuja, hincha y contrae zonas con un pincel de deformación suave. (esfuerzo: L) (impacto: medio)
13. **Reducir ruido de foto** — suavizado que conserva bordes para fotos nocturnas, con control de luma y color. (esfuerzo: M) (impacto: medio)
14. **Quitar ojos rojos** — clic sobre la pupila y el rojo se neutraliza. (esfuerzo: S) (impacto: bajo)
15. **Suavizar piel** — alisa textura en una zona pintada manteniendo ojos y pelo nítidos. (esfuerzo: M) (impacto: medio)
16. **Iluminar ojos y dientes** — pincel de retoque que aclara y satura solo la zona pintada. (esfuerzo: S) (impacto: bajo)
17. **Efecto tilt-shift** — desenfoque en bandas arriba y abajo que da aspecto de maqueta. (esfuerzo: S) (impacto: medio)
18. **Desenfoque de movimiento, radial y de zoom** — tres desenfoques direccionales con ángulo e intensidad. (esfuerzo: M) (impacto: medio)
19. **Aberración cromática y glitch** — separa canales RGB y desplaza franjas para estética digital. (esfuerzo: S) (impacto: medio)
20. **Trama de medios tonos (halftone)** — convierte la foto en puntos o líneas estilo cómic o serigrafía. (esfuerzo: M) (impacto: medio)
21. **Efecto lápiz y cómic** — bordes y sombreado hachurado que convierten una foto en dibujo. (esfuerzo: M) (impacto: medio)
22. **Corregir distorsión de lente** — barril y cojín con un solo deslizador, útil para gran angular y móviles. (esfuerzo: S) (impacto: bajo)
23. **Quitar neblina (dehaze)** — recupera contraste y color en fotos con bruma o ventanas con reflejo. (esfuerzo: M) (impacto: medio)
24. **Doble exposición** — mezcla dos fotos con modos de fusión y máscara de degradado ya preparada. (esfuerzo: S) (impacto: medio)
25. **Censurar zona** — pinta un rectángulo o pincel y se pixela o desenfoca irreversiblemente (matrículas, datos). (esfuerzo: S) (impacto: medio)
26. **Reflejo en suelo** — copia volteada de la imagen con degradado de desvanecimiento. (esfuerzo: S) (impacto: bajo)
27. **Sombra proyectada en perspectiva** — sombra del objeto recortado que se tumba sobre el suelo con ángulo y desenfoque creciente. (esfuerzo: M) (impacto: medio)
28. **Mockups en perspectiva** — arrastra una captura sobre una pantalla de móvil o portátil y se deforma a las cuatro esquinas. (esfuerzo: M) (impacto: alto)
29. **Rotar libre con esquinas inteligentes** — gira cualquier ángulo y rellena o recorta las esquinas automáticamente. (esfuerzo: S) (impacto: bajo)
30. **Texturas y superposiciones** — polvo, luz de fuga y papel arrugado incluidos como capas fusionables. (esfuerzo: S) (impacto: medio)

**Las 3 primeras que haría**
- Curvas de tono: es la herramienta que más echa en falta quien viene de otros editores y es una sola pantalla.
- Máscaras de capa no destructivas: desbloquea el resto de retoques sin miedo a perder el original.
- Pincel de clonar y curar: es lo que la gente hace con más frecuencia al limpiar una foto y hoy no se puede.

## 2. Texto y tipografía

1. **Buscador de fuentes con vista previa** — lista con la muestra real, filtros (serif, mono, manuscrita, display) y búsqueda por nombre. (esfuerzo: M) (impacto: alto)
2. **Fuentes favoritas y recientes** — estrella para fijar fuentes y sección de las últimas usadas arriba del selector. (esfuerzo: S) (impacto: medio)
3. **Paquete de fuentes ampliado offline** — unas 150 familias libres empaquetadas y descargables bajo demanda. (esfuerzo: M) (impacto: alto)
4. **Fuentes variables con ejes** — deslizadores de peso, ancho e inclinación para las fuentes que los admiten. (esfuerzo: M) (impacto: medio)
5. **Funciones OpenType** — ligaduras, versalitas, numerales de tabla y alternativas estilísticas con interruptores. (esfuerzo: M) (impacto: medio)
6. **Kerning por pares** — ajusta a mano el espacio entre dos letras concretas, ideal para titulares y logos. (esfuerzo: M) (impacto: medio)
7. **Texto sobre trazado libre** — el texto sigue cualquier línea o forma dibujada, no solo el arco. (esfuerzo: M) (impacto: medio)
8. **Texto dentro de una forma** — el párrafo se ajusta al contorno de un corazón, círculo o forma propia. (esfuerzo: L) (impacto: bajo)
9. **Columnas de texto** — un cuadro se divide en 2 o 3 columnas con medianil, como en un folleto. (esfuerzo: M) (impacto: medio)
10. **Texto autoajustable al cuadro** — el tamaño de fuente se adapta para que el texto llene el cuadro sin desbordar. (esfuerzo: S) (impacto: alto)
11. **Sangría y espacio entre párrafos** — sangría de primera línea, francesa y separación antes y después. (esfuerzo: S) (impacto: medio)
12. **Capitular** — primera letra grande que ocupa varias líneas. (esfuerzo: S) (impacto: bajo)
13. **Superíndice, subíndice y fracciones** — formato rápido para fórmulas, notas y unidades. (esfuerzo: S) (impacto: bajo)
14. **Tabulaciones con puntos guía** — alinea precios o páginas con puntos hasta el borde, para menús e índices. (esfuerzo: M) (impacto: medio)
15. **Cambiar mayúsculas** — MAYÚSCULAS, minúsculas, Título y frase con un botón. (esfuerzo: S) (impacto: medio)
16. **Relleno de texto con imagen** — la foto se ve solo dentro de las letras gruesas del titular. (esfuerzo: M) (impacto: alto)
17. **Sombra larga y extrusión 3D** — profundidad falsa del texto con ángulo y longitud. (esfuerzo: M) (impacto: medio)
18. **Contornos múltiples** — dos o tres trazos concéntricos de colores distintos alrededor del texto. (esfuerzo: S) (impacto: medio)
19. **Texto con textura de tinta** — desgaste, grano y bordes irregulares para estilo sello o letrero viejo. (esfuerzo: M) (impacto: medio)
20. **Resaltador y subrayado de rotulador** — trazo irregular detrás o bajo palabras seleccionadas. (esfuerzo: S) (impacto: medio)
21. **Corrector ortográfico offline** — subraya errores con diccionario local por idioma (Hunspell en WASM). (esfuerzo: M) (impacto: alto)
22. **Buscar y reemplazar en el documento** — cambia un nombre o fecha en todos los textos de todas las páginas. (esfuerzo: S) (impacto: medio)
23. **Texto de relleno** — lorem ipsum o frases de ejemplo en español en un clic para maquetar. (esfuerzo: S) (impacto: bajo)
24. **Contador y tiempo de lectura** — palabras, caracteres y duración al hablar de un texto o de todo el diseño. (esfuerzo: S) (impacto: bajo)
25. **Texto vertical y escrituras RTL** — vertical, árabe, hebreo y CJK con dirección correcta. (esfuerzo: L) (impacto: medio)
26. **Emoji a color** — insertar emoji como elemento nítido que se escala sin pixelarse. (esfuerzo: M) (impacto: medio)
27. **Selector de símbolos** — panel de caracteres especiales, flechas, monedas y letras acentuadas buscables. (esfuerzo: S) (impacto: bajo)
28. **Sustitución de fuente faltante** — al abrir un proyecto sin la fuente, avisa y propone la más parecida. (esfuerzo: S) (impacto: medio)
29. **Texto a contornos vectoriales** — convierte el texto en formas editables para logos y para que nada cambie al imprimir. (esfuerzo: M) (impacto: medio)
30. **Campos dinámicos** — número de página, total de páginas y fecha de hoy que se actualizan solos. (esfuerzo: M) (impacto: medio)

**Las 3 primeras que haría**
- Buscador de fuentes con vista previa: elegir tipografía es lo primero que hace todo el mundo y hoy es a ciegas.
- Texto autoajustable al cuadro: resuelve de golpe plantillas con textos de longitud variable.
- Relleno de texto con imagen: un efecto muy vistoso y raro de encontrar gratis y offline.

## 3. Diseño, lienzo y organización

1. **Componentes reutilizables** — convierte un grupo en componente; sus copias se actualizan al editar el original. (esfuerzo: L) (impacto: alto)
2. **Estilos de objeto compartidos** — guarda sombra, borde y relleno como estilo con nombre y aplícalo a otros. (esfuerzo: M) (impacto: medio)
3. **Carpetas de capas anidadas** — carpetas plegables en el panel de capas con ocultar y bloquear en bloque. (esfuerzo: M) (impacto: medio)
4. **Página maestra** — fondo, logo y pie definidos una vez y repetidos en todas las páginas. (esfuerzo: M) (impacto: alto)
5. **Autodisposición (auto-layout)** — contenedor que apila elementos con separación fija y crece al añadir más. (esfuerzo: L) (impacto: alto)
6. **Restricciones al redimensionar** — fija un elemento al borde o al centro cuando cambia el tamaño de la página. (esfuerzo: M) (impacto: medio)
7. **Combinar datos desde CSV** — genera una página por fila (credenciales, diplomas, etiquetas) rellenando campos. (esfuerzo: L) (impacto: alto)
8. **Márgenes y sangrado visibles** — línea de margen seguro y de sangrado configurables sobre el lienzo. (esfuerzo: S) (impacto: medio)
9. **Cuadrícula de columnas** — rejilla de 12 columnas con medianil como guía de maquetación. (esfuerzo: S) (impacto: medio)
10. **Operaciones booleanas** — unir, restar, intersectar y excluir formas para crear siluetas nuevas. (esfuerzo: L) (impacto: alto)
11. **Editor de nodos (pluma)** — dibuja y edita curvas Bézier punto por punto. (esfuerzo: L) (impacto: alto)
12. **Conectores entre objetos** — líneas que siguen a las formas cuando se mueven, con flechas. (esfuerzo: M) (impacto: medio)
13. **Biblioteca de diagramas** — formas de flujo, UML y mapas mentales con puntos de anclaje para conectores. (esfuerzo: M) (impacto: medio)
14. **Repetición en patrón** — duplica un objeto en cuadrícula, fila o círculo con separación y rotación. (esfuerzo: M) (impacto: medio)
15. **Patrones de fondo** — rayas, puntos, olas y geométricos con color y escala editables. (esfuerzo: S) (impacto: medio)
16. **Máscara con cualquier forma** — recorta cualquier elemento, no solo fotos, con una forma como máscara. (esfuerzo: M) (impacto: medio)
17. **Notas del orador** — campo de notas por página visible en el modo presentación. (esfuerzo: S) (impacto: medio)
18. **Enlaces en elementos** — asigna una URL o salto de página a un objeto que se conserva en el PDF. (esfuerzo: M) (impacto: medio)
19. **Seleccionar similares** — selecciona todos los objetos con el mismo color, fuente o tamaño. (esfuerzo: S) (impacto: medio)
20. **Pegar solo el formato** — copia el estilo de un objeto y aplícalo a otro con un atajo. (esfuerzo: S) (impacto: medio)
21. **Pizarra infinita** — modo sin bordes de página para lluvias de ideas y mapas. (esfuerzo: L) (impacto: medio)
22. **Redimensionar a varios formatos a la vez** — de un diseño genera post, historia y banner en un paso. (esfuerzo: M) (impacto: alto)
23. **Carpetas y etiquetas de diseños** — organiza la pantalla de inicio por proyectos y etiquetas. (esfuerzo: M) (impacto: medio)
24. **Buscador de plantillas por etiqueta y color** — filtra las plantillas por tema, tamaño y color dominante. (esfuerzo: S) (impacto: medio)
25. **Clasificador de páginas** — vista en cuadrícula de todas las páginas para reordenar y duplicar de un vistazo. (esfuerzo: M) (impacto: medio)
26. **Notas adhesivas internas** — comentarios sobre el lienzo que no se exportan, para uno mismo. (esfuerzo: S) (impacto: bajo)
27. **Instantáneas con nombre** — guarda «versión cliente 1» y compara o vuelve a ella más tarde. (esfuerzo: M) (impacto: alto)
28. **Importar SVG y PDF editables** — abre un SVG o una página PDF como formas y textos manipulables. (esfuerzo: L) (impacto: alto)
29. **Papelera de diseños** — los diseños borrados se quedan 30 días recuperables. (esfuerzo: S) (impacto: medio)
30. **Capas con búsqueda y filtros** — filtra el panel de capas por tipo, nombre o elementos ocultos. (esfuerzo: S) (impacto: bajo)

**Las 3 primeras que haría**
- Página maestra: ahorra repetir el mismo logo y pie en cada página de un documento.
- Componentes reutilizables: es lo que separa un editor de juguete de uno para trabajar en serio.
- Combinar datos desde CSV: una función muy valorada de pago que aquí cuesta poco porque ya hay texto y páginas.

## 4. Color, degradados y marca

1. **Comprobador de contraste** — muestra la relación WCAG entre texto y fondo y sugiere el color más cercano que cumple. (esfuerzo: S) (impacto: alto)
2. **Simulador de daltonismo** — vista previa del diseño como lo ven protanopía, deuteranopía y tritanopía. (esfuerzo: S) (impacto: medio)
3. **Paletas por palabra o ambiente** — escribe «otoño», «tecnológico» o «cálido» y salen paletas armónicas locales. (esfuerzo: M) (impacto: medio)
4. **Degradado de malla** — varios puntos de color con fusión suave, estilo fondos fluidos modernos. (esfuerzo: L) (impacto: alto)
5. **Degradado cónico** — giro de color alrededor de un centro, para diales y fondos tipo holográfico. (esfuerzo: S) (impacto: medio)
6. **Degradado en contornos** — el trazo de formas y texto admite degradado, no solo color plano. (esfuerzo: M) (impacto: medio)
7. **Degradados prediseñados** — colección de 60 degradados cuidados organizados por estilo. (esfuerzo: S) (impacto: medio)
8. **Degradados y colores guardados** — biblioteca propia a la que se añaden y de la que se reutilizan. (esfuerzo: S) (impacto: medio)
9. **Degradados sin bandas** — tramado y suavizado para que los degradados largos no muestren escalones. (esfuerzo: S) (impacto: bajo)
10. **Recolorear todo el diseño** — cambia un color en cada elemento, página y degradado con un solo gesto. (esfuerzo: M) (impacto: alto)
11. **Tema de paleta de una plantilla** — aplica otra paleta y la plantilla se reasigna color por color. (esfuerzo: M) (impacto: alto)
12. **Mapa de degradado en fotos** — sustituye los tonos de la foto por un degradado de varios colores. (esfuerzo: S) (impacto: medio)
13. **Importar LUT .cube** — carga looks de cine o de fotografía en un clic. (esfuerzo: M) (impacto: medio)
14. **Vista previa CMYK** — aproxima cómo cambia el color al pasar a imprenta y avisa de los fuera de gama. (esfuerzo: M) (impacto: medio)
15. **Nombres de color** — cada color muestra su nombre común y el equivalente Pantone aproximado. (esfuerzo: S) (impacto: bajo)
16. **Importar paletas** — lee .gpl, .ase y .txt de Lospec y similares. (esfuerzo: S) (impacto: medio)
17. **Exportar paletas** — a CSS, .gpl, .ase y JSON de tokens. (esfuerzo: S) (impacto: medio)
18. **Hoja de marca automática** — genera una página con logos, colores, fuentes y reglas de uso desde el kit. (esfuerzo: M) (impacto: alto)
19. **Tokens de marca** — colores con rol («primario», «acento») enlazados a los objetos, de modo que cambiar el kit actualiza todo. (esfuerzo: L) (impacto: alto)
20. **Varios kits de marca** — gestiona clientes o proyectos con kits distintos y cámbialos desde un menú. (esfuerzo: M) (impacto: alto)
21. **Variantes de logo automáticas** — versión monocromo, blanca, negra e invertida a partir de un logo. (esfuerzo: M) (impacto: medio)
22. **Zona de respeto del logo** — guía visual del espacio mínimo libre alrededor del logo. (esfuerzo: S) (impacto: bajo)
23. **Recolorear iconos y SVG por paleta** — mapea los colores internos de un SVG a los de tu marca. (esfuerzo: M) (impacto: medio)
24. **Resplandor y sombra de color** — sombra con degradado o tono propio, no solo gris. (esfuerzo: S) (impacto: medio)
25. **Escala tonal de un color** — de un color genera la escala 50 a 900 para fondos, bordes y textos. (esfuerzo: S) (impacto: medio)
26. **Ruleta de color con bloqueo** — genera combinaciones aleatorias y bloquea los colores que te gustan. (esfuerzo: S) (impacto: bajo)
27. **Colores recientes por documento** — historial de los últimos colores usados, separado del kit. (esfuerzo: S) (impacto: bajo)
28. **Fondo con ruido y grano** — textura de grano sobre degradados para un acabado moderno y analógico. (esfuerzo: S) (impacto: medio)
29. **Modo claro/oscuro de una plantilla** — alterna una versión oscura generada a partir de la clara. (esfuerzo: M) (impacto: medio)
30. **Guía de combinación de marca** — avisa si un color del diseño no pertenece al kit o se aleja de él. (esfuerzo: M) (impacto: medio)

**Las 3 primeras que haría**
- Comprobador de contraste: evita textos ilegibles, un fallo frecuente que cuesta casi nada de evitar.
- Recolorear todo el diseño: resuelve el caso «cámbiame el azul por el verde» que hoy lleva diez minutos.
- Tokens de marca: convierte el kit en algo vivo y es la base de las plantillas con tema.

## 5. Video y audio

1. **Editor de subtítulos y SRT** — escribe o pega líneas con tiempos, importa y exporta SRT/VTT y quémalos en el video. (esfuerzo: M) (impacto: alto)
2. **Transiciones entre clips** — disolver, deslizar, empujar y zoom en la unión de dos clips. (esfuerzo: M) (impacto: alto)
3. **Keyframes de propiedades** — anima posición, escala, rotación y opacidad de cualquier capa con fotogramas clave. (esfuerzo: L) (impacto: alto)
4. **Chroma key** — elimina un fondo verde o azul con tolerancia y suavizado. (esfuerzo: M) (impacto: alto)
5. **Estabilizar video** — reduce temblores de cámara en mano con análisis de movimiento. (esfuerzo: L) (impacto: medio)
6. **Marcadores en la línea de tiempo** — banderas con nombre para señalar puntos y saltar entre ellos. (esfuerzo: S) (impacto: medio)
7. **Forma de onda visible** — el audio se dibuja en la línea de tiempo para cortar en el silencio exacto. (esfuerzo: M) (impacto: alto)
8. **Ecualizador de audio** — graves, medios y agudos con curva visual y presets (voz, podcast, radio). (esfuerzo: M) (impacto: medio)
9. **Normalizar volumen (LUFS)** — iguala el volumen de todos los clips al nivel de YouTube o podcast. (esfuerzo: M) (impacto: medio)
10. **Bajar música con la voz (ducking)** — la música baja sola cuando hay voz en otra pista. (esfuerzo: M) (impacto: medio)
11. **Grabar pantalla** — captura de pantalla con audio del sistema directamente a la línea de tiempo. (esfuerzo: M) (impacto: alto)
12. **Grabar voz en off** — micrófono sobre la línea de tiempo mientras se reproduce el video. (esfuerzo: M) (impacto: medio)
13. **Cámara web en burbuja** — graba la webcam y colócala redonda en una esquina de la grabación. (esfuerzo: M) (impacto: medio)
14. **Créditos rodantes** — texto que sube por la pantalla con velocidad configurable. (esfuerzo: S) (impacto: bajo)
15. **Rampa de velocidad** — acelera o frena suavemente dentro de un mismo clip. (esfuerzo: M) (impacto: medio)
16. **Invertir clip** — reproduce hacia atrás con audio opcional. (esfuerzo: S) (impacto: bajo)
17. **Congelar fotograma** — pausa de N segundos sobre un fotograma, con texto encima. (esfuerzo: S) (impacto: medio)
18. **Fotograma a imagen** — guarda el fotograma actual como PNG o llévalo al editor de diseño. (esfuerzo: S) (impacto: medio)
19. **Ken Burns automático** — zoom y paneo suave sobre fotos fijas en una presentación de fotos. (esfuerzo: S) (impacto: alto)
20. **Reencuadre vertical 9:16** — convierte un video horizontal a vertical eligiendo la zona que se conserva. (esfuerzo: M) (impacto: alto)
21. **LUTs y corrección de color de clip** — ajustes de color y looks aplicados por clip o a todo el video. (esfuerzo: M) (impacto: medio)
22. **Efectos de video** — viñeta, VHS, glitch, grano de película y desenfoque aplicables a clips. (esfuerzo: M) (impacto: medio)
23. **Texto animado por letra** — títulos que aparecen letra a letra o palabra a palabra sobre el video. (esfuerzo: M) (impacto: medio)
24. **Proxies de edición** — copias ligeras para editar con fluidez y exportar con el original. (esfuerzo: L) (impacto: medio)
25. **Biblioteca de sonidos libre** — música y efectos CC0 incluidos o descargables, con vista previa. (esfuerzo: M) (impacto: alto)
26. **Marcas de ritmo** — detecta el beat de la música y coloca marcadores para cortar a tiempo. (esfuerzo: M) (impacto: medio)
27. **Mezclador de varias pistas** — volumen, silencio y panorámica por pista de audio. (esfuerzo: M) (impacto: medio)
28. **Exportar solo audio** — MP3, WAV, OGG o M4A desde la línea de tiempo. (esfuerzo: S) (impacto: medio)
29. **Tercios inferiores y rótulos** — plantillas de nombre y cargo animadas para colocar sobre el video. (esfuerzo: M) (impacto: medio)
30. **Bucle perfecto** — ajusta el final con fundido cruzado para que un clip corto o GIF se repita sin salto. (esfuerzo: M) (impacto: bajo)

**Las 3 primeras que haría**
- Subtítulos con editor y SRT: es lo que más se pide en video corto y prepara el terreno a la transcripción por IA.
- Transiciones entre clips: sin ellas cualquier montaje con varios clips se ve abrupto.
- Keyframes de propiedades: da movimiento a todo lo demás y reutiliza la lógica de animaciones ya existente.

## 6. Exportación, formatos y compartir

1. **Exportar selección o grupo** — descarga solo el elemento seleccionado con fondo transparente y recorte ajustado. (esfuerzo: S) (impacto: alto)
2. **Exportar todas las páginas a ZIP** — un archivo por página con nombre ordenado. (esfuerzo: S) (impacto: alto)
3. **Varios tamaños de una vez** — marca @1x, @2x y @3x y salen todos en una sola exportación. (esfuerzo: S) (impacto: medio)
4. **Rebanadas (slices)** — define zonas con nombre y expórtalas como imágenes separadas. (esfuerzo: M) (impacto: medio)
5. **Ajustes de exportación guardados** — perfiles como «Instagram», «Web ligera» o «Imprenta». (esfuerzo: S) (impacto: medio)
6. **Optimizar a peso objetivo** — pide «menos de 200 KB» y la calidad se ajusta sola. (esfuerzo: M) (impacto: alto)
7. **PDF con marcas de corte y sangrado** — añade crop marks y margen para llevar a imprenta. (esfuerzo: M) (impacto: alto)
8. **PDF con enlaces y marcadores** — los enlaces de los objetos funcionan y las páginas aparecen en el índice. (esfuerzo: M) (impacto: medio)
9. **PDF de dos en una hoja** — reduce varias páginas del diseño a una hoja para imprimir borradores. (esfuerzo: S) (impacto: bajo)
10. **Exportar a PPTX** — pasa una presentación a PowerPoint con textos y formas editables. (esfuerzo: L) (impacto: alto)
11. **Presentación HTML autónoma** — un único archivo que se abre en cualquier navegador sin ChamVa. (esfuerzo: M) (impacto: medio)
12. **Hoja de sprites** — junta las imágenes de las páginas en una rejilla con su JSON para juegos y web. (esfuerzo: M) (impacto: bajo)
13. **Paquete de iconos de aplicación** — todos los tamaños para Android, iOS y escritorio desde un icono. (esfuerzo: S) (impacto: medio)
14. **Favicon completo y manifiesto** — .ico, PNG de varios tamaños y site.webmanifest listos para pegar. (esfuerzo: S) (impacto: medio)
15. **Convertir imágenes por lote** — suelta una carpeta, elige formato y tamaño y se convierten todas. (esfuerzo: M) (impacto: alto)
16. **Marca de agua en la exportación** — texto o logo repetido o en una esquina, con opacidad, opcional en cada descarga. (esfuerzo: S) (impacto: alto)
17. **Limpiar o añadir metadatos** — borra EXIF y GPS al exportar, o añade autor y licencia. (esfuerzo: S) (impacto: medio)
18. **Compartir con el sistema** — Web Share y menú «Compartir» de Android para enviar a otras apps sin descargar. (esfuerzo: S) (impacto: medio)
19. **Pliegos para imprimir** — coloca varias tarjetas o etiquetas por hoja A4 con marcas de corte. (esfuerzo: M) (impacto: alto)
20. **Compartir por QR en la red local** — sirve el archivo exportado por la wifi para que el móvil lo descargue escaneando. (esfuerzo: M) (impacto: medio)
21. **Proyecto portátil .chamva** — un archivo único con diseño y recursos para mover entre equipos. (esfuerzo: M) (impacto: alto)
22. **Exportar capas por separado** — cada capa a su PNG con la posición conservada. (esfuerzo: S) (impacto: medio)
23. **APNG, WebP animado y Lottie** — más formatos de animación ligeros para web. (esfuerzo: M) (impacto: medio)
24. **Perfil de color de salida** — elige sRGB o Display P3 y se incrusta en el archivo. (esfuerzo: M) (impacto: bajo)
25. **Cola de exportación en segundo plano** — sigue editando mientras se exporta con barra de progreso y cancelar. (esfuerzo: M) (impacto: medio)
26. **Plantilla de nombre de archivo** — patrón con {nombre}-{página}-{fecha} para lotes ordenados. (esfuerzo: S) (impacto: bajo)
27. **Recordar carpeta y abrirla al acabar** — guarda el último destino y ofrece «mostrar en carpeta». (esfuerzo: S) (impacto: medio)
28. **Copiar CSS de un elemento** — genera el CSS (color, sombra, radio, degradado) de lo seleccionado. (esfuerzo: M) (impacto: bajo)
29. **Exportar a HEIC y TIFF** — formatos que piden algunas imprentas y el ecosistema Apple. (esfuerzo: M) (impacto: bajo)
30. **Informe de recursos** — lista fuentes, imágenes y resolución efectiva usadas, para revisar antes de imprimir. (esfuerzo: M) (impacto: medio)

**Las 3 primeras que haría**
- Exportar páginas y selección en lote (ideas 1 y 2): es lo que pide quien trabaja con carruseles y packs de recursos y es barato.
- Marca de agua en la exportación: muchos fotógrafos y creadores la usan a diario y no tiene dependencias.
- Optimizar a un peso objetivo: resuelve el «me pide menos de 2 MB» sin probar a ciegas.

## 7. Inteligencia artificial local (offline)

1. **Transcripción con Whisper local** — convierte voz de audio o video en texto con marcas de tiempo, sin salir del equipo. (esfuerzo: L) (impacto: alto)
2. **Subtítulos automáticos** — del resultado de Whisper salen subtítulos sincronizados en la línea de tiempo. (esfuerzo: M) (impacto: alto)
3. **OCR a texto editable** — extrae el texto de una imagen con Tesseract (WASM) y lo pone en un cuadro. (esfuerzo: M) (impacto: alto)
4. **Captura a capas editables** — OCR más detección de bloques para reconstruir una captura como textos movibles. (esfuerzo: L) (impacto: medio)
5. **Selección por clic (SAM)** — haz clic sobre un objeto y se recorta con un modelo tipo MobileSAM. (esfuerzo: L) (impacto: alto)
6. **Quitar objeto con inpaint IA** — pinta lo que sobra y un modelo tipo LaMa rellena de forma creíble. (esfuerzo: L) (impacto: alto)
7. **Colorear fotos en blanco y negro** — un modelo propone colores para fotos antiguas, ajustables. (esfuerzo: M) (impacto: medio)
8. **Restaurar rostros** — mejora caras borrosas o dañadas con GFPGAN o CodeFormer. (esfuerzo: M) (impacto: alto)
9. **Quitar ruido con IA** — modelo de denoise para fotos oscuras, mejor que el filtro clásico. (esfuerzo: M) (impacto: medio)
10. **Upscale ×4 y modelo para ilustraciones** — Real-ESRGAN general y variante anime o dibujo. (esfuerzo: M) (impacto: medio)
11. **Recorte inteligente** — detecta caras y sujeto principal para proponer el encuadre en cada formato. (esfuerzo: M) (impacto: alto)
12. **Desenfoque con profundidad real** — mapa de profundidad (Depth Anything) para un bokeh gradual, no un corte plano. (esfuerzo: M) (impacto: medio)
13. **Búsqueda semántica en la galería** — escribe «perro en la playa» y CLIP encuentra tus imágenes. (esfuerzo: L) (impacto: alto)
14. **Imágenes similares** — «más como esta» sobre la galería o los iconos. (esfuerzo: M) (impacto: bajo)
15. **Descripción alternativa de imagen** — genera un texto alt para accesibilidad con un modelo de captioning. (esfuerzo: M) (impacto: medio)
16. **Voz sintética local** — Piper o similar convierte un texto en locución para el video. (esfuerzo: M) (impacto: alto)
17. **Separar voz y música** — Demucs o similar aísla las pistas para editar o silenciar una. (esfuerzo: L) (impacto: medio)
18. **Recortar silencios automáticamente** — detecta pausas y muletillas largas y las corta de la línea de tiempo. (esfuerzo: M) (impacto: alto)
19. **Detección de escenas** — propone cortes donde cambia el plano en un video largo. (esfuerzo: M) (impacto: medio)
20. **Seguimiento de objeto** — un texto o pegatina sigue a una persona o cosa a lo largo del clip. (esfuerzo: L) (impacto: medio)
21. **Quitar fondo de video** — matting por fotograma para dejar solo al sujeto sin pantalla verde. (esfuerzo: L) (impacto: alto)
22. **Cámara lenta con interpolación** — RIFE genera fotogramas intermedios para ralentizar sin tirones. (esfuerzo: L) (impacto: medio)
23. **Upscale de video** — mejora la resolución de un clip por fotogramas con aviso de tiempo estimado. (esfuerzo: L) (impacto: medio)
24. **Identificar fuente de una imagen** — sube una captura de texto y propone las fuentes instaladas más parecidas. (esfuerzo: L) (impacto: medio)
25. **Difuminar caras automáticamente** — detecta rostros y los pixela para privacidad en un clic. (esfuerzo: M) (impacto: medio)
26. **Generación de imagen local** — Stable Diffusion en versión ligera por WebGPU u ONNX para fondos y texturas. (esfuerzo: L) (impacto: alto)
27. **Asistente de redacción local** — un LLM pequeño reescribe, acorta y corrige textos del diseño sin salir del equipo. (esfuerzo: L) (impacto: medio)
28. **Traducción local de textos** — traduce todos los textos del diseño con modelos Marian o Bergamot, conservando el formato. (esfuerzo: L) (impacto: alto)
29. **Gestor de modelos** — lista de modelos con tamaño, descarga, borrado y elección del activo por tarea. (esfuerzo: M) (impacto: alto)
30. **Aceleración automática y prueba de rendimiento** — detecta WebGPU, CUDA o CPU, elige lo mejor y avisa de cuánto tardará. (esfuerzo: M) (impacto: medio)

**Las 3 primeras que haría**
- Transcripción con Whisper local: abre subtítulos, recorte de silencios y búsqueda por voz con un único modelo.
- Quitar objeto con inpaint IA: el resultado se nota al instante y complementa el borrador mágico existente.
- OCR a texto editable: es útil a diario, el modelo es pequeño y no necesita GPU.

## 8. Experiencia de uso, rendimiento, accesibilidad y móvil

1. **Atajos personalizables** — pantalla para reasignar cualquier atajo y detectar conflictos. (esfuerzo: M) (impacto: alto)
2. **Tooltips con atajo y descripción** — pasar el ratón por una herramienta explica qué hace y su tecla. (esfuerzo: S) (impacto: medio)
3. **Gestos táctiles completos** — pellizcar para hacer zoom, dos dedos para mover y girar el lienzo. (esfuerzo: M) (impacto: alto)
4. **Lápiz con presión** — soporte de stylus con presión e inclinación para pincel y goma. (esfuerzo: M) (impacto: medio)
5. **Modo tablet** — tiradores, botones y menús más grandes cuando se detecta pantalla táctil. (esfuerzo: M) (impacto: alto)
6. **Minimapa del lienzo** — vista reducida con el área visible, útil con zoom alto o pizarras grandes. (esfuerzo: S) (impacto: bajo)
7. **Modo concentración** — oculta paneles y barras con una tecla para ver solo el lienzo. (esfuerzo: S) (impacto: medio)
8. **Pestañas de documentos** — varios diseños abiertos a la vez y cambio rápido entre ellos. (esfuerzo: M) (impacto: alto)
9. **Abrir con doble clic desde el sistema** — asociación de .chamva e imágenes para abrirlas directamente en la app. (esfuerzo: M) (impacto: alto)
10. **Pegar y arrastrar desde fuera** — pega imágenes, SVG, texto o colores del portapapeles y suelta archivos desde el explorador con detección de tipo. (esfuerzo: S) (impacto: alto)
11. **Tema de alto contraste** — paleta de interfaz de máximo contraste y bordes marcados. (esfuerzo: S) (impacto: medio)
12. **Lectores de pantalla y teclado total** — etiquetas ARIA y orden de tabulación para manejar paneles sin ratón. (esfuerzo: L) (impacto: medio)
13. **Tamaño de interfaz ajustable** — escala 80 a 150 por ciento independiente del sistema. (esfuerzo: S) (impacto: medio)
14. **Traducciones por archivo JSON** — cualquiera añade un idioma copiando un archivo, sin tocar el código. (esfuerzo: M) (impacto: medio)
15. **Renderizado por zonas** — solo dibuja lo visible para que diseños enormes no se arrastren. (esfuerzo: L) (impacto: alto)
16. **Miniaturas en caché y galería perezosa** — la galería carga solo lo que se ve y recuerda las miniaturas. (esfuerzo: M) (impacto: medio)
17. **Medidor de memoria y modo ahorro** — avisa de que el equipo va justo y baja la calidad de la vista mientras editas. (esfuerzo: M) (impacto: medio)
18. **Vista previa ligera al arrastrar** — durante el movimiento se usan versiones reducidas y se afina al soltar. (esfuerzo: M) (impacto: medio)
19. **Tareas pesadas cancelables** — IA y filtros grandes con barra de progreso y botón cancelar. (esfuerzo: S) (impacto: alto)
20. **PWA instalable offline** — la versión web se instala y funciona sin conexión con service worker. (esfuerzo: M) (impacto: alto)
21. **Copia de seguridad completa** — exporta e importa toda la biblioteca (diseños, galería, kit) en un archivo. (esfuerzo: M) (impacto: alto)
22. **Varias versiones de autoguardado** — conserva las últimas N copias para volver tras un fallo. (esfuerzo: S) (impacto: medio)
23. **Deshacer que sobrevive al cierre** — el historial se guarda y sigue disponible al reabrir. (esfuerzo: M) (impacto: medio)
24. **Atajos de dos dedos en móvil** — tocar con dos dedos deshace y con tres rehace. (esfuerzo: S) (impacto: medio)
25. **Barra contextual flotante** — al seleccionar aparecen junto al objeto las 4 acciones más usadas. (esfuerzo: M) (impacto: alto)
26. **Modo horizontal y zurdo en móvil** — reubica la barra y los paneles según orientación y mano. (esfuerzo: M) (impacto: medio)
27. **Indicador «todo local»** — insignia visible y registro de actividad de red que demuestra que nada sale del equipo. (esfuerzo: S) (impacto: medio)
28. **Errores con informe copiable** — mensajes claros con causa probable y botón para copiar el informe técnico. (esfuerzo: S) (impacto: medio)
29. **Recibir desde «Compartir» en Android** — enviar una foto desde la galería del móvil a ChamVa la abre en un diseño nuevo. (esfuerzo: M) (impacto: alto)
30. **Arranque rápido con carga diferida** — la IA y el video se cargan al usarlos para abrir en menos de dos segundos. (esfuerzo: M) (impacto: alto)

**Las 3 primeras que haría**
- Atajos personalizables: lo piden todos los usuarios habituales y ya hay un diálogo de atajos sobre el que construir.
- Pegar y arrastrar desde fuera: pocas líneas y se usa en cada sesión.
- Renderizado por zonas para diseños grandes: es lo que hará que la app siga siendo ágil cuando el uso crezca.
