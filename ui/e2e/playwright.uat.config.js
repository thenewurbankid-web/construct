// UAT walks (owner rule, 11 Oct): each Line step's review.md "To try it" how-to, walked as the owner would in a real
// browser (clicks only, no API shortcuts; fails on console errors and 4xx/5xx). Same servers, ports and env as the
// default config; only the spec folder differs.
//
//   cd ui/e2e && npx playwright test -c playwright.uat.config.js
import base from './playwright.config.js';

export default {
  ...base,
  testDir: './uat',
  testIgnore: [],
};
