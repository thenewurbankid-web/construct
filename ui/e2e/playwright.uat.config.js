// UAT walks (ui/e2e/uat/<step>.spec.js): each step's review.md "To try it in Cockpit" how-to, walked in a real browser
// the way a non-technical owner would (no API shortcuts), failing on console errors and 4xx/5xx answers. Same servers and
// ports as playwright.config.js:
//   E2E_CLIENT_PORT=3367 E2E_SERVER_PORT=4367 packages/tools/dev/heavy.sh npx playwright test -c playwright.uat.config.js --workers=1
import base from './playwright.config.js';

export default { ...base, testDir: './uat', testIgnore: [] };
