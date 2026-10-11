// Owner UAT walks (one per Line step, ui/e2e/uat/<step>.spec.js): each walks its review.md "To try it in Cockpit"
// how-to in a real browser the way a non-technical owner would (clicks only, no API shortcuts) and fails on a console
// error or a 4xx/5xx answer. Same servers as the main config.
//
//   E2E_CLIENT_PORT=3363 E2E_SERVER_PORT=4363 npx playwright test -c playwright.uat.config.js uat/cs1.spec.js
import base from './playwright.config.js';

export default { ...base, testDir: './uat', testIgnore: [], timeout: 60_000 };
