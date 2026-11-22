#!/bin/bash
# Контактный лист всех панорам (миниатюры, 12 в ряд) для быстрого просмотра результата одним изображением.
cd "$(dirname "$0")/../../outputs/stadium-pilot/public/panoramas" || exit 1
ffmpeg -y -loglevel error -pattern_type glob -i '*.webp' -vf "scale=240:-1,tile=12x20:padding=2:color=0x14181a" -frames:v 1 -q:v 4 ../../../../work/panoramas-contact-sheet.jpg
ls -la ../../../../work/panoramas-contact-sheet.jpg
