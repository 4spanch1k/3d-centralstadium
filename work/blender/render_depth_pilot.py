"""Пилот панорам с Z-pass для сектора 9. Сохраняет результаты только в work/exports.

Blender -b -P work/blender/render_depth_pilot.py -- --limit 1 --samples 24
Цвет: PNG, глубина: PNG16 (метры = значение * 200/65534, 65535 = нет пересечения).
Нужна визуальная проверка и проверка репроекции до использования на сайте.
"""
import argparse
import json
import math
import struct
import sys
import time
import zlib
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('--limit', type=int, default=1)
parser.add_argument('--samples', type=int, default=24)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
root = Path(__file__).resolve().parents[2]
out = root / 'work/exports/depth-pilot'
nodes = json.loads((out / 'nodes.json').read_text())[:args.limit]
if not nodes:
    raise ValueError('Нет запланированных точек')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root / 'work/exports/stadium-scene.glb'))
scene = bpy.context.scene
world = bpy.data.worlds.new('Sky')
world.use_nodes = True
scene.world = world
env = world.node_tree.nodes.new('ShaderNodeTexEnvironment')
env.image = bpy.data.images.load(str(root / 'outputs/stadium-pilot/public/sky-2k.hdr'))
world.node_tree.links.new(env.outputs['Color'], world.node_tree.nodes['Background'].inputs['Color'])
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
scene.collection.objects.link(sun)
sun.data.energy = 3
sun.data.angle = math.radians(2)
sun.rotation_euler = (-Vector((-85, 70, 140))).to_track_quat('-Z', 'Y').to_euler()
cam = bpy.data.objects.new('Seat panorama', bpy.data.cameras.new('Seat panorama'))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.type = 'PANO'
cam.data.panorama_type = 'EQUIRECTANGULAR'
cam.rotation_euler = (math.radians(90), 0, math.radians(180))
scene.render.engine = 'CYCLES'
scene.render.resolution_x = 2048
scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
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
bpy.context.view_layer.use_pass_z = True
scene.use_nodes = True
tree = bpy.data.node_groups.new('Depth pass', 'CompositorNodeTree')
scene.compositing_node_group = tree
source = tree.nodes.new('CompositorNodeRLayers')
depth = tree.nodes.new('CompositorNodeOutputFile')
depth.directory = str(out)
depth.file_output_items.new('FLOAT', 'Depth')
depth.format.file_format = 'OPEN_EXR'
depth.format.color_mode = 'BW'
depth.format.color_depth = '32'
tree.links.new(source.outputs['Depth'], depth.inputs['Depth'])

def save_png16(path, values):
    height, width = values.shape
    data = b''.join(b'\0' + row.astype('>u2').tobytes() for row in values)
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload) & 0xffffffff)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 16, 0, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(data, 9)) + chunk(b'IEND', b''))

results = []
for node in nodes:
    x, y, z = node['position']
    cam.location = (x, -z, y)
    depth.file_name = node['id'] + '-depth-'
    scene.render.image_settings.file_format = 'PNG'
    color_path = out / (node['id'] + '-color.png')
    scene.render.filepath = str(color_path)
    started = time.monotonic()
    bpy.ops.render.render(write_still=True)
    candidates = list(out.glob(node['id'] + '-depth-*.exr'))
    if len(candidates) != 1:
        raise RuntimeError(f'Ожидался один EXR для {node["id"]}, найдено {len(candidates)}')
    image = bpy.data.images.load(str(candidates[0]), check_existing=False)
    width, height = image.size
    if (width, height) != (2048, 1024):
        raise RuntimeError('Размер карты глубины не совпадает с панорамой')
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    distances = np.flipud(pixels.reshape(height, width, 4)[:, :, 0])
    valid = np.isfinite(distances) & (distances > 0) & (distances <= 200)
    if valid.mean() < 0.05:
        raise RuntimeError(f'Слишком мало корректных значений глубины для {node["id"]}')
    encoded = np.full((height, width), 65535, dtype=np.uint16)
    encoded[valid] = np.rint(distances[valid] * (65534 / 200)).astype(np.uint16)
    depth_path = out / (node['id'] + '-depth.png')
    save_png16(depth_path, encoded)
    results.append({**node, 'color': color_path.name, 'depth': depth_path.name,
                    'depthMetresPerUnit': 200 / 65534, 'depthNoHit': 65535,
                    'seconds': round(time.monotonic() - started, 1),
                    'colorBytes': color_path.stat().st_size, 'depthBytes': depth_path.stat().st_size})
    print(node['id'], results[-1], flush=True)
(out / 'test-index.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
