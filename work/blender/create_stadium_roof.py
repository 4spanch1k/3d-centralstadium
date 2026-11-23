"""Create the approximate 149 x 39 m west canopy and export it for Three.js.

Blender Y points towards the west stand (negative Z in Three.js). The roof is
20 m high at its rear edge; its columns stand behind the 175 m wide bowl.
Run: Blender -b -P work/blender/create_stadium_roof.py
"""
import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

root = Path(__file__).resolve().parents[2]
bpy.ops.wm.read_factory_settings(use_empty=True)

meshes = {}
materials = {}
for name, color, metallic, roughness in (
    ('Roof panels', (0.015, 0.055, 0.15, 1), 0.15, 0.48),
    ('Roof framing', (0.12, 0.16, 0.19, 1), 0.55, 0.48),
    ('Main trusses', (0.35, 0.39, 0.40, 1), 0.55, 0.5),
):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = color
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = roughness
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


def height(y):
    return 20.0 + (y - 95.0) * 0.035


front, rear = 56.0, 95.0
half_length = 74.5
vertices = bmesh.ops.create_cube(meshes['Roof panels'], size=1)['verts']
transform = (Matrix.Translation((0, (front + rear) / 2, height((front + rear) / 2)))
             @ Matrix.Rotation(math.atan(0.035), 4, 'X')
             @ Matrix.Diagonal((149, 39, 0.12, 1)))
bmesh.ops.transform(meshes['Roof panels'], matrix=transform, verts=vertices)

for x in range(-72, 73, 6):
    beam('Roof framing', (x, front, height(front) - 0.12), (x, rear, height(rear) - 0.12), 0.12, 0.12)
for y in range(57, 96, 3):
    beam('Roof framing', (-half_length, y, height(y) - 0.12), (half_length, y, height(y) - 0.12), 0.10, 0.10)

for x in (-66, -44, -22, 0, 22, 44, 66):
    beam('Main trusses', (x, front, height(front) - 0.25), (x, rear, height(rear) - 0.25), 0.22, 0.22)
    beam('Main trusses', (x, front, height(front) - 1.6), (x, rear, height(rear) - 1.6), 0.16, 0.16)
    for y in range(56, 92, 4):
        beam('Main trusses', (x, y, height(y) - 1.6), (x, y + 4, height(y + 4) - 0.25), 0.09, 0.09)
        beam('Main trusses', (x, y, height(y) - 0.25), (x, y + 4, height(y + 4) - 1.6), 0.09, 0.09)
    beam('Main trusses', (x, rear, 0), (x, rear, height(rear) - 0.2), 0.45, 0.45)

for name, bm in meshes.items():
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(materials[name])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(root / 'work/blender/stadium-roof.blend'))
bpy.ops.export_scene.gltf(filepath=str(root / 'outputs/stadium-pilot/public/stadium-roof.glb'), export_format='GLB')
print('Triangles:', sum(len(p.vertices) - 2 for mesh in bpy.data.meshes for p in mesh.polygons))
