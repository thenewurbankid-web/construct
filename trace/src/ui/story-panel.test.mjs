// The Story panel's pure render functions (LIN-106): plain string .includes() checks on the returned HTML,
// same style as the rest of src/ui/*.test.mjs (no contract-panel.test.mjs exists to mirror; this is the pattern
// used elsewhere in the tree for markup-returning functions).
import { test } from "node:test";
import assert from "node:assert/strict";
import { storyEmpty, storyLoaded, storyGate } from "./story-panel.mjs";

test("storyEmpty: shows Add story, no criteria list", () => {
  const html = storyEmpty();
  assert.ok(html.includes("Add story"));
  assert.ok(!html.includes("st-crit\""));
});

test("storyLoaded: shows goal, criteria and Edit story", () => {
  const html = storyLoaded({ goal: "x", criteria: ["a", "b"] });
  assert.ok(html.includes("x"));
  assert.ok(html.includes("a"));
  assert.ok(html.includes("b"));
  assert.ok(html.includes("Edit story"));
});

test("storyGate: shows the confirm heading and Confirm/Skip controls", () => {
  const html = storyGate();
  assert.ok(html.includes("Draft story, please confirm"));
  assert.ok(html.includes("data-stconfirm"));
  assert.ok(html.includes("data-stskip"));
});

test("storyGate: prefills the draft into the editor fields", () => {
  const html = storyGate({ draft: { goal: "g", criteria: ["c"] } });
  assert.ok(html.includes(">g<"));
  assert.ok(html.includes('value="c"'));
});
