#!/usr/bin/env bash
# Line browser batch: every line-* spec under its config, then every UAT walk. One config at a time,
# one pair of servers each, --workers=1. Usage: ui/e2e/line-batch.sh [spec filter...]
set -u
cd "$(dirname "$0")"
export E2E_CLIENT_PORT=${E2E_CLIENT_PORT:-3391} E2E_SERVER_PORT=${E2E_SERVER_PORT:-4391}
status=0
run() { echo "=== $*"; npx playwright test "$@" --workers=1 --reporter=line || status=1; }
if [ "$#" -gt 0 ]; then run "$@"; exit $status; fi
MAIN=$(ls tests/line-*.spec.js | grep -v -e line-drafter -e line-train -e line-new-project)
run -c playwright.config.js $MAIN
run -c playwright.workspace.config.js tests/line-new-project.spec.js
run -c playwright.line-drafter.config.js tests/line-drafter.spec.js
run -c playwright.line-train.config.js tests/line-train.spec.js
run -c playwright.uat.config.js
exit $status
