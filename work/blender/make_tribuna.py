"""Детальная западная трибуна (10 рядов x 40 мест) для прототипа.

Запуск:  Blender -b -P make_tribuna.py -- [--render preview.png]
Результат: tribuna-realistic.blend и GLB в outputs/stadium-pilot/public.

Раскладка рядов и кресел совпадает с tribuna-maket.glb / tribuna-test.html:
ряд r: Z(three) = -53 - r*1.15, высота ступени r*0.62, 40 мест с шагом 0.78,
проход на местах 19-20. В Blender ось Y = -Z(three), Z = Y(three).
"""
import bpy, bmesh, math, os, sys
from mathutils import Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_GLB = os.path.join(ROOT, 'outputs/stadium-pilot/public/tribuna-realistic.glb')
OUT_BLEND = os.path.join(HERE, 'tribuna-realistic.blend')
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
RENDER = args[args.index('--render') + 1] if '--render' in args else None

ROWS, SEATS = 10, 40
ROW_D, RISE, SEAT_PITCH = 1.15, 0.62, 0.78
Y0 = 53.0            # Y ряда 0 (= -Z three)
FLOOR = -0.35
HALF_W = 16.0
AISLE = 0.87

def zt(r): return r * RISE + 0.10         # верх ступени (по высоте)
def yr(r): return Y0 + r * ROW_D

bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, color, rough=0.8, metal=0.0, emit=None, emit_strength=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = emit_strength
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
    return m

MATS = {
    'Бетон': mat('Бетон', (0.50, 0.52, 0.50), 0.92),
    'Бетон тёмный': mat('Бетон тёмный', (0.30, 0.32, 0.32), 0.95),
    'Кромка ступени': mat('Кромка ступени', (0.82, 0.83, 0.78), 0.7),
    'Синие кресла': mat('Синие кресла', (0.02, 0.11, 0.42), 0.45),
    'Жёлтые кресла': mat('Жёлтые кресла', (0.78, 0.55, 0.05), 0.45),
    'Каркас кресел': mat('Каркас кресел', (0.05, 0.05, 0.06), 0.4, 0.6),
    'Металл': mat('Металл', (0.75, 0.78, 0.80), 0.32, 1.0),
    'LED': mat('LED', (0.1, 0.35, 1.0), 0.4, 0, (0.1, 0.4, 1.0), 6.0),
    'Стекло': mat('Стекло', (0.75, 0.9, 0.95), 0.05, 0, alpha=0.22),
}
bms = {k: bmesh.new() for k in MATS}

def box(key, c, s, rotx=0.0, bevel=0.0):
    bm = bms[key]
    verts = bmesh.ops.create_cube(bm, size=1.0)['verts']
    m = Matrix.Translation(c) @ Matrix.Rotation(rotx, 4, 'X') @ Matrix.Diagonal((s[0], s[1], s[2], 1))
    bmesh.ops.transform(bm, matrix=m, verts=verts)
    if bevel:
        edges = list({e for v in verts for e in v.link_edges})
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=2, affect='EDGES')

def seat(x, y, r, block):
    t = zt(r)
    key = 'Синие кресла' if block == 1 else 'Жёлтые кресла'
    box(key, (x, y, t + 0.47), (0.46, 0.44, 0.09), bevel=0.025)              # подушка
    box(key, (x, y + 0.20, t + 0.76), (0.46, 0.07, 0.50), -0.14, bevel=0.025)  # спинка
    for sx in (-1, 1):
        box('Каркас кресел', (x + sx * 0.255, y + 0.04, t + 0.64), (0.035, 0.40, 0.035))   # подлокотник
        box('Каркас кресел', (x + sx * 0.255, y + 0.08, t + 0.33), (0.035, 0.05, 0.62))    # опора
    box('Каркас кресел', (x, y + 0.10, t + 0.04), (0.50, 0.05, 0.05))                       # поперечина

for r in range(ROWS):
    y, t = yr(r), zt(r)
    front, back = y - ROW_D / 2, y + ROW_D / 2
    # боковые части ступени (без прохода)
    for sgn in (-1, 1):
        w = HALF_W - AISLE
        box('Бетон', (sgn * (AISLE + w / 2), y, (FLOOR + t) / 2), (w, ROW_D, t - FLOOR))
        box('Кромка ступени', (sgn * (AISLE + w / 2), front + 0.03, t + 0.005), (w, 0.06, 0.012))
        # боковые парапеты
        box('Бетон тёмный', (sgn * (HALF_W + 0.15), y, (FLOOR + t + 0.85) / 2), (0.3, ROW_D, t + 0.85 - FLOOR))
    # проход: две ступени по 0.31
    for i, (ya, top) in enumerate(((front + ROW_D / 4, t - 0.31), (back - ROW_D / 4, t))):
        box('Бетон', (0, ya, (FLOOR + top) / 2), (AISLE * 2, ROW_D / 2, top - FLOOR))
        box('Кромка ступени', (0, ya - ROW_D / 4 + 0.03, top + 0.005), (AISLE * 2, 0.06, 0.012))
    # кресла
    for s in range(SEATS):
        if s in (19, 20): continue
        seat((s - 19.5) * SEAT_PITCH, y + 0.05, r, (s // 10) % 2)

# поручни прохода
y_a, z_a = yr(0) - ROW_D / 2, zt(0) - 0.31
y_b, z_b = yr(ROWS - 1) + ROW_D / 2, zt(ROWS - 1)
run, rise = y_b - y_a, z_b - z_a
L, ang = math.hypot(run, rise), math.atan2(rise, run)
for sgn in (-1, 1):
    x = sgn * (AISLE - 0.02)
    box('Металл', (x, (y_a + y_b) / 2, (z_a + z_b) / 2 + 0.95), (0.045, L, 0.045), ang, bevel=0.01)
    box('Металл', (x, (y_a + y_b) / 2, (z_a + z_b) / 2 + 0.5), (0.03, L, 0.03), ang)
    n = int(run / (ROW_D / 2))
    for i in range(n + 1):
        yy = y_a + i * (ROW_D / 2)
        zz = z_a + (yy - y_a) * rise / run
        box('Металл', (x, yy, zz + 0.47), (0.04, 0.04, 0.95))

# барьер перед первым рядом: бетон + LED-лента + стеклянный экран с поручнем
yb = yr(0) - ROW_D / 2 - 0.3
box('Бетон тёмный', (0, yb, (FLOOR + 0.55) / 2), (HALF_W * 2 + 0.6, 0.22, 0.55 - FLOOR))
box('LED', (0, yb - 0.115, 0.15), (HALF_W * 2, 0.02, 0.07))
box('Стекло', (0, yb, 0.55 + 0.30), (HALF_W * 2, 0.025, 0.6))
box('Металл', (0, yb, 1.17), (HALF_W * 2, 0.06, 0.05), bevel=0.01)
for x in range(-16, 17, 2):
    box('Металл', (x, yb, 0.86), (0.04, 0.05, 0.62))

# задняя стена и светящаяся полоса под крышей
yw = yr(ROWS - 1) + ROW_D / 2 + 0.25
box('Бетон тёмный', (0, yw, (FLOOR + zt(ROWS - 1) + 3.2) / 2), (HALF_W * 2 + 0.6, 0.5, zt(ROWS - 1) + 3.2 - FLOOR))
box('LED', (0, yw - 0.26, zt(ROWS - 1) + 2.7), (HALF_W * 2, 0.02, 0.08))

# сборка объектов
col = bpy.data.collections.new('Трибуна'); bpy.context.scene.collection.children.link(col)
for key, bm in bms.items():
    me = bpy.data.meshes.new(key); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = key in ('Синие кресла', 'Жёлтые кресла')
    me.materials.append(MATS[key])
    ob = bpy.data.objects.new(key, me); col.objects.link(ob)

bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', export_apply=True,
                          export_cameras=False, export_lights=False, export_yup=True)
print('GLB:', OUT_GLB, os.path.getsize(OUT_GLB) // 1024, 'KB')

if RENDER:
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 48; sc.cycles.device = 'CPU'
    sc.render.resolution_x, sc.render.resolution_y = 1400, 800
    sc.cycles.use_denoising = True
    w = bpy.data.worlds.new('w'); w.use_nodes = True; sc.world = w
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.7, 0.9, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
    sun.data.energy = 4; sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    gp = bpy.data.objects.new('g', bpy.data.meshes.new('g'))
    bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=80, matrix=Matrix.Translation((0, 30, FLOOR)))
    bm.to_mesh(gp.data); sc.collection.objects.link(gp)
    gm = mat('g', (0.2, 0.42, 0.2), 1); gp.data.materials.append(gm)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam)
    cam.location = (-9, 44, 6.5); cam.rotation_euler = (math.radians(75), 0, math.radians(-15)); cam.data.lens = 30
    sc.camera = cam
    sc.render.filepath = RENDER; bpy.ops.render.render(write_still=True)
