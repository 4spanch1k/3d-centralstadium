#!/bin/bash
# Пробы запускаются только после полного завершения последовательного рендера и кодирования облётов.
set -euo pipefail
cd "$(dirname "$0")/../.."
pipeline_pid="$1"
while kill -0 "$pipeline_pid" 2>/dev/null; do sleep 15; done
if ! grep -q 'Видео и постеры готовы к визуальной проверке.' /tmp/stadium-orbit-pipeline.log; then
  echo 'Облёт не завершён успешно, пробы света не запущены.' >&2
  exit 1
fi
blender=/Applications/Blender.app/Contents/MacOS/Blender
common=(--glb work/exports/stadium-scene.glb --seats work/exports/seats-full.json --out work/exports/seat-light-pilot --samples 16)
"$blender" -b -P work/blender/bake_seat_light.py -- "${common[@]}" > /tmp/stadium-light-day.log 2>&1
"$blender" -b -P work/blender/bake_seat_light.py -- "${common[@]}" --evening > /tmp/stadium-light-evening.log 2>&1
echo 'Пилотные пробы света готовы к проверке.'
