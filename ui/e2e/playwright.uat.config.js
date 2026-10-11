// UAT walks (ui/e2e/uat/<step>.spec.js): each step's review.md "To try it in Cockpit" how-to, walked in a real browser
// as a non-technical owner would (clicks and typing only, no API shortcuts), failing on any console error or 4xx/5xx.
// Same servers and ports as the main config (E2E_CLIENT_PORT / E2E_SERVER_PORT):
//   npx playwright test -c playwright.uat.config.js --workers=1 [cw1]
import base from './playwright.config.js';

export default { ...base, testDir: './uat', testIgnore: [] };
