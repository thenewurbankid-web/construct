import test from "node:test";
import assert from "node:assert/strict";
import { samplePrompt, checkSample, proposeSample } from "./sample.mjs";

test("samplePrompt names the endpoint, the field and its declared type, and includes real sibling values for context", () => {
  const p = samplePrompt({ endpoint: "GET /api/orders", where: "response", field: "weighted", type: "number", siblings: { id: 1, name: "Ana", meta: { nested: true } } });
  assert.match(p, /GET \/api\/orders/);
  assert.match(p, /"weighted"/);
  assert.match(p, /declared type: number/);
  assert.match(p, /id: 1/);
  assert.match(p, /name: "Ana"/);
  assert.doesNotMatch(p, /nested/, "an object-valued sibling is skipped, not dumped raw into the prompt");
});

test("checkSample accepts a scalar value and rejects an object, array or null", () => {
  assert.deepEqual(checkSample('{"value": "EMEA"}'), { ok: true, value: "EMEA" });
  assert.deepEqual(checkSample('{"value": 42}'), { ok: true, value: 42 });
  assert.deepEqual(checkSample('{"value": true}'), { ok: true, value: true });
  assert.equal(checkSample('{"value": {"a": 1}}').ok, false);
  assert.equal(checkSample('{"value": [1, 2]}').ok, false);
  assert.equal(checkSample('{"value": null}').ok, false);
  assert.equal(checkSample("not json at all").ok, false);
  assert.equal(checkSample('{"nope": 1}').ok, false);
});

test("checkSample enforces a declared type when one is given, but accepts any scalar when it isn't", () => {
  assert.equal(checkSample('{"value": "12"}', "number").ok, false, "a string is rejected when a number was declared");
  assert.equal(checkSample('{"value": 12}', "number").ok, true);
  assert.equal(checkSample('{"value": "12"}').ok, true, "no declared type (a response gap): any scalar is accepted");
});

test("proposeSample builds the prompt, calls the provider once, and returns the checked value", async () => {
  const calls = [];
  const providerFn = async (args) => { calls.push(args); return { text: '{"value": "APAC"}' }; };
  const r = await proposeSample({ endpoint: "GET /api/x", where: "response", field: "region" }, providerFn);
  assert.deepEqual(r, { ok: true, value: "APAC" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].user, /"region"/);
});

test("proposeSample turns a provider failure into a declined result, never a throw", async () => {
  const providerFn = async () => { throw new Error("ECONNREFUSED"); };
  const r = await proposeSample({ endpoint: "GET /api/x", where: "response", field: "region" }, providerFn);
  assert.equal(r.ok, false);
  assert.match(r.why, /ECONNREFUSED/);
});

test("proposeSample rejects a reply that violates the declared type", async () => {
  const providerFn = async () => ({ text: '{"value": "not-a-number"}' });
  const r = await proposeSample({ endpoint: "POST /api/x", where: "request", field: "price", type: "number" }, providerFn);
  assert.equal(r.ok, false);
  assert.match(r.why, /number/);
});
