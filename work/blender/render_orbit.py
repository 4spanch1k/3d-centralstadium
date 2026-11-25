"""Render an orbit from the exported stadium scene with Blender Cycles."""
import argparse
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('--frame', type=int)
parser.add_argument('--samples', type=int, default=16)
parser.add_argument('--width', type=int, default=1280)
parser.add_argument('--portrait', action='store_true')
parser.add_argument('--radius', type=float, default=245)
parser.add_argument('--height', type=float, default=145)
parser.add_argument('--out', default='orbit-frames')
parser.add_argument('--sky', default='sky.hdr')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
root = Path(__file__).resolve().parents[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root / 'work/exports/stadium-scene.glb'))
scene = bpy.context.scene
# GLB export does not retain per-instance tree colours.
tree_material = bpy.data.materials.new('Tree crowns')
tree_material.use_nodes = True
tree_material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.07, 0.18, 0.05, 1)
for obj in scene.objects:
    if obj.type == 'MESH' and obj.name.split('.')[0] == 'Mesh_4':
        obj.data.materials.clear()
        obj.data.materials.append(tree_material)
world = bpy.data.worlds.new('Sky')
world.use_nodes = True
scene.world = world
nodes = world.node_tree.nodes
sky = nodes.new('ShaderNodeTexEnvironment')
sky.image = bpy.data.images.load(str(root / 'outputs/stadium-pilot/public' / args.sky))
world.node_tree.links.new(sky.outputs['Color'], nodes['Background'].inputs['Color'])

sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
scene.collection.objects.link(sun)
sun.data.energy = 3
sun.data.angle = math.radians(2)
sun.rotation_euler = (-Vector((-85, 70, 140))).to_track_quat('-Z', 'Y').to_euler()

camera = bpy.data.objects.new('Orbit camera', bpy.data.cameras.new('Orbit camera'))
scene.collection.objects.link(camera)
scene.camera = camera
camera.data.lens = 45 if args.portrait else 36
if args.portrait:
    camera.data.sensor_fit = 'HORIZONTAL'
scene.frame_start = 1
scene.frame_end = 144
scene.render.fps = 24
def position_camera(scene):
    angle = 2 * math.pi * (scene.frame_current - 1) / 144
    camera.location = (args.radius * math.cos(angle), args.radius * math.sin(angle), args.height)
    camera.rotation_euler = (Vector((0, 0, 5)) - camera.location).to_track_quat('-Z', 'Y').to_euler()

bpy.app.handlers.frame_change_pre.append(position_camera)
position_camera(scene)

scene.render.engine = 'CYCLES'
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 4
try:
    preferences = bpy.context.preferences.addons['cycles'].preferences
    preferences.compute_device_type = 'METAL'
    preferences.get_devices()
    for device in preferences.devices:
        device.use = True
    scene.cycles.device = 'GPU'
except (AttributeError, TypeError, RuntimeError) as error:
    print('Metal unavailable:', error)
scene.view_settings.view_transform = 'AgX'
scene.render.resolution_x = args.width
scene.render.resolution_y = args.width * 16 // 9 if args.portrait else args.width * 9 // 16
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
output = root / 'work/exports' / args.out
output.mkdir(parents=True, exist_ok=True)
scene.render.filepath = str(output / 'frame-')
if args.frame:
    scene.frame_set(args.frame)
    scene.render.filepath = str(output / f'preview-{args.frame}.png')
    bpy.ops.render.render(write_still=True)
else:
    bpy.ops.render.render(animation=True)
