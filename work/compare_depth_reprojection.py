"""Проверка прямой репроекции одного узла к трём реальным креслам.

Запуск: Blender -b -P work/compare_depth_reprojection.py
Перед запуском должны быть созданы depth-pilot и depth-pilot-reference. Это
простейшее отображение ближайшего пикселя с Z-буфером, без заполнения дыр.
"""
import json
import math
import struct
import subprocess
import zlib
from pathlib import Path

import numpy as np

root = Path(__file__).resolve().parents[1]
source_dir = root / 'work/exports/depth-pilot'
reference_dir = root / 'work/exports/depth-pilot-reference'
out = root / 'work/exports/depth-pilot-comparison'
out.mkdir(parents=True, exist_ok=True)
source = json.loads((source_dir / 'test-index.json').read_text())[0]
references = json.loads((reference_dir / 'test-index.json').read_text())

def depth_png(path):
    data = path.read_bytes()
    offset, packed = 8, b''
    while offset < len(data):
        size = struct.unpack('>I', data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        chunk = data[offset + 8:offset + 8 + size]
        offset += size + 12
        if kind == b'IHDR':
            width, height, bits, color, _, _, _ = struct.unpack('>IIBBBBB', chunk)
            if (bits, color) != (16, 0):
                raise ValueError('Ожидалась 16-битная одноканальная глубина')
        elif kind == b'IDAT':
            packed += chunk
    raw = zlib.decompress(packed)
    rows = np.frombuffer(raw, dtype=np.uint8).reshape(height, 1 + 2 * width)
    if np.any(rows[:, 0]):
        raise ValueError('Ожидался PNG без фильтра строк')
    return np.ascontiguousarray(rows[:, 1:]).view('>u2').reshape(height, width)

def color_image(path, width, height):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    return np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 3)

def save_png(path, image):
    height, width, _ = image.shape
    raw = b''.join(b'\0' + row.tobytes() for row in image)
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))

codes = depth_png(source_dir / source['depth'])
height, width = codes.shape
color = color_image(source_dir / source['color'], width, height)
longitude = ((np.arange(width, dtype=np.float32) + 0.5) / width - 0.5) * (2 * np.pi)
latitude = (0.5 - (np.arange(height, dtype=np.float32) + 0.5) / height) * np.pi
cos_lat = np.cos(latitude)[:, None]
# rotation_euler=(90°,0,180°): local (x,y,z) -> world (-x,z,y).
dir_x = -cos_lat * np.sin(longitude)[None, :]
dir_y = -cos_lat * np.cos(longitude)[None, :]
dir_z = np.broadcast_to(np.sin(latitude)[:, None], (height, width))
valid = codes != source['depthNoHit']
distance = codes.astype(np.float32) * source['depthMetresPerUnit']
origin = np.array([source['position'][0], -source['position'][2], source['position'][1]], np.float32)
world_x = origin[0] + dir_x * distance
world_y = origin[1] + dir_y * distance
world_z = origin[2] + dir_z * distance
roi = np.zeros((height, width), dtype=bool)
roi[round(height * (0.5 - 35 / 180)):round(height * (0.5 + 45 / 180)), width // 4:3 * width // 4] = True
results = []
for target in references:
    target_codes = depth_png(reference_dir / target['depth'])
    truth = color_image(reference_dir / target['color'], width, height)
    target_origin = np.array([target['position'][0], -target['position'][2], target['position'][1]], np.float32)
    dx, dy, dz = world_x - target_origin[0], world_y - target_origin[1], world_z - target_origin[2]
    target_dist = np.sqrt(dx * dx + dy * dy + dz * dz)
    lon = np.arctan2(-dx, -dy)
    lat = np.arcsin(np.clip(dz / np.maximum(target_dist, 1e-6), -1, 1))
    tx = np.rint((lon / (2 * np.pi) + 0.5) * width - 0.5).astype(np.int32) % width
    ty = np.rint((0.5 - lat / np.pi) * height - 0.5).astype(np.int32)
    usable = valid & (ty >= 0) & (ty < height)
    target_index = (ty[usable] * width + tx[usable]).astype(np.int64)
    source_index = np.flatnonzero(usable)
    source_distance = target_dist[usable]
    order = np.lexsort((source_distance, target_index))
    ordered_target = target_index[order]
    first = np.r_[True, ordered_target[1:] != ordered_target[:-1]]
    chosen = order[first]
    pixels = target_index[chosen]
    source_pixels = source_index[chosen]
    projected = np.zeros((height * width, 3), dtype=np.uint8)
    projected[pixels] = color.reshape(-1, 3)[source_pixels]
    projected = projected.reshape(height, width, 3)
    zbuffer = np.full(height * width, np.inf, dtype=np.float32)
    zbuffer[pixels] = source_distance[chosen]
    zbuffer = zbuffer.reshape(height, width)
    truth_depth = target_codes.astype(np.float32) * target['depthMetresPerUnit']
    foreground = roi & (target_codes != target['depthNoHit'])
    assigned = foreground & np.isfinite(zbuffer)
    # Отбрасываем пиксели, где пересечение оказалось не на видимой поверхности.
    comparable = assigned & (np.abs(zbuffer - truth_depth) <= 0.15)
    difference = np.abs(projected.astype(np.float32) - truth.astype(np.float32))
    mse = float(np.mean((projected.astype(np.float32)[comparable] - truth.astype(np.float32)[comparable]) ** 2)) if comparable.any() else float('nan')
    result = {'seat': [target['stand'], target['sector'], target['row'], target['number']],
              'offsetMetres': target['actualOffset'], 'roiForegroundPixels': int(foreground.sum()),
              'unfilledPercent': round(100 * float((foreground & ~assigned).sum()) / max(1, int(foreground.sum())), 2),
              'wrongDepthPercent': round(100 * float((assigned & ~comparable).sum()) / max(1, int(foreground.sum())), 2),
              'comparedPercent': round(100 * float(comparable.sum()) / max(1, int(foreground.sum())), 2),
              'meanAbsoluteRgb': round(float(difference[comparable].mean()), 3) if comparable.any() else None,
              'psnrDb': round(10 * math.log10(255 * 255 / mse), 2) if mse > 0 else None}
    save_png(out / (target['id'] + '-reprojected.png'), projected)
    results.append(result)
    print(json.dumps(result, ensure_ascii=False), flush=True)
(out / 'metrics.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
