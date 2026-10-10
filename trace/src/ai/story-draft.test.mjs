import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { storyPrompt, checkStoryDraft, draftStory } from "./story-draft.mjs";
import { loadStory } from "./context.mjs";
import { readSpec } from "../contract.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleDir = path.join(here, "..", "..", "examples", "products");

test("storyPrompt includes the feature/route and the real part/endpoint/field names given to it", () => {
  const parts = { values: [{ name: "openCount" }], lists: [{ name: "products", fields: ["name", "price"] }], actions: [{ name: "viewProduct" }] };
  const labels = { values: { openCount: { label: "Open orders" } }, fields: { name: { header: "Name" }, price: { header: "Price" } }, list: { name: "products", header: "Name" } };
  const endpoints = [{ method: "GET", path: "/api/products" }];
  const fields = ["price", "sku"];
  const p = storyPrompt({ feature: "products", route: "/products", parts, labels, endpoints, fields });
  assert.match(p, /"products"/);
  assert.match(p, /\/products/);
  assert.match(p, /openCount/);
  assert.match(p, /Open orders/);
  assert.match(p, /name/);
  assert.match(p, /price/);
  assert.match(p, /viewProduct/);
  assert.match(p, /GET \/api\/products/);
  assert.match(p, /sku/);
});

test("checkStoryDraft drops a criterion that names no real part or field, and keeps one that does", () => {
  const text = JSON.stringify({
    goal: "As a user, I want to see products, so that I can browse them.",
    criteria: ["The page shows the product name and price.", "The moon is made of cheese."],
  });
  const r = checkStoryDraft(text, { partNames: ["name"], fieldNames: ["price"] });
  assert.equal(r.ok, true);
  assert.equal(r.criteria.length, 1);
  assert.match(r.criteria[0], /product name and price/);
  assert.equal(r.dropped.length, 1);
  assert.match(r.dropped[0], /moon is made of cheese/);
});

test("checkStoryDraft returns ok:false when nothing survives", () => {
  const text = JSON.stringify({ goal: "", criteria: ["This bullet mentions nothing from the given list at all."] });
  const r = checkStoryDraft(text, { partNames: ["name"], fieldNames: ["price"] });
  assert.equal(r.ok, false);
  assert.match(r.why, /no goal/);
});

test("checkStoryDraft rejects invalid JSON", () => {
  assert.equal(checkStoryDraft("not json").ok, false);
});

test("draftStory returns markdown that round-trips through loadStory, and never writes any file", async () => {
  const spec = readSpec(exampleDir);
  const source = fs.readFileSync(path.join(exampleDir, spec.page || "page.jsx"), "utf8");

  // Snapshot the directory before calling, to assert nothing was written.
  const before = fs.readdirSync(exampleDir).sort().map((f) => `${f}:${fs.statSync(path.join(exampleDir, f)).mtimeMs}:${fs.statSync(path.join(exampleDir, f)).size}`);

  const providerFn = async () => ({
    text: JSON.stringify({
      goal: "As a shopper, I want to see products, so that I can decide what to buy.",
      criteria: [
        "The product name and price are shown for each item.",
        "This criterion mentions no real part or field at all.",
      ],
    }),
  });

  const result = await draftStory({ dir: exampleDir, spec, source }, providerFn);
  assert.equal(result.ok, true);
  assert.match(result.markdown, /^## Goal\n/);
  assert.match(result.markdown, /## Acceptance criteria\n- /);

  const after = fs.readdirSync(exampleDir).sort().map((f) => `${f}:${fs.statSync(path.join(exampleDir, f)).mtimeMs}:${fs.statSync(path.join(exampleDir, f)).size}`);
  assert.deepEqual(after, before, "draftStory must never write any file in the example directory");

  // Round-trip through loadStory: write the markdown to a temp dir's story.md and confirm it parses back to
  // the same goal/criteria.
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "story-draft-"));
  try {
    fs.writeFileSync(path.join(tmp, "story.md"), result.markdown);
    const loaded = loadStory(tmp);
    assert.equal(loaded.goal, result.goal);
    assert.deepEqual(loaded.criteria, result.criteria);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("draftStory returns ok:false when the provider call fails", async () => {
  const spec = readSpec(exampleDir);
  const source = fs.readFileSync(path.join(exampleDir, spec.page || "page.jsx"), "utf8");
  const providerFn = async () => { throw new Error("ECONNREFUSED"); };
  const r = await draftStory({ dir: exampleDir, spec, source }, providerFn);
  assert.equal(r.ok, false);
  assert.match(r.why, /ECONNREFUSED/);
});
