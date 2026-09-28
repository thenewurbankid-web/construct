import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { allowedHost, checkRequest, readJsonBody, HttpError, isStateChanging, MAX_BODY } from "./http-guard.mjs";

const rq = (method, headers) => ({ method, headers });
const PORT = 4200;
const okJson = { host: "localhost:4200", "content-type": "application/json" };

test("Host must be localhost / 127.0.0.1 / [::1] with this server's port", () => {
  for (const h of ["localhost:4200", "127.0.0.1:4200", "[::1]:4200", "LOCALHOST:4200"]) assert.ok(allowedHost(h, PORT), h);
  for (const h of [undefined, "", "localhost", "localhost:4201", "evil.example:4200", "127.0.0.1.evil.example:4200", "localhost:4200.evil.example", "0.0.0.0:4200", "localhost:4200, evil.example", " localhost:4200"]) assert.equal(allowedHost(h, PORT), null, String(h));
});

test("reads need only the Host check; every other method needs Origin and JSON too", () => {
  assert.equal(checkRequest(rq("GET", { host: "localhost:4200" }), PORT), null);
  assert.equal(checkRequest(rq("GET", { host: "localhost:4200", origin: "https://evil.example" }), PORT), null); // a read: CORS keeps the answer from the page
  assert.equal(checkRequest(rq("GET", { host: "evil.example:4200" }), PORT).status, 403);
  assert.equal(checkRequest(rq("POST", okJson), PORT), null); // no Origin: a non-browser client
  assert.equal(checkRequest(rq("POST", { ...okJson, origin: "http://localhost:4200" }), PORT), null);
  assert.equal(checkRequest(rq("POST", { ...okJson, "content-type": "application/json; charset=utf-8" }), PORT), null);
  assert.equal(checkRequest(rq("POST", { ...okJson, origin: "https://evil.example" }), PORT).status, 403);
  assert.equal(checkRequest(rq("POST", { ...okJson, origin: "null" }), PORT).status, 403);
  assert.equal(checkRequest(rq("POST", { ...okJson, origin: "http://127.0.0.1:4200" }), PORT).status, 403); // must equal the Host it was sent to
  assert.equal(checkRequest(rq("POST", { ...okJson, origin: "https://localhost:4200" }), PORT).status, 403);
  for (const t of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "", undefined]) assert.equal(checkRequest(rq("POST", { host: "localhost:4200", "content-type": t }), PORT).status, 415, String(t));
  for (const m of ["PUT", "DELETE", "PATCH", "OPTIONS"]) assert.ok(isStateChanging(m) && checkRequest(rq(m, { host: "localhost:4200" }), PORT), m);
});

const stream = (chunks) => Readable.from(chunks.map((c) => Buffer.from(c)));
test("readJsonBody: parses objects, {} when empty, 400 for bad JSON or a non-object, 413 when too large", async () => {
  assert.deepEqual(await readJsonBody(stream(['{"a":', "1}"])), { a: 1 });
  assert.deepEqual(await readJsonBody(stream([])), {});
  for (const bad of ["{oops", "null", "[1]", '"s"', "12"]) await assert.rejects(readJsonBody(stream([bad])), (e) => e instanceof HttpError && e.status === 400, bad);
  await assert.rejects(readJsonBody(stream(["x".repeat(100), "y".repeat(100)]), { limit: 150 }), (e) => e instanceof HttpError && e.status === 413);
  assert.equal(MAX_BODY, 2 * 1024 * 1024);
});

test("readJsonBody: an aborted request rejects with 400 instead of hanging or throwing", async () => {
  const r = new Readable({ read() {} });
  const p = readJsonBody(r);
  r.push('{"a"');
  r.destroy(new Error("socket hang up"));
  await assert.rejects(p, (e) => e instanceof HttpError && e.status === 400);
});
