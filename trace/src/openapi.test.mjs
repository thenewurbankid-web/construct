// Parsing a Swagger/OpenAPI file into the `apis` the pipeline reads: versions, formats, $ref, cycles,
// the list envelope, and the no-guessing rule for missing examples.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readOpenApi, parseDocument } from "./openapi.mjs";
import { findEndpoints } from "./match.mjs";
import { isItemPath, isWired, pathParams } from "./endpoint-paths.mjs";
import { apisToOpenApi } from "./apis-to-openapi.mjs";

const find = (r, method, path) => r.apis.find((a) => a.method === method && a.path === path);

// ---------- OpenAPI 3.x ----------
const V3 = {
  openapi: "3.0.3",
  info: { title: "Products", version: "1" },
  paths: {
    "/api/products": {
      get: { responses: { 200: { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/ProductList" }, example: [{ id: 1, name: "Lamp" }, { id: 2, name: "Desk" }] } } } } },
      post: {
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/ProductInput" } } } },
        responses: { 201: { description: "created", content: { "application/json": { schema: { $ref: "#/components/schemas/Product" } } } } },
      },
    },
    "/api/products/{id}": {
      delete: { parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { 204: { description: "gone" } } },
      put: {
        requestBody: { content: { "application/json": { examples: { one: { value: { name: "Lamp", price: 10 } } } } } },
        responses: { 200: { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Product" } } } } },
      },
    },
  },
  components: {
    schemas: {
      Product: { type: "object", properties: { id: { type: "integer", example: 3 }, name: { type: "string", example: "Chair" }, kind: { type: "string", enum: ["furniture"] }, tier: { type: "string", enum: ["a", "b"] }, active: { type: "boolean", default: true } } },
      ProductInput: { type: "object", properties: { name: { type: "string", example: "Chair" }, price: { type: "number" }, id: { type: "integer", readOnly: true, example: 9 } } },
      ProductList: { type: "array", items: { $ref: "#/components/schemas/Product" } },
    },
  },
};

test("OpenAPI 3.x: paths become :id, examples come from media type, examples map and schema", () => {
  const r = readOpenApi(JSON.stringify(V3));
  assert.deepEqual(r.apis.map((a) => `${a.method} ${a.path}`), ["GET /api/products", "POST /api/products", "DELETE /api/products/:id", "PUT /api/products/:id"]);
  assert.deepEqual(find(r, "GET", "/api/products").response, [{ id: 1, name: "Lamp" }, { id: 2, name: "Desk" }]); // the media type example wins over the schema
  // schema examples: `example`, single-value `enum` and `default` are values; a two-value enum is NOT (no guessing); readOnly is left out of a request
  assert.deepEqual(find(r, "POST", "/api/products").response, { id: 3, name: "Chair", kind: "furniture", active: true });
  assert.deepEqual(find(r, "POST", "/api/products").request, { name: "Chair" });
  assert.deepEqual(find(r, "PUT", "/api/products/:id").request, { name: "Lamp", price: 10 }); // from `examples`
  assert.equal(find(r, "DELETE", "/api/products/:id").response, undefined);
  assert.equal(r.listKey, null);
});

// ---------- T12.1: sample-data provenance (real vs. assumed) ----------
test("responseAssumed/requestAssumed name exactly the values that came from `default`/`enum`, not from a given example", () => {
  const r = readOpenApi(JSON.stringify(V3));
  // kind (enum) and active (default) are assumed; id and name (both `example`) are not, and neither is entry.responseAssumed present for an endpoint with none
  assert.deepEqual(find(r, "POST", "/api/products").responseAssumed, ["kind", "active"]);
  assert.equal(find(r, "GET", "/api/products").responseAssumed, undefined, "an endpoint with nothing assumed carries no such field at all");
  assert.equal(find(r, "PUT", "/api/products/:id").requestAssumed, undefined);
});

test("responseAssumed on a bare-array response uses the same \"[].field\" convention as `missing`, for a nested assumed value", () => {
  const doc = {
    openapi: "3.0.0", info: { title: "t", version: "1" },
    paths: { "/api/rows": { get: { responses: { 200: { description: "ok", content: { "application/json": { schema: { type: "array", items: { type: "object", properties: { id: { type: "integer", example: 1 }, status: { type: "string", enum: ["open"] } } } } } } } } } } },
  };
  const r = readOpenApi(JSON.stringify(doc));
  const ep = find(r, "GET", "/api/rows");
  assert.deepEqual(ep.response, [{ id: 1, status: "open" }]);
  assert.deepEqual(ep.responseAssumed, ["[].status"]);
});

test("a schema-only request keeps the types of fields with no example (`declared`), and says so", () => {
  const r = readOpenApi(JSON.stringify(V3));
  assert.deepEqual(find(r, "POST", "/api/products").declared, { price: "number" });
  assert.ok(r.gaps.some((g) => g.kind === "field-no-example" && g.endpoint === "POST /api/products" && g.path === "price"));
});

test("OpenAPI 3.x in YAML", () => {
  const yaml = `
openapi: 3.0.1
info: { title: T, version: "1" }
paths:
  /api/items:
    get:
      responses:
        "200":
          description: ok
          content:
            application/json:
              example:
                - { id: 1, label: One }
`;
  const r = readOpenApi(yaml);
  assert.equal(r.format, "yaml");
  assert.deepEqual(r.apis, [{ method: "GET", path: "/api/items", response: [{ id: 1, label: "One" }] }]);
});

// ---------- Swagger 2.0 ----------
const V2 = {
  swagger: "2.0",
  info: { title: "Orders", version: "1" },
  basePath: "/api",
  paths: {
    "/orders": {
      get: { responses: { 200: { description: "ok", schema: { type: "object", properties: { total: { type: "integer", example: 7 }, orders: { type: "array", items: { $ref: "#/definitions/Order" } } } } } } },
      post: { parameters: [{ in: "body", name: "body", schema: { $ref: "#/definitions/Order" } }], responses: { 201: { description: "ok", schema: { $ref: "#/definitions/Order" }, examples: { "application/json": { id: 5, customer: "Ana" } } } } },
    },
    "/orders/{orderId}": { delete: { responses: { 204: { description: "gone" } } } },
  },
  definitions: { Order: { type: "object", properties: { id: { type: "integer", example: 1 }, customer: { type: "string", example: "Ben" } } } },
};

test("Swagger 2.0: basePath is part of the path, body parameter, definitions, response examples", () => {
  const r = readOpenApi(JSON.stringify(V2));
  assert.deepEqual(r.apis.map((a) => `${a.method} ${a.path}`), ["GET /api/orders", "POST /api/orders", "DELETE /api/orders/:orderId"]);
  assert.deepEqual(find(r, "POST", "/api/orders").request, { id: 1, customer: "Ben" });
  assert.deepEqual(find(r, "POST", "/api/orders").response, { id: 5, customer: "Ana" }); // a response `examples` entry beats the schema
  assert.deepEqual(find(r, "GET", "/api/orders").response, { total: 7, orders: [{ id: 1, customer: "Ben" }] });
});

test("Swagger 2.0 in YAML (`swagger: 2.0` is read as a number by YAML)", () => {
  const r = readOpenApi(`
swagger: 2.0
info: { title: T, version: "1" }
paths:
  /things:
    get:
      responses:
        200:
          description: ok
          schema:
            type: array
            items: { type: object, properties: { id: { type: integer, example: 4 } } }
`);
  assert.equal(r.kind, "swagger2");
  assert.deepEqual(r.apis, [{ method: "GET", path: "/things", response: [{ id: 4 }] }]);
});

// ---------- $ref ----------
test("$ref: chains, JSON-pointer escapes, and a ref that is not in the file is reported, not followed", () => {
  const doc = {
    openapi: "3.0.0", info: {}, paths: {
      "/a": { get: { responses: { 200: { $ref: "#/components/responses/R" } } } },
      "/b": { get: { responses: { 200: { description: "x", content: { "application/json": { schema: { $ref: "https://example.com/x.json#/S" } } } } } } },
    },
    components: {
      responses: { R: { description: "r", content: { "application/json": { schema: { $ref: "#/components/schemas/A~1B" } } } } },
      schemas: { "A/B": { $ref: "#/components/schemas/Real" }, Real: { type: "object", properties: { v: { type: "string", example: "ok" } } } },
    },
  };
  const r = readOpenApi(JSON.stringify(doc));
  assert.deepEqual(find(r, "GET", "/a").response, { v: "ok" });
  assert.equal(find(r, "GET", "/b").response, undefined);
  assert.ok(r.gaps.some((g) => g.kind === "ref" && g.text.includes("https://example.com/x.json#/S")));
});

test("cycles in $ref terminate (a tree node that contains nodes)", () => {
  const doc = {
    openapi: "3.0.0", info: {}, paths: { "/tree": { get: { responses: { 200: { description: "x", content: { "application/json": { schema: { $ref: "#/components/schemas/Node" } } } } } } } },
    components: { schemas: { Node: { type: "object", properties: { name: { type: "string", example: "root" }, children: { type: "array", items: { $ref: "#/components/schemas/Node" } }, parent: { $ref: "#/components/schemas/Node" } } } } },
  };
  const r = readOpenApi(JSON.stringify(doc));
  assert.deepEqual(find(r, "GET", "/tree").response, { name: "root" }); // the recursive properties have no example: left out, not looped
  const loop = { openapi: "3.0.0", info: {}, paths: { "/x": { get: { responses: { 200: { description: "x", content: { "application/json": { schema: { $ref: "#/components/schemas/A" } } } } } } } }, components: { schemas: { A: { $ref: "#/components/schemas/B" }, B: { $ref: "#/components/schemas/A" } } } };
  assert.doesNotThrow(() => readOpenApi(JSON.stringify(loop)));
});

// ---------- the list envelope ----------
const withResponse = (response) => JSON.stringify({ openapi: "3.0.0", info: {}, paths: { "/api/things": { get: { responses: { 200: { description: "ok", content: { "application/json": response } } } } } } });

test("envelope: a GET object with exactly one array property is the list; its key is the list key", () => {
  const r = readOpenApi(withResponse({ example: { summary: { total: 2 }, categories: [{ id: 1 }, { id: 2 }] } }));
  assert.equal(r.listKey, "categories");
  assert.deepEqual(find(r, "GET", "/api/things").response.categories, [{ id: 1 }, { id: 2 }]);
});

test("envelope: two array properties are ambiguous (no guess) unless a listKey is given", () => {
  const body = { example: { a: [{ id: 1 }], b: [{ id: 2 }] } };
  assert.equal(readOpenApi(withResponse(body)).listKey, null);
  assert.equal(readOpenApi(withResponse(body), { listKey: "b" }).listKey, "b");
});

test("envelope: found from the schema when there is no example", () => {
  const r = readOpenApi(withResponse({ schema: { type: "object", properties: { total: { type: "integer" }, rows: { type: "array", items: { type: "object", properties: { id: { type: "integer" } } } } } } }));
  assert.equal(r.listKey, "rows");
});

// ---------- missing examples: never invented ----------
test("no example at all: a list endpoint gets an EMPTY list and is flagged; nothing is made up", () => {
  const r = readOpenApi(withResponse({ schema: { type: "array", items: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" } } } } }));
  const a = find(r, "GET", "/api/things");
  assert.deepEqual(a.response, []);
  assert.equal(a.noExample, true);
  assert.deepEqual(r.gaps.map((g) => g.kind), ["no-example"]);
  assert.match(r.gaps[0].text, /the contract has no example/);
  assert.equal(r.endpoints[0].response, "no-example");
});

test("no example: an envelope list starts as { key: [] } and a non-list response is left without a body", () => {
  const env = readOpenApi(withResponse({ schema: { type: "object", properties: { rows: { type: "array", items: { type: "object" } } } } }));
  assert.deepEqual(find(env, "GET", "/api/things").response, { rows: [] });
  const one = readOpenApi(JSON.stringify({ openapi: "3.0.0", info: {}, paths: { "/api/things/{id}": { get: { responses: { 200: { description: "ok", content: { "application/json": { schema: { type: "object", properties: { id: { type: "integer" } } } } } } } } } } }));
  assert.equal(find(one, "GET", "/api/things/:id").response, undefined);
  assert.equal(one.gaps.length, 1);
});

test("partly missing examples: only documented values appear, the rest are named as gaps", () => {
  const r = readOpenApi(withResponse({ schema: { type: "array", items: { type: "object", properties: { id: { type: "integer", example: 1 }, name: { type: "string" }, zip: { type: "string" } } } } }));
  assert.deepEqual(find(r, "GET", "/api/things").response, [{ id: 1 }]);
  assert.deepEqual(r.gaps.filter((g) => g.kind === "field-no-example").map((g) => g.path), ["[].name", "[].zip"]);
});

test("nothing that could match by chance is ever produced (no null, 0, empty string, false)", () => {
  const r = readOpenApi(withResponse({ schema: { type: "object", properties: { rows: { type: "array", items: { type: "object", properties: { n: { type: "integer" }, s: { type: "string" }, b: { type: "boolean" } } } } } } }));
  assert.equal(JSON.stringify(find(r, "GET", "/api/things").response), '{"rows":[]}');
});

// ---------- paths with several parameters, or one that is not last ----------
// They are imported as endpoints (`{x}` -> `:x` everywhere) and are not gaps: nothing is missing from the contract. `wired: false`
// says the generator will not call them (it fills one trailing `:param`), so they are never the list, create, update or remove endpoint.
const NESTED = JSON.parse(fs.readFileSync(new URL("./fixtures/nested-paths.openapi.json", import.meta.url), "utf8"));

test("more than one path parameter, or one that is not last, is imported as an endpoint, not reported as a gap", () => {
  const r = readOpenApi(JSON.stringify({ openapi: "3.0.0", info: {}, paths: {
    "/a/{x}/b/{y}": { get: { responses: { 200: { description: "ok" } } } },
    "/c/{x}/d": { get: { responses: { 200: { description: "ok" } } } },
    "/ok": { get: { responses: { 200: { description: "ok" } } } },
    "/e/{x}": { delete: { responses: { 204: { description: "ok" } } } },
  } }));
  assert.deepEqual(r.apis.map((a) => a.path), ["/a/:x/b/:y", "/c/:x/d", "/ok", "/e/:x"]);
  assert.deepEqual(r.gaps.filter((g) => g.kind === "unsupported"), [], "no endpoint is dropped, so nothing is reported as not imported");
  assert.deepEqual(r.endpoints.map((e) => [e.path, e.wired]), [["/a/:x/b/:y", false], ["/c/:x/d", false], ["/ok", undefined], ["/e/:x", undefined]]);
});

test("nested fixture: every path parameter becomes :name, the parameter need not be last, and the wired endpoints are still found", () => {
  const r = readOpenApi(JSON.stringify(NESTED));
  assert.deepEqual(r.apis.map((a) => `${a.method} ${a.path}`), [
    "GET /api/customers", "PUT /api/customers/:id", "DELETE /api/customers/:id",
    "GET /api/customers/:id/orders", "POST /api/customers/:id/orders",
    "GET /api/customers/:id/orders/:orderId", "PUT /api/customers/:id/orders/:orderId", "DELETE /api/customers/:id/orders/:orderId",
    "GET /api/regions/:region/stores/:store/stock",
  ]);
  assert.deepEqual(r.endpoints.filter((e) => e.wired === false).map((e) => e.label), [
    "GET /api/customers/:id/orders", "POST /api/customers/:id/orders",
    "GET /api/customers/:id/orders/:orderId", "PUT /api/customers/:id/orders/:orderId", "DELETE /api/customers/:id/orders/:orderId",
    "GET /api/regions/:region/stores/:store/stock",
  ]);
  assert.deepEqual(r.gaps, []);
  // the list is the customers list, not the nested `/customers/:id/orders` one that comes later (and would also return an array)
  assert.equal(r.listKey, null);
  const e = findEndpoints(r.apis, r.listKey);
  assert.equal(e.list.path, "/api/customers");
  assert.equal(e.create, undefined, "POST /api/customers/:id/orders has a parameter, so it is not the create endpoint");
  assert.equal(e.update.path, "/api/customers/:id");
  assert.equal(e.remove.path, "/api/customers/:id");
});

test("item versus list: the last segment decides, and only endpoints the generator can call are picked", () => {
  assert.equal(isItemPath("/x/:id"), true);
  assert.equal(isItemPath("/a/:id/b/:sub"), true, "ends in a parameter");
  assert.equal(isItemPath("/a/:id/b"), false);
  assert.equal(isItemPath("/a/:id.json"), false);
  assert.deepEqual(pathParams("/a/:id/b/:sub"), ["id", "sub"]);
  assert.deepEqual(pathParams("/plain"), []);
  assert.deepEqual([["/x", true], ["/x/:id", true], ["/a/:id/b", false], ["/a/:id/b/:sub", false], ["/a/:id.json", false]].map(([p]) => isWired(p)), [true, true, false, false, false]);
  // a nested endpoint listed FIRST is never picked over the plain one
  const apis = [
    { method: "GET", path: "/a/:id/b", response: [{ x: 1 }] },
    { method: "PUT", path: "/a/:id/b/:sub", request: { x: 1 } },
    { method: "DELETE", path: "/a/:id/b/:sub" },
    { method: "GET", path: "/a", response: [{ y: 2 }] },
    { method: "PUT", path: "/a/:id", request: { y: 2 } },
  ];
  const e = findEndpoints(apis, null);
  assert.equal(e.list.path, "/a");
  assert.equal(e.update.path, "/a/:id");
  assert.equal(e.remove, undefined, "DELETE /a/:id/b/:sub is not callable by the generator");
  // ... and with only nested endpoints there is simply no list (no code is generated for them)
  assert.equal(findEndpoints(apis.slice(0, 3), null).list, undefined);
});

test("a file whose only endpoints are nested ones is not a usable contract (nothing could be generated), a mixed one is", () => {
  const only = { openapi: "3.0.0", info: {}, paths: { "/a/{x}/b/{y}": { get: { responses: { 200: { description: "ok" } } } } } };
  assert.equal(readOpenApi(JSON.stringify(only)).apis.length, 1, "it is read, and listed");
  assert.equal(readOpenApi(JSON.stringify(only)).endpoints[0].wired, false);
});

// ---------- bad files ----------
test("bad files are rejected with a reason", () => {
  assert.throws(() => parseDocument(""), /empty/);
  assert.throws(() => parseDocument("{ not json"), /not valid JSON/);
  assert.throws(() => parseDocument("key: [unclosed"), /not valid YAML/);
  assert.throws(() => parseDocument("just some text"), /top level is not an object/);
  assert.throws(() => parseDocument(JSON.stringify({ hello: "world" })), /not OpenAPI 3\.x or Swagger 2\.0/);
  assert.throws(() => parseDocument(JSON.stringify({ openapi: "4.0.0", paths: {} })), /not OpenAPI 3\.x or Swagger 2\.0/);
  assert.throws(() => parseDocument(JSON.stringify({ openapi: "3.0.0" })), /no "paths"/);
  assert.throws(() => parseDocument("x".repeat(3 * 1024 * 1024)), /larger than/);
});

// ---------- the old hand-written contract, as OpenAPI ----------
test("apis -> OpenAPI -> apis gives the same apis (the migration loses nothing)", () => {
  const apis = [
    { method: "GET", path: "/api/x", response: { meta: { day: "2026-07-31" }, rows: [{ id: 1, name: "a", tags: ["t"], parent: null }, { id: 2, name: "b", score: 1.5 }] } },
    { method: "POST", path: "/api/x", request: { name: "c" }, response: { id: 3, name: "c" } },
    { method: "PUT", path: "/api/x/:id", request: { name: "d" }, response: { id: 1, name: "d" } },
    { method: "DELETE", path: "/api/x/:id" },
  ];
  const doc = apisToOpenApi(apis, { title: "x" });
  assert.equal(doc.openapi, "3.0.3");
  assert.ok(doc.paths["/api/x/{id}"].put.parameters.some((p) => p.name === "id" && p.in === "path"));
  const back = readOpenApi(JSON.stringify(doc));
  assert.deepEqual(back.apis, apis);
  assert.equal(back.listKey, "rows");
  assert.deepEqual(back.gaps, []);
  assert.deepEqual(readOpenApi(JSON.stringify(apisToOpenApi(apis, { title: "x" }))).apis, back.apis); // deterministic
});
