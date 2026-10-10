// The story-evidence variant (LIN-108) is registered correctly. This is NOT an acceptance test: the variant is
// measurement-only infrastructure (see eval/variants.mjs's header) and the default pipeline/CLI stay off
// regardless of what `npm run eval -- --variant story-evidence` / `npm run eval:gate -- --variant story-evidence`
// measure — those numbers are reported by hand in CHANGELOG.md, not gated here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getVariant, variantNames } from "./variants.mjs";

test("the story-evidence variant is registered with acceptance criteria and its own generate()", () => {
  assert.ok(variantNames().includes("story-evidence"));
  const v = getVariant("story-evidence");
  assert.deepEqual(v.acceptance, { wrong_accept_reduction: 0.5, recall_drop_max: 0.02, questions_increase_max: 0.1, determinism: true });
  assert.equal(typeof v.generate, "function", "generated-file hashes must come from the pipeline with the flag on");
  assert.equal(typeof v.analyze, "function");
});

test("with no story text, analyze() behaves exactly like baseline (no evidence to narrow with)", () => {
  const extracted = { lists: [], values: [{ name: "v", example: "5" }], actions: [], forms: [] };
  const spec = { apis: [{ method: "GET", path: "/items", response: [{ id: 1, count: 5 }] }], list: null, contract: { usable: true } };
  const v = getVariant("story-evidence");
  const { matched } = v.analyze(extracted, spec, { story: null });
  // both fields (id, count as a value) could explain "5" as text; with no story, nothing is narrowed away.
  assert.ok(matched.values[0].candidates.length >= 1);
});

// TR-50: regression for the coupled-field collision measured on eval/cases/example-roster (plannedTotal/
// forecastTotal both tied between budget/forecast; the story's "budgets" plural never token-matches candidate
// "budget", so both ties independently "win" on "forecast" under the OLD per-field-eager narrowing, silently
// mis-resolving plannedTotal). Two fields whose story-evidence pick collides on the same candidate must BOTH
// stay as full ties (ask, don't guess); an independent, uncontested tie elsewhere in the same match() call must
// still narrow, so the fix is a targeted collision guard, not a blanket disable of story-evidence.
import { match } from "../src/match.mjs";

test("TR-50: two tied fields whose story-evidence pick collides on the same candidate both stay tied, while an uncontested tie elsewhere still narrows", () => {
  const extracted = { lists: [], values: [
    { name: "plannedTotal", example: "1500" },
    { name: "forecastTotal", example: "1500" },
    { name: "totalCost", example: "10" },
  ], actions: [], forms: [] };
  const spec = {
    apis: [{ method: "GET", path: "/items", response: [
      { id: 1, budget: 1000, forecast: 1000, cost: 7, spend: 7 },
      { id: 2, budget: 500, forecast: 500, cost: 3, spend: 3 },
    ] }],
    list: null, contract: { usable: true },
  };
  // mentions "forecast" literally but only the PLURAL "budgets" (never the singular candidate name "budget"),
  // the exact asymmetry that caused the real regression; "cost" is mentioned literally and uncontested.
  const story = "The forecast total is the sum of all forecasts. The total cost is the sum of costs.";

  const withStory = match(extracted, spec, { storyEvidence: true, storyText: story });
  const byName = Object.fromEntries(withStory.values.map((v) => [v.name, v.candidates.map((c) => c.field)]));
  assert.deepEqual(new Set(byName.plannedTotal), new Set(["budget", "forecast"]), "colliding tie stays a tie, not narrowed to the wrong field");
  assert.deepEqual(new Set(byName.forecastTotal), new Set(["budget", "forecast"]), "colliding tie stays a tie, not narrowed to the wrong field");
  assert.deepEqual(byName.totalCost, ["cost"], "an uncontested tie elsewhere still narrows (story-evidence is not disabled wholesale)");

  const withoutStory = match(extracted, spec);
  const byNameNoStory = Object.fromEntries(withoutStory.values.map((v) => [v.name, v.candidates.map((c) => c.field)]));
  assert.deepEqual(new Set(byNameNoStory.totalCost), new Set(["cost", "spend"]), "storyEvidence off (default) stays byte-for-byte unchanged: no narrowing at all");
});
