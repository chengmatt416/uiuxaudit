#!/bin/sh
# One-shot finisher after the Figma plugin import.
# Usage: FIGMA_TOKEN=figd_… ./scripts/finalize.sh https://www.figma.com/design/<KEY>/Name
set -e
cd "$(dirname "$0")/.."

LINK="${1:?usage: finalize.sh <figma-file-url>}"
FIGMA_TOKEN="${FIGMA_TOKEN:?set FIGMA_TOKEN first}"
SLUGS="example hn playwright-docs tailwind github-ts"

echo "== register =="
for s in $SLUGS; do
  npm run --silent ua -- register "$s" --link "$LINK"
done

echo "== verify (original baselines) =="
npm run --silent ua -- verify || true

echo "== generate ops + applied baselines =="
for s in $SLUGS; do
  npm run --silent ua -- apply "$s" --all || true
done

cat <<'EOF'

== manual step (last one) ==
Run the plugin → Apply mode → select each .uiuxaudit/out/<slug>.ops.json
(5 files, same Figma file). Then finish with:
  FIGMA_TOKEN=… ./scripts/finalize-verify.sh
EOF
