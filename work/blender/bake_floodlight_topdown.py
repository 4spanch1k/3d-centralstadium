"""Запекание вечернего света прожекторов в карту вида сверху (Cycles).

Четыре прожектора на мачтах освещают поле и трибуны; Blender считает, сколько света доходит до каждой точки (с тенями
от чаши, крыши и мачт). Результат сохраняется в одну ортографическую карту «вид сверху», как карта затенения
(bake_ao_topdown.py): в браузере в вечернем режиме она добавляется к освещённости поверхностей по мировым координатам (x, z).

Запуск: Blender -b -P bake_floodlight_topdown.py -- --glb ../exports/stadium-scene.glb --out ../exports/light-top.png [--px 2048] [--samples 128]
Границы и параметры --bounds / --extra-glb те же, что у bake_ao_topdown.py; карта должна покрывать ту же область.
Положение прожекторов: --masts "x,z;x,z;..." (Three.js, метры), высота --mast-height (по умолчанию 31).
"""
import bpy, sys, os, time, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default
glb = arg('--glb')
out = os.path.abspath(arg('--out'))
px = int(arg('--px', 2048)); samples = int(arg('--samples', 128))
power = float(arg('--power', 6.0e6))   # Вт на прожектор: подбирается по яркости поля на карте
mast_height = float(arg('--mast-height', 31.0))
masts = [tuple(map(float, item.split(','))) for item in arg('--masts', '-102,-90;-102,90;102,-90;102,90').split(';')]
if '--bounds' in argv:
    index = argv.index('--bounds')
    X0, X1, Z0, Z1 = map(float, argv[index + 1:index + 5])
else:
    X0, X1, Z0, Z1 = -112.0, 112.0, -96.0, 96.0
HIDE_ABOVE = 5.5

t0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(glb))
for index, value in enumerate(argv):
    if value == '--extra-glb':
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(argv[index + 1]))
scene = bpy.context.scene
bpy.context.view_layer.update()

# Высокое остаётся в сцене (даёт тени), но не попадает в кадр.
for obj in scene.objects:
    if obj.type != 'MESH': continue
    zs = [(obj.matrix_world @ Vector(c)).z for c in obj.bound_box]
    if min(zs) > HIDE_ABOVE:
        obj.visible_camera = False

white = bpy.data.materials.new('LightWhite'); white.use_nodes = True
white.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (1, 1, 1, 1)
white.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1.0
bpy.context.view_layer.material_override = white
world = bpy.data.worlds.new('W'); world.use_nodes = True; scene.world = world
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0, 0, 0, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0

# Прожекторы: Three.js (x, y, z) -> Blender (x, -z, y); цель — центр поля.
for index, (x, z) in enumerate(masts):
    light = bpy.data.lights.new(f'Mast{index}', 'SPOT')
    light.energy = power
    light.spot_size = math.radians(70)
    light.spot_blend = 0.6
    light.shadow_soft_size = 1.5
    obj = bpy.data.objects.new(f'Mast{index}', light)
    scene.collection.objects.link(obj)
    obj.location = (x, -z, mast_height)
    direction = Vector((0, 0, 0)) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

cam = bpy.data.objects.new('Top', bpy.data.cameras.new('Top')); scene.collection.objects.link(cam)
cam.data.type = 'ORTHO'; cam.data.ortho_scale = X1 - X0
cam.location = ((X0 + X1) / 2, -(Z0 + Z1) / 2, 80.0)
cam.rotation_euler = (0, 0, 0)
cam.data.clip_start = cam.location.z - HIDE_ABOVE; cam.data.clip_end = 200.0
scene.camera = cam
scene.render.resolution_x = px; scene.render.resolution_y = int(px * (Z1 - Z0) / (X1 - X0))
scene.render.resolution_percentage = 100
scene.render.engine = 'CYCLES'; scene.cycles.samples = samples; scene.cycles.use_denoising = True
scene.cycles.max_bounces = 2
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for d in prefs.devices: d.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    print('GPU недоступен:', e)
scene.view_settings.view_transform = 'Standard'; scene.view_settings.look = 'None'
scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'BW'; scene.render.image_settings.color_depth = '8'
scene.render.filepath = out
t1 = time.time(); bpy.ops.render.render(write_still=True)
print('Рендер:', round(time.time() - t1, 1), 'с ->', out, os.path.getsize(out) // 1024, 'КБ; всего', round(time.time() - t0, 1), 'с')
