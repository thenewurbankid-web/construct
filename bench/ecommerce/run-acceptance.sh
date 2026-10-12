#!/usr/bin/env bash
# Run the acceptance specs against one built project (either arm), through heavy.sh, one worker, one server.
#
#   bench/ecommerce/run-acceptance.sh <project-dir> [port=3395] [report.json]
#
# Writes the Playwright JSON report (default <project-dir>/../logs/acceptance.json) and prints its summary: passed/total,
# or "did not run: build failed" when no test ran.
# The project needs its node_modules (the starters' are installed; new-run.sh copies them).
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
project="$(cd "${1:?project dir}" && pwd)"
port="${2:-3395}"
report="${3:-$project/../logs/acceptance.json}"
mkdir -p "$(dirname "$report")"
if [ ! -d "$here/acceptance/node_modules/@playwright/test" ]; then
  (cd "$here/acceptance" && "$repo/packages/tools/dev/heavy.sh" npm install --no-audit --no-fund >/dev/null) || exit 1
fi
cd "$here/acceptance"
BENCH_PROJECT="$project" BENCH_PORT="$port" BENCH_REPORT="$report" \
  "$repo/packages/tools/dev/heavy.sh" npx playwright test --config playwright.config.ts --workers=1
code=$?
# The summary line from metrics.mjs (one module counts acceptance): no test ran, because the webServer's
# `next build` failed, prints {"ran":false,"status":"did not run: build failed",...}, never "passed 0 total 0".
node "$here/metrics.mjs" acceptance "$report"
exit $code
