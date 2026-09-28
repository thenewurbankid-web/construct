// Pure-render tests for T12.2 (endpoint selection with Product confirm). Only data-in/HTML-out functions are
// tested here (no DOM), the same convention as import-wizard.test.mjs; install* is DOM/fetch glue.
import test from "node:test";
import assert from "node:assert/strict";
import { listCandidates, endpointConfirmHtml, parseCandidateValue } from "./endpoint-select.mjs";

test("endpoint-select re-exports T13's listCandidates/parseCandidateValue unchanged (adopted, not reimplemented)", () => {
  const apis = [{ method: "GET", path: "/api/orders", response: { orders: [] } }];
  const c = listCandidates(apis, "orders");
  assert.deepEqual(c.map((x) => [x.method, x.path, x.key]), [["GET", "/api/orders", "orders"]]);
  assert.deepEqual(parseCandidateValue(c[0].value), { method: "GET", path: "/api/orders", key: "orders" });
});

test("endpointConfirmHtml names the endpoint and its key, and offers Product confirm plus a way back", () => {
  const html = endpointConfirmHtml({ method: "GET", path: "/api/invoices", key: "invoices", value: "GET /api/invoices::invoices" });
  assert.match(html, /GET \/api\/invoices/);
  assert.match(html, /key <code>invoices<\/code>/);
  assert.match(html, /data-esconfirm/);
  assert.match(html, /Product confirm/);
  assert.match(html, /data-eschange/);
});

test("endpointConfirmHtml labels a bare-array candidate (no key) plainly", () => {
  const html = endpointConfirmHtml({ method: "GET", path: "/api/orders", key: null, value: "GET /api/orders::" });
  assert.match(html, /\(bare array\)/);
  assert.doesNotMatch(html, /key <code>/);
});
