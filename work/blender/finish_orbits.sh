#!/bin/bash
# Дождаться текущего desktop-рендера, закодировать его и последовательно собрать телефонный вариант.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
desktop_pid="$1"
while kill -0 "$desktop_pid" 2>/dev/null; do sleep 15; done
output="work/exports/orbit-video"
mkdir -p "$output"
if [ "$(find work/exports/orbit-clean-desktop -name 'frame-*.png' | wc -l | tr -d ' ')" != 144 ]; then
  echo 'Desktop-рендер не завершён: дальнейшие операции отменены.' >&2
  exit 1
fi
encode() {
  local size="$1" source="$2" rate="$3"
  ffmpeg -v error -y -framerate 24 -i "$source/frame-%04d.png" -frames:v 144 -an -c:v libx264 -b:v "$rate" -pix_fmt yuv420p -movflags +faststart "$output/stadium-orbit-$size.mp4"
  ffmpeg -v error -y -framerate 24 -i "$source/frame-%04d.png" -frames:v 144 -an -c:v libvpx-vp9 -b:v "$rate" -deadline good -cpu-used 4 -pix_fmt yuv420p "$output/stadium-orbit-$size.webm"
  for quality in 4 8 12 16 20 24 28 31; do
    ffmpeg -v error -y -i "$source/frame-0001.png" -frames:v 1 -q:v "$quality" "$output/intro-$size.jpg"
    [ "$(stat -f %z "$output/intro-$size.jpg")" -le 153600 ] && break
  done
  [ "$(stat -f %z "$output/intro-$size.jpg")" -le 153600 ]
}
encode desktop work/exports/orbit-clean-desktop 7000k
/Applications/Blender.app/Contents/MacOS/Blender -b -P work/blender/render_orbit.py -- --samples 24 --width 1080 --portrait --radius 300 --height 170 --out orbit-clean-phone --sky sky-2k.hdr > /tmp/stadium-orbit-phone.log 2>&1
if [ "$(find work/exports/orbit-clean-phone -name 'frame-*.png' | wc -l | tr -d ' ')" != 144 ]; then
  echo 'Телефонный рендер не завершён: кодирование отменено.' >&2
  exit 1
fi
encode phone work/exports/orbit-clean-phone 3500k
for file in "$output"/*; do
  case "$file" in
    *-desktop.mp4|*-desktop.webm) limit=6291456 ;;
    *-phone.mp4|*-phone.webm) limit=3145728 ;;
    *) continue ;;
  esac
  if [ "$(stat -f %z "$file")" -gt "$limit" ]; then
    echo "Файл превышает бюджет: $file" >&2
    exit 1
  fi
done
echo 'Видео и постеры готовы к визуальной проверке.'
