"""Build an approximate mountain backdrop from Mapzen Terrarium elevations."""

import math
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlretrieve

import bpy
from mathutils import Vector


root = Path(__file__).resolve().parents[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
tiles = {}
with tempfile.TemporaryDirectory() as directory:
    def download(tile):
        x, y = tile
        path = Path(directory) / f'{x}-{y}.png'
        urlretrieve(f'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/11/{x}/{y}.png', path)
        return tile, path

    with ThreadPoolExecutor(max_workers=6) as executor:
        paths = dict(executor.map(download, ((x, y) for x in range(1460, 1464) for y in range(750, 753))))
    for tile, path in paths.items():
        image = bpy.data.images.load(str(path))
        image.colorspace_settings.name = 'Non-Color'
        tiles[tile] = image.pixels[:]
        bpy.data.images.remove(image)


def elevation(lat, lon):
    scale = 2**11
    x = (lon + 180) / 360 * scale
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * scale
    tx, ty = int(x), int(y)
    px, py = int((x - tx) * 256), int((y - ty) * 256)
    index = ((255 - py) * 256 + px) * 4
    red, green, blue = tiles[(tx, ty)][index:index + 3]
    return round(red * 255) * 256 + round(green * 255) + round(blue * 255) / 256 - 32768


latitude, longitude = 43.2383743, 76.9241807
rotation = math.radians(4.5)
scale = 0.14
rows, columns = 110, 170
vertices, colors, faces = [], [], []
for row in range(rows):
    lat = 43.19 - row / (rows - 1) * 0.24
    for column in range(columns):
        lon = 76.65 + column / (columns - 1) * 0.55
        altitude = elevation(lat, lon)
        north = (lat - latitude) * 111132
        east = (lon - longitude) * 111320 * math.cos(math.radians(latitude))
        x = (north * math.cos(rotation) - east * math.sin(rotation)) * scale
        y = -(north * math.sin(rotation) + east * math.cos(rotation)) * scale
        vertices.append((x, y, (altitude - 839) * scale))
        snow = max(0, min(1, (altitude - 2950) / 650))
        rock = max(0, min(1, (altitude - 1700) / 1200))
        base = (0.19 + rock * 0.13, 0.25 + rock * 0.10, 0.20 + rock * 0.15)
        colors.append(tuple(c * (1 - snow * 0.6) + 0.72 * snow * 0.6 for c in base) + (1,))
        if row and column:
            a = (row - 1) * columns + column - 1
            faces.append((a, a + columns, a + columns + 1, a + 1))

mesh = bpy.data.meshes.new('Alatau terrain')
mesh.from_pydata(vertices, [], faces)
mesh.update()
attribute = mesh.color_attributes.new(name='Elevation', type='BYTE_COLOR', domain='POINT')
light = Vector((-0.5, 0.4, 0.76)).normalized()
for entry, vertex, color in zip(attribute.data, mesh.vertices, colors):
    shade = 0.55 + 0.45 * max(0, vertex.normal.dot(light))
    entry.color = tuple(component * shade for component in color[:3]) + (1,)
for polygon in mesh.polygons:
    polygon.use_smooth = True
terrain = bpy.data.objects.new('Alatau terrain', mesh)
bpy.context.collection.objects.link(terrain)

material = bpy.data.materials.new('Terrain')
material.use_nodes = True
shader = material.node_tree.nodes['Principled BSDF']
shader.inputs['Roughness'].default_value = 1
vertex_colors = material.node_tree.nodes.new('ShaderNodeVertexColor')
vertex_colors.layer_name = 'Elevation'
material.node_tree.links.new(vertex_colors.outputs['Color'], shader.inputs['Base Color'])
mesh.materials.append(material)

bpy.ops.wm.save_as_mainfile(filepath=str(root / 'work/blender/alatau-terrain.blend'))
bpy.ops.export_scene.gltf(filepath=str(root / 'outputs/stadium-pilot/public/alatau-terrain.glb'), export_format='GLB')
