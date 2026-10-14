#!/usr/bin/env bash
# يبني مشهد الافتتاح كاملًا: تصيير الصورة ← تصميم الصوت ← الدمج النهائي.
# المتطلبات: Node.js + Playwright (Chromium)، Python 3 + numpy، ffmpeg.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BUILD="$HERE/../build"
OUT="$HERE/../output"
mkdir -p "$BUILD" "$OUT"
export NODE_PATH="${NODE_PATH:-$(npm root -g)}"

node "$HERE/render.cjs" --out "$BUILD"
python3 "$HERE/audio.py" "$BUILD/timeline.json" "$BUILD/audio.wav"

mux() {
  ffmpeg -y -loglevel error -i "$1" -i "$BUILD/audio.wav" \
    -map 0:v -map 1:a -c:v copy \
    -af "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000" -c:a aac -b:a 256k \
    -metadata title="من الظل إلى النور — مشهد الافتتاح" -metadata:s:a:0 language=ara \
    -movflags +faststart -shortest "$2"
}
mux "$BUILD/video_subs.mp4"  "$OUT/opening-scene.mp4"
mux "$BUILD/video_clean.mp4" "$OUT/opening-scene_clean.mp4"

# صور ثابتة للمراجعة
for f in 1.8 4.0 5.6 7.0 9.0; do
  ffmpeg -y -loglevel error -ss "$f" -i "$OUT/opening-scene.mp4" -frames:v 1 -q:v 3 "$OUT/still_${f/./_}s.jpg"
done
ls -la "$OUT"
