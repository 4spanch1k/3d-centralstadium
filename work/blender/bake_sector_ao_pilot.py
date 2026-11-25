"""Пробное запекание Cycles AO для кресел или бетона выбранного сектора.

Запуск: caffeinate -i nice -n 10 Blender -b -P work/blender/bake_sector_ao_pilot.py -- --stand west --sector 9 --surface seat
Результат 800×34 в work/exports/seat-light-pilot/, A отмечает существующие пробы. Это только проверка стоимости и качества одной поверхности;
полноценное освещение и бетон требуют отдельной проверки.
"""
import argparse
import json
import math
import time
import sys
from pathlib import Path

import bpy

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--surface', choices=('seat', 'concrete'), default='seat')
parser.add_argument('--stand', choices=('west', 'east'), default='west')
parser.add_argument('--sector', type=int, default=9)
parser.add_argument('--samples', type=int, default=64)
parser.add_argument('--all', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
out = root / 'work/exports/seat-light-pilot'
out.mkdir(parents=True, exist_ok=True)
seats = json.loads((root / 'work/exports/seats-full.json').read_text())
if not args.all:
    seats = [s for s in seats if s['stand'] == args.stand and s['sector'] == args.sector]
if len({(s['rowIndex'], s['pathIndex']) for s in seats}) != len(seats):
    raise ValueError('Индексы мест должны быть уникальны')
if not seats:
    raise ValueError('В указанном секторе нет мест')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root / 'work/exports/stadium-scene.glb'))
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = args.samples
scene.cycles.use_denoising = False
preferences = bpy.context.preferences.addons['cycles'].preferences
preferences.compute_device_type = 'METAL'
preferences.get_devices()
for device in preferences.devices:
    device.use = True
scene.cycles.device = 'GPU'
world = bpy.data.worlds.new('AO World')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
scene.world = world
image = bpy.data.images.new('AO seat pilot', width=800, height=34, alpha=True)
image.colorspace_settings.name = 'Non-Color'
image.generated_color = (0, 0, 0, 0)
material = bpy.data.materials.new('AO bake target')
material.use_nodes = True
texture = material.node_tree.nodes.new('ShaderNodeTexImage')
texture.image = image
material.node_tree.nodes.active = texture
vertices, faces, coordinates = [], [], []
for seat in seats:
    x, y, z = seat['x'], -seat['z'], seat['y'] - 1 + 0.2
    if args.surface == 'concrete':
        length = math.hypot(x, y)
        x, y, z = x - 0.36 * y / length, y + 0.36 * x / length, z - 0.44
    first = len(vertices)
    vertices.extend([(x - 0.12, y - 0.12, z), (x + 0.12, y - 0.12, z),
                     (x + 0.12, y + 0.12, z), (x - 0.12, y + 0.12, z)])
    faces.append((first, first + 1, first + 2, first + 3))
    u0, u1 = (seat['pathIndex'] + 0.05) / 800, (seat['pathIndex'] + 0.95) / 800
    v0, v1 = (33 - seat['rowIndex'] + 0.05) / 34, (33 - seat['rowIndex'] + 0.95) / 34
    coordinates.extend([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
mesh = bpy.data.meshes.new('Seat probe surfaces')
mesh.from_pydata(vertices, [], faces)
mesh.materials.append(material)
uv = mesh.uv_layers.new(name='Probe pixel')
for loop, coordinate in zip(uv.data, coordinates):
    loop.uv = coordinate
obj = bpy.data.objects.new('Seat probe surfaces', mesh)
scene.collection.objects.link(obj)
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
scene.render.bake.margin = 0
scene.render.bake.use_clear = True
started = time.monotonic()
bpy.ops.object.bake(type='AO')
name = 'all' if args.all else f'{args.stand}-{args.sector}'
image.filepath_raw = str(out / f'{args.surface}-{name}-cycles-ao-linear.png')
image.file_format = 'PNG'
image.save()
print(f'Cycles AO: {len(seats)} probes, {args.samples} samples, {time.monotonic() - started:.1f}s, {image.filepath_raw}', flush=True)
