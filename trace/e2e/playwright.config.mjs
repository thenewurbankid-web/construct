// T16.8: Playwright config for the root Trace app. Scoped to this directory (config, browsers, results and the
// server's scratch output all live under e2e/, never the repo root) — same isolation pattern as
// tools/feature-grouper/playwright.config.mjs. Starts the real server (src/server.mjs) against a scratch --out
// directory, never demo-app/src, so running these specs (which press "Wire it" and so trigger a real generation
// run) can never change the shipped examples' generated output.
import { defineConfig } from "@playwright/test";

const PORT = 4599;

export default defineConfig({
  testDir: "./specs",
  outputDir: "./out/test-results",
  reporter: [["list"], ["html", { outputFolder: "./out/report", open: "never" }]],
  timeout: 30_000,
  fullyParallel: false, // one server, started once, like tools/feature-grouper's config
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    command: `node ../src/server.mjs --port ${PORT} --strict-port --no-open --out ./out/generated`,
    url: `http://127.0.0.1:${PORT}/api/examples`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
