#!/bin/sh
# Post-apply verification: re-runs verify for all slugs (now comparing
# against the APPLIED baselines written by finalize.sh / apply).
set -e
cd "$(dirname "$0")/.."
FIGMA_TOKEN="${FIGMA_TOKEN:?set FIGMA_TOKEN first}"
npm run --silent ua -- verify
