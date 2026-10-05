# Licencias de la biblioteca de sonidos

Todos los archivos de esta carpeta son **CC0 1.0 (dominio público)**: https://creativecommons.org/publicdomain/zero/1.0/deed.es
No exigen atribución; se agradece igualmente a sus autores.

## Cómo se verificó

- **Kenney** (kenney.nl): la página de cada paquete indica «Creative Commons CC0» y el zip incluye `License.txt` con «Creative Commons Zero, CC0».
- **OpenGameArt.org**: la página de cada recurso se leyó el 2026-10-05 y se aceptó SOLO si su lista de licencias es exactamente «CC0» (se descartaron los que ofrecen CC-BY, OGA-BY o varias licencias).
- `scripts/sounds/build-sounds.py` repite esa comprobación y aborta si algo deja de ser CC0.
- Límite honesto: en OpenGameArt la licencia la declara quien sube el recurso; no se puede comprobar que el autor tenga todos los derechos.

## Método de codificación

Cada original (OGG, MP3, WAV o FLAC) se recodificó con ffmpeg + libopus a OGG/Opus (mono 32–48 kbit/s en efectos; estéreo 40–56 kbit/s en ambiente y música), a 48 kHz.
Los efectos se normalizan a pico -3 dBFS (los ambientes a -9/-6) y la música a ≈ -18 LUFS. Algunos se recortaron (se indica en el índice por su duración).

## Archivos

| Archivo | Nombre | Autor | Fuente (página de la licencia) | Original |
|---|---|---|---|---|
| `clic-suave.ogg` | Clic suave | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `click_001.ogg` |
| `clic-seco.ogg` | Clic seco | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `click_003.ogg` |
| `clic-firme.ogg` | Clic firme | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `click_005.ogg` |
| `tic.ogg` | Tic corto | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `tick_001.ogg` |
| `interruptor-1.ogg` | Interruptor | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `switch_001.ogg` |
| `interruptor-2.ogg` | Interruptor grave | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `switch_005.ogg` |
| `alternar.ogg` | Alternar | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `toggle_001.ogg` |
| `seleccionar-1.ogg` | Seleccionar | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `select_001.ogg` |
| `seleccionar-2.ogg` | Seleccionar brillante | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `select_005.ogg` |
| `confirmar-1.ogg` | Confirmar | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `confirmation_001.ogg` |
| `confirmar-2.ogg` | Confirmar doble | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `confirmation_003.ogg` |
| `error-1.ogg` | Error | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `error_001.ogg` |
| `error-2.ogg` | Error grave | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `error_004.ogg` |
| `atras.ogg` | Atrás | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `back_001.ogg` |
| `abrir.ogg` | Abrir | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `open_001.ogg` |
| `cerrar.ogg` | Cerrar | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `close_001.ogg` |
| `pregunta.ogg` | Pregunta | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `question_001.ogg` |
| `pulsar-cuerda.ogg` | Pulsación de cuerda | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `pluck_001.ogg` |
| `cristal.ogg` | Tintineo de cristal | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `glass_001.ogg` |
| `gong-suave.ogg` | Campanada suave | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `bong_001.ogg` |
| `soltar.ogg` | Soltar | Kenney (kenney.nl) | https://kenney.nl/assets/interface-sounds | Kenney · interface-sounds · `drop_001.ogg` |
| `clic-raton.ogg` | Clic de ratón | Kenney (kenney.nl) | https://kenney.nl/assets/ui-audio | Kenney · ui-audio · `mouseclick1.ogg` |
| `pasar-por-encima.ogg` | Pasar por encima | Kenney (kenney.nl) | https://kenney.nl/assets/ui-audio | Kenney · ui-audio · `rollover2.ogg` |
| `swoosh-1.ogg` | Swoosh 1 | artisticdude | https://opengameart.org/content/swishes-sound-pack | Swishes Sound Pack · `swish-1.wav` |
| `swoosh-3.ogg` | Swoosh 3 | artisticdude | https://opengameart.org/content/swishes-sound-pack | Swishes Sound Pack · `swish-3.wav` |
| `swoosh-5.ogg` | Swoosh 5 | artisticdude | https://opengameart.org/content/swishes-sound-pack | Swishes Sound Pack · `swish-5.wav` |
| `swoosh-7.ogg` | Swoosh 7 | artisticdude | https://opengameart.org/content/swishes-sound-pack | Swishes Sound Pack · `swish-7.wav` |
| `swoosh-9.ogg` | Swoosh 9 | artisticdude | https://opengameart.org/content/swishes-sound-pack | Swishes Sound Pack · `swish-9.wav` |
| `viento-rapido.ogg` | Ráfaga de viento | SketchMan3 | https://opengameart.org/content/wind-whoosh-loop | wind whoosh loop · `wind woosh loop.ogg` |
| `subida-fase-1.ogg` | Barrido ascendente | Kenney (kenney.nl) | https://kenney.nl/assets/digital-audio | Kenney · digital-audio · `phaserUp1.ogg` |
| `subida-fase-4.ogg` | Barrido ascendente largo | Kenney (kenney.nl) | https://kenney.nl/assets/digital-audio | Kenney · digital-audio · `phaserUp4.ogg` |
| `bajada-fase-1.ogg` | Barrido descendente | Kenney (kenney.nl) | https://kenney.nl/assets/digital-audio | Kenney · digital-audio · `phaserDown1.ogg` |
| `salto-fase.ogg` | Salto de fase | Kenney (kenney.nl) | https://kenney.nl/assets/digital-audio | Kenney · digital-audio · `phaseJump1.ogg` |
| `agudo-sube.ogg` | Agudo ascendente | Kenney (kenney.nl) | https://kenney.nl/assets/digital-audio | Kenney · digital-audio · `highUp.ogg` |
| `agudo-baja.ogg` | Agudo descendente | Kenney (kenney.nl) | https://kenney.nl/assets/digital-audio | Kenney · digital-audio · `highDown.ogg` |
| `campo-fuerza.ogg` | Campo de fuerza | Kenney (kenney.nl) | https://kenney.nl/assets/sci-fi-sounds | Kenney · sci-fi-sounds · `forceField_000.ogg` |
| `pasar-pagina.ogg` | Pasar página | Kenney (kenney.nl) | https://kenney.nl/assets/rpg-audio | Kenney · rpg-audio · `bookFlip1.ogg` |
| `tela.ogg` | Roce de tela | Kenney (kenney.nl) | https://kenney.nl/assets/rpg-audio | Kenney · rpg-audio · `cloth1.ogg` |
| `punetazo-fuerte.ogg` | Puñetazo fuerte | Kenney (kenney.nl) | https://kenney.nl/assets/impact-sounds | Kenney · impact-sounds · `impactPunch_heavy_000.ogg` |
| `punetazo-medio.ogg` | Puñetazo medio | Kenney (kenney.nl) | https://kenney.nl/assets/impact-sounds | Kenney · impact-sounds · `impactPunch_medium_000.ogg` |
| `metal-pesado.ogg` | Golpe de metal pesado | Kenney (kenney.nl) | https://kenney.nl/assets/impact-sounds | Kenney · impact-sounds · `impactMetal_heavy_000.ogg` |
| `metal-ligero.ogg` | Golpe de metal ligero | Kenney (kenney.nl) | https://kenney.nl/assets/impact-sounds | Kenney · impact-sounds · `impactMetal_light_000.ogg` |
| `madera.ogg` | Golpe de madera | Kenney (kenney.nl) | https://kenney.nl/assets/impact-sounds | Kenney · impact-sounds · `impactPlank_medium_000.ogg` |
| `cristal-roto.ogg` | Impacto de cristal | Kenney (kenney.nl) | https://kenney.nl/assets/impact-sounds | Kenney · impact-sounds · `impactGlass_heavy_000.ogg` |
| `campana-pesada.ogg` | Campana pesada | Kenney (kenney.nl) | https://kenney.nl/assets/impact-sounds | Kenney · impact-sounds · `impactBell_heavy_000.ogg` |
| `pico.ogg` | Golpe de pico | Kenney (kenney.nl) | https://kenney.nl/assets/impact-sounds | Kenney · impact-sounds · `impactMining_000.ogg` |
| `explosion.ogg` | Explosión | Kenney (kenney.nl) | https://kenney.nl/assets/sci-fi-sounds | Kenney · sci-fi-sounds · `explosionCrunch_000.ogg` |
| `explosion-grave.ogg` | Explosión grave | Kenney (kenney.nl) | https://kenney.nl/assets/sci-fi-sounds | Kenney · sci-fi-sounds · `lowFrequency_explosion_000.ogg` |
| `pisada-cemento.ogg` | Pisada en cemento | Kenney (kenney.nl) | https://kenney.nl/assets/impact-sounds | Kenney · impact-sounds · `footstep_concrete_000.ogg` |
| `pisada-madera.ogg` | Pisada en madera | Kenney (kenney.nl) | https://kenney.nl/assets/impact-sounds | Kenney · impact-sounds · `footstep_wood_000.ogg` |
| `pisada-hierba.ogg` | Pisada en hierba | Kenney (kenney.nl) | https://kenney.nl/assets/impact-sounds | Kenney · impact-sounds · `footstep_grass_000.ogg` |
| `tajo.ogg` | Tajo | Kenney (kenney.nl) | https://kenney.nl/assets/rpg-audio | Kenney · rpg-audio · `chop.ogg` |
| `puerta-cierra.ogg` | Puerta que se cierra | Kenney (kenney.nl) | https://kenney.nl/assets/rpg-audio | Kenney · rpg-audio · `doorClose_1.ogg` |
| `puerta-abre.ogg` | Puerta que se abre | Kenney (kenney.nl) | https://kenney.nl/assets/rpg-audio | Kenney · rpg-audio · `doorOpen_1.ogg` |
| `monedas.ogg` | Monedas | Kenney (kenney.nl) | https://kenney.nl/assets/rpg-audio | Kenney · rpg-audio · `handleCoins.ogg` |
| `multitud.ogg` | Multitud gritando | StarNinjas | https://opengameart.org/content/crowd-shoutingspeaking-ambience | Crowd Shouting/Speaking Ambience · `crowd_shouting_0.ogg` |
| `motor-circular.ogg` | Motor circular | Kenney (kenney.nl) | https://kenney.nl/assets/sci-fi-sounds | Kenney · sci-fi-sounds · `engineCircular_000.ogg` |
| `motor-espacial.ogg` | Motor de nave | Kenney (kenney.nl) | https://kenney.nl/assets/sci-fi-sounds | Kenney · sci-fi-sounds · `spaceEngineLow_000.ogg` |
| `crujido.ogg` | Crujido de madera | Kenney (kenney.nl) | https://kenney.nl/assets/rpg-audio | Kenney · rpg-audio · `creak1.ogg` |
| `aplausos.ogg` | Aplausos de sala | eXpl0it3r | https://opengameart.org/content/applause-in-a-large-hall-or-church | Applause in a large hall or church · `applause-clapping-church-crowd-immersive.wav` |
| `risitas-grupo.ogg` | Risitas de grupo | Nocturnal_Vanguard | https://opengameart.org/content/group-giggling | Group giggling · `group_giggling.ogg` |
| `risa-bruja.ogg` | Risa de bruja | AntumDeluge | https://opengameart.org/content/witch-cackle | Witch Cackle · `witch_cackle-1_0.ogg` |
| `risas-maniacas.ogg` | Risas maníacas | Nocturnal_Vanguard | https://opengameart.org/content/maniacal-laughter-pack-1 | Maniacal Laughter Pack 1 · `maniacal_laughter_pack_1.ogg` |
| `risa-malvada.ogg` | Risa malvada | AntumDeluge | https://opengameart.org/content/evil-laugh | Evil Laugh · `laugh-evil-1_0.ogg` |
| `risa-malvada-2.ogg` | Risa malvada 2 | Eldritch Grim | https://opengameart.org/content/evil-laughs-pack | Evil Laughs Pack · `Laugh 1.mp3` |
| `risa-malvada-4.ogg` | Risa malvada 4 | Eldritch Grim | https://opengameart.org/content/evil-laughs-pack | Evil Laughs Pack · `Laugh 3.mp3` |
| `risa-malvada-6.ogg` | Risa malvada 6 | Eldritch Grim | https://opengameart.org/content/evil-laughs-pack | Evil Laughs Pack · `Laugh 5.mp3` |
| `sirena.ogg` | Sirena | aquinn | https://opengameart.org/content/sirens-and-alarm-noise | Sirens and Alarm Noise · `siren_0.mp3` |
| `alarma-1.ogg` | Alarma de pitidos | Frenchyboy | https://opengameart.org/content/alarm-2 | Alarm · `alarm_0.wav` |
| `alarma-2.ogg` | Alarma larga | bonzille | https://opengameart.org/content/alarm-sound-effect | Alarm Sound Effect · `alarm_2.wav` |
| `alarma-3.ogg` | Alarma corta | EZduzziteh | https://opengameart.org/content/alarm-1 | Alarm · `alarm_2.ogg` |
| `alarma-4.ogg` | Alarma breve | yd | https://opengameart.org/content/short-alarm | Short alarm · `alarm_0.ogg` |
| `lluvia-1.ogg` | Lluvia constante (bucle) | Ylmir | https://opengameart.org/content/rain-loopable | Rain (loopable) · `1.ogg` |
| `lluvia-2.ogg` | Lluvia suave (bucle) | Ylmir | https://opengameart.org/content/rain-loopable | Rain (loopable) · `2.ogg` |
| `lluvia-truenos.ogg` | Lluvia con trueno | WuxiaScrub | https://opengameart.org/content/rain-long-thunder | Rain + Long Thunder · `rain-thunder.ogg` |
| `pajaros.ogg` | Pájaros del bosque | isaiah658 | https://opengameart.org/content/ambient-bird-sounds | Ambient Bird Sounds · `birds-isaiah658_0.ogg` |
| `pajaros-cortos.ogg` | Gorjeo de pájaros | syncopika | https://opengameart.org/content/bird-chirping-sounds | Bird chirping sounds · `birdchirping071414_0.mp3` |
| `grillos.ogg` | Grillos nocturnos (bucle) | Wolfgang_ | https://opengameart.org/content/crickets-ambient-noise-loopable | Crickets Ambient Noise - loopable · `crickets_1.mp3` |
| `olas-1.ogg` | Ola de mar 1 | transitking | https://opengameart.org/content/water-waves | Water Waves · `wave_01_cc0-11505__transitking__wavesound.flac` |
| `olas-playa-1.ogg` | Olas en la playa 1 | jasinski | https://opengameart.org/content/beach-ocean-waves | Beach Ocean Waves · `wave_01_cc0-18363__jasinski__alkaibeach.flac` |
| `viento-1.ogg` | Viento suave | IgnasD | https://opengameart.org/content/wind | Wind · `Wind.ogg` |
| `viento-2.ogg` | Viento fuerte | IgnasD | https://opengameart.org/content/wind | Wind · `Wind2.ogg` |
| `fuego.ogg` | Fuego crepitando | AntumDeluge | https://opengameart.org/content/fire-crackling | Fire Crackling · `fire-1_0.ogg` |
| `chimenea.ogg` | Chimenea (bucle) | PagDev | https://opengameart.org/content/fireplace-sound-loop | Fireplace Sound loop · `fire.wav` |
| `jingle-nes00.ogg` | Jingle 8 bits 1 | Kenney (kenney.nl) | https://kenney.nl/assets/music-jingles | Kenney · music-jingles · `jingles_NES00.ogg` |
| `jingle-nes05.ogg` | Jingle 8 bits 2 | Kenney (kenney.nl) | https://kenney.nl/assets/music-jingles | Kenney · music-jingles · `jingles_NES05.ogg` |
| `jingle-hit00.ogg` | Jingle de golpe 1 | Kenney (kenney.nl) | https://kenney.nl/assets/music-jingles | Kenney · music-jingles · `jingles_HIT00.ogg` |
| `jingle-hit05.ogg` | Jingle de golpe 2 | Kenney (kenney.nl) | https://kenney.nl/assets/music-jingles | Kenney · music-jingles · `jingles_HIT05.ogg` |
| `jingle-pizzi00.ogg` | Jingle de pizzicato 1 | Kenney (kenney.nl) | https://kenney.nl/assets/music-jingles | Kenney · music-jingles · `jingles_PIZZI00.ogg` |
| `jingle-pizzi06.ogg` | Jingle de pizzicato 2 | Kenney (kenney.nl) | https://kenney.nl/assets/music-jingles | Kenney · music-jingles · `jingles_PIZZI06.ogg` |
| `jingle-sax00.ogg` | Jingle de saxofón 1 | Kenney (kenney.nl) | https://kenney.nl/assets/music-jingles | Kenney · music-jingles · `jingles_SAX00.ogg` |
| `jingle-sax05.ogg` | Jingle de saxofón 2 | Kenney (kenney.nl) | https://kenney.nl/assets/music-jingles | Kenney · music-jingles · `jingles_SAX05.ogg` |
| `jingle-steel00.ogg` | Jingle de acero 1 | Kenney (kenney.nl) | https://kenney.nl/assets/music-jingles | Kenney · music-jingles · `jingles_STEEL00.ogg` |
| `jingle-steel05.ogg` | Jingle de acero 2 | Kenney (kenney.nl) | https://kenney.nl/assets/music-jingles | Kenney · music-jingles · `jingles_STEEL05.ogg` |
| `subida-1.ogg` | Subida de nivel | Kenney (kenney.nl) | https://kenney.nl/assets/digital-audio | Kenney · digital-audio · `powerUp3.ogg` |
| `subida-2.ogg` | Mejora conseguida | Kenney (kenney.nl) | https://kenney.nl/assets/digital-audio | Kenney · digital-audio · `powerUp8.ogg` |
| `tres-tonos.ogg` | Tres tonos | Kenney (kenney.nl) | https://kenney.nl/assets/digital-audio | Kenney · digital-audio · `threeTone1.ogg` |
| `dos-tonos.ogg` | Dos tonos | Kenney (kenney.nl) | https://kenney.nl/assets/digital-audio | Kenney · digital-audio · `twoTone1.ogg` |
| `musica-vaquero.ogg` | Vaquero (bucle) | congusbongus | https://opengameart.org/content/lasso-lady-seamless-loop | Lasso Lady (seamless loop) · `lassolady_4.ogg` |
| `musica-campos.ogg` | Campos de flores (bucle) | Zane Little Music | https://opengameart.org/content/flowerbed-fields-loop | Flowerbed Fields [Loop] · `flowerbed_fields.ogg` |
| `musica-parque.ogg` | Parque de verano 8 bits (bucle) | Scribe | https://opengameart.org/content/summer-park-8bit-tune-loop | Summer Park - 8bit tune (loop) · `8bit attempt.ogg` |
| `musica-celestial.ogg` | Celestial (bucle) | isaiah658 | https://opengameart.org/content/heavenly-loop | Heavenly Loop · `Heavenly Loop_0.ogg` |
| `musica-ambiental.ogg` | Ambiental relajante (bucle) | isaiah658 | https://opengameart.org/content/ambient-relaxing-loop | Ambient Relaxing Loop · `Ambient-Loop-isaiah658_0.ogg` |
| `musica-fiebre-chill.ogg` | Chill suave (bucle) | Pro Sensory | https://opengameart.org/content/a-chill-fever-loopable | A Chill Fever (Loopable) · `a_chill_fever_0.mp3` |
| `musica-piano.ogg` | Piano emotivo (bucle) | extenz | https://opengameart.org/content/emotional-piano-loop | Emotional piano loop · `Piano Loop.wav` |
| `musica-percusion.ogg` | Percusión cinematográfica (bucle) | Marwan Antonios | https://opengameart.org/content/cinematic-percussion-loop | Cinematic percussion loop · `Cinematic percussion loop 2.wav` |
| `musica-lofi-otra-vez.ogg` | Lofi otra vez | omfgdude | https://opengameart.org/content/lofi-again | Lofi again · `lofiagain.ogg` |
| `musica-lofi-inspirada.ogg` | Lofi inspirado | omfgdude | https://opengameart.org/content/chill-lofi-inspired | Chill lofi inspired · `ChillLofi.ogg` |
| `musica-nube.ogg` | Siesta en una nube | congusbongus | https://opengameart.org/content/napping-on-a-cloud | Napping on a Cloud · `napping_on_a_cloud.ogg` |

Total: 109 archivos, 6.46 MB.
