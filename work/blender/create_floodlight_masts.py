"""Create four approximate 40 m floodlight masts east of the stadium.

Coordinates are in metres: Blender Y=-z becomes Three.js Z. Positions along the
pitch follow the OpenStreetMap mast nodes; distance from the axis is kept just
behind the modelled east stand. Lamp layout is illustrative, not surveyed.
Run: Blender -b -P work/blender/create_floodlight_masts.py
"""
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

root = Path(__file__).resolve().parents[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
meshes = {}
materials = {}
for name, color, metallic, roughness in (
    ('Mast steel', (0.09, 0.30, 0.27, 1), 0.55, 0.5),
    ('Lamp housing', (0.08, 0.10, 0.11, 1), 0.4, 0.6),
    ('Lamp face', (0.9, 0.88, 0.8, 1), 0.05, 0.3),
):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = color
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = roughness
    if name == 'Lamp face':
        shader.inputs['Emission Color'].default_value = color
        shader.inputs['Emission Strength'].default_value = 0.3
    materials[name] = material
    meshes[name] = bmesh.new()


def beam(name, start, end, width, depth):
    start, end = Vector(start), Vector(end)
    direction = end - start
    transform = (Matrix.Translation((start + end) / 2)
                 @ direction.to_track_quat('Z', 'Y').to_matrix().to_4x4()
                 @ Matrix.Diagonal((width, depth, direction.length, 1)))
    vertices = bmesh.ops.create_cube(meshes[name], size=1)['verts']
    bmesh.ops.transform(meshes[name], matrix=transform, verts=vertices)


# Совпадает с mastPlaces в outputs/stadium-pilot/src/main.js.
for x, distance in ((-62, 91), (-36, 94), (40, 94), (64, 91)):
    y = -distance
    for dx in (-1, 1):
        for dy in (-1, 1):
            beam('Mast steel', (x + dx * 1.25, y + dy * 1.25, 0),
                 (x + dx * 0.55, y + dy * 0.55, 37), 0.15, 0.15)
    for z in range(0, 36, 3):
        bottom = 1.25 - z * 0.7 / 37
        top = 1.25 - (z + 3) * 0.7 / 37
        for side in (-1, 1):
            beam('Mast steel', (x + side * bottom, y - bottom, z),
                 (x + side * top, y + top, z + 3), 0.08, 0.08)
            beam('Mast steel', (x - bottom, y + side * bottom, z),
                 (x + top, y + side * top, z + 3), 0.08, 0.08)
    beam('Lamp housing', (x, y, 36.8), (x, y, 40.0), 6.4, 0.28)
    for col in range(8):
        for row in range(3):
            lx, lz = x - 2.8 + col * 0.8, 37.3 + row * 1.0
            vertices = bmesh.ops.create_cube(meshes['Lamp face'], size=1)['verts']
            bmesh.ops.scale(meshes['Lamp face'], vec=(0.5, 0.05, 0.62), verts=vertices)
            bmesh.ops.translate(meshes['Lamp face'], vec=(lx, y + 0.16, lz), verts=vertices)

for name, bm in meshes.items():
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(materials[name])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

bpy.ops.export_scene.gltf(filepath=str(root / 'outputs/stadium-pilot/public/floodlight-masts.glb'), export_format='GLB')
print('Triangles:', sum(len(p.vertices) - 2 for mesh in bpy.data.meshes for p in mesh.polygons))
