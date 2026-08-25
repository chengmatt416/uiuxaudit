#!/bin/sh
# Builds the Chrome and Firefox extensions into apps/extension/dist/<target>
# (unpacked) plus distributable zips. Reuses the shared web UI bundle.
set -e
cd "$(dirname "$0")/.."

for target in chrome firefox; do
  d="apps/extension/dist/$target"
  rm -rf "$d"
  mkdir -p "$d"
  npx esbuild apps/web/src/main.ts --bundle --format=iife --target=es2020 \
    --minify --outfile="$d/app.js"
  npx esbuild packages/core/src/extractor.ts --bundle --format=iife \
    --global-name=uaExt --outfile="$d/extractor.js"
  cp apps/web/index.html "$d/"
  cp apps/web/src/style.css "$d/style.css"
  cp apps/web/dist/icon-192.png apps/web/dist/icon-512.png "$d/"
  cp "apps/extension/$target.manifest.json" "$d/manifest.json"
  cp apps/extension/background.js "$d/"
  echo "built $d"
done

if command -v zip >/dev/null 2>&1; then
  ( cd apps/extension/dist
    rm -f chrome.zip firefox.zip
    zip -qr chrome.zip chrome
    zip -qr firefox.zip firefox )
  echo "zips: apps/extension/dist/{chrome,firefox}.zip"
else
  echo "zip(1) not found — unpacked dirs only (pkg install zip to enable zips)"
fi
