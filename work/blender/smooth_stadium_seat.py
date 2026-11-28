"""Recalculate seat normals without changing its geometry or triangle count."""
from pathlib import Path
from math import radians
import bpy

root = Path(__file__).resolve().parents[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root / 'outputs/stadium-pilot/public/stadium-seat.glb'))
seat = next(obj for obj in bpy.context.selected_objects if obj.type == 'MESH')
bpy.context.view_layer.objects.active = seat
bpy.ops.object.shade_smooth_by_angle(angle=radians(40))
seat.data.calc_loop_triangles()
print('SEAT_TRIANGLES', len(seat.data.loop_triangles), flush=True)
out = root / 'work/exports/seat-pilot/stadium-seat-smooth.glb'
out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB')
