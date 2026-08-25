#!/bin/sh
# Bundles the Node-side core for the Electron shell and refreshes web assets.
set -e
cd "$(dirname "$0")/.."

npx esbuild packages/core/src/index.ts \
  --bundle --platform=node --format=cjs \
  --external:esbuild --external:ws \
  --outfile=apps/desktop/core-node.cjs

bash scripts/build-web.sh

rm -rf apps/desktop/web
mkdir -p apps/desktop/web
cp apps/web/dist/index.html apps/web/dist/app.js apps/web/dist/style.css apps/desktop/web/
cp apps/web/dist/manifest.webmanifest apps/web/dist/sw.js apps/web/dist/icon-192.png apps/web/dist/icon-512.png apps/desktop/web/ 2>/dev/null || true

echo "desktop bundles ready"
