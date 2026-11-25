"""Пилотные пробы видимости света для кресел и бетона по физическому ряду и индексу пути.

Blender -b -P work/blender/bake_seat_light.py -- --glb work/exports/stadium-scene.glb --seats work/exports/seats-full.json --out work/exports/seat-light-pilot --samples 16 [--evening]
Каналы PNG: R — видимость солнца/мачт, G — доля видимого неба,
B — локальная открытость (радиус 1 м), A — проба существует. Это пробы,
а не полноценная Cycles-карта света; качество нужно проверить на сцене.
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
parser.add_argument('--glb', required=True)
parser.add_argument('--seats', required=True)
parser.add_argument('--out', required=True)
parser.add_argument('--samples', type=int, default=16)
parser.add_argument('--evening', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
if args.samples < 1:
    raise ValueError('--samples должно быть больше нуля')
out = Path(args.out).resolve()
out.mkdir(parents=True, exist_ok=True)
seats = json.loads(Path(args.seats).read_text())
seats = [s for s in seats if (s['stand'], s['sector']) in {('west', 9), ('east', 46)}]
if not seats:
    raise ValueError('В выгрузке нет мест пилотных секторов 9 и 46')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(Path(args.glb).resolve()))
scene = bpy.context.scene
depsgraph = bpy.context.evaluated_depsgraph_get()
bpy.context.view_layer.update()
sun = Vector((-85, 70, 140)).normalized()
masts = [Vector((x, -94, 38.5)) for x in (-84, -28, 28, 84)]
directions = []
for i in range(args.samples):
    z = (i + 0.5) / args.samples
    angle = i * math.pi * (3 - math.sqrt(5))
    radius = math.sqrt(1 - z * z)
    directions.append(Vector((math.cos(angle) * radius, math.sin(angle) * radius, z)))

def visible(origin, direction, distance):
    hit, *_ = scene.ray_cast(depsgraph, origin, direction, distance=distance)
    return not hit

def light_sample(origin):
    sky = sum(visible(origin, direction, 200) for direction in directions) / len(directions)
    local = sum(visible(origin, direction, 1) for direction in directions) / len(directions)
    if args.evening:
        values = []
        for mast in masts:
            delta = mast - origin
            distance = delta.length
            values.append(visible(origin, delta.normalized(), distance - 0.01) / (distance * distance))
        direct = min(1, sum(values) * 1500)
    else:
        direct = float(visible(origin, sun, 500))
    return [round(255 * direct), round(255 * sky), round(255 * local), 255]

def write_png(path, image):
    height, width, _ = image.shape
    data = b''.join(b'\0' + row.tobytes() for row in image)
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload) & 0xffffffff)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(data, 9)) + chunk(b'IEND', b''))

started = time.monotonic()
images = {'seat': np.zeros((34, 800, 4), np.uint8), 'concrete': np.zeros((34, 800, 4), np.uint8)}
for i, seat in enumerate(seats):
    # y в экспортных данных — высота глаз; сиденье находится на метр ниже.
    position = Vector((seat['x'], -seat['z'], seat['y'] - 1))
    row, path = seat['rowIndex'], seat['pathIndex']
    images['seat'][row, path] = light_sample(position + Vector((0, 0, 0.2)))
    images['concrete'][row, path] = light_sample(position + Vector((0, 0, -0.2)))
    if (i + 1) % 100 == 0:
        print(f'{i + 1}/{len(seats)} seats, {time.monotonic() - started:.1f}s', flush=True)
mode = 'evening' if args.evening else 'day'
for kind, image in images.items():
    write_png(out / f'{kind}-{mode}.png', image)
print(f'{mode}: {len(seats)} seats in {time.monotonic() - started:.1f}s', flush=True)
