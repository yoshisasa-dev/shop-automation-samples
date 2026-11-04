#!/bin/bash
# listing/src/*.html を 1220×1240 の PNG にする（Mac の Chrome を使う）
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for f in src/[0-9]*.html; do
  name=$(basename "$f" .html)
  url="file://$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$PWD/$f")"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1220,1240 --screenshot="$PWD/$name.png" "$url" >/dev/null 2>&1
  echo "$name.png"
done
