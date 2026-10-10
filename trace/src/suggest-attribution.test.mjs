// LIN-256 / TR-54: a demo-page Ask answered via the Suggest-provided pick (the Suggest button, not a direct
// option click) must be recorded with a source distinct from a direct human pick, so the Ledger and Handoffs
// tally can tell the two apart. The whole chain is: demo.mjs's suggestAsk() posts `{answer, suggested: true}`
// to /api/answer -> server.mjs wraps the resolved value as `{value, suggested}` -> pipeline.mjs's `ui` wrapper
// unwraps it and remembers the flag per question id -> its onAnswer callback upgrades source "you" to
// "suggested" for that question's emitted "answered" event, which is exactly what demo.mjs's `on.answered`
// handler pushes into `run.answers` for paintLedger()/toHandoffs() to read.
//
// This drives runPipeline() directly with a `prompt` that returns the same `{value, suggested}` shape
// server.mjs's /api/answer route produces, rather than spinning up the whole HTTP server: pipeline.mjs's `ui`
// wrapper and onAnswer callback are where the actual attribution logic lives, and server.mjs's own wrapping
// (`resolve({ value: answer, suggested: !!suggested })`) is a one-line pass-through already covered by reading
// the source.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "./pipeline.mjs";
import { resetExample } from "./reset.mjs";

test("an Ask answered via Suggest (prompt returns {value, suggested: true}) is recorded with source 'suggested', not 'you'", async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-suggest-attr-"));
  fs.cpSync(path.join(root, "examples", "contacts"), dir, { recursive: true });
  resetExample(dir);
  const events = [];
  let suggestedId = null;
  let picked = false;
  await runPipeline({
    dir,
    outRoot: fs.mkdtempSync(path.join(os.tmpdir(), "lm-suggest-attr-out-")),
    auto: false,
    interactive: false,
    // Mirrors what server.mjs's /api/answer now hands back to pipeline.mjs's `ui` wrapper. The first "choice"
    // question is answered as if it came from the Suggest button; everything else gets a plain direct-pick-
    // shaped answer (an index for "choice", the default for "text", the first index for "multi", a built
    // {from, inputs, fn} for "joint" — none of which carry both a "value" and a "suggested" key, so pipeline's
    // unwrap guard must leave them alone).
    prompt: (q) => {
      if (!picked && q.type === "choice") {
        picked = true;
        suggestedId = q.id;
        return Promise.resolve({ value: 0, suggested: true });
      }
      if (q.type === "text") return Promise.resolve(q.default ?? "");
      if (q.type === "multi") return Promise.resolve([0]);
      if (q.type === "joint") return Promise.resolve({ from: q.sources[0].value, inputs: q.suggestedInputs, fn: q.defaultName[q.sources[0].value] });
      return Promise.resolve(0);
    },
    emit: (type, data) => events.push({ type, data }),
  });
  assert.ok(suggestedId, "expected at least one 'choice' question in the contacts example");
  const answered = events.find((e) => e.type === "answered" && e.data.id === suggestedId);
  assert.ok(answered, "expected an 'answered' event for the Suggest-picked question");
  assert.equal(answered.data.source, "suggested");
  assert.notEqual(answered.data.source, "you");
});
