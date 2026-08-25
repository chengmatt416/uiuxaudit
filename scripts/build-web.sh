#!/bin/sh
set -e
cd "$(dirname "$0")/.."
mkdir -p apps/web/dist
OUT=apps/web/dist/app.js
if [ "${1}" = "--min" ]; then
  npx esbuild apps/web/src/main.ts --bundle --format=iife --target=es2020 --minify --outfile=$OUT
else
  npx esbuild apps/web/src/main.ts --bundle --format=iife --target=es2020 --outfile=$OUT
fi
cp apps/web/index.html apps/web/dist/
cp apps/web/src/style.css apps/web/dist/style.css
cp apps/web/src/manifest.webmanifest apps/web/dist/
cp apps/web/src/sw.js apps/web/dist/
if [ ! -f apps/web/dist/icon-512.png ]; then
  npx tsx scripts/gen-icons.ts
fi
echo "web dist ready → apps/web/dist"
