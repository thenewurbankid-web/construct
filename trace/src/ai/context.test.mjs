// loadStory: the optional Goal / Acceptance criteria sections in story.md, that loadFacts doesn't duplicate
// what those sections already carry, and the fallback for a story.md with neither heading (title -> goal,
// top-level bullets -> criteria).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadStory, loadFacts, matchCriterion, formatStory, saveStory } from "./context.mjs";

const dirWith = (storyMd) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ctx-"));
  fs.writeFileSync(path.join(d, "story.md"), storyMd);
  return d;
};
const spec = { docs: {} };
const source = "export default function P(){ return <main/>; }";

test("loadStory: parses Goal and Acceptance criteria sections", () => {
  const d = dirWith(
    "## Goal\n" +
      "As a manager, I want to see the total,\n" +
      "so that I can track spend.\n" +
      "\n" +
      "## Acceptance criteria\n" +
      "- The total is the sum of all line items.\n" +
      "* It updates live.\n" +
      "1. It shows a currency symbol.\n" +
      "\n" +
      "## Notes\n" +
      "- Not part of either section.\n",
  );
  const story = loadStory(d);
  assert.equal(story.goal, "As a manager, I want to see the total, so that I can track spend.");
  assert.deepEqual(story.criteria, [
    "The total is the sum of all line items.",
    "It updates live.",
    "It shows a currency symbol.",
  ]);
});

test("loadStory: story.md with no headings and no title falls back to empty goal, bullets as criteria", () => {
  const d = dirWith("- Owner is the project lead.\n- Initials are the first letter of the first name and of the last name.\n");
  assert.deepEqual(loadStory(d), {
    goal: "",
    criteria: ["Owner is the project lead.", "Initials are the first letter of the first name and of the last name."],
  });
});

test("loadStory: story.md with a title but no Goal/Acceptance headings falls back to title as goal, bullets as criteria", () => {
  const d = dirWith(
    "# Roster — requirements\n\n- Owner is the project lead.\n- Backup is the project's deputy.\n",
  );
  assert.deepEqual(loadStory(d), {
    goal: "Roster — requirements",
    criteria: ["Owner is the project lead.", "Backup is the project's deputy."],
  });
});

test("loadFacts: fallback story.md's title and bullets are not duplicated into the general fact pool (they're consumed by loadStory, same as the explicit-heading path)", () => {
  const d = dirWith(
    "# Roster — requirements\n\n- Owner is the project lead.\n- Backup is the project's deputy.\n",
  );
  const facts = loadFacts({ dir: d, spec, source });
  assert.ok(!facts.some((f) => f.includes("Owner is the project lead")));
  assert.ok(!facts.some((f) => f.includes("Backup is the project's deputy")));
});

test("loadFacts: Goal/Acceptance-criteria lines are not duplicated into the general fact pool", () => {
  const d = dirWith(
    "## Goal\n" +
      "As a manager, I want to see the total, so that I can track spend.\n" +
      "\n" +
      "## Acceptance criteria\n" +
      "- The total is the sum of all line items.\n" +
      "\n" +
      "## Notes\n" +
      "- A regular fact, unrelated to goal or criteria.\n",
  );
  const facts = loadFacts({ dir: d, spec, source });
  assert.ok(!facts.some((f) => f.includes("I want to see the total")));
  assert.ok(!facts.some((f) => f.includes("sum of all line items")));
  assert.ok(facts.some((f) => f.includes("A regular fact, unrelated to goal or criteria.")));
});

test("matchCriterion: picks the criterion sharing a word with the part", () => {
  const story = { goal: "", criteria: ["The total is the sum of all line items.", "It shows a currency symbol."] };
  assert.deepEqual(matchCriterion("total", story), { id: "criterion-0", text: "The total is the sum of all line items." });
});

test("matchCriterion: returns null when no criterion overlaps", () => {
  const story = { goal: "", criteria: ["The total is the sum of all line items.", "It shows a currency symbol."] };
  assert.equal(matchCriterion("owner", story), null);
});

test("matchCriterion: returns null when story.criteria is empty", () => {
  assert.equal(matchCriterion("total", { goal: "", criteria: [] }), null);
});

test("matchCriterion: with two overlapping criteria, picks the earlier index", () => {
  const story = { goal: "", criteria: ["The total shows a currency symbol.", "The total is the sum of all line items."] };
  const m = matchCriterion("total", story);
  assert.equal(m.id, "criterion-0");
  assert.equal(m.text, "The total shows a currency symbol.");
});

test("matchCriterion: id is stable/derived from index", () => {
  const story = { goal: "", criteria: ["Owner is the project lead.", "Backup is the project's deputy.", "Total is the sum."] };
  assert.equal(matchCriterion("owner", story).id, "criterion-0");
  assert.equal(matchCriterion("backup", story).id, "criterion-1");
  assert.equal(matchCriterion("total", story).id, "criterion-2");
});

// formatStory / saveStory (LIN-106): the Story panel's save path, and the shape loadStory reads back.
test("formatStory: goal and criteria both present, in the explicit-heading shape", () => {
  const md = formatStory({ goal: "As a user, I want X, so that Y.", criteria: ["First.", "Second."] });
  assert.equal(md, "## Goal\n\nAs a user, I want X, so that Y.\n\n## Acceptance criteria\n\n- First.\n- Second.\n");
});

test("formatStory: goal only omits the Acceptance criteria section", () => {
  const md = formatStory({ goal: "As a user, I want X.", criteria: [] });
  assert.equal(md, "## Goal\n\nAs a user, I want X.\n\n");
  assert.ok(!md.includes("Acceptance criteria"));
});

test("formatStory: criteria only omits the Goal section", () => {
  const md = formatStory({ goal: "", criteria: ["First.", "Second."] });
  assert.equal(md, "## Acceptance criteria\n\n- First.\n- Second.\n");
  assert.ok(!md.includes("## Goal"));
});

test("saveStory + loadStory: round trip with a goal and two criteria", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ctx-"));
  saveStory(d, { goal: "As a manager, I want the total.", criteria: ["It sums correctly.", "It updates live."] });
  assert.deepEqual(loadStory(d), { goal: "As a manager, I want the total.", criteria: ["It sums correctly.", "It updates live."] });
});

test("saveStory + loadStory: round trip, goal only", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ctx-"));
  saveStory(d, { goal: "As a manager, I want the total.", criteria: [] });
  assert.deepEqual(loadStory(d), { goal: "As a manager, I want the total.", criteria: [] });
});

test("saveStory + loadStory: round trip, criteria only", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ctx-"));
  saveStory(d, { goal: "", criteria: ["It sums correctly."] });
  assert.deepEqual(loadStory(d), { goal: "", criteria: ["It sums correctly."] });
});
