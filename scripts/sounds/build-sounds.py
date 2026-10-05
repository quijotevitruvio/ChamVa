#!/usr/bin/env python3
"""Genera public/sounds/ (biblioteca de sonidos CC0 de ChamVa): descarga, verifica la licencia EN LA PÁGINA
de cada recurso, recodifica a OGG/Opus pequeño, escribe index.json y LICENCIAS.md.

Uso:  python scripts/sounds/build-sounds.py --cache <carpeta de descargas>
Requisitos de la herramienta (NO son dependencias de la app): Python 3, y un ffmpeg con libopus
(`pip install imageio-ffmpeg` trae uno; o pasa --ffmpeg <ruta>).

Fuentes:
  - Kenney (kenney.nl): paquetes de audio, página «Creative Commons CC0» + License.txt dentro del zip.
  - OpenGameArt.org: cada recurso se consulta y SOLO se acepta si su lista de licencias es exactamente «CC0».
Si la licencia de una página no se puede leer o no es CC0, el script aborta (no incluye ese archivo).
"""
import argparse, hashlib, html, json, os, re, subprocess, sys, urllib.parse, urllib.request, zipfile

UA = {'User-Agent': 'Mozilla/5.0'}
FECHA = '2026-10-05'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'sounds')

KEN = {  # clave -> (slug de la página de Kenney)
    'ki': 'interface-sounds', 'kui': 'ui-audio', 'kim': 'impact-sounds', 'kj': 'music-jingles',
    'kd': 'digital-audio', 'ks': 'sci-fi-sounds', 'kr': 'rpg-audio',
}
# categorías: id -> nombre
CATS = [
    ('clics', 'Clics e interfaz'), ('transiciones', 'Transiciones y swoosh'), ('impactos', 'Impactos'),
    ('ambiente', 'Ambiente'), ('risas', 'Risas y aplausos'), ('sirenas', 'Sirenas y alarmas'),
    ('naturaleza', 'Naturaleza'), ('musica', 'Música de fondo'), ('jingles', 'Jingles'),
]

# (id, nombre, categoría, etiquetas, fuente, archivo, opciones)
# fuente: clave Kenney (ver KEN) o 'oga:<slug>'. opciones: t=recorte (s), loop, ch, kb (kbit/s), pk (pico dBFS), z=miembro del zip
S = []
def k(id, nombre, cat, tags, src, f, **o): S.append((id, nombre, cat, tags, src, f, o))
def g(id, nombre, cat, tags, slug, f, **o): S.append((id, nombre, cat, tags, 'oga:' + slug, f, o))

# --- clics e interfaz (Kenney) ---
k('clic-suave', 'Clic suave', 'clics', 'clic botón interfaz', 'ki', 'click_001.ogg')
k('clic-seco', 'Clic seco', 'clics', 'clic botón interfaz', 'ki', 'click_003.ogg')
k('clic-firme', 'Clic firme', 'clics', 'clic botón pulsar', 'ki', 'click_005.ogg')
k('tic', 'Tic corto', 'clics', 'tic reloj tictac metrónomo', 'ki', 'tick_001.ogg')
k('interruptor-1', 'Interruptor', 'clics', 'interruptor palanca encender', 'ki', 'switch_001.ogg')
k('interruptor-2', 'Interruptor grave', 'clics', 'interruptor palanca apagar', 'ki', 'switch_005.ogg')
k('alternar', 'Alternar', 'clics', 'alternar casilla activar toggle', 'ki', 'toggle_001.ogg')
k('seleccionar-1', 'Seleccionar', 'clics', 'selección elegir menú', 'ki', 'select_001.ogg')
k('seleccionar-2', 'Seleccionar brillante', 'clics', 'selección elegir menú', 'ki', 'select_005.ogg')
k('confirmar-1', 'Confirmar', 'clics', 'confirmación aceptar correcto ok', 'ki', 'confirmation_001.ogg')
k('confirmar-2', 'Confirmar doble', 'clics', 'confirmación aceptar correcto ok', 'ki', 'confirmation_003.ogg')
k('error-1', 'Error', 'clics', 'error fallo incorrecto no', 'ki', 'error_001.ogg')
k('error-2', 'Error grave', 'clics', 'error fallo incorrecto no', 'ki', 'error_004.ogg')
k('atras', 'Atrás', 'clics', 'volver atrás cancelar', 'ki', 'back_001.ogg')
k('abrir', 'Abrir', 'clics', 'abrir ventana menú', 'ki', 'open_001.ogg')
k('cerrar', 'Cerrar', 'clics', 'cerrar ventana menú', 'ki', 'close_001.ogg')
k('pregunta', 'Pregunta', 'clics', 'pregunta duda aviso', 'ki', 'question_001.ogg')
k('pulsar-cuerda', 'Pulsación de cuerda', 'clics', 'pluck cuerda nota aviso', 'ki', 'pluck_001.ogg')
k('cristal', 'Tintineo de cristal', 'clics', 'cristal vidrio tintineo brillo', 'ki', 'glass_001.ogg')
k('gong-suave', 'Campanada suave', 'clics', 'campana gong aviso notificación', 'ki', 'bong_001.ogg')
k('soltar', 'Soltar', 'clics', 'soltar arrastrar caer', 'ki', 'drop_001.ogg')
k('clic-raton', 'Clic de ratón', 'clics', 'ratón clic pulsar', 'kui', 'mouseclick1.ogg')
k('pasar-por-encima', 'Pasar por encima', 'clics', 'hover pasar encima rollover', 'kui', 'rollover2.ogg')

# --- transiciones y swoosh ---
for n in (1, 3, 5, 7, 9):
    g('swoosh-%d' % n, 'Swoosh %d' % n, 'transiciones', 'swoosh whoosh barrido paso aire transición', 'swishes-sound-pack', 'swish-%d.wav' % n, z='swishes.zip', kb=40, pk=-3)
g('viento-rapido', 'Ráfaga de viento', 'transiciones', 'viento ráfaga whoosh aire transición', 'wind-whoosh-loop', 'wind woosh loop.ogg', kb=48, pk=-6, ch=2)
k('subida-fase-1', 'Barrido ascendente', 'transiciones', 'barrido subida riser sintetizador transición', 'kd', 'phaserUp1.ogg')
k('subida-fase-4', 'Barrido ascendente largo', 'transiciones', 'barrido subida riser sintetizador transición', 'kd', 'phaserUp4.ogg')
k('bajada-fase-1', 'Barrido descendente', 'transiciones', 'barrido bajada sintetizador transición', 'kd', 'phaserDown1.ogg')
k('salto-fase', 'Salto de fase', 'transiciones', 'salto teletransporte fase sintetizador', 'kd', 'phaseJump1.ogg')
k('agudo-sube', 'Agudo ascendente', 'transiciones', 'agudo subida sintetizador', 'kd', 'highUp.ogg')
k('agudo-baja', 'Agudo descendente', 'transiciones', 'agudo bajada sintetizador', 'kd', 'highDown.ogg')
k('campo-fuerza', 'Campo de fuerza', 'transiciones', 'campo fuerza escudo ciencia ficción zumbido', 'ks', 'forceField_000.ogg')
k('pasar-pagina', 'Pasar página', 'transiciones', 'página libro papel pasar', 'kr', 'bookFlip1.ogg')
k('tela', 'Roce de tela', 'transiciones', 'tela ropa roce cortina', 'kr', 'cloth1.ogg')

# --- impactos ---
k('punetazo-fuerte', 'Puñetazo fuerte', 'impactos', 'puñetazo golpe pelea', 'kim', 'impactPunch_heavy_000.ogg')
k('punetazo-medio', 'Puñetazo medio', 'impactos', 'puñetazo golpe pelea', 'kim', 'impactPunch_medium_000.ogg')
k('metal-pesado', 'Golpe de metal pesado', 'impactos', 'metal golpe pesado choque', 'kim', 'impactMetal_heavy_000.ogg')
k('metal-ligero', 'Golpe de metal ligero', 'impactos', 'metal golpe ligero choque', 'kim', 'impactMetal_light_000.ogg')
k('madera', 'Golpe de madera', 'impactos', 'madera golpe tabla', 'kim', 'impactPlank_medium_000.ogg')
k('cristal-roto', 'Impacto de cristal', 'impactos', 'cristal vidrio rotura golpe', 'kim', 'impactGlass_heavy_000.ogg')
k('campana-pesada', 'Campana pesada', 'impactos', 'campana golpe resonancia', 'kim', 'impactBell_heavy_000.ogg')
k('pico', 'Golpe de pico', 'impactos', 'pico minería piedra golpe', 'kim', 'impactMining_000.ogg')
k('explosion', 'Explosión', 'impactos', 'explosión estallido bum', 'ks', 'explosionCrunch_000.ogg')
k('explosion-grave', 'Explosión grave', 'impactos', 'explosión grave estallido bum', 'ks', 'lowFrequency_explosion_000.ogg')
k('pisada-cemento', 'Pisada en cemento', 'impactos', 'pisada paso cemento calle', 'kim', 'footstep_concrete_000.ogg')
k('pisada-madera', 'Pisada en madera', 'impactos', 'pisada paso madera suelo', 'kim', 'footstep_wood_000.ogg')
k('pisada-hierba', 'Pisada en hierba', 'impactos', 'pisada paso hierba césped', 'kim', 'footstep_grass_000.ogg')
k('tajo', 'Tajo', 'impactos', 'tajo corte hacha golpe', 'kr', 'chop.ogg')
k('puerta-cierra', 'Puerta que se cierra', 'impactos', 'puerta cerrar portazo', 'kr', 'doorClose_1.ogg')
k('puerta-abre', 'Puerta que se abre', 'impactos', 'puerta abrir', 'kr', 'doorOpen_1.ogg')
k('monedas', 'Monedas', 'impactos', 'monedas dinero caja', 'kr', 'handleCoins.ogg')

# --- ambiente ---
g('multitud', 'Multitud gritando', 'ambiente', 'multitud gente público estadio gritos', 'crowd-shoutingspeaking-ambience', 'crowd_shouting_0.ogg', kb=40, ch=2, pk=-9, loop=False)
k('motor-circular', 'Motor circular', 'ambiente', 'motor máquina zumbido ciencia ficción', 'ks', 'engineCircular_000.ogg', kb=40, pk=-9)
k('motor-espacial', 'Motor de nave', 'ambiente', 'motor nave espacio zumbido', 'ks', 'spaceEngineLow_000.ogg', kb=40, pk=-9)
k('crujido', 'Crujido de madera', 'ambiente', 'crujido madera casa vieja terror', 'kr', 'creak1.ogg')

# --- risas y aplausos ---
g('aplausos', 'Aplausos de sala', 'risas', 'aplausos palmas público sala ovación', 'applause-in-a-large-hall-or-church', 'applause-clapping-church-crowd-immersive.wav', kb=40, ch=2, pk=-6, t=30, fade=1.5)
g('risitas-grupo', 'Risitas de grupo', 'risas', 'risas risitas grupo gente', 'group-giggling', 'group_giggling.ogg', kb=32)
g('risa-bruja', 'Risa de bruja', 'risas', 'risa bruja cacareo terror', 'witch-cackle', 'witch_cackle-1_0.ogg')
g('risas-maniacas', 'Risas maníacas', 'risas', 'risa maníaca malvada villano', 'maniacal-laughter-pack-1', 'maniacal_laughter_pack_1.ogg', kb=32, t=20, fade=1)
g('risa-malvada', 'Risa malvada', 'risas', 'risa malvada villano', 'evil-laugh', 'laugh-evil-1_0.ogg')
for n in (1, 3, 5):
    g('risa-malvada-%d' % (n + 1), 'Risa malvada %d' % (n + 1), 'risas', 'risa malvada villano', 'evil-laughs-pack', 'Laugh %d.mp3' % n, z='evil_laughs.zip', kb=32)

# --- sirenas y alarmas ---
g('sirena', 'Sirena', 'sirenas', 'sirena policía ambulancia emergencia', 'sirens-and-alarm-noise', 'siren_0.mp3', kb=32, t=20, fade=0.8, ch=1)
g('alarma-1', 'Alarma de pitidos', 'sirenas', 'alarma pitidos aviso peligro', 'alarm-2', 'alarm_0.wav', kb=32, ch=1)
g('alarma-2', 'Alarma larga', 'sirenas', 'alarma aviso peligro despertador', 'alarm-sound-effect', 'alarm_2.wav', kb=32)
g('alarma-3', 'Alarma corta', 'sirenas', 'alarma aviso peligro', 'alarm-1', 'alarm_2.ogg')
g('alarma-4', 'Alarma breve', 'sirenas', 'alarma aviso peligro', 'short-alarm', 'alarm_0.ogg')

# --- naturaleza ---
g('lluvia-1', 'Lluvia constante (bucle)', 'naturaleza', 'lluvia llover agua ambiente tormenta', 'rain-loopable', '1.ogg', z='Rain OGG.zip', kb=40, ch=2, pk=-9, loop=True)
g('lluvia-2', 'Lluvia suave (bucle)', 'naturaleza', 'lluvia llover agua ambiente suave', 'rain-loopable', '2.ogg', z='Rain OGG.zip', kb=40, ch=2, pk=-9, loop=True)
g('lluvia-truenos', 'Lluvia con trueno', 'naturaleza', 'lluvia trueno tormenta relámpago', 'rain-long-thunder', 'rain-thunder.ogg', kb=40, ch=2, pk=-9)
g('pajaros', 'Pájaros del bosque', 'naturaleza', 'pájaros aves bosque canto mañana', 'ambient-bird-sounds', 'birds-isaiah658_0.ogg', kb=40, ch=2, pk=-9)
g('pajaros-cortos', 'Gorjeo de pájaros', 'naturaleza', 'pájaros aves gorjeo canto', 'bird-chirping-sounds', 'birdchirping071414_0.mp3', kb=40, ch=2, pk=-6)
g('grillos', 'Grillos nocturnos (bucle)', 'naturaleza', 'grillos grillo noche campo insectos', 'crickets-ambient-noise-loopable', 'crickets_1.mp3', kb=40, ch=2, pk=-9, loop=True)
g('olas-1', 'Ola de mar 1', 'naturaleza', 'olas mar playa agua', 'water-waves', 'wave_01_cc0-11505__transitking__wavesound.flac', kb=40, ch=2, pk=-6)
g('olas-playa-1', 'Olas en la playa 1', 'naturaleza', 'olas mar playa agua orilla', 'beach-ocean-waves', 'wave_01_cc0-18363__jasinski__alkaibeach.flac', kb=40, ch=2, pk=-6)
g('viento-1', 'Viento suave', 'naturaleza', 'viento aire brisa ambiente', 'wind', 'Wind.ogg', z='wind.zip', kb=40, pk=-6)
g('viento-2', 'Viento fuerte', 'naturaleza', 'viento aire racha ambiente', 'wind', 'Wind2.ogg', z='wind.zip', kb=40, pk=-6)
g('fuego', 'Fuego crepitando', 'naturaleza', 'fuego hoguera crepitar llamas', 'fire-crackling', 'fire-1_0.ogg', kb=40, pk=-6)
g('chimenea', 'Chimenea (bucle)', 'naturaleza', 'fuego chimenea hoguera llamas crepitar', 'fireplace-sound-loop', 'fire.wav', kb=40, ch=2, pk=-9, loop=True)

# --- jingles (Kenney) ---
for i, (n, nm) in enumerate([('NES00', 'Jingle 8 bits 1'), ('NES05', 'Jingle 8 bits 2'), ('HIT00', 'Jingle de golpe 1'), ('HIT05', 'Jingle de golpe 2'),
                              ('PIZZI00', 'Jingle de pizzicato 1'), ('PIZZI06', 'Jingle de pizzicato 2'), ('SAX00', 'Jingle de saxofón 1'), ('SAX05', 'Jingle de saxofón 2'),
                              ('STEEL00', 'Jingle de acero 1'), ('STEEL05', 'Jingle de acero 2')]):
    fam = re.match(r'[A-Z]+', n).group(0)
    tg = {'NES': 'retro 8 bits videojuego', 'HIT': 'golpe remate final', 'PIZZI': 'pizzicato cuerdas alegre', 'SAX': 'saxofón jazz', 'STEEL': 'acero percusión'}[fam]
    k('jingle-' + n.lower(), nm, 'jingles', 'jingle logo intro final ' + tg, 'kj', 'jingles_%s.ogg' % n, ch=2, kb=48, pk=-3)
k('subida-1', 'Subida de nivel', 'jingles', 'jingle subida nivel logro mejora', 'kd', 'powerUp3.ogg')
k('subida-2', 'Mejora conseguida', 'jingles', 'jingle logro mejora premio', 'kd', 'powerUp8.ogg')
k('tres-tonos', 'Tres tonos', 'jingles', 'jingle aviso notificación tonos', 'kd', 'threeTone1.ogg')
k('dos-tonos', 'Dos tonos', 'jingles', 'jingle aviso notificación tonos', 'kd', 'twoTone1.ogg')

# --- música de fondo (OpenGameArt, CC0) ---
M = dict(ch=2, kb=56, music=True)
g('musica-vaquero', 'Vaquero (bucle)', 'musica', 'música fondo bucle western alegre guitarra', 'lasso-lady-seamless-loop', 'lassolady_4.ogg', loop=True, ch=1, kb=48, music=True)
g('musica-campos', 'Campos de flores (bucle)', 'musica', 'música fondo bucle suave tranquilo naturaleza', 'flowerbed-fields-loop', 'flowerbed_fields.ogg', loop=True, **M)
g('musica-parque', 'Parque de verano 8 bits (bucle)', 'musica', 'música fondo bucle retro 8 bits videojuego alegre', 'summer-park-8bit-tune-loop', '8bit attempt.ogg', loop=True, **M)
g('musica-celestial', 'Celestial (bucle)', 'musica', 'música fondo bucle etéreo calma', 'heavenly-loop', 'Heavenly Loop_0.ogg', loop=True, **M)
g('musica-ambiental', 'Ambiental relajante (bucle)', 'musica', 'música fondo bucle ambiental relajante calma', 'ambient-relaxing-loop', 'Ambient-Loop-isaiah658_0.ogg', loop=True, **M)
g('musica-fiebre-chill', 'Chill suave (bucle)', 'musica', 'música fondo bucle chill relajado electrónica', 'a-chill-fever-loopable', 'a_chill_fever_0.mp3', loop=True, **M)
g('musica-piano', 'Piano emotivo (bucle)', 'musica', 'música fondo bucle piano emotiva', 'emotional-piano-loop', 'Piano Loop.wav', loop=True, **M)
g('musica-percusion', 'Percusión cinematográfica (bucle)', 'musica', 'música fondo bucle percusión cine tensión épica', 'cinematic-percussion-loop', 'Cinematic percussion loop 2.wav', loop=True, **M)
g('musica-lofi-otra-vez', 'Lofi otra vez', 'musica', 'música fondo lofi chill relajado estudio', 'lofi-again', 'lofiagain.ogg', ch=1, kb=48, music=True)
g('musica-lofi-inspirada', 'Lofi inspirado', 'musica', 'música fondo lofi chill relajado estudio', 'chill-lofi-inspired', 'ChillLofi.ogg', t=90, fade=3, **M)
g('musica-nube', 'Siesta en una nube', 'musica', 'música fondo tranquilo suave sueño calma', 'napping-on-a-cloud', 'napping_on_a_cloud.ogg', t=90, fade=3, **M)


def die(m):
    print('ERROR:', m, file=sys.stderr); sys.exit(1)

def http(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60).read()

def oga_info(slug):
    """Lee la página de OpenGameArt: licencias (nombres), autor, título."""
    h = http('https://opengameart.org/content/' + slug).decode('utf8', 'replace')
    i = h.find('field-name-field-art-licenses')
    seg = h[i:i + 900] if i >= 0 else ''
    lic = re.findall(r"license-name'>([^<]*)", seg)
    au = re.search(r"<span class='username'><a[^>]*>([^<]*)", h)
    ti = re.search(r'<title>(.*?)\s*\|', h, re.S)
    files = list(dict.fromkeys(re.findall(r'href="(https://opengameart.org/sites/default/files/[^"]+)"', h)))
    return dict(lic=lic, autor=html.unescape(au.group(1)).strip() if au else None, titulo=html.unescape(ti.group(1)).strip() if ti else slug, files=files)

def kenney_verify(slug, cache):
    page = http('https://kenney.nl/assets/' + slug).decode('utf8', 'replace')
    if 'Creative Commons CC0' not in page: die('Kenney %s: la página no declara CC0' % slug)
    zu = re.search(r'https://kenney.nl/media/pages/assets/[^"]*\.zip', page)
    if not zu: die('Kenney %s: no hay zip' % slug)
    d = os.path.join(cache, slug)
    if not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)
        zp = d + '.zip'
        open(zp, 'wb').write(http(zu.group(0)))
        zipfile.ZipFile(zp).extractall(d)
    lic = open(os.path.join(d, 'License.txt'), encoding='utf8', errors='replace').read()
    if 'Creative Commons Zero, CC0' not in lic: die('Kenney %s: License.txt no es CC0' % slug)
    return d

def find(base, name):
    hits = []
    for r, _, fs in os.walk(base):
        for f in fs:
            if f == name: hits.append(os.path.join(r, f))
    if len(hits) != 1: die('%s: %d coincidencias para %s' % (base, len(hits), name))
    return hits[0]

def run(ff, args):
    return subprocess.run([ff, '-hide_banner', '-nostdin'] + args, capture_output=True, text=True)

def duration(ff, p):
    r = run(ff, ['-i', p]).stderr
    m = re.search(r'Duration: (\d+):(\d+):([\d.]+)', r)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))

def peak(ff, src, pre):
    r = run(ff, ['-i', src] + pre + ['-af', 'volumedetect', '-f', 'null', '-']).stderr
    m = re.search(r'max_volume: (-?[\d.]+) dB', r)
    return float(m.group(1)) if m else 0.0

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', required=True)
    ap.add_argument('--ffmpeg')
    a = ap.parse_args()
    ff = a.ffmpeg
    if not ff:
        import imageio_ffmpeg; ff = imageio_ffmpeg.get_ffmpeg_exe()
    os.makedirs(a.cache, exist_ok=True); os.makedirs(OUT, exist_ok=True)
    ids = [s[0] for s in S]
    if len(ids) != len(set(ids)): die('ids duplicados')
    kcache, ocache, oinfo = {}, {}, {}
    out, lic_rows = [], []
    for (id, nombre, cat, tags, src, f, o) in S:
        if src.startswith('oga:'):
            slug = src[4:]
            if slug not in oinfo:
                oinfo[slug] = oga_info(slug)
            inf = oinfo[slug]
            if inf['lic'] != ['CC0']: die('OpenGameArt %s: licencias %r (se exige exactamente CC0)' % (slug, inf['lic']))
            if not inf['autor']: die('OpenGameArt %s: sin autor' % slug)
            base = os.path.join(a.cache, 'oga', slug)
            if not os.path.isdir(base):
                os.makedirs(base)
                for u in inf['files']:
                    fn = urllib.parse.unquote(u.split('/')[-1])
                    open(os.path.join(base, fn), 'wb').write(http(u))
            if o.get('z'):
                zp = find(base, o['z'])
                zd = os.path.join(base, '_x_' + o['z'])
                if not os.path.isdir(zd): zipfile.ZipFile(zp).extractall(zd)
                srcf = find(zd, f)
            else:
                srcf = find(base, f)
            autor, fuente, licencia = inf['autor'], 'https://opengameart.org/content/' + slug, 'CC0-1.0'
            paquete = inf['titulo']
        else:
            slug = KEN[src]
            if slug not in kcache: kcache[slug] = kenney_verify(slug, os.path.join(a.cache, 'kenney'))
            srcf = find(kcache[slug], f)
            autor, fuente, licencia = 'Kenney (kenney.nl)', 'https://kenney.nl/assets/' + slug, 'CC0-1.0'
            paquete = 'Kenney · ' + slug
        music = o.get('music'); ch = o.get('ch', 1); kb = o.get('kb', 32 if not music else 56)
        pre = ['-t', str(o['t'])] if o.get('t') else []
        pk = o.get('pk', -3 if not music else -6)
        af = []
        if music:
            # sonoridad común para la música (~ -18 LUFS): una pasada de loudnorm
            af.append('loudnorm=I=-18:TP=-2:LRA=11')
        else:
            g_db = max(-20.0, min(24.0, pk - peak(ff, srcf, pre)))
            af.append('volume=%.2fdB' % g_db)
        if o.get('fade') and o.get('t'):
            af.append('afade=t=out:st=%.2f:d=%.2f' % (o['t'] - o['fade'], o['fade']))
        dst = os.path.join(OUT, id + '.ogg')
        args = ['-y', '-i', srcf] + pre + ['-vn', '-map_metadata', '-1', '-af', ','.join(af), '-ac', str(ch), '-ar', '48000', '-c:a', 'libopus', '-b:a', '%dk' % kb, '-application', 'audio', dst]
        r = run(ff, args)
        if r.returncode != 0 or not os.path.exists(dst): die('ffmpeg falló en %s:\n%s' % (id, r.stderr[-800:]))
        data = open(dst, 'rb').read()
        d = duration(ff, dst)
        e = dict(id=id, nombre=nombre, categoria=cat, duracion=round(d, 2), etiquetas=sorted(set(tags.split())), autor=autor, fuente=fuente,
                 licencia=licencia, sha256=hashlib.sha256(data).hexdigest(), archivo=id + '.ogg', bytes=len(data), bucle=bool(o.get('loop')), canales=ch)
        out.append(e)
        lic_rows.append((id, nombre, autor, fuente, paquete, os.path.basename(srcf)))
        print('%-24s %6.1fs %6d B' % (id, d, len(data)))
    total = sum(e['bytes'] for e in out)
    idx = dict(version=1, verificado=FECHA, licencias_permitidas=['CC0-1.0'], presupuesto_bytes=12 * 1024 * 1024,
               categorias=[dict(id=i, nombre=n) for i, n in CATS], sonidos=out)
    json.dump(idx, open(os.path.join(OUT, 'index.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    # LICENCIAS.md
    L = ['# Licencias de la biblioteca de sonidos', '',
         'Todos los archivos de esta carpeta son **CC0 1.0 (dominio público)**: https://creativecommons.org/publicdomain/zero/1.0/deed.es',
         'No exigen atribución; se agradece igualmente a sus autores.', '',
         '## Cómo se verificó', '',
         '- **Kenney** (kenney.nl): la página de cada paquete indica «Creative Commons CC0» y el zip incluye `License.txt` con «Creative Commons Zero, CC0».',
         '- **OpenGameArt.org**: la página de cada recurso se leyó el %s y se aceptó SOLO si su lista de licencias es exactamente «CC0» (se descartaron los que ofrecen CC-BY, OGA-BY o varias licencias).' % FECHA,
         '- `scripts/sounds/build-sounds.py` repite esa comprobación y aborta si algo deja de ser CC0.',
         '- Límite honesto: en OpenGameArt la licencia la declara quien sube el recurso; no se puede comprobar que el autor tenga todos los derechos.', '',
         '## Método de codificación', '',
         'Cada original (OGG, MP3, WAV o FLAC) se recodificó con ffmpeg + libopus a OGG/Opus (mono 32–48 kbit/s en efectos; estéreo 40–56 kbit/s en ambiente y música), a 48 kHz.',
         'Los efectos se normalizan a pico -3 dBFS (los ambientes a -9/-6) y la música a ≈ -18 LUFS. Algunos se recortaron (se indica en el índice por su duración).', '',
         '## Archivos', '', '| Archivo | Nombre | Autor | Fuente (página de la licencia) | Original |', '|---|---|---|---|---|']
    for (id, nombre, autor, fuente, paquete, orig) in lic_rows:
        L.append('| `%s.ogg` | %s | %s | %s | %s · `%s` |' % (id, nombre, autor, fuente, paquete, orig))
    L += ['', 'Total: %d archivos, %.2f MB.' % (len(out), total / 1048576), '']
    open(os.path.join(OUT, 'LICENCIAS.md'), 'w', encoding='utf8').write('\n'.join(L))
    print('TOTAL', len(out), 'archivos', round(total / 1048576, 2), 'MB')

main()
