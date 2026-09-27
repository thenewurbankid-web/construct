// #420: the required-before-merge lane. smoke.spec.js (the "does the harness even work" check) plus one spec per
// primary screen (PrimaryScreens.ts / Navigation.spec.mjs: Features, Pages, Components, Git, Tests) — enough to
// catch a broken build or a broken screen without paying for the full 90+ spec, 12-config suite on every PR.
// Target: under 5 minutes. Everything else (ports, webServer, workspace env) is identical to the default config;
// only which specs run differs, same pattern as playwright.workspace.config.js's testMatch override.
//
//   cd ui/e2e && npx playwright test -c playwright.smoke.config.js        # or: npm run test:smoke-lane
//
// The full, sharded suite (one job per config) is a separate lane — see docs/E2E-LANES.md and
// .github/workflows/e2e-full.yml — and runs on merge/nightly, not on every PR.
import base from './playwright.config.js';

export default {
  ...base,
  testIgnore: [],
  testMatch: [
    /smoke\.spec\.js/,
    /features-screen\.spec\.js/, // Features screen
    /pages-screen\.spec\.js/, // Pages screen
    /components-screen\.spec\.js/, // Components screen
    /review-mode\.spec\.js/, // Git screen (route: /review, feature: review)
    /tests-tab\.spec\.js/, // Tests screen
  ],
};
