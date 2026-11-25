"""Сетка пилотных панорам сектора 9: одна точка на блок 4×4 места.

Запуск: python3 work/blender/plan_depth_nodes.py
Координаты в выгрузке — готовая точка глаз в системе Three.js.
"""
import json
import math
from collections import defaultdict
from pathlib import Path

root = Path(__file__).resolve().parents[2]
seats = json.loads((root / 'work/exports/seats-full.json').read_text())
cells = defaultdict(list)
for seat in seats:
    if seat['stand'] == 'west' and seat['sector'] == 9:
        cells[((seat['row'] - 1) // 4, (seat['number'] - 1) // 4)].append(seat)
nodes = []
for (row_block, seat_block), cell in sorted(cells.items()):
    center = [sum(s[k] for s in cell) / len(cell) for k in ('x', 'y', 'z')]
    def distance(seat):
        return math.dist([seat['x'], seat['y'], seat['z']], center)
    seat = min(cell, key=distance)
    position = [seat['x'], seat['y'], seat['z']]
    nodes.append({
        'id': f'west-9-{row_block}-{seat_block}',
        'stand': 'west', 'sector': 9, 'row': seat['row'], 'number': seat['number'],
        'position': position, 'yaw': math.atan2(-seat['z'], -seat['x']),
        'seats': len(cell),
        'maxOffset': round(max(math.dist(position, [s['x'], s['y'], s['z']]) for s in cell), 3),
    })
out = root / 'work/exports/depth-pilot/nodes.json'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(nodes, ensure_ascii=False, indent=2) + '\n')
print(f'{len(nodes)} узлов для {sum(n["seats"] for n in nodes)} мест; макс. смещение {max(n["maxOffset"] for n in nodes):.2f} м')
