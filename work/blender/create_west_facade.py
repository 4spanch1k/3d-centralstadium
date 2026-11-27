"""Главный фасад стадиона: арка-входная группа с пятью опорами, башнями с павильонами и крыльями.

Собран по фотографии главного фасада (Wikimedia Commons, Ortalyq-Almaty_2022e, автор CD, CC BY-SA 4.0) как ориентиру пропорций; геометрия своя,
размеры оценочные. Без логотипов, скульптур и надписей. Начало координат GLB уже в мировой точке сцены:
модель строится у точки Three.js x=0, z=-FACADE_Z лицом наружу (-z Three.js = +Y Blender).
В приложении она поворачивается и ставится за северной трибуной: так колоннада стоит на настоящем стадионе
(снимки Kazinform и NewTimes от 25.09.2025 использованы только для сверки, в проект не копировались).
Имена файлов west-facade.* остались с прежнего расположения.
Запуск: Blender -b -P work/blender/create_west_facade.py
Для отдельного теста: Blender -b -P work/blender/create_west_facade.py -- --z 103 --preview
"""
import argparse
import sys
import bpy, bmesh, math
from pathlib import Path
from mathutils import Matrix

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--z', type=float, default=103.0)
parser.add_argument('--preview', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
FACADE_Z = args.z  # расстояние от центра поля до оси фасада в Three.js
bpy.ops.wm.read_factory_settings(use_empty=True)

mats, bms = {}, {}
for name, color, rough, metal in (
    ('Facade stone', (0.62, 0.58, 0.50, 1), 0.92, 0.0),
    ('Facade stone dark', (0.42, 0.40, 0.36, 1), 0.95, 0.0),
    ('Facade trim', (0.78, 0.76, 0.70, 1), 0.85, 0.0),
    ('Facade steel', (0.10, 0.11, 0.12, 1), 0.5, 0.6),
    ('Facade gate', (0.80, 0.62, 0.04, 1), 0.55, 0.4),
    ('Facade white', (0.82, 0.82, 0.79, 1), 0.8, 0.0),
    ('Facade glass', (0.07, 0.11, 0.14, 1), 0.18, 0.2),
):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = color; b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    mats[name] = m; bms[name] = bmesh.new()

def box(mat, center, size, rotz=0.0, bevel=0.0):
    bm = bms[mat]
    verts = bmesh.ops.create_cube(bm, size=1.0)['verts']
    T = Matrix.Translation(center) @ Matrix.Rotation(rotz, 4, 'Z') @ Matrix.Diagonal((size[0], size[1], size[2], 1))
    bmesh.ops.transform(bm, matrix=T, verts=verts)
    if bevel:
        edges = list({e for v in verts for e in v.link_edges})
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=1, affect='EDGES')

def cyl(mat, center, radius, depth, segments=24):
    bm = bms[mat]
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=depth)
    bmesh.ops.rotate(bm, verts=res['verts'], cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
    bmesh.ops.translate(bm, verts=res['verts'], vec=center)

W_OPEN = 22.0           # ширина центрального проёма
H_OPEN = 10.0           # высота до низа балки: название над балюстрадой должно быть видно из чаши
D = 7.0                 # глубина прохода
# Пол прохода и ступени
box('Facade stone dark', (0, 0, 0.1), (W_OPEN + 17 * 2 + 6, D + 5, 0.2))
box('Facade stone dark', (0, D / 2 + 1.4, 0.18), (W_OPEN + 4, 1.6, 0.36))
# Пять опор
for x in (-11.0, -5.5, 0.0, 5.5, 11.0):
    box('Facade stone', (x, 0, H_OPEN / 2), (1.9, D - 1.0, H_OPEN), bevel=0.04)
    box('Facade trim', (x, 0, 0.45), (2.3, D - 0.6, 0.9))        # цоколь опоры
    box('Facade trim', (x, 0, H_OPEN - 0.25), (2.3, D - 0.6, 0.5))  # капитель
# Главная балка, кессонные балки потолка, карниз
box('Facade stone', (0, 0.2, H_OPEN + 0.75), (W_OPEN + 4.0, D + 0.8, 1.5), bevel=0.04)
for x in (-8.25, -2.75, 2.75, 8.25):
    box('Facade stone dark', (x, 0, H_OPEN - 0.35), (0.6, D - 0.8, 0.7))
box('Facade trim', (0, 0.35, H_OPEN + 1.65), (W_OPEN + 4.6, D + 1.2, 0.3))
# Балюстрада по верху
base_z = H_OPEN + 1.8
box('Facade trim', (0, 0.35, base_z + 0.1), (W_OPEN + 4.4, 0.6, 0.2))
box('Facade trim', (0, 0.35, base_z + 1.25), (W_OPEN + 4.4, 0.6, 0.18))
for i in range(int((W_OPEN + 4.0) / 0.7) + 1):
    x = -(W_OPEN + 4.0) / 2 + i * 0.7
    box('Facade trim', (x, 0.35, base_z + 0.68), (0.22, 0.3, 1.0))
# Флагштоки за балюстрадой; буквы названия добавляет приложение (текстурой).
for x in (-8.0, -4.8, -1.6, 1.6, 4.8, 8.0):
    box('Facade steel', (x, 0.1, base_z + 4.1), (0.09, 0.09, 5.6))
# Ворота-решётки между опорами (жёлтые) и ограждение
for a, b in ((-11.0, -5.5), (-5.5, 0.0), (0.0, 5.5), (5.5, 11.0)):
    cx, w = (a + b) / 2, (b - a) - 1.9
    box('Facade gate', (cx, D / 2 - 0.9, 3.2), (w, 0.08, 0.1))
    box('Facade gate', (cx, D / 2 - 0.9, 0.6), (w, 0.08, 0.1))
    box('Facade gate', (cx, D / 2 - 0.9, 5.7), (w, 0.08, 0.1))
    for k in range(int(w / 0.45) + 1):
        box('Facade gate', (cx - w / 2 + k * 0.45, D / 2 - 0.9, 3.15), (0.05, 0.06, 5.1))
# Башни по бокам: каменный объём, декоративная панель с медальонами, карниз
for side in (-1, 1):
    tx = side * (W_OPEN / 2 + 2.0 + 4.5)
    box('Facade stone', (tx, 0.5, 7.2), (9.0, D + 2.0, 14.4), bevel=0.05)
    box('Facade trim', (tx, 0.5, 14.55), (9.6, D + 2.6, 0.5))                 # карниз
    box('Facade stone dark', (tx, 0.5, 0.6), (9.6, D + 2.6, 1.2))              # цоколь
    # белый павильон с окнами на башне: виден из чаши над верхним рядом
    box('Facade white', (tx, 0.5, 16.35), (7.4, D + 0.6, 3.1), bevel=0.05)
    for face in (-1, 1):
        box('Facade glass', (tx, 0.5 + face * (D + 0.62) / 2, 16.5), (6.4, 0.08, 1.35))
        for k in range(-3, 4):
            box('Facade white', (tx + k * 1.07, 0.5 + face * (D + 0.72) / 2, 16.5), (0.1, 0.06, 1.35))
    box('Facade trim', (tx, 0.5, 18.05), (8.4, D + 1.6, 0.3))
    box('Facade stone dark', (tx, D / 2 + 1.55, 11.4), (6.4, 0.18, 2.2))        # панель
    for k in (-2.0, 0.0, 2.0):
        cyl('Facade trim', (tx + k, D / 2 + 1.7, 11.4), 0.8, 0.12)            # медальоны
    for k in (-2.4, 2.4):                                                      # пилястры
        box('Facade trim', (tx + k * 1.35, D / 2 + 1.58, 6.2), (0.5, 0.2, 8.4))
    # цоколь под скульптуру (без скульптуры)
    box('Facade stone dark', (tx + side * 6.0, D / 2 + 2.0, 0.75), (3.4, 3.0, 1.5))
    box('Facade trim', (tx + side * 6.0, D / 2 + 2.0, 1.6), (3.8, 3.4, 0.2))
    # дальнее крыло: низкая изогнутая стена с окнами
    for j in range(1, 4):
        wx = tx + side * (4.5 + j * 5.2)
        box('Facade stone', (wx, 0.5 + j * 0.5, 3.6), (5.4, 2.4, 7.2), rotz=side * j * 0.1)
        box('Facade stone dark', (wx, 0.5 + j * 0.5 + 1.25, 3.3), (3.4, 0.1, 1.5), rotz=side * j * 0.1)
        box('Facade trim', (wx, 0.5 + j * 0.5, 7.3), (5.6, 2.6, 0.25), rotz=side * j * 0.1)

for name, bm in bms.items():
    mesh = bpy.data.meshes.new(name); bm.to_mesh(mesh); bm.free(); mesh.materials.append(mats[name])
    for poly in mesh.polygons: poly.use_smooth = False
    obj = bpy.data.objects.new(name, mesh); bpy.context.collection.objects.link(obj)

# Переносим в мировую точку: Three.js z = -FACADE_Z -> Blender y = +FACADE_Z; лицом наружу (+Y Blender).
for obj in bpy.data.objects:
    obj.location = (0, FACADE_Z, 0)
if args.preview:
    blend_path = root / 'work/exports/west-facade-scaled.blend'
    glb_path = root / 'work/exports/west-facade-scaled.glb'
else:
    blend_path = root / 'work/blender/west-facade.blend'
    glb_path = root / 'outputs/stadium-pilot/public/west-facade.glb'
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format='GLB')
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects)
print('Facade exported:', len(bpy.data.objects), 'objects,', tris, 'triangles')
