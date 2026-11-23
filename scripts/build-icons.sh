#!/bin/sh
# Renders the PWA icons (PNG) from the SVG sources in web/public: headless Chrome draws
# each SVG at 512 px (it cannot open smaller windows), ImageMagick scales it down.
# Usage: sh scripts/build-icons.sh   (macOS; set CHROME to override the browser path)
set -eu
cd "$(dirname "$0")/../web/public"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

render() { # <svg> <size> <png>
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --window-size=512,512 --screenshot="$PWD/$3" "file://$PWD/$1" 2>/dev/null
  if [ "$2" != 512 ]; then magick "$3" -filter Lanczos -resize "${2}x$2" "$3"; fi
  echo "$3 (${2}x$2)"
}

render icon.svg                 192 icons/icon-192.png
render icon.svg                 512 icons/icon-512.png
render icons/icon-maskable.svg  512 icons/icon-maskable-512.png
render icons/icon-full.svg      180 icons/apple-touch-icon.png
# iOS shows transparency as black: make the Apple icon fully opaque.
magick icons/apple-touch-icon.png -background '#3a5bd9' -alpha remove -alpha off icons/apple-touch-icon.png
