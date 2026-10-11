// Owner UAT walks (ui/e2e/uat/<step>.spec.js): each step's docs/line/review.md "UAT" how-to, walked in a real browser
// the way a non-technical owner would. Same servers and ports as playwright.config.js; only the folder differs.
//   E2E_CLIENT_PORT=3366 E2E_SERVER_PORT=4366 npx playwright test -c playwright.uat.config.js --workers=1 cg1 ct1
import base from './playwright.config.js';

export default { ...base, testDir: './uat', testIgnore: [] };
