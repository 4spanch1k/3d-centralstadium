"""План сетки узлов панорам: для каждого сектора 2 полосы рядов x 2 половины мест = до 4 узлов.

Запуск: python3 plan_nodes.py [--bands 2] [--halves 2]
Читает ../exports/seats.json (window.__debug.exportSeats()), пишет ../exports/nodes.json.
Узел — реальное место, ближайшее к центру ячейки; камера на высоте 1 м над сиденьем (уже учтено в экспорте).
"""
import json, math, os, sys
from collections import defaultdict
here = os.path.dirname(os.path.abspath(__file__))
bands = int(sys.argv[sys.argv.index('--bands') + 1]) if '--bands' in sys.argv else 2
halves = int(sys.argv[sys.argv.index('--halves') + 1]) if '--halves' in sys.argv else 2
seats = json.load(open(os.path.join(here, '..', 'exports', 'seats.json')))
by_sector = defaultdict(list)
for stand, sector, row, number, x, y, z in seats:
    by_sector[(stand, sector)].append((row, number, x, y, z))
nodes = []
for (stand, sector), items in sorted(by_sector.items(), key=lambda kv: (kv[0][0], kv[0][1])):
    rows = sorted({r for r, *_ in items}); numbers = sorted({n for _, n, *_ in items})
    def cut(values, parts, value):
        index = min(parts - 1, int(parts * (values.index(value) / max(1, len(values)))))
        return index
    cells = defaultdict(list)
    for row, number, x, y, z in items:
        cells[(cut(rows, bands, row), cut(numbers, halves, number))].append((row, number, x, y, z))
    for (b, h), cell in sorted(cells.items()):
        cx = sum(c[2] for c in cell) / len(cell); cz = sum(c[4] for c in cell) / len(cell); cy = sum(c[3] for c in cell) / len(cell)
        seat = min(cell, key=lambda c: (c[2] - cx) ** 2 + (c[3] - cy) ** 2 + (c[4] - cz) ** 2)
        row, number, x, y, z = seat
        nodes.append({'id': f'{stand}-{sector}-b{b}h{h}', 'stand': stand, 'sector': sector, 'file': f'{stand}-{sector}-b{b}h{h}.webp',
                      'position': [x, y, z], 'yaw': round(math.atan2(-z, -x), 4), 'lon': 75, 'latUp': 52, 'latDown': 52,
                      'sample': {'row': row, 'number': number}, 'seats': len(cell)})
json.dump(nodes, open(os.path.join(here, '..', 'exports', 'nodes.json'), 'w'), ensure_ascii=False, indent=1)
print('секторов:', len(by_sector), 'узлов:', len(nodes))
