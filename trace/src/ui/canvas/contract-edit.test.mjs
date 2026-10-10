import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEdited, patchExample } from "./contract-edit.mjs";

test("parseEdited accepts valid JSON", () => {
  assert.deepEqual(parseEdited('{"a": 1}'), { ok: true, value: { a: 1 } });
  assert.deepEqual(parseEdited("[1, 2, 3]"), { ok: true, value: [1, 2, 3] });
});

test("parseEdited refuses invalid JSON with a message", () => {
  const r = parseEdited("{not json");
  assert.equal(r.ok, false);
  assert.match(r.error, /Invalid JSON/);
});

const doc = () => ({
  paths: {
    "/api/orders": {
      get: { responses: { 200: { content: { "application/json": { example: [{ id: 1 }] } } } } },
      post: { requestBody: { content: { "application/json": { example: { id: 1 } } } }, responses: { 201: { content: { "application/json": { example: { id: 1 } } } } } },
    },
  },
});

test("patchExample replaces a GET response example", () => {
  const before = doc();
  const after = patchExample(before, { method: "GET", path: "/api/orders" }, "response", [{ id: 2 }]);
  assert.deepEqual(after.paths["/api/orders"].get.responses[200].content["application/json"].example, [{ id: 2 }]);
  // the input is not mutated
  assert.deepEqual(before.paths["/api/orders"].get.responses[200].content["application/json"].example, [{ id: 1 }]);
});

test("patchExample replaces a POST request example, method match is case-insensitive", () => {
  const after = patchExample(doc(), { method: "post", path: "/api/orders" }, "request", { id: 9 });
  assert.deepEqual(after.paths["/api/orders"].post.requestBody.content["application/json"].example, { id: 9 });
});

test("patchExample throws a user-facing error for an unknown endpoint", () => {
  assert.throws(() => patchExample(doc(), { method: "GET", path: "/api/nope" }, "response", {}), /Can't find GET \/api\/nope/);
});

test("patchExample throws when the request has no application/json body", () => {
  assert.throws(() => patchExample(doc(), { method: "GET", path: "/api/orders" }, "request", {}), /no application\/json body/);
});
