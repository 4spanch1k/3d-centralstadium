"""Пакетный рендер панорам по узлам из ../exports/nodes.json (Cycles). Можно прерывать и запускать снова: готовые пропускаются.

Запуск (фоном, с низким приоритетом):
  nice -n 19 Blender -b -P render_batch.py -- --glb ../exports/stadium-scene.glb [--ppd 22] [--samples 24] [--limit N]
Результат: JPEG во временной папке, затем WebP в outputs/stadium-pilot/public/panoramas и обновлённый index.json.
"""
import bpy, math, sys, os, time, json, subprocess
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.abspath(os.path.join(here, '..', '..'))
glb = os.path.abspath(arg('--glb'))
ppd = float(arg('--ppd', 22)); samples = int(arg('--samples', 24)); limit = int(arg('--limit', 10**9))
nodes = json.load(open(os.path.join(here, '..', 'exports', 'nodes.json')))
tmp = os.path.join(here, '..', 'exports', 'panos-tmp'); os.makedirs(tmp, exist_ok=True)
outdir = os.path.join(root, 'outputs/stadium-pilot/public/panoramas'); os.makedirs(outdir, exist_ok=True)
index_path = os.path.join(outdir, 'index.json')
sky = os.path.join(root, 'outputs/stadium-pilot/public/sky.hdr')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
scene = bpy.context.scene
world = bpy.data.worlds.new('World'); scene.world = world; world.use_nodes = True
nt = world.node_tree; nt.nodes.clear()
env = nt.nodes.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(sky)
bg = nt.nodes.new('ShaderNodeBackground'); out_w = nt.nodes.new('ShaderNodeOutputWorld')
nt.links.new(env.outputs['Color'], bg.inputs['Color']); nt.links.new(bg.outputs['Background'], out_w.inputs['Surface'])
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN')); scene.collection.objects.link(sun)
sun.data.energy = 4.0; sun.data.angle = math.radians(1.5); sun.data.color = (1.0, 0.94, 0.82)
sun.rotation_euler = (-Vector((-85, 70, 140)).normalized()).to_track_quat('-Z', 'Y').to_euler()
cam = bpy.data.objects.new('Pano', bpy.data.cameras.new('Pano')); scene.collection.objects.link(cam)
cam.data.type = 'PANO'
try: cam.data.panorama_type = 'EQUIRECTANGULAR'
except Exception: cam.data.cycles.panorama_type = 'EQUIRECTANGULAR'
scene.camera = cam
scene.render.engine = 'CYCLES'; scene.cycles.samples = samples; scene.cycles.use_denoising = True; scene.cycles.max_bounces = 4
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for d in prefs.devices: d.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    print('GPU недоступен:', e)
for transform in ('Khronos PBR Neutral', 'AgX'):
    try:
        scene.view_settings.view_transform = transform
        break
    except Exception:
        continue
scene.render.image_settings.file_format = 'JPEG'; scene.render.image_settings.quality = 90

done = json.load(open(index_path)) if os.path.exists(index_path) else []
done_ids = {n['id'] for n in done}
count = 0; started = time.time()
for node in nodes:
    if node['id'] in done_ids or os.path.exists(os.path.join(outdir, node['file'])): continue
    if count >= limit: break
    x, y, z = node['position']
    lon, up, down = node['lon'], node['latUp'], node['latDown']
    cam.location = (x, -z, y)
    cam.rotation_euler = (math.radians(90), 0, math.radians(180 if -z > 0 else 0))
    for owner in (cam.data, getattr(cam.data, 'cycles', None)):
        if owner is None: continue
        try:
            owner.longitude_min, owner.longitude_max = -math.radians(lon), math.radians(lon)
            owner.latitude_min, owner.latitude_max = -math.radians(down), math.radians(up)
            break
        except Exception: continue
    scene.render.resolution_x, scene.render.resolution_y = int(2 * lon * ppd), int((up + down) * ppd)
    jpg = os.path.join(tmp, node['id'] + '.jpg'); scene.render.filepath = jpg
    t = time.time(); bpy.ops.render.render(write_still=True)
    webp = os.path.join(outdir, node['file'])
    subprocess.run(['/opt/homebrew/bin/cwebp', '-q', '82', '-m', '4', jpg, '-o', webp], check=True, capture_output=True)
    os.remove(jpg)
    done.append({k: node[k] for k in ('id', 'stand', 'sector', 'file', 'position', 'yaw', 'lon', 'latUp', 'latDown')})
    json.dump(done, open(index_path, 'w'), ensure_ascii=False)
    count += 1
    print(f"[{len(done)}/{len(nodes)}] {node['id']} {round(time.time() - t, 1)} с, {os.path.getsize(webp) // 1024} КБ", flush=True)
print('Готово:', count, 'узлов за', round(time.time() - started), 'с')
