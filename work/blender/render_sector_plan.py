"""Рендер общего плана из текущего GLB. Запуск: Blender -b -P render_sector_plan.py -- --out DIR."""
import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('--out', required=True)
parser.add_argument('--samples', type=int, default=8)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
root = Path(__file__).resolve().parents[2]
out = Path(args.out).resolve()
out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root / 'work/exports/stadium-scene.glb'))
scene = bpy.context.scene
tree_material = bpy.data.materials.new('Tree crowns')
tree_material.use_nodes = True
tree_material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.07, 0.18, 0.05, 1)
for obj in scene.objects:
    if obj.type == 'MESH' and obj.name.split('.')[0] == 'Mesh_4':
        obj.data.materials.clear()
        obj.data.materials.append(tree_material)
for obj in scene.objects:
    if obj.name.split('.')[0] in {'Roof_framing', 'Roof_panels', 'Roof_edge'}:
        obj.hide_render = True
world = bpy.data.worlds.new('Sky')
world.use_nodes = True
scene.world = world
sky = world.node_tree.nodes.new('ShaderNodeTexEnvironment')
sky.image = bpy.data.images.load(str(root / 'outputs/stadium-pilot/public/sky-2k.hdr'))
world.node_tree.links.new(sky.outputs['Color'], world.node_tree.nodes['Background'].inputs['Color'])
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
scene.collection.objects.link(sun)
sun.data.energy = 3
sun.data.angle = math.radians(2)
sun.rotation_euler = (-Vector((-85, 70, 140))).to_track_quat('-Z', 'Y').to_euler()
camera = bpy.data.objects.new('Plan camera', bpy.data.cameras.new('Plan camera'))
scene.collection.objects.link(camera)
scene.camera = camera
camera.data.sensor_fit = 'VERTICAL'
camera.data.sensor_height = 36
scene.render.engine = 'CYCLES'
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 4
preferences = bpy.context.preferences.addons['cycles'].preferences
preferences.compute_device_type = 'METAL'
preferences.get_devices()
for device in preferences.devices:
    device.use = True
scene.cycles.device = 'GPU'
scene.view_settings.view_transform = 'AgX'
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
for name, width, height, z, fov in [('desktop', 2560, 1440, 375, 38), ('phone', 1170, 1700, 380, 54)]:
    scene.render.resolution_x, scene.render.resolution_y = width, height
    camera.location = (0, -50, z)
    camera.rotation_euler = (Vector((0, 0, 4)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.lens = 18 / math.tan(math.radians(fov / 2))
    scene.render.filepath = str(out / f'plan-{name}.png')
    bpy.ops.render.render(write_still=True)
