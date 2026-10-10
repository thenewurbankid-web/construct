import { test } from "node:test";
import assert from "node:assert/strict";
import { transformKindsFor, applyTransform, previewTransform, transformLabel } from "./adapter.mjs";

test("transformKindsFor: same type offers passthrough and map, nothing type-specific", () => {
  const kinds = transformKindsFor("string", "string").map((t) => t.id);
  assert.ok(kinds.includes("passthrough"));
  assert.ok(kinds.includes("map"));
  assert.ok(kinds.includes("substring"));
  assert.ok(kinds.includes("regex"));
  assert.ok(!kinds.includes("stringify")); // same type: nothing to convert
});

test("transformKindsFor: number -> string offers stringify and map, not substring/regex (source isn't text)", () => {
  const kinds = transformKindsFor("number", "string").map((t) => t.id);
  assert.deepEqual(kinds.sort(), ["map", "stringify"].sort());
});

test("transformKindsFor: number -> boolean offers only map (no direct conversion, no text ops)", () => {
  const kinds = transformKindsFor("number", "boolean").map((t) => t.id);
  assert.deepEqual(kinds, ["map"]);
});

test("transformKindsFor: unknown type gives nothing to pick from", () => {
  assert.deepEqual(transformKindsFor(null, "string"), []);
  assert.deepEqual(transformKindsFor("string", null), []);
});

test("applyTransform: passthrough returns the value unchanged", () => {
  assert.equal(applyTransform("passthrough", {}, "open"), "open");
});

test("applyTransform: stringify converts any value to text", () => {
  assert.equal(applyTransform("stringify", {}, 42), "42");
  assert.equal(applyTransform("stringify", {}, true), "true");
});

test("applyTransform: map looks a value up in a closed table", () => {
  const table = { 1: "open", 2: "closed" };
  assert.equal(applyTransform("map", { table }, 1), "open");
  assert.equal(applyTransform("map", { table }, 2), "closed");
});

test("applyTransform: map with no match and no default throws a plain error", () => {
  assert.throws(() => applyTransform("map", { table: { 1: "open" } }, 9), /no mapping/);
});

test("applyTransform: map falls back to an explicit default when given one", () => {
  assert.equal(applyTransform("map", { table: { 1: "open" }, default: "unknown" }, 9), "unknown");
});

test("applyTransform: substring slices text by start/end", () => {
  assert.equal(applyTransform("substring", { start: 0, end: 3 }, "ORD-201"), "ORD");
});

test("applyTransform: substring on a non-string value throws", () => {
  assert.throws(() => applyTransform("substring", {}, 42), /text value/);
});

test("applyTransform: regex replaces a matched pattern", () => {
  assert.equal(applyTransform("regex", { pattern: "^ORD-", replacement: "" }, "ORD-201"), "201");
});

test("applyTransform: regex with an invalid pattern throws a user-facing error, not a raw SyntaxError", () => {
  assert.throws(() => applyTransform("regex", { pattern: "(" }, "x"), /valid regular expression/);
});

test("applyTransform: regex with no pattern throws", () => {
  assert.throws(() => applyTransform("regex", {}, "x"), /pattern is required/);
});

test("applyTransform: unknown kind throws", () => {
  assert.throws(() => applyTransform("nope", {}, "x"), /unknown adapter mapping/);
});

test("previewTransform: wraps a valid transform as {ok: true, value}", () => {
  assert.deepEqual(previewTransform("stringify", {}, 7), { ok: true, value: "7" });
});

test("previewTransform: wraps a failing transform as {ok: false, error} instead of throwing", () => {
  const r = previewTransform("map", { table: {} }, "x");
  assert.equal(r.ok, false);
  assert.match(r.error, /no mapping/);
});

test("transformLabel: the same plain-language word the picker offers, by id; an unknown id falls back to itself", () => {
  assert.equal(transformLabel("map"), "Map specific values");
  assert.equal(transformLabel("stringify"), "Convert to text");
  assert.equal(transformLabel("nope"), "nope");
});
