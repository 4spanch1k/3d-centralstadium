"""Create the approximate building in the middle of the west stand."""

from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix


root = Path(__file__).resolve().parents[2]
bpy.ops.wm.read_factory_settings(use_empty=True)

meshes = {}
materials = {}
for name, color, metallic, roughness in (
    ('Concrete walls', (0.29, 0.33, 0.30, 1), 0.0, 0.85),
    ('Window glass', (0.025, 0.065, 0.07, 1), 0.25, 0.24),
    ('Window frames', (0.17, 0.20, 0.18, 1), 0.55, 0.45),
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


def box(material, location, size):
    bm = meshes[material]
    vertices = bmesh.ops.create_cube(bm, size=1)['verts']
    transform = Matrix.Translation(location) @ Matrix.Diagonal((*size, 1))
    bmesh.ops.transform(bm, matrix=transform, verts=vertices)


# Blender's Y axis points towards the back of the west stand.
box('Concrete walls', (0, 76, 11.0), (24, 6, 8.2))
box('Concrete walls', (0, 75.9, 15.2), (24.8, 6.6, 0.35))
box('Concrete walls', (0, 72.85, 9.4), (24.2, 0.38, 0.35))

for height, window_height in ((8.0, 1.9), (11.7, 1.8), (14.0, 0.75)):
    for column in range(8):
        x = (column - 3.5) * 2.55
        box('Window glass', (x, 72.97, height), (2.35, 0.08, window_height))
        box('Window frames', (x, 72.91, height), (0.05, 0.08, window_height))

for x in range(-10, 11, 2):
    box('Window frames', (x, 72.55, 7.15), (0.045, 0.045, 0.9))
box('Window frames', (0, 72.55, 7.58), (22, 0.05, 0.05))
box('Window frames', (0, 72.55, 7.0), (22, 0.04, 0.04))

for name, bm in meshes.items():
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(materials[name])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

bpy.ops.wm.save_as_mainfile(filepath=str(root / 'work/blender/west-building.blend'))
bpy.ops.export_scene.gltf(filepath=str(root / 'outputs/stadium-pilot/public/west-building.glb'), export_format='GLB')
