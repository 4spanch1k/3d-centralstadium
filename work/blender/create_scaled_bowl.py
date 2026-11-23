"""Build a standalone scaled bowl from the site's exported seat coordinates.

The field keeps its original dimensions. Only the bowl footprint and seat
positions are scaled to 227 x 175 m; seat meshes and heights are not scaled.
The intermediate landing follows the existing site geometry.
Seat directions follow the neighboring exported seats after scaling.
Seat identifiers are copied from work/exports/seats.json, produced by
window.__debug.exportSeats() on the development server. The number of rows and
all positions remain approximate, not surveyed stadium data.

Run: Blender -b -P work/blender/create_scaled_bowl.py
Output: work/exports/stadium-bowl-scaled.blend (not connected to the website).
"""
import json
import math
from pathlib import Path

import bpy

root = Path(__file__).resolve().parents[2]
seats_path = root / 'work/exports/seats.json'
seats = json.loads(seats_path.read_text(encoding='utf-8'))

# The outermost row in main.js uses these half-extents before scaling.
outer_x = 71.6 + 33 * 0.72 + 2
outer_z = 53.6 + 33 * 0.72 + 2
scale_x = 227 / (2 * outer_x)
scale_z = 175 / (2 * outer_z)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root / 'outputs/stadium-pilot/public/stadium-seat.glb'))
seat_mesh = next(obj.data for obj in bpy.context.scene.objects if obj.type == 'MESH')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

concrete = bpy.data.materials.new('Concrete')
concrete.diffuse_color = (0.58, 0.59, 0.57, 1)
seat_material = bpy.data.materials.new('Seat')
seat_material.diffuse_color = (0.04, 0.16, 0.43, 1)
seat_mesh.materials.clear()
seat_mesh.materials.append(seat_material)


def outline(half_x, half_y, radius):
    corners = (
        ((half_x, half_y - radius), (half_x, half_y), (half_x - radius, half_y)),
        ((-half_x + radius, half_y), (-half_x, half_y), (-half_x, half_y - radius)),
        ((-half_x, -half_y + radius), (-half_x, -half_y), (-half_x + radius, -half_y)),
        ((half_x - radius, -half_y), (half_x, -half_y), (half_x, -half_y + radius)),
    )
    points = []
    for start, control, end in corners:
        for i in range(13):
            t = i / 12
            x = (1 - t) ** 2 * start[0] + 2 * (1 - t) * t * control[0] + t ** 2 * end[0]
            y = (1 - t) ** 2 * start[1] + 2 * (1 - t) * t * control[1] + t ** 2 * end[1]
            points.append((x * scale_x, y * scale_z))
    return points


vertices, faces = [], []
levels = []
for row in range(34):
    step = row * 0.72 + (2 if row >= 15 else 0)
    top = 0.45 + row * 0.37
    if row == 15:
        levels.append((83.68, 65.68, 81.68, 63.68, 41.58, top - 0.37))
    levels.append((71.6 + step, 53.6 + step, 70.88 + step,
                   52.88 + step, 29.5 + step, top))

for outer_x, outer_y, inner_x, inner_y, radius, top in levels:
    outer = outline(outer_x, outer_y, radius)
    inner = outline(inner_x, inner_y, radius - (outer_x - inner_x))
    count = len(outer)
    base = len(vertices)
    for height, outline_points in ((top, outer), (top, inner), (top - 0.38, outer), (top - 0.38, inner)):
        vertices.extend((x, y, height) for x, y in outline_points)
    for i in range(count):
        j = (i + 1) % count
        faces.extend(((base+i, base+j, base+count+j, base+count+i),
                      (base+2*count+i, base+2*count+j, base+j, base+i),
                      (base+count+i, base+count+j, base+3*count+j, base+3*count+i)))
mesh = bpy.data.meshes.new('Scaled bowl')
mesh.from_pydata(vertices, [], faces)
mesh.materials.append(concrete)
bowl = bpy.data.objects.new('Scaled bowl', mesh)
bpy.context.collection.objects.link(bowl)

seat_collection = bpy.data.collections.new('Seats')
bpy.context.scene.collection.children.link(seat_collection)
for index, (stand, sector, row, number, x, y, z) in enumerate(seats):
    seat = bpy.data.objects.new(f'{stand}-{sector}-{row}-{number}', seat_mesh)
    seat.location = (x * scale_x, -z * scale_z, y - 1)
    if index + 1 < len(seats) and seats[index + 1][5] == y:
        other = seats[index + 1]
        dx, dy = other[4] - x, z - other[6]
    else:
        other = seats[index - 1]
        dx, dy = x - other[4], other[6] - z
    seat.rotation_euler.z = math.atan2(dy * scale_z, dx * scale_x)
    seat['stand'], seat['sector'], seat['row'], seat['number'] = stand, sector, row, number
    seat_collection.objects.link(seat)

bpy.context.preferences.filepaths.save_version = 0
output = root / 'work/exports/stadium-bowl-scaled.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(output))
print(f'Bowl: 227 x 175 m; scale x={scale_x:.6f}, z={scale_z:.6f}; seats={len(seats)}')
