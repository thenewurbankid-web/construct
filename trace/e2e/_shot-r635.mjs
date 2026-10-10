// LIN-190 verification shot: a live Tie (invoices' list.requestedBy) resolved through a real POST /api/adapter
// run+questionId call against the actual dev server's live run — the exact mechanism "Save adapter & attach"
// now uses. The UI's own compatible-endpoints gate means this specific tie has directly-compatible candidates
// (so the "Create adapter…" affordance itself doesn't show for it, same situation R6.34's shot noted), so this
// drives the real POST the dialog makes directly, against the real running pipeline, and screenshots the
// before/after of the Ask card to show the tie actually resolving — not a mocked call.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const shotsDir = "/Users/shashank/Repositories/construct/trace/src/ui/changelog/shots";
const invoicesDir = "/Users/shashank/Repositories/construct/trace/examples/invoices";
const STATE_FILES = ["answers.json", "decisions.json", "ai-cache.json", "answers.history.jsonl", "adapters.json"];

const before = STATE_FILES.map((f) => {
  const p = path.join(invoicesDir, f);
  return [p, fs.existsSync(p) ? fs.readFileSync(p) : null];
});
const restore = () => { for (const [p, buf] of before) { if (buf === null) fs.rmSync(p, { force: true }); else fs.writeFileSync(p, buf); } };

try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto("http://localhost:4200/?canvasdebug");
  await page.evaluate(() => fetch("/api/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ example: "invoices" }) }));
  await page.locator('.scen-card[data-id="invoices"]').click();

  const runPromise = page.waitForResponse((r) => r.url().includes("/api/run") && r.request().method() === "POST");
  const wireButton = page.locator("#bWire");
  await page.waitForFunction(() => document.querySelector("#bWire") && !document.querySelector("#bWire").disabled, undefined, { timeout: 15000 });
  await wireButton.click();
  const runId = (await (await runPromise).json()).run;

  await page.locator("[data-asking]").first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(() => document.querySelector(".ask-card, #sideBody"), undefined, { timeout: 15000 });
  await page.waitForTimeout(400);
  await page.locator("#side").screenshot({ path: `${shotsDir}/R6.35-before.jpg`, type: "jpeg" }).catch(() => {});

  // The exact request the "Create adapter" dialog's "Save adapter & attach" now makes (src/ui/canvas/trace.mjs's
  // saveAdapterDraft): saves the mapping AND resolves the run's open question in one call.
  const result = await page.evaluate(async (runId) => {
    const r = await fetch("/api/adapter", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ example: "invoices", operationId: "GET /api/invoices", field: "vendor", transform: "passthrough", fromType: "string", toType: "string", value: "Northwind Freight", run: runId, questionId: "list.requestedBy" }),
    });
    return r.json();
  }, runId);
  if (!result.ok || !result.resolved) throw new Error("adapter save/resolve did not succeed: " + JSON.stringify(result));

  // The Ask card advances (or the run finishes) once the tie is resolved.
  await page.waitForFunction(() => !document.querySelector('[data-asking][data-part="tie"]'), undefined, { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.locator("#side").screenshot({ path: `${shotsDir}/R6.35.jpg`, type: "jpeg" });

  console.log("resolved:", JSON.stringify(result));
  await browser.close();
  console.log("done");
} finally {
  restore();
}
