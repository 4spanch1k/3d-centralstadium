"""Черновые маски секторов по координатам кресел для проверки соответствия плану.

Запуск: Blender -b -P work/blender/create_sector_masks.py -- --out work/exports/sector-mask-test
Маска хранит номер сектора в красном и зелёном канале. Кадры должны использовать камеру render_sector_plan.py.
"""
import argparse
import json
import math
import struct
import sys
import zlib
from collections import defaultdict
from pathlib import Path

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('--out', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
root = Path(__file__).resolve().parents[2]
out = Path(args.out).resolve()
out.mkdir(parents=True, exist_ok=True)
seats = json.loads((root / 'work/exports/seats-full.json').read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
camera = bpy.data.objects.new('Plan camera', bpy.data.cameras.new('Plan camera'))
scene.collection.objects.link(camera)
scene.camera = camera
camera.data.sensor_fit = 'VERTICAL'
camera.data.sensor_height = 36

def save_png(path, ids):
    height, width = ids.shape
    channels = np.zeros((height, width, 3), dtype=np.uint8)
    channels[:, :, 0] = ids & 255
    channels[:, :, 1] = ids >> 8
    data = b''.join(b'\0' + row.tobytes() for row in channels)
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(data, 9)) + chunk(b'IEND', b''))

for name, width, height, z, fov, radius in [('desktop', 2560, 1440, 375, 38, 22), ('phone', 1170, 1700, 380, 54, 18)]:
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.resolution_percentage = 100
    camera.location = (0, -50, z)
    camera.rotation_euler = (Vector((0, 0, 4)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.lens = 18 / math.tan(math.radians(fov / 2))
    bpy.context.view_layer.update()
    ids = np.zeros((height, width), dtype=np.uint16)
    nearest = np.full((height, width), np.inf, dtype=np.float32)
    points = []
    for seat in seats:
        p = world_to_camera_view(scene, camera, Vector((seat['x'], -seat['z'], seat['y'] - 1)))
        x, y = p.x * width, (1 - p.y) * height
        points.append((seat, x, y))
        left, right = max(0, int(x - radius)), min(width, int(x + radius + 1))
        top, bottom = max(0, int(y - radius)), min(height, int(y + radius + 1))
        if left >= right or top >= bottom:
            continue
        yy, xx = np.ogrid[top:bottom, left:right]
        distance = (xx - x) ** 2 + (yy - y) ** 2
        region = nearest[top:bottom, left:right]
        replace = (distance <= radius ** 2) & (distance < region)
        region[replace] = distance[replace]
        ids[top:bottom, left:right][replace] = seat['sector']
    mismatches = 0
    for seat, x, y in points:
        px, py = int(round(x)), int(round(y))
        if not (0 <= px < width and 0 <= py < height) or ids[py, px] != seat['sector']:
            mismatches += 1
    save_png(out / f'plan-{name}-id.png', ids)
    print(name, 'sectors', len(np.unique(ids)) - 1, 'seat mismatches', mismatches, 'of', len(seats), flush=True)
