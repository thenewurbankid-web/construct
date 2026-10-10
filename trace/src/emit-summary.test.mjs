// LIN-219: a value matched to a dedicated "summary" endpoint (LIN-212) gets real Service/Controller/Domain
// wiring end to end, not a placeholder and not a crash (the crash was LIN-218, fixed in R6.58 with a
// placeholder stand-in; this is the real wiring that placeholder stood in for).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "./pipeline.mjs";
import { loadCase, writeInputs } from "../eval/adapter.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "lm-emit-summary-"));

test("a value matched to a dedicated summary endpoint gets real Service/Controller/Domain code", async () => {
  const loaded = loadCase(path.join(root, "eval/cases/example-invoices-summary"));
  const dir = path.join(tmp(), "in");
  const out = path.join(tmp(), "out");
  writeInputs(loaded, dir, loaded.spec);
  await runPipeline({ dir, outRoot: out, auto: true });
  const base = path.join(out, "features", "invoices");
  const service = fs.readFileSync(path.join(base, "service/invoices.service.js"), "utf8");
  const domain = fs.readFileSync(path.join(base, "domain/invoices.domain.js"), "utf8");
  const controller = fs.readFileSync(path.join(base, "controller/InvoicesController.jsx"), "utf8");

  assert.match(service, /export const getInvoicesSummary = \(\) => request\("GET", `\/api\/invoices\/summary`\);/);
  assert.match(domain, /export function outstandingTotal\(summary\) \{\n {2}return moneyCompact\(get\(summary, "outstandingTotal"\)\);\n\}/);
  assert.doesNotMatch(domain, /PLACEHOLDER: "outstandingTotal"/);
  assert.match(controller, /const \[summary, setSummary\] = useState\(null\);/);
  assert.match(controller, /service\.getInvoicesSummary\(\)\.then\(setSummary\);/);
  assert.match(controller, /outstandingTotal=\{domain\.outstandingTotal\(summary\)\}/);

  // The generated Domain module's own function, run for real against the summary endpoint's example response.
  const domainMod = await import(path.join(base, "domain/invoices.domain.js"));
  assert.equal(domainMod.outstandingTotal({ outstandingTotal: 487300000 }), "$487.3M");

  // The generated Domain test file itself (the design's own example is the expected output) must pass.
  const testFile = fs.readFileSync(path.join(base, "domain/invoices.domain.test.js"), "utf8");
  assert.match(testFile, /const summary = \{\n {2}outstandingTotal: 487300000,\n\};/);
  assert.match(testFile, /assert\.equal\(domain\.outstandingTotal\(summary\), "\$487\.3M"\);/);
});
