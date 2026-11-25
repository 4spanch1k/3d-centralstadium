#!/bin/bash
# Рендер глубины только после окончания обоих облётов и проб освещения.
set -euo pipefail
cd "$(dirname "$0")/../.."
light_pid="$1"
while kill -0 "$light_pid" 2>/dev/null; do sleep 15; done
if ! grep -q 'Пилотные пробы света готовы к проверке.' /tmp/stadium-light-pipeline.log; then
  echo 'Пробы света не завершились; пилот глубины не запущен.' >&2
  exit 1
fi
/Applications/Blender.app/Contents/MacOS/Blender -b -P work/blender/render_depth_pilot.py -- --limit 24 --samples 24 > /tmp/stadium-depth-render.log 2>&1
echo 'Панорамы и карты глубины готовы к проверке.'
