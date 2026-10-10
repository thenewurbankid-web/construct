// Playwright config for feature-grouper's UI (Construct's rule: a Playwright spec per UI feature). Scoped to
// this tool: config, browsers and results all live under tools/feature-grouper/, not the repo root.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./out/test-results",
  reporter: [["list"], ["html", { outputFolder: "./out/report", open: "never" }]],
  timeout: 30_000,
  fullyParallel: false, // one page.html server, started once (see e2e/serve.setup.mjs)
  use: { baseURL: "http://127.0.0.1:4319" },
});
