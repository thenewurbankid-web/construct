#!/usr/bin/env bash
# #485 -- the one shared, deterministic build step both Cockpit distribution
# paths (Docker image, `@line/cockpit` npm package) consume. Produces:
#   ui/client/.next/standalone/   -- a self-contained Next.js production
#                                    server (server.js + its own node_modules,
#                                    plus static/public copied in per Next's
#                                    own standalone-output instructions)
#   ui/server/dist/                -- ui/server bundled by esbuild (see
#                                    ui/server/scripts/build.mjs for what
#                                    stays external and why)
#
# Run from the repo root: ui/build.sh
# Heavy (npm ci + next build): wrap with tools/dev/heavy.sh in this repo's
# own dev workflow; a Docker build or a fresh `npm install` of the published
# package runs it directly (no heavy.sh outside this repo's own machine).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== ui/client: next build (output: 'standalone') =="
npm --prefix ui/client ci
npm --prefix ui/client run build
rm -rf ui/client/.next/standalone/.next/static ui/client/.next/standalone/public
cp -r ui/client/.next/static ui/client/.next/standalone/.next/static
[ -d ui/client/public ] && cp -r ui/client/public ui/client/.next/standalone/public

echo "== ui/server: esbuild bundle =="
npm --prefix ui/server ci
npm --prefix ui/server run build

echo "== done =="
echo "Client standalone: ui/client/.next/standalone/server.js"
echo "Server bundle:      ui/server/dist/index.mjs"
