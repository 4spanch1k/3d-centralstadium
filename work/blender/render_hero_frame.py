"""Cycles-кадры из west/4/5/9. Результаты остаются в work/screenshots/hero-frame.

Пример: caffeinate -i nice -n 10 Blender -b -P work/blender/render_hero_frame.py -- --view phone --percent 25 --samples 16
Фоновые люди: Quaternius, LowPoly Posed Humans, CC0; локальный архив в work/exports/hero-assets.
"""
import argparse
import json
import math
import random
import sys
import time
from pathlib import Path

import bpy
from mathutils import Vector

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--view', choices=('phone', 'desktop', 'both', 'all'), required=True)
parser.add_argument('--percent', type=int, default=100)
parser.add_argument('--samples', type=int, default=64)
parser.add_argument('--no-crowd', action='store_true')
parser.add_argument('--out', default='work/screenshots/hero-frame')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
random.seed(4421)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root / 'work/exports/stadium-scene.glb'))
scene = bpy.context.scene
world = bpy.data.worlds.new('Daylight sky')
world.use_nodes = True
scene.world = world
env = world.node_tree.nodes.new('ShaderNodeTexEnvironment')
env.image = bpy.data.images.load(str(root / 'outputs/stadium-pilot/public/sky-2k.hdr'))
world.node_tree.links.new(env.outputs['Color'], world.node_tree.nodes['Background'].inputs['Color'])
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
scene.collection.objects.link(sun)
sun.data.energy = 2.2
sun.data.angle = math.radians(3)
sun.rotation_euler = (-Vector((-85, 70, 140))).to_track_quat('-Z', 'Y').to_euler()

# The public export does not preserve the instanced tree colours.
tree = bpy.data.materials.new('Tree crowns')
tree.diffuse_color = (0.07, 0.18, 0.05, 1)
tree.use_nodes = True
tree.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = tree.diffuse_color
for obj in scene.objects:
    if obj.type == 'MESH' and obj.name.split('.')[0] == 'Mesh_4':
        obj.data.materials.clear()
        obj.data.materials.append(tree)

seats = json.loads((root / 'work/exports/seats-full.json').read_text())
selected = next(s for s in seats if s['stand'] == 'west' and s['sector'] == 4 and s['row'] == 5 and s['number'] == 9)
eye = Vector((selected['x'], -selected['z'], selected['y']))

people = []
asset_root = root / 'work/exports/hero-assets/Posed Background Characters by @Quaternius'
if not args.no_crowd:
    for gender in ('Male', 'Female'):
        for pose in ('Sitting', 'Sitting_Cheering'):
            path = asset_root / gender / f'{gender} Poses/FBX/{gender}_{pose}.fbx'
            if not path.exists():
                raise FileNotFoundError(path)
            bpy.ops.object.select_all(action='DESELECT')
            bpy.ops.import_scene.fbx(filepath=str(path))
            person = next(obj for obj in bpy.context.selected_objects if obj.type == 'MESH')
            bpy.context.view_layer.objects.active = person
            person.select_set(True)
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
            for material in person.data.materials:
                if material and material.use_nodes:
                    shader = material.node_tree.nodes.get('Principled BSDF')
                    if shader:
                        shader.inputs['Alpha'].default_value = 1.0
            person.hide_render = True
            shirt_colors = [(0.06, 0.11, 0.16, 1), (0.35, 0.07, 0.06, 1), (0.08, 0.24, 0.17, 1),
                            (0.58, 0.53, 0.43, 1), (0.15, 0.22, 0.36, 1), (0.45, 0.31, 0.17, 1)]
            for color in shirt_colors:
                model = person.copy()
                model.data = person.data.copy()
                for index, material in enumerate(model.data.materials):
                    if material and material.name.startswith('Shirt'):
                        shirt = material.copy()
                        shirt.diffuse_color = color
                        shirt.use_nodes = True
                        shirt.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = color
                        model.data.materials[index] = shirt
                people.append(model)

    count = 0
    for seat in seats:
        x, y = seat['x'], -seat['z']
        if random.random() > 0.65 or math.hypot(x - eye.x, y - eye.y) < 3.2:
            continue
        person = random.choice(people)
        obj = person.copy()
        obj.data = person.data
        obj.hide_render = False
        obj.location = (x, y, seat['y'] - 1.27)
        obj.rotation_euler.z = math.atan2(-x, y) + random.uniform(-0.1, 0.1)
        size = random.uniform(0.39, 0.46)
        obj.scale = (size, size, size)
        scene.collection.objects.link(obj)
        count += 1
    print('HERO_PEOPLE', count, flush=True)

# Add fine surface relief without changing the scene geometry or texture colours.
for name, scale, distance in [('Material_53', 45, 0.008), ('Material_39', 180, 0.0015),
                              ('Material_40', 180, 0.0015), ('Material_41', 180, 0.0015),
                              ('Material_42', 180, 0.0015)]:
    material = bpy.data.materials.get(name)
    if not material or not material.use_nodes:
        raise ValueError(f'Не найден материал: {name}')
    nodes = material.node_tree.nodes
    shader = nodes.get('Principled BSDF')
    if not shader:
        raise ValueError(f'Нет Principled BSDF в материале: {name}')
    if shader.inputs['Normal'].is_linked:
        continue
    coordinates = nodes.new('ShaderNodeNewGeometry')
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = scale
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.18
    bump.inputs['Distance'].default_value = distance
    links = material.node_tree.links
    links.new(coordinates.outputs['Position'], noise.inputs['Vector'])
    links.new(noise.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], shader.inputs['Normal'])

camera = bpy.data.objects.new('Seat camera', bpy.data.cameras.new('Seat camera'))
scene.collection.objects.link(camera)
scene.camera = camera
camera.location = eye
horizontal = Vector((-eye.x, -eye.y, 0)).normalized()
direction = Vector((horizontal.x * math.cos(0.12), horizontal.y * math.cos(0.12), -math.sin(0.12)))
camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
camera.data.clip_end = 7500
camera.data.sensor_fit = 'VERTICAL'
camera.data.sensor_height = 24
scene.render.engine = 'CYCLES'
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 5
preferences = bpy.context.preferences.addons['cycles'].preferences
preferences.compute_device_type = 'METAL'
preferences.get_devices()
for device in preferences.devices:
    device.use = True
scene.cycles.device = 'GPU'
scene.view_settings.view_transform = 'AgX'
scene.render.resolution_percentage = args.percent
scene.render.image_settings.file_format = 'PNG'
out = root / args.out
out.mkdir(parents=True, exist_ok=True)
for view in (('phone', 'desktop', 'panorama') if args.view == 'all' else ('phone', 'desktop') if args.view == 'both' else (args.view,)):
    camera.data.type = 'PANO' if view == 'panorama' else 'PERSP'
    if view == 'panorama':
        camera.data.panorama_type = 'EQUIRECTANGULAR'
        camera.rotation_euler = (math.radians(90), 0, math.radians(180))
    camera.data.angle = math.radians(80 if view == 'phone' else 64)
    scene.render.resolution_x, scene.render.resolution_y = (1170, 2532) if view == 'phone' else (2048, 1024) if view == 'panorama' else (2560, 1440)
    scene.render.filepath = str(out / (f'{view}-draft.png' if args.percent != 100 else f'{view}.png'))
    started = time.monotonic()
    bpy.ops.render.render(write_still=True)
    print('HERO_RENDER', view, args.percent, args.samples, round(time.monotonic() - started, 1), scene.render.filepath, flush=True)
