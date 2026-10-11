// Owner UAT walks (ui/e2e/uat/<step>.spec.js): each step's review.md "To try it" how-to, clicked through in a real
// browser as the owner would, on the same servers and ports as the main config. Run:
//   E2E_CLIENT_PORT=... E2E_SERVER_PORT=... npx playwright test -c playwright.uat.config.js --workers=1
import base from './playwright.config.js';

export default { ...base, testDir: './uat', testIgnore: [], outputDir: './test-results-uat' };
