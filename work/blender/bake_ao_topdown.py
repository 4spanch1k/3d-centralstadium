"""Запекание затенения (ambient occlusion) в карту вида сверху для всей сцены (Cycles).

Идея: Blender один раз считает, сколько света неба доходит до каждой точки поверхностей (под креслами, в углах ступеней,
под крышей темнее). Результат сохраняется в одну ортографическую карту «вид сверху»; в браузере она накладывается на бетон,
дорожки и землю по мировым координатам (x, z) без нагрузки на видеокарту.

Запуск: Blender -b -P bake_ao_topdown.py -- --glb ../exports/stadium-scene.glb --out ../exports/ao-top.png [--px 4096] [--samples 192]
Для отдельной сцены Blender вместо --glb можно указать --blend, а для крыши
и мачт добавить по одному --extra-glb с путём к модели.
По умолчанию карта покрывает x in [-112, 112], z in [-96, 96] (Three.js).
Для увеличенной чаши используйте --bounds -125 125 -105 105 и обновите uAoRect в приложении вместе с картой.
Всё, что выше 5,5 м (крыша, мачты, кроны, кресла верхних ярусов, таблички), НЕ видно в кадре, но затеняет нижние поверхности.
"""
import bpy, sys, os, time, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default
glb = arg('--glb')
blend = arg('--blend')
if bool(glb) == bool(blend):
    raise ValueError('Specify exactly one of --glb or --blend')
out = os.path.abspath(arg('--out'))
px = int(arg('--px', 4096)); samples = int(arg('--samples', 192))
if '--bounds' in argv:
    index = argv.index('--bounds')
    X0, X1, Z0, Z1 = map(float, argv[index + 1:index + 5])
    if X0 >= X1 or Z0 >= Z1:
        raise ValueError('Bounds must have increasing X and Z limits')
else:
    X0, X1, Z0, Z1 = -112.0, 112.0, -96.0, 96.0
HIDE_ABOVE = 5.5

t0 = time.time()
if blend:
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(blend))
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(glb))
for index, value in enumerate(argv):
    if value == '--extra-glb':
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(argv[index + 1]))
scene = bpy.context.scene
bpy.context.view_layer.update()

# Скрыть от камеры всё высокое: оно остаётся в сцене и затеняет нижнее.
hidden = 0
for obj in scene.objects:
    if obj.type != 'MESH': continue
    zs = [(obj.matrix_world @ Vector(c)).z for c in obj.bound_box]
    if min(zs) > HIDE_ABOVE:
        obj.visible_camera = False; hidden += 1
print('Импорт:', round(time.time() - t0, 1), 'с; объектов', len(scene.objects), '; скрыто от камеры', hidden)

# Единый белый диффузный материал на всё, мир: белое небо (чистое затенение без прямого света).
white = bpy.data.materials.new('AOWhite'); white.use_nodes = True
white.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (1, 1, 1, 1)
white.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1.0
bpy.context.view_layer.material_override = white
world = bpy.data.worlds.new('W'); world.use_nodes = True; scene.world = world
world.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0

# Ортографическая камера строго сверху. Blender: y = -z(Three).
cam = bpy.data.objects.new('Top', bpy.data.cameras.new('Top')); scene.collection.objects.link(cam)
cam.data.type = 'ORTHO'; cam.data.ortho_scale = X1 - X0
cam.location = ((X0 + X1) / 2, -(Z0 + Z1) / 2, 80.0)
cam.rotation_euler = (0, 0, 0)       # смотрит вниз (-Z), вверх кадра = +y Blender = -z Three
cam.data.clip_start = cam.location.z - HIDE_ABOVE; cam.data.clip_end = 200.0
scene.camera = cam
scene.render.resolution_x = px; scene.render.resolution_y = int(px * (Z1 - Z0) / (X1 - X0))
scene.render.resolution_percentage = 100
scene.render.engine = 'CYCLES'; scene.cycles.samples = samples; scene.cycles.use_denoising = True
scene.cycles.max_bounces = 1
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
print('Рендер:', round(time.time() - t1, 1), 'с ->', out, os.path.getsize(out) // 1024, 'КБ')
