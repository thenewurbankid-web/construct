// LIN-117 §2 screenshot: while the API details card is open, the Ask collapses to a one-line pinned bar.
// Starts its own Trace server on a scratch port (not 4200/4300/4210, which other agents' processes own) against
// a scratch copy of the invoices example, so no shared checkout state is touched. Playwright (not @playwright/test).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotsDir = path.join(root, "src", "ui", "changelog", "shots");
const PORT = 4611;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trace-askpin-shot-"));
fs.cpSync(path.join(root, "examples"), path.join(tmp, "examples"), { recursive: true });
fs.rmSync(path.join(tmp, "examples", ".original"), { recursive: true, force: true });
for (const f of ["answers.json", "decisions.json", "ai-cache.json", "answers.history.jsonl"]) fs.rmSync(path.join(tmp, "examples", "invoices", f), { force: true }); // fresh questions, not whatever the checked-in example already settled
const outDir = path.join(tmp, "out");

const server = spawn(process.execPath, [path.join(root, "src", "server.mjs"), "--port", String(PORT), "--strict-port", "--no-open", "--examples", path.join(tmp, "examples"), "--out", outDir], { stdio: "ignore" });
const cleanup = () => { server.kill(); fs.rmSync(tmp, { recursive: true, force: true }); };
process.on("exit", cleanup);

try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) break; } catch {} await sleep(250); }

  const browser = await chromium.launch();
  // taller than the usual 900 so the story panel's full text plus the API card and the pinned Ask bar all fit
  // without `#side`'s own box clipping the bottom (`#s-fit`'s height tracks the viewport via `100dvh`).
  const page = await browser.newPage({ viewport: { width: 1440, height: 1800 } });
  await page.goto(`http://localhost:${PORT}/`);
  await page.locator('.scen-card[data-id="invoices"]').click();
  const wireButton = page.locator("#bWire");
  await page.waitForFunction(() => document.querySelector("#bWire") && !document.querySelector("#bWire").disabled, undefined, { timeout: 15000 });
  await wireButton.click();

  await page.locator("[data-asking]").first().waitFor({ state: "visible", timeout: 15000 });
  await page.locator(".ask, .ask-pin").first().waitFor({ state: "visible", timeout: 15000 });

  const chip = page.locator("#railEps li.ep").first();
  await chip.waitFor({ state: "visible", timeout: 10000 });
  await chip.click();

  const pin = page.locator(".ask-pin");
  await pin.waitFor({ state: "visible", timeout: 10000 });

  await page.locator("#side").screenshot({ path: `${shotsDir}/R6.19.jpg`, quality: 90, type: "jpeg" });

  await browser.close();
  console.log("done");
} finally {
  cleanup();
}
