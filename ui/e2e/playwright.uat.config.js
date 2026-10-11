// The owner's UAT walks (one per step, ui/e2e/uat/<step>.spec.js): the review.md "To try it in Cockpit" how-to, walked
// in a real browser as a non-technical owner would. Same servers and ports as playwright.config.js.
import base from './playwright.config.js';

export default { ...base, testDir: './uat', testIgnore: [] };
