"""Build a standalone scaled bowl from the site's exported seat coordinates.

The field keeps its original dimensions. Only the bowl footprint and seat
positions are scaled to 227 x 175 m; seat meshes and heights are not scaled.
The intermediate landing, front barrier, aisle steps, rails and exits follow the existing site geometry.
The preview includes a field, goals, running track, west roof, east masts and west facade.
It also includes a camera and light for rendering the assembled model.
Seat directions follow the row tangent after scaling, including across gaps.
Seat identifiers are copied from work/exports/seats.json, produced by
window.__debug.exportSeats() on the development server. The number of rows and
all positions remain approximate, not surveyed stadium data.

Run: Blender -b -P work/blender/create_scaled_bowl.py
Output: work/exports/stadium-bowl-scaled.blend (not connected to the website).
"""
import json
import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

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
concrete.use_nodes = True
concrete.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = concrete.diffuse_color
seat_material = bpy.data.materials.new('Seat')
seat_material.diffuse_color = (0.04, 0.16, 0.43, 1)
seat_material.use_nodes = True
seat_material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = seat_material.diffuse_color
seat_mesh.materials.clear()
seat_mesh.materials.append(seat_material)


def outline(half_x, half_y, radius, segments=12, scaled=True):
    corners = (
        ((half_x, half_y - radius), (half_x, half_y), (half_x - radius, half_y)),
        ((-half_x + radius, half_y), (-half_x, half_y), (-half_x, half_y - radius)),
        ((-half_x, -half_y + radius), (-half_x, -half_y), (-half_x + radius, -half_y)),
        ((half_x - radius, -half_y), (half_x, -half_y), (half_x, -half_y + radius)),
    )
    points = []
    for start, control, end in corners:
        for i in range(segments + 1):
            t = i / segments
            x = (1 - t) ** 2 * start[0] + 2 * (1 - t) * t * control[0] + t ** 2 * end[0]
            y = (1 - t) ** 2 * start[1] + 2 * (1 - t) * t * control[1] + t ** 2 * end[1]
            points.append((x * scale_x, y * scale_z) if scaled else (x, y))
    return points


# The playing field and track retain the site's dimensions; only the bowl scales.
pitch_material = bpy.data.materials.new('Pitch')
pitch_material.use_nodes = True
pitch_material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.08, 0.26, 0.08, 1)
track_material = bpy.data.materials.new('Running track')
track_material.use_nodes = True
track_material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.12, 0.23, 0.32, 1)
white = bpy.data.materials.new('Field markings')
white.use_nodes = True
white.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.88, 0.9, 0.85, 1)

ground_material = bpy.data.materials.new('Ground')
ground_material.use_nodes = True
ground_material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.3, 0.33, 0.29, 1)
ground_mesh = bpy.data.meshes.new('Ground')
ground_mesh.from_pydata([(-125, -105, -0.2), (125, -105, -0.2),
                         (125, 105, -0.2), (-125, 105, -0.2)], [], [(0, 1, 2, 3)])
ground_mesh.materials.append(ground_material)
bpy.context.collection.objects.link(bpy.data.objects.new('Ground', ground_mesh))

pitch_mesh = bpy.data.meshes.new('Pitch')
pitch_mesh.from_pydata([(-52.5, -34, 0.06), (52.5, -34, 0.06),
                        (52.5, 34, 0.06), (-52.5, 34, 0.06)], [], [(0, 1, 2, 3)])
pitch_mesh.materials.append(pitch_material)
bpy.context.collection.objects.link(bpy.data.objects.new('Pitch', pitch_mesh))


def flat_ring(mesh, outer_x, outer_y, inner_x, inner_y, radius, height):
    outer = outline(outer_x, outer_y, radius, scaled=False)
    inner = outline(inner_x, inner_y, radius - (outer_x - inner_x), scaled=False)
    outside = [mesh.verts.new((x, y, height)) for x, y in outer]
    inside = [mesh.verts.new((x, y, height)) for x, y in inner]
    for i in range(len(outside)):
        j = (i + 1) % len(outside)
        mesh.faces.new((outside[i], outside[j], inside[j], inside[i]))

track_mesh = bmesh.new()
flat_ring(track_mesh, 65, 46, 54, 35, 26, 0.04)
track_data = bpy.data.meshes.new('Running track')
track_mesh.to_mesh(track_data)
track_mesh.free()
track_data.materials.append(track_material)
bpy.context.collection.objects.link(bpy.data.objects.new('Running track', track_data))

markings = bmesh.new()
for lane in range(9):
    offset = lane * 1.22
    flat_ring(markings, 55 + offset, 36 + offset, 54.94 + offset, 35.94 + offset, 16 + offset, 0.041)
for x1, y1, x2, y2 in ((-52.5, -34, 52.5, -34), (-52.5, 34, 52.5, 34),
                       (-52.5, -34, -52.5, 34), (52.5, -34, 52.5, 34), (0, -34, 0, 34),
                       (-52.5, -20, -36, -20), (-36, -20, -36, 20), (-36, 20, -52.5, 20),
                       (52.5, -20, 36, -20), (36, -20, 36, 20), (36, 20, 52.5, 20),
                       (-52.5, -9, -47, -9), (-47, -9, -47, 9), (-47, 9, -52.5, 9),
                       (52.5, -9, 47, -9), (47, -9, 47, 9), (47, 9, 52.5, 9)):
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy)
    nx, ny = -dy / length * 0.09, dx / length * 0.09
    corners = [markings.verts.new((x, y, 0.061)) for x, y in
               ((x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x2 - nx, y2 - ny), (x2 + nx, y2 + ny))]
    markings.faces.new(corners)
for i in range(64):
    a, b = 2 * math.pi * i / 64, 2 * math.pi * (i + 1) / 64
    corners = [markings.verts.new((r * math.cos(angle), r * math.sin(angle), 0.061))
               for r, angle in ((9, a), (9.16, a), (9.16, b), (9, b))]
    markings.faces.new(corners)
span = math.acos(5.5 / 9.15)
for side in (-1, 1):
    center_x = side * 41.5
    start_angle = -span if side < 0 else math.pi - span
    for i in range(40):
        a = start_angle + 2 * span * i / 40
        b = start_angle + 2 * span * (i + 1) / 40
        corners = [markings.verts.new((center_x + r * math.cos(angle), r * math.sin(angle), 0.061))
                   for r, angle in ((9, a), (9.16, a), (9.16, b), (9, b))]
        markings.faces.new(corners)
for center_x, radius in ((0, 0.2), (-41.5, 0.15), (41.5, 0.15)):
    points = [markings.verts.new((center_x + radius * math.cos(2 * math.pi * i / 16),
                                  radius * math.sin(2 * math.pi * i / 16), 0.061)) for i in range(16)]
    markings.faces.new(points)
marking_mesh = bpy.data.meshes.new('Pitch and lane markings')
markings.to_mesh(marking_mesh)
markings.free()
marking_mesh.materials.append(white)
bpy.context.collection.objects.link(bpy.data.objects.new('Pitch and lane markings', marking_mesh))


goal_frames = bmesh.new()
for side in (-1, 1):
    x = side * 52.5
    for y in (-3.66, 3.66):
        vertices = bmesh.ops.create_cone(goal_frames, cap_ends=True, segments=8,
                                         radius1=0.06, radius2=0.06, depth=2.44)['verts']
        bmesh.ops.translate(goal_frames, verts=vertices, vec=(x, y, 1.22))
    vertices = bmesh.ops.create_cone(goal_frames, cap_ends=True, segments=8,
                                     radius1=0.06, radius2=0.06, depth=7.32)['verts']
    bmesh.ops.rotate(goal_frames, verts=vertices, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
    bmesh.ops.translate(goal_frames, verts=vertices, vec=(x, 0, 2.44))
goal_mesh = bpy.data.meshes.new('Goal frames')
goal_frames.to_mesh(goal_mesh)
goal_frames.free()
goal_mesh.materials.append(white)
bpy.context.collection.objects.link(bpy.data.objects.new('Goal frames', goal_mesh))

goal_nets = bmesh.new()
for side in (-1, 1):
    x = side * 52.5
    lines = [((x, -3.6 + i * 0.6, 2.44), (x + side * 2, -3.6 + i * 0.6, 0.1)) for i in range(13)]
    for height in (0.5, 0.95, 1.4, 1.85, 2.3):
        back_x = x + side * (2 - height / 2.44 * 2)
        lines.append(((back_x, -3.66, height), (back_x, 3.66, height)))
    for start, end in lines:
        start, end = Vector(start), Vector(end)
        direction = end - start
        vertices = bmesh.ops.create_cone(goal_nets, cap_ends=False, segments=4,
                                         radius1=0.012, radius2=0.012, depth=direction.length)['verts']
        bmesh.ops.rotate(goal_nets, verts=vertices, cent=(0, 0, 0),
                         matrix=direction.to_track_quat('Z', 'Y').to_matrix())
        bmesh.ops.translate(goal_nets, verts=vertices, vec=(start + end) / 2)
net_mesh = bpy.data.meshes.new('Goal nets')
goal_nets.to_mesh(net_mesh)
goal_nets.free()
net_mesh.materials.append(white)
bpy.context.collection.objects.link(bpy.data.objects.new('Goal nets', net_mesh))


vertices, faces = [], []
levels = []
for row in range(34):
    step = row * 0.72 + (2 if row >= 15 else 0)
    top = 0.45 + row * 0.37
    if row == 15:
        levels.append((83.68, 65.68, 81.68, 63.68, 41.58, top - 0.37, 0.38))
    levels.append((71.6 + step, 53.6 + step, 70.88 + step,
                   52.88 + step, 29.5 + step, top, 0.38))
levels.append((70.7, 52.7, 70.4, 52.4, 29.3, 0.95, 0.95))

for outer_x, outer_y, inner_x, inner_y, radius, top, thickness in levels:
    outer = outline(outer_x, outer_y, radius)
    inner = outline(inner_x, inner_y, radius - (outer_x - inner_x))
    count = len(outer)
    base = len(vertices)
    for height, outline_points in ((top, outer), (top, inner), (top - thickness, outer), (top - thickness, inner)):
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

# Match the eight aisle centers to the same fractions of each unscaled row path.
aisles = [[] for _ in range(8)]
row_segments = {}
steps = bmesh.new()
for row in range(34):
    step = row * 0.72 + (2 if row >= 15 else 0)
    row_path = outline(71 + step, 53 + step, 29 + step, segments=64)
    start = 3 * 65 - 1
    row_path = row_path[start:] + row_path[:start + 1]
    segments = []
    for a, b in zip(row_path, row_path[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        length_squared = dx * dx + dy * dy
        if length_squared:
            segments.append((a[0], a[1], dx, dy, length_squared))
    row_segments[round(1.72 + row * 0.37, 2)] = segments
    lengths = [0.0]
    for start, end in zip(row_path, row_path[1:]):
        lengths.append(lengths[-1] + math.hypot((end[0] - start[0]) / scale_x,
                                                (end[1] - start[1]) / scale_z))
    for aisle, points in enumerate(aisles):
        target = lengths[-1] * (aisle * 100 + 2) / 800
        segment = next(i for i in range(len(lengths) - 1) if lengths[i + 1] >= target)
        fraction = (target - lengths[segment]) / (lengths[segment + 1] - lengths[segment])
        start, end = Vector(row_path[segment]), Vector(row_path[segment + 1])
        point = start.lerp(end, fraction)
        top = 0.45 + row * 0.37
        points.append(Vector((point.x, point.y, top + 0.35)))
        tangent = (end - start).normalized()
        outward = Vector((point.x / scale_x, point.y / scale_z)).normalized()
        center = Vector((point.x + outward.x * 0.24 * scale_x,
                         point.y + outward.y * 0.24 * scale_z, top + 0.02))
        unscaled_tangent = Vector((tangent.x / scale_x, tangent.y / scale_z)).normalized()
        unscaled_normal = Vector((-unscaled_tangent.y, unscaled_tangent.x))
        width = lengths[-1] * 4 / 800 * 0.85 * math.hypot(unscaled_tangent.x * scale_x, unscaled_tangent.y * scale_z)
        depth = 0.68 * math.hypot(unscaled_normal.x * scale_x, unscaled_normal.y * scale_z)
        transform = (Matrix.Translation(center)
                     @ Matrix.Rotation(math.atan2(tangent.y, tangent.x), 4, 'Z')
                     @ Matrix.Diagonal((width, depth, 0.04, 1)))
        corners = bmesh.ops.create_cube(steps, size=1)['verts']
        bmesh.ops.transform(steps, matrix=transform, verts=corners)
step_mesh = bpy.data.meshes.new('Aisle steps')
steps.to_mesh(step_mesh)
steps.free()
step_mesh.materials.append(concrete)
step_object = bpy.data.objects.new('Aisle steps', step_mesh)
bpy.context.collection.objects.link(step_object)

steel = bpy.data.materials.new('Aisle rail steel')
steel.diffuse_color = (0.48, 0.52, 0.52, 1)
rails = bmesh.new()
outer = outline(70.72, 52.72, 29.32)
inner = outline(70.4, 52.4, 29.0)
outer_vertices = [rails.verts.new((x, y, 1.0)) for x, y in outer]
inner_vertices = [rails.verts.new((x, y, 1.0)) for x, y in inner]
for i in range(len(outer_vertices)):
    j = (i + 1) % len(outer_vertices)
    rails.faces.new((outer_vertices[i], outer_vertices[j], inner_vertices[j], inner_vertices[i]))
for points in aisles:
    for row, (start, end) in enumerate(zip(points, points[1:])):
        for height, width in ((0.85, 0.05), (0.45, 0.036)):
            a = start + Vector((0, 0, height))
            b = end + Vector((0, 0, height))
            direction = b - a
            transform = (Matrix.Translation((a + b) / 2)
                         @ direction.to_track_quat('Z', 'Y').to_matrix().to_4x4()
                         @ Matrix.Diagonal((width, width, direction.length, 1)))
            corners = bmesh.ops.create_cube(rails, size=1)['verts']
            bmesh.ops.transform(rails, matrix=transform, verts=corners)
        if row % 3 == 0:
            corners = bmesh.ops.create_cube(rails, size=1)['verts']
            transform = Matrix.Translation(start + Vector((0, 0, 0.425))) @ Matrix.Diagonal((0.04, 0.04, 0.85, 1))
            bmesh.ops.transform(rails, matrix=transform, verts=corners)
rail_mesh = bpy.data.meshes.new('Aisle rails')
rails.to_mesh(rail_mesh)
rails.free()
rail_mesh.materials.append(steel)
rail_object = bpy.data.objects.new('Aisle rails', rail_mesh)
bpy.context.collection.objects.link(rail_object)

exit_frames = bmesh.new()
for points in aisles:
    top = points[-1]
    outward = Vector((top.x, top.y)).normalized()
    center = Vector((top.x + outward.x * 1.5, top.y + outward.y * 1.5, top.z - 0.3))
    rotation = Matrix.Rotation(math.atan2(-outward.x, outward.y), 4, 'Z')
    for x, height, width, z in ((-1.45, 3.4, 0.5, 1.7),
                                 (1.45, 3.4, 0.5, 1.7),
                                 (0, 0.5, 2.4, 3.15)):
        transform = (Matrix.Translation(center) @ rotation @ Matrix.Translation((x, 0, z))
                     @ Matrix.Diagonal((width, 0.9, height, 1)))
        corners = bmesh.ops.create_cube(exit_frames, size=1)['verts']
        bmesh.ops.transform(exit_frames, matrix=transform, verts=corners)
exit_mesh = bpy.data.meshes.new('Exit frames')
exit_frames.to_mesh(exit_mesh)
exit_frames.free()
exit_mesh.materials.append(concrete)
exit_object = bpy.data.objects.new('Exit frames', exit_mesh)
bpy.context.collection.objects.link(exit_object)

seat_collection = bpy.data.collections.new('Seats')
bpy.context.scene.collection.children.link(seat_collection)
for stand, sector, row, number, x, y, z in seats:
    seat = bpy.data.objects.new(f'{stand}-{sector}-{row}-{number}', seat_mesh)
    seat.location = (x * scale_x, -z * scale_z, y - 1)
    closest = float('inf')
    for px, py, dx, dy, length_squared in row_segments[round(y, 2)]:
        t = max(0, min(1, ((seat.location.x - px) * dx + (seat.location.y - py) * dy) / length_squared))
        distance = (seat.location.x - px - t * dx) ** 2 + (seat.location.y - py - t * dy) ** 2
        if distance < closest:
            closest = distance
            seat.rotation_euler.z = math.atan2(dy, dx)
    seat['stand'], seat['sector'], seat['row'], seat['number'] = stand, sector, row, number
    seat_collection.objects.link(seat)

for asset_name in ('stadium-roof.glb', 'floodlight-masts.glb', 'west-facade.glb'):
    bpy.ops.import_scene.gltf(filepath=str(root / 'outputs/stadium-pilot/public' / asset_name))

scene = bpy.context.scene
scene.world = bpy.data.worlds.new('Preview sky')
scene.world.color = (0.3, 0.3, 0.3)
bpy.ops.object.light_add(type='SUN', location=(0, 0, 80))
bpy.context.object.name = 'Preview sun'
bpy.context.object.rotation_euler = (0.45, -0.35, -0.45)
bpy.context.object.data.energy = 2
bpy.ops.object.camera_add(location=(210, 250, 190))
camera = bpy.context.object
camera.name = 'Preview camera'
camera.rotation_euler = (Vector((0, 0, 2)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 330
scene.camera = camera
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100

bpy.context.preferences.filepaths.save_version = 0
output = root / 'work/exports/stadium-bowl-scaled.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(output))
print(f'Bowl: 227 x 175 m; scale x={scale_x:.6f}, z={scale_z:.6f}; seats={len(seats)}')
