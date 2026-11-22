"""Проверка результата пакетного рендера панорам.

Запуск: python3 verify_panoramas.py
Проверяет: все ли узлы из nodes.json отрендерены, нет ли пустых/подозрительно маленьких файлов, совпадает ли index.json,
какие сектора не покрыты. Печатает отчёт и пишет ../panoramas-report.md. Контактный лист: make_contact_sheet.sh.
"""
import json, os, sys
here = os.path.dirname(os.path.abspath(__file__))
nodes = json.load(open(os.path.join(here, '..', 'exports', 'nodes.json')))
pano_dir = os.path.abspath(os.path.join(here, '..', '..', 'outputs', 'stadium-pilot', 'public', 'panoramas'))
index = json.load(open(os.path.join(pano_dir, 'index.json')))
indexed = {n['id'] for n in index}
missing, small, total = [], [], 0
for node in nodes:
    path = os.path.join(pano_dir, node['file'])
    if not os.path.exists(path):
        missing.append(node['id']); continue
    size = os.path.getsize(path); total += size
    if size < 80 * 1024: small.append((node['id'], size // 1024))
not_indexed = [n['id'] for n in nodes if os.path.exists(os.path.join(pano_dir, n['file'])) and n['id'] not in indexed]
sectors = {(n['stand'], n['sector']) for n in nodes}
covered = {(n['stand'], n['sector']) for n in index}
lines = [
    '# Отчёт по панорамам', '',
    f'- Узлов в плане: {len(nodes)}', f'- Отрендерено файлов: {len(nodes) - len(missing)}', f'- В index.json: {len(index)}',
    f'- Общий размер: {total / 1024 / 1024:.1f} МБ (в среднем {total / max(1, len(nodes) - len(missing)) / 1024:.0f} КБ)',
    f'- Секторов в плане: {len(sectors)}, с панорамой: {len(covered)}',
    f'- Не хватает: {", ".join(missing) if missing else "нет"}',
    f'- Подозрительно маленькие (<80 КБ): {small if small else "нет"}',
    f'- Есть файл, но нет в index.json: {not_indexed if not_indexed else "нет"}',
]
report = '\n'.join(lines)
print(report)
open(os.path.join(here, '..', 'panoramas-report.md'), 'w', encoding='utf-8').write(report + '\n')
sys.exit(1 if missing or not_indexed else 0)
