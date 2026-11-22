import bpy
from pathlib import Path


root = Path(__file__).resolve().parents[2]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# The shell curves from the front of the seat into the backrest.
profile = [
    (0.24, 0.02), (0.18, -0.01), (0.04, -0.025), (-0.08, -0.01),
    (-0.15, 0.04), (-0.19, 0.15), (-0.21, 0.25), (-0.23, 0.35),
    (-0.25, 0.45), (-0.27, 0.50),
]
columns = 5
vertices = []
for index, (depth, height) in enumerate(profile):
    width = 0.225 if index < 7 else 0.225 - (index - 6) * 0.007
    for column in range(columns):
        side = column / (columns - 1) * 2 - 1
        vertices.append((width * side, depth + 0.025 * side**2, height + 0.025 * side**2))

faces = []
for row in range(len(profile) - 1):
    for column in range(columns - 1):
        a = row * columns + column
        faces.append((a, a + columns, a + columns + 1, a + 1))

mesh = bpy.data.meshes.new('Seat shell')
mesh.from_pydata(vertices, [], faces)
mesh.update()
seat = bpy.data.objects.new('Stadium seat', mesh)
bpy.context.collection.objects.link(seat)
bpy.context.view_layer.objects.active = seat
seat.select_set(True)
for polygon in mesh.polygons:
    polygon.use_smooth = True

shell = seat.modifiers.new('Shell thickness', 'SOLIDIFY')
shell.thickness = 0.012
shell.offset = -1
bpy.ops.object.modifier_apply(modifier=shell.name)

bpy.ops.wm.save_as_mainfile(filepath=str(root / 'work/blender/stadium-seat.blend'))
bpy.ops.export_scene.gltf(filepath=str(root / 'outputs/stadium-pilot/public/stadium-seat.glb'), export_format='GLB')
print('Seat exported:', len(seat.data.vertices), 'vertices,', len(seat.data.polygons), 'faces')
