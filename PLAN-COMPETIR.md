# ChamVa — Plan para competir con Canva y CapCut

La estrategia no es copiarlos función por función — tienen miles de ingenieros y
catálogos de contenido licenciado imposibles de igualar. La estrategia es ganar en
el terreno donde ellos **no pueden** entrar:

> **ChamVa: todo lo que te cobran, gratis. Todo lo que te espían, privado.
> Todo lo que te limitan, sin límites. 100% offline.**

Canva cobra por: quitar fondo, magic resize, exportar con transparencia, kit de
marca, upscale. CapCut cobra por (y pone marca de agua a): exportar en calidad,
efectos "pro", quitar fondo de video. **Todo eso ChamVa ya lo da gratis u offline.**
Ese es el mensaje; las funciones de abajo lo hacen creíble.

---

## 1. Dónde ya ganamos (comunicarlo, no construirlo)

| Ellos | ChamVa hoy |
|---|---|
| Quitar fondo = de pago (Canva Pro) | Gratis, offline, 2 motores |
| Transparencia en export = de pago | Gratis en todos los formatos |
| Marca de agua (CapCut) | Nunca |
| Cuenta obligatoria + datos a la nube | Cero cuentas, cero red |
| Upscale/Magic Resize = de pago | Gratis |
| Suscripción US$120+/año | Gratis (donación opcional) |

**Acción:** este cuadro debe estar en el README, la landing y la pantalla de inicio.

## 2. Brechas vs **Canva** (editor de diseño)

Por impacto en el uso diario, no por vistosidad:

### P0 — sin esto la gente vuelve a Canva
1. **Plantillas, muchas.** Canva vive de sus ~1M de plantillas; ChamVa tiene un puñado.
   No hace falta 1M: hacen falta **~100 buenas** de los casos reales: post/historia de
   Instagram, flyer, tarjeta de presentación, hoja de vida, invitación, menú, portada
   de Facebook, miniatura de YouTube, certificado, escarapela. Formato JSON propio ya
   existe (`presetTemplates.ts`) — es trabajo de diseño, no de código, y es
   **el mayor retorno de todo este plan**.
2. **Edición de texto inline por palabra** (ya identificado en el README): negrita a
   media frase es lo primero que un usuario de Canva intenta y hoy falla.
3. **Fotos e ilustraciones de stock** vía **Openverse/Wikimedia** (API libre, sin
   clave) con caché local — evita la clave de Unsplash y mantiene la bandera offline
   ("descarga una vez, usa siempre").
4. **Gráficas y tablas** (barras, torta, línea): imprescindible para el usuario de
   oficina, y es render puro sobre el documento — encaja con la arquitectura actual.

### P1 — retención
5. **Carpetas/proyectos** con vista de galería de diseños guardados (hoy: autoguardado
   plano en IndexedDB).
6. **Grupos de capas** (agrupar/desagrupar) y **bloquear capa**.
7. **Marcos (frames)** para soltar fotos dentro de formas — el gesto más famoso de Canva.
8. **Más efectos de un clic:** sombra larga, glitch, recorte con borde adhesivo
   (sticker), fondos con degradados/mallas generativos.

### P2 — diferenciadores que Canva no tiene
9. **Generación de imagen local** (Stable Diffusion Turbo/SDXS vía ONNX): pesada pero
   posible; "IA generativa gratis y privada" es titular por sí solo.
10. **Modo por lotes:** aplicar una plantilla a un CSV (100 escarapelas con nombres
    distintos). Canva lo cobra caro (Bulk Create); para nosotros es un bucle sobre
    render puro.

## 3. Brechas vs **CapCut** (editor de video)

### P0 — el mínimo creíble
1. **Transiciones reales entre clips** (crossfade ya está identificado; sumar
   deslizar/zoom/barrido — con WebGL son shaders sencillos).
2. **Subtítulos automáticos** con **Whisper local** (transformers.js ya está en el
   stack; whisper-tiny/base corre en WASM). Es LA función de CapCut, y hacerla
   **offline y gratis** cuando CapCut la está moviendo a Pro es un golpe directo.
3. **Keyframes** de posición/escala/opacidad en capas superpuestas (hoy solo hay
   tiempos de aparición).
4. **Recorte/zoom del clip en el lienzo** (encuadrar un video vertical desde uno
   horizontal) y **exportación 9:16 / 1:1 / 16:9** con un clic.

### P1 — paridad de flujo
5. **Chroma key** (fondo verde) — filtro de color por píxel, factible en WebGL.
6. **Velocidad con curvas** (rampas de cámara lenta) — ya hay velocidad por clip.
7. **Música/SFX libres** empaquetados (colecciones CC0) + detección de beat simple
   para cortar al ritmo.
8. **Texto a voz local** (Piper TTS corre en WASM, voces es/en decentes).

### P2 — el titular
9. **Quitar fondo de VIDEO** offline (RMBG por frame + interpolación). Costoso de
   CPU pero nadie lo da gratis; aunque tarde, "gratis y privado" gana a "rápido y
   de pago" para mucha gente.
10. **Auto-recorte a formatos** (un video → horizontal/vertical/cuadrado de una vez).

## 4. Lo que NO vamos a perseguir (decisión, no descuido)

- **Colaboración en tiempo real** y **nube propia**: contradice el ADN offline y
  exige servidores que cuestan dinero. Alternativa barata: exportar/importar
  proyecto `.chamva` (ya existe) + "compartir como plantilla".
- **Catálogo infinito de stock licenciado**: imposible sin licencias; Openverse + CC0.
- **App social / feed / comunidad**: CapCut es un embudo hacia TikTok; ChamVa no
  necesita serlo.

## 5. Orden de ejecución sugerido

| Trimestre | Diseño (vs Canva) | Video (vs CapCut) |
|---|---|---|
| T1 | 100 plantillas + texto inline por palabra | Subtítulos Whisper + crossfade real |
| T2 | Stock Openverse + gráficas/tablas | Keyframes + export 9:16/1:1 |
| T3 | Frames + grupos + carpetas | Chroma key + curvas de velocidad + TTS |
| T4 | Lotes desde CSV + SD local (experimento) | Quitar fondo de video (experimento) |

**Regla de oro:** cada release debe poder anunciarse con una frase del tipo
"lo que [Canva|CapCut] te cobra, ChamVa te lo da gratis y sin subir tus archivos
a ningún servidor". Si una función no soporta esa frase ni mejora la retención,
va al final de la cola.

## 6. Prerrequisitos técnicos (de PLAN-MEJORA.md)

Antes de T2, ejecutar de PLAN-MEJORA.md: CI verde (#6), trocear App.tsx (#11),
**Web Workers para IA** (#15 — Whisper y quitar-fondo-video lo exigen) y esquema
de documento versionado (#16 — las 100 plantillas dependen de que el formato no
se rompa entre versiones).
