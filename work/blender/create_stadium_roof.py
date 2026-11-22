"""Create the approximate west-stand canopy for the web scene."""

import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector


root = Path(__file__).resolve().parents[2]
bpy.ops.wm.read_factory_settings(use_empty=True)

materials = {}
meshes = {}
for name, color, metallic, roughness in (
    ('Blue roof panels', (0.015, 0.25, 0.34, 1), 0.12, 0.42),
    ('Roof framing', (0.12, 0.19, 0.19, 1), 0.55, 0.55),
    ('Main trusses', (0.38, 0.43, 0.42, 1), 0.55, 0.48),
):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    shader = material.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = color
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = roughness
    materials[name] = material
    meshes[name] = bmesh.new()


def beam(material, start, end, width, depth):
    start, end = Vector(start), Vector(end)
    direction = end - start
    rotation = direction.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    transform = Matrix.Translation((start + end) / 2) @ rotation @ Matrix.Diagonal((width, depth, direction.length, 1))
    vertices = bmesh.ops.create_cube(meshes[material], size=1)['verts']
    bmesh.ops.transform(meshes[material], matrix=transform, verts=vertices)


def height(y):
    return 18.0 + (y - 58) * 0.035


# The real roof is a large, shallow blue canopy carried from behind the stand.
panels = meshes['Blue roof panels']
vertices = bmesh.ops.create_cube(panels, size=1)['verts']
transform = Matrix.Translation((0, 70, height(70))) @ Matrix.Rotation(math.atan(0.035), 4, 'X') @ Matrix.Diagonal((108, 24, 0.10, 1))
bmesh.ops.transform(panels, matrix=transform, verts=vertices)

for x in range(-54, 55, 6):
    beam('Roof framing', (x, 58, height(58) - 0.08), (x, 82, height(82) - 0.08), 0.18, 0.18)
for y in range(58, 83, 2):
    beam('Roof framing', (-54, y, height(y) - 0.08), (54, y, height(y) - 0.08), 0.10, 0.10)

for x in (-48, -24, 0, 24, 48):
    beam('Main trusses', (x, 58, height(58) - 0.25), (x, 82, height(82) - 0.25), 0.2, 0.2)
    beam('Main trusses', (x, 58, height(58) - 1.2), (x, 82, height(82) - 1.2), 0.14, 0.14)
    for y in range(58, 82, 4):
        beam('Main trusses', (x, y, height(y) - 1.2), (x, y + 4, height(y + 4) - 0.25), 0.09, 0.09)
        beam('Main trusses', (x, y, height(y) - 0.25), (x, y + 4, height(y + 4) - 1.2), 0.09, 0.09)

for x in (-42, 42):
    for dx in (-0.6, 0.6):
        beam('Main trusses', (x + dx, 82, 1), (x + dx, 82, height(82)), 0.23, 0.23)
    for z in range(2, 18, 2):
        beam('Main trusses', (x - 0.6, 82, z), (x + 0.6, 82, z + 2), 0.10, 0.10)
        beam('Main trusses', (x + 0.6, 82, z), (x - 0.6, 82, z + 2), 0.10, 0.10)

for name, bm in meshes.items():
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(materials[name])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

bpy.ops.wm.save_as_mainfile(filepath=str(root / 'work/blender/stadium-roof.blend'))
bpy.ops.export_scene.gltf(filepath=str(root / 'outputs/stadium-pilot/public/stadium-roof.glb'), export_format='GLB')
