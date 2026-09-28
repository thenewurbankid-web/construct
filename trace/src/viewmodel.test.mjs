// Tests for the ViewModel (src/viewmodel.mjs): the persisted, editable superset of extractParts's page shape.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractParts } from "./import/extract-parts.mjs";
import { readSpec } from "./contract.mjs";
import {
  deriveViewModel,
  mergeViewModel,
  toExtractedShape,
  addManualValue,
  addManualList,
  addManualFormField,
  editEntry,
  removeEntry,
} from "./viewmodel.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const examples = path.join(root, "examples");

// ---------- round-trip identity on every shipped example ----------
test("round-trip identity: toExtractedShape(deriveViewModel(extractParts(src))) deep-equals extractParts(src) for every example", () => {
  const names = fs.readdirSync(examples).filter((d) => fs.existsSync(path.join(examples, d, "feature.json")));
  assert.equal(names.length, 12);
  for (const name of names) {
    const dir = path.join(examples, name);
    const spec = readSpec(dir);
    const source = fs.readFileSync(path.join(dir, spec.page), "utf8");
    const extracted = extractParts(source);
    assert.deepEqual(toExtractedShape(deriveViewModel(extracted)), extracted, name);
    // mergeViewModel(null, extracted) — no viewmodel.json exists yet — must behave the same way
    assert.deepEqual(toExtractedShape(mergeViewModel(null, extracted)), extracted, name);
  }
});

// ---------- synthetic pages to control markup precisely ----------
const page = (body) => `export default function P() {\n  return (\n${body}\n  );\n}\n`;
const withValue = () => page(`<div><span data-dyn="title">Hello</span></div>`);
const withTwoValues = () => page(`<div><span data-dyn="title">Hello</span><span data-dyn="count">3</span></div>`);
const noValues = () => page(`<div><span>static</span></div>`);

test("auto-refresh: a value with no manual edits is replaced wholesale when the page's example text changes", () => {
  const e1 = extractParts(withValue());
  const vm1 = mergeViewModel(null, e1);
  assert.deepEqual(vm1.values, [{ key: "value.title", origin: "auto", presentInPage: true, name: "title", example: "Hello" }]);

  const changed = page(`<div><span data-dyn="title">Goodbye</span></div>`);
  const e2 = extractParts(changed);
  const vm2 = mergeViewModel(vm1, e2);
  assert.equal(vm2.values[0].example, "Goodbye");
  assert.equal(vm2.values[0].origin, "auto");
});

test("manual pin survives re-extraction: a hand-edited value is not overwritten while the page still shows a different example", () => {
  const e1 = extractParts(withValue());
  let vm = mergeViewModel(null, e1);
  vm = editEntry(vm, "value.title", { example: "Hand-set text" });
  assert.equal(vm.values[0].origin, "manual");

  // the page's markup didn't change, so this key is still produced every run: manual -> linked (spec rule),
  // but the hand-set field is untouched — no partial refresh of just the example text
  const vm2 = mergeViewModel(vm, e1);
  assert.equal(vm2.values.find((v) => v.key === "value.title").example, "Hand-set text");
  assert.equal(vm2.values.find((v) => v.key === "value.title").origin, "linked");
});

test("manual entry not backed by any markup stays manual across merges (never flips to linked, never dropped)", () => {
  let vm = mergeViewModel(null, extractParts(noValues()));
  vm = addManualValue(vm, { name: "extra", example: "42" });
  assert.deepEqual(vm.values, [{ key: "value.extra", origin: "manual", presentInPage: false, name: "extra", example: "42" }]);

  const vm2 = mergeViewModel(vm, extractParts(noValues()));
  assert.deepEqual(vm2.values, vm.values);
});

test("manual -> linked: a manual value the page later also shows keeps the hand-set fields, tagged linked and present", () => {
  let vm = mergeViewModel(null, extractParts(noValues()));
  vm = addManualValue(vm, { name: "title", example: "Manually authored" });
  assert.equal(vm.values[0].origin, "manual");
  assert.equal(vm.values[0].presentInPage, false);

  const vm2 = mergeViewModel(vm, extractParts(withValue())); // the page now marks up data-dyn="title"
  const title = vm2.values.find((v) => v.key === "value.title");
  assert.equal(title.origin, "linked");
  assert.equal(title.presentInPage, true);
  assert.equal(title.example, "Manually authored", "the hand-set example is kept, not refreshed from the page");
});

test("linked -> manual fallback: when the markup disappears the entry is kept (not deleted), presentInPage false", () => {
  let vm = mergeViewModel(null, extractParts(withValue()));
  vm = editEntry(vm, "value.title", { example: "Edited" }); // -> manual
  vm = mergeViewModel(vm, extractParts(withValue())); // still on the page -> linked
  assert.equal(vm.values[0].origin, "linked");

  const vmGone = mergeViewModel(vm, extractParts(noValues())); // markup removed
  assert.equal(vmGone.values.length, 1, "the entry is kept, not deleted");
  assert.equal(vmGone.values[0].origin, "manual");
  assert.equal(vmGone.values[0].presentInPage, false);
  assert.equal(vmGone.values[0].example, "Edited");
});

test("tombstone: removeEntry suppresses a page-present field and merge never resurrects it", () => {
  let vm = mergeViewModel(null, extractParts(withTwoValues()));
  assert.equal(vm.values.length, 2);
  vm = removeEntry(vm, "value.count");
  assert.deepEqual(vm.values.map((v) => v.key), ["value.title"]);
  assert.deepEqual(vm.suppressed, ["value.count"]);

  // the page still marks up data-dyn="count" every run — merge must keep it suppressed
  for (let i = 0; i < 3; i++) vm = mergeViewModel(vm, extractParts(withTwoValues()));
  assert.deepEqual(vm.values.map((v) => v.key), ["value.title"]);
  assert.deepEqual(vm.suppressed, ["value.count"]);
  assert.deepEqual(toExtractedShape(vm).values, [{ name: "title", example: "Hello" }]);
});

test("addManualList / addManualFormField build well-formed manual entries with no page markup", () => {
  let vm = mergeViewModel(null, extractParts(noValues()));
  vm = addManualList(vm, { name: "rows", fields: ["a"], rows: [{ a: "1" }] });
  assert.deepEqual(vm.lists, [{ key: "list.rows", origin: "manual", presentInPage: false, name: "rows", fields: ["a"], rows: [{ a: "1" }], actions: [] }]);

  vm = addManualFormField(vm, "save", { name: "email", type: "email" });
  vm = addManualFormField(vm, "save", { name: "phone", type: "tel" });
  const form = vm.forms.find((f) => f.key === "form.save");
  assert.equal(form.origin, "manual");
  assert.deepEqual(form.fields, [{ name: "email", type: "email" }, { name: "phone", type: "tel" }]);
});

// ---------- works with no contract ----------
test("creating and editing a ViewModel on a no-contract example needs no contract at all", () => {
  const dir = path.join(examples, "products-no-contract");
  const spec = readSpec(dir);
  assert.equal(spec.contract.usable, false);
  const source = fs.readFileSync(path.join(dir, spec.page), "utf8");
  const extracted = extractParts(source);

  let vm = mergeViewModel(null, extracted);
  assert.ok(vm.values.length + vm.lists.length + vm.actions.length + vm.forms.length > 0);
  vm = addManualValue(vm, { name: "note", example: "hand authored, no API involved" });
  assert.equal(vm.values.find((v) => v.key === "value.note").origin, "manual");
  // round-tripping through the extracted shape still works with nothing contract-related touched
  assert.ok(toExtractedShape(vm).values.some((v) => v.name === "note"));
});
