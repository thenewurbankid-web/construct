import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAi, confidenceOf } from "./ai-eval.mjs";
import { loadCase } from "./adapter.mjs";
import { getVariant } from "./variants.mjs";
import { here } from "./util.mjs";

test("AI run scores accepted answers against ground truth (fake model, no network)", async () => {
  const loaded = ["example-roster", "coincidence-shared-04"].map((c) => loadCase(here("cases", c)));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "eval-ai-"));
  const r = await runAi({ loaded, variant: getVariant("baseline"), workRoot: work, limit: 6, provider: async () => ({ text: '{"choice":1,"fact":1}', usage: { in: 100, out: 10 } }) });
  assert.equal(r.status, "ran");
  assert.ok(r.questions > 0 && r.questions <= 6);
  assert.ok(r.accepted <= r.questions && r.accepted_correct <= r.accepted);
  assert.ok(r.tokens > 0);
  assert.equal(r.ece, null, "a fake model reports no confidence");
});

test("confidence is read from providers that report it", () => {
  assert.equal(confidenceOf({ thinking: "open-jev: P(choice)={}, epistemic confidence 0.734 ≥ 0.5" }), 0.734);
  assert.equal(confidenceOf({ thinking: "" }), null);
});
