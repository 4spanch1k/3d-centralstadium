"""Сверяет отдельные пиксели Z-прохода пилота с лучами по сцене Blender.

Запуск: Blender -b -P work/blender/check_depth_pilot.py
PNG16 должен быть создан render_depth_pilot.py. Значение 65535 — нет попадания.
"""
import json
import math
import struct
import zlib
from pathlib import Path

import bpy
from mathutils import Euler, Vector

root = Path(__file__).resolve().parents[2]
out = root / 'work/exports/depth-pilot'
node = json.loads((out / 'test-index.json').read_text())[0]
contents = (out / node['depth']).read_bytes()
position, compressed = 8, b''
while position < len(contents):
    length = struct.unpack('>I', contents[position:position + 4])[0]
    kind = contents[position + 4:position + 8]
    payload = contents[position + 8:position + 8 + length]
    position += 12 + length
    if kind == b'IHDR':
        width, height = struct.unpack('>II', payload[:8])
    if kind == b'IDAT':
        compressed += payload
raw = zlib.decompress(compressed)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root / 'work/exports/stadium-scene.glb'))
bpy.context.view_layer.update()
scene = bpy.context.scene
depsgraph = bpy.context.evaluated_depsgraph_get()
x, y, z = node['position']
origin = Vector((x, -z, y))
rotation = Euler((math.pi / 2, 0, math.pi)).to_matrix()
for px, py in [(1024, 512), (1024, 740), (768, 660), (1280, 660), (1024, 220), (1536, 512)]:
    row = py * (1 + width * 2)
    if raw[row] != 0:
        raise ValueError('Ожидался PNG без фильтра строк')
    code = struct.unpack('>H', raw[row + 1 + px * 2:row + 3 + px * 2])[0]
    longitude = ((px + 0.5) / width - 0.5) * 2 * math.pi
    latitude = (0.5 - (py + 0.5) / height) * math.pi
    local = Vector((math.sin(longitude) * math.cos(latitude), math.sin(latitude), -math.cos(longitude) * math.cos(latitude)))
    direction = rotation @ local
    hit, point, normal, face, obj, matrix = scene.ray_cast(depsgraph, origin, direction, distance=200)
    measured = (point - origin).length if hit else None
    depth = code * node['depthMetresPerUnit'] if code != 65535 else None
    error = abs(depth - measured) if depth is not None and measured is not None else None
    print(f'pixel=({px},{py}) Z={depth} ray={measured} error={error} object={obj.name if obj else None}', flush=True)
