#!/usr/bin/env bash
# Run the acceptance specs against one built project (either arm), through heavy.sh, one worker, one server.
#
#   bench/ecommerce/run-acceptance.sh [--bench <bench-dir>] <project-dir> [port=3395] [report.json]
#
# --bench (or BENCH_DIR) picks the bench whose acceptance/ folder runs (default bench/ecommerce; e.g. bench/lending,
# the held-out spec). Each bench's acceptance/ has its own package.json, playwright.config.ts and *.spec.ts.
# Writes the Playwright JSON report (default <project-dir>/../logs/acceptance.json) and prints its summary: passed/total,
# or "did not run: build failed" when no test ran.
# The project needs its node_modules (the starters' are installed; new-run.sh copies them).
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
bench="${BENCH_DIR:-$here}"
if [ "${1:-}" = "--bench" ]; then bench="${2:?bench dir}"; shift 2; fi
bench="$(cd "$bench" && pwd)"
project="$(cd "${1:?project dir}" && pwd)"
port="${2:-3395}"
report="${3:-$project/../logs/acceptance.json}"
mkdir -p "$(dirname "$report")"
if [ ! -d "$bench/acceptance/node_modules/@playwright/test" ]; then
  (cd "$bench/acceptance" && "$repo/packages/tools/dev/heavy.sh" npm install --no-audit --no-fund >/dev/null) || exit 1
fi
cd "$bench/acceptance"
BENCH_PROJECT="$project" BENCH_PORT="$port" BENCH_REPORT="$report" \
  "$repo/packages/tools/dev/heavy.sh" npx playwright test --config playwright.config.ts --workers=1
code=$?
# The summary line from metrics.mjs (one module counts acceptance): no test ran, because the webServer's
# `next build` failed, prints {"ran":false,"status":"did not run: build failed",...}, never "passed 0 total 0".
node "$here/metrics.mjs" acceptance "$report" --bench "$bench"
exit $code
