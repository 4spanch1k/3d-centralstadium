"""Рендер панорамы 360° из экспортированной сцены стадиона (Cycles).

Запуск:
  Blender -b -P render_panorama.py -- --glb ../exports/stadium-scene.glb --pos X Y Z --out out.jpg [--res 2048] [--samples 48]
Позиция --pos в координатах Three.js (x, y вверх, z). Сцена экспортируется из браузера: window.__debug.exportScene() при ?debug=1.
"""
import bpy, math, sys, os, time
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
def arg(name, default=None, count=1):
    if name in argv:
        i = argv.index(name)
        vals = argv[i + 1:i + 1 + count]
        return vals if count > 1 else vals[0]
    return default
glb = os.path.abspath(arg('--glb'))
x, y, z = [float(v) for v in arg('--pos', count=3)]
out = os.path.abspath(arg('--out'))
res = int(arg('--res', 2048))
samples = int(arg('--samples', 48))
# Ограниченный сектор обзора: полуширина по долготе и полувысота по широте (градусы) и плотность пикселей на градус.
lon = float(arg('--lon', 180)); lat_up = float(arg('--lat-up', 90)); lat_down = float(arg('--lat-down', 90))
ppd = float(arg('--ppd', 0)) or res / 360.0
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sky = os.path.join(root, 'outputs/stadium-pilot/public/sky.hdr')

bpy.ops.wm.read_factory_settings(use_empty=True)
t0 = time.time()
bpy.ops.import_scene.gltf(filepath=glb)
print('Импорт GLB:', round(time.time() - t0, 1), 'с, объектов:', len(bpy.data.objects))

scene = bpy.context.scene
# Мир: тот же HDR неба, что и в браузере.
world = bpy.data.worlds.new('World'); scene.world = world; world.use_nodes = True
nt = world.node_tree; nt.nodes.clear()
env = nt.nodes.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(sky)
bg = nt.nodes.new('ShaderNodeBackground'); bg.inputs['Strength'].default_value = 1.0
outn = nt.nodes.new('ShaderNodeOutputWorld')
nt.links.new(env.outputs['Color'], bg.inputs['Color']); nt.links.new(bg.outputs['Background'], outn.inputs['Surface'])

# Солнце: направление как у DirectionalLight в сцене (положение (-85, 140, -70) в Three.js).
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN')); scene.collection.objects.link(sun)
sun.data.energy = 4.0; sun.data.angle = math.radians(1.5); sun.data.color = (1.0, 0.94, 0.82)
direction = Vector((-85, 70, 140)).normalized()          # из точки на сцену, координаты Blender
sun.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()

# Камера-панорама в точке места: Three (x, y, z) -> Blender (x, -z, y).
cam = bpy.data.objects.new('Pano', bpy.data.cameras.new('Pano')); scene.collection.objects.link(cam)
cam.location = (x, -z, y)
cam.rotation_euler = (math.radians(90), 0, math.radians(180 if -z > 0 else 0))   # взгляд на поле
cam.data.type = 'PANO'
try: cam.data.panorama_type = 'EQUIRECTANGULAR'
except Exception: cam.data.cycles.panorama_type = 'EQUIRECTANGULAR'
for owner in (cam.data, getattr(cam.data, 'cycles', None)):
    if owner is None: continue
    try:
        owner.longitude_min, owner.longitude_max = -math.radians(lon), math.radians(lon)
        owner.latitude_min, owner.latitude_max = -math.radians(lat_down), math.radians(lat_up)
        break
    except Exception:
        continue
scene.camera = cam

scene.render.engine = 'CYCLES'
scene.render.resolution_x, scene.render.resolution_y = int(2 * lon * ppd), int((lat_up + lat_down) * ppd)
scene.cycles.samples = samples
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 4
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for d in prefs.devices: d.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    print('GPU недоступен, CPU:', e)
scene.view_settings.view_transform = 'AgX'
scene.render.image_settings.file_format = 'JPEG'; scene.render.image_settings.quality = 88
scene.render.filepath = out
t1 = time.time()
bpy.ops.render.render(write_still=True)
print('Рендер:', round(time.time() - t1, 1), 'с ->', out, os.path.getsize(out) // 1024, 'КБ')
