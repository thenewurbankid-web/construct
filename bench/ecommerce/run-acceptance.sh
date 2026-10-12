#!/usr/bin/env bash
# Run the acceptance specs against one built project (either arm), through heavy.sh, one worker, one server.
#
#   bench/ecommerce/run-acceptance.sh <project-dir> [port=3395] [report.json]
#
# Writes the Playwright JSON report (default <project-dir>/../logs/acceptance.json) and prints "passed/total".
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
node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const specs = []; const walk = (s) => { for (const x of s.suites ?? []) walk(x); for (const sp of s.specs ?? []) specs.push(sp); };
walk(r);
const passed = specs.filter((s) => s.ok).length;
console.log(JSON.stringify({ passed, total: specs.length, failed: specs.filter((s) => !s.ok).map((s) => s.title) }));
' "$report" 2>/dev/null || echo '{"passed":0,"total":0,"error":"no report"}'
exit $code
