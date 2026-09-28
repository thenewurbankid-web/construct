// Reads a Swagger 2.0 / OpenAPI 3.x file (JSON or YAML) into the `apis` shape the pipeline consumes:
//   [{ method, path: "/api/x/:id", request?, response? }]   (bodies are EXAMPLES, never invented)
// Deterministic, no model. The no-guessing rule applies to example values:
//   a value is taken from, in order, `example`, `examples`, `default`, a single-value `enum`.
//   Nothing else is ever put in a body. A response or field with no example is recorded as a gap
//   (returned in `gaps`, shown in the run as an open item) and simply left out of the example.
// To still generate the code SHAPE without fake values:
//   - a list endpoint with no example gets an EMPTY list (`[]`, or `{ key: [] }`) and `noExample: true`,
//     so the service, workflow and mock are generated but nothing is matched against made-up rows;
//   - a request whose schema declares fields without examples gets `declared: { field: type }`, so form
//     inputs are typed from the schema and are not reported as "not in the API".
import YAML from "yaml";
import { isItemPath, isWired } from "./endpoint-paths.mjs";

export const MAX_BYTES = 2 * 1024 * 1024;
const VERBS = ["get", "post", "put", "patch", "delete"];
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : structuredClone(v));
const firstLine = (s) => String(s).split("\n")[0].trim();

// ---------- text -> document ----------
// Throws an Error whose message says what is wrong with the file, in words fit to show the user.
/**
 * Parse a contract file's text (JSON or YAML) into a document and identify its kind.
 *
 * @param {string} text The file's text.
 * @returns {{doc: object, format: "json"|"yaml", kind: "openapi3"|"swagger2", version: string, title: string}}
 *   The parsed document, its format, whether it is OpenAPI 3.x or Swagger 2.0, its version string, and its
 *   `info.title` (or `""`).
 * @throws {Error} With a message fit to show the user: empty, too large (over {@link MAX_BYTES}), invalid
 *   JSON/YAML, not an object, not OpenAPI 3.x/Swagger 2.0, or no `paths`.
 */
export function parseDocument(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("the file is empty");
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(`the file is larger than ${MAX_BYTES / 1024 / 1024} MB`);
  const t = text.replace(/^﻿/, "");
  let doc, format;
  if (/^\s*[{[]/.test(t)) {
    format = "json";
    try { doc = JSON.parse(t); } catch (e) { throw new Error(`it is not valid JSON (${firstLine(e.message)})`); }
  } else {
    format = "yaml";
    try { doc = YAML.parse(t, { maxAliasCount: 50 }); } catch (e) { throw new Error(`it is not valid YAML (${firstLine(e.message)})`); }
  }
  if (!isObj(doc)) throw new Error("it is not an OpenAPI or Swagger document (the top level is not an object)");
  // YAML reads `swagger: 2.0` as the number 2 and `openapi: 3.0` as 3, so compare loosely
  const kind = /^3(\.\d+)*$/.test(String(doc.openapi ?? "")) ? "openapi3" : Number(doc.swagger) === 2 ? "swagger2" : null;
  if (!kind) throw new Error('it is not OpenAPI 3.x or Swagger 2.0 (there is no "openapi: 3.x" or "swagger: 2.0" field)');
  if (!isObj(doc.paths)) throw new Error('it has no "paths", so there are no endpoints');
  return { doc, format, kind, version: String(doc.openapi ?? doc.swagger), title: isObj(doc.info) ? String(doc.info.title ?? "") : "" };
}

// ---------- $ref (local only) ----------
function pointer(doc, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#")) return undefined;
  let node = doc;
  for (const raw of ref.slice(1).split("/").filter((_, i) => i > 0)) {
    let key = raw;
    try { key = decodeURIComponent(raw); } catch { /* keep the raw text */ }
    key = key.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObj(node) && !Array.isArray(node)) return undefined;
    node = node[key];
    if (node === undefined) return undefined;
  }
  return node;
}

// Follows a chain of $refs. `stack` holds the refs being expanded above this node: meeting one again is a
// cycle, and the caller gets null (no example from there) instead of looping.
function resolve(ctx, node, stack = []) {
  const refs = [];
  let n = node;
  while (isObj(n) && typeof n.$ref === "string") {
    const ref = n.$ref;
    if (stack.includes(ref) || refs.includes(ref)) return null;
    refs.push(ref);
    const target = pointer(ctx.doc, ref);
    if (target === undefined) { ctx.unresolved.add(ref); return null; }
    n = target;
  }
  return { node: isObj(n) ? n : {}, stack: refs.length ? [...stack, ...refs] : stack };
}

// ---------- schema -> example ----------
// An object/array schema's own properties are merged with its allOf members.
function collect(ctx, s, stack) {
  const out = { properties: {}, items: s.items, type: s.type };
  for (const member of Array.isArray(s.allOf) ? s.allOf : []) {
    const r = resolve(ctx, member, stack);
    if (!r) continue;
    const c = collect(ctx, r.node, r.stack);
    Object.assign(out.properties, c.properties);
    out.items ??= c.items;
    out.type ??= c.type;
  }
  Object.assign(out.properties, isObj(s.properties) ? s.properties : {});
  return out;
}

/**
 * The JSON type a schema (after resolving `$ref`s and merging `allOf`) describes.
 *
 * @param {{doc: object, unresolved: Set<string>}} ctx Parse context (the document, and unresolved `$ref`s found
 *   so far).
 * @param {object} schema A schema (or `$ref` to one).
 * @param {string[]} [stack] `$ref`s already being expanded above this node, to detect cycles.
 * @returns {"object"|"array"|"string"|"number"|"boolean"|undefined} The type (`"integer"` is folded into
 *   `"number"`), or `undefined` when it cannot be determined or the ref is a cycle.
 */
export function typeOf(ctx, schema, stack = []) {
  const r = resolve(ctx, schema, stack);
  if (!r) return undefined;
  const c = collect(ctx, r.node, r.stack);
  let t = Array.isArray(c.type) ? c.type.find((x) => x !== "null") : c.type;
  if (!t) t = Object.keys(c.properties).length ? "object" : c.items ? "array" : undefined;
  return t === "integer" ? "number" : t;
}

// -> { has, value, missing: [paths of declared-but-example-less properties], assumed: [paths whose value came
//   from `default`/`enum` rather than an actual `example`/`examples` — T12.1's provenance label] }
// "" inside `assumed` (only ever produced by `got`) means "this node itself", translated to the parent's own
// key (or "[]" for an array item) one level up — the same trick `missing` plays with a leading "[".
function exampleOf(ctx, schema, mode, stack = []) {
  const none = { has: false, missing: [], assumed: [] };
  const r = resolve(ctx, schema, stack);
  if (!r) return none;
  const s = r.node;
  const got = (value, assumed = []) => ({ has: true, value: clone(value), missing: [], assumed });
  if ("example" in s) return got(s.example);
  if (Array.isArray(s.examples) && s.examples.length) return got(s.examples[0]);
  if ("default" in s) return got(s.default, [""]); // an assumption, not a real sample (T12.1: labelled "assumed")
  if (Array.isArray(s.enum) && s.enum.length === 1) return got(s.enum[0], [""]); // same: the only option, not a given sample

  const c = collect(ctx, s, r.stack);
  const props = Object.entries(c.properties);
  if (props.length) {
    const value = {}, missing = [], assumed = [];
    let any = false;
    for (const [k, ps] of props) {
      const rp = resolve(ctx, ps, r.stack);
      if (rp && ((mode === "request" && rp.node.readOnly === true) || (mode === "response" && rp.node.writeOnly === true))) continue;
      const e = exampleOf(ctx, ps, mode, r.stack);
      if (!e.has) { missing.push(k); continue; }
      value[k] = e.value;
      any = true;
      for (const m of e.missing) missing.push(m.startsWith("[") ? k + m : `${k}.${m}`);
      for (const a of e.assumed) assumed.push(a === "" ? k : a.startsWith("[") ? k + a : `${k}.${a}`);
    }
    // no property has an example: the whole body has none (one gap, not one per property)
    return any ? { has: true, value, missing, assumed } : none;
  }
  if (c.items) {
    const e = exampleOf(ctx, c.items, mode, r.stack);
    if (e.has) return { has: true, value: [e.value], missing: e.missing.map((m) => (m.startsWith("[") ? "[]" + m : `[].${m}`)), assumed: e.assumed.map((a) => (a === "" ? "[]" : a.startsWith("[") ? "[]" + a : `[].${a}`)) };
  }
  return none;
}

// ---------- bodies ----------
const jsonKey = (map) => {
  const keys = Object.keys(isObj(map) ? map : {});
  return keys.find((k) => /^application\/json\b/i.test(k)) ?? keys.find((k) => /json/i.test(k)) ?? keys.find((k) => k === "*/*");
};

// An OpenAPI 3 media type object, or a Swagger 2 body ({ schema, example }).
// -> { has, value, missing, assumed, hasSchema, schema }
function bodyOf(ctx, media, mode) {
  const schema = media.schema;
  const hasSchema = isObj(schema) && Object.keys(schema).length > 0;
  const base = { hasSchema, schema, missing: [], assumed: [] };
  // a body-level (not per-field) example/examples entry is always real: T12.1 only tags values exampleOf()
  // itself fell back to `default`/`enum` for, never a value the contract gave directly.
  if ("example" in media) return { ...base, has: true, value: clone(media.example) };
  if (isObj(media.examples)) {
    const first = Object.values(media.examples)[0];
    const r = resolve(ctx, first);
    if (r && "value" in r.node) return { ...base, has: true, value: clone(r.node.value) };
  }
  if (hasSchema) {
    const e = exampleOf(ctx, schema, mode);
    if (e.has) return { ...base, has: true, value: e.value, missing: e.missing, assumed: e.assumed };
  }
  return { ...base, has: false };
}

function requestBody(ctx, op, pathItem, kind) {
  if (kind === "openapi3") {
    const rb = op.requestBody && resolve(ctx, op.requestBody);
    const key = rb && jsonKey(rb.node.content);
    return key ? bodyOf(ctx, rb.node.content[key], "request") : null;
  }
  const params = [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])];
  for (const p of params) {
    const r = resolve(ctx, p);
    if (r?.node.in !== "body") continue;
    const media = { schema: r.node.schema };
    if ("x-example" in r.node) media.example = r.node["x-example"];
    return bodyOf(ctx, media, "request");
  }
  return null;
}

function responseBody(ctx, op, kind) {
  const codes = Object.keys(isObj(op.responses) ? op.responses : {}).filter((c) => /^2(\d\d|XX)$/i.test(c)).sort();
  for (const code of codes) {
    const r = resolve(ctx, op.responses[code]);
    if (!r) continue;
    if (kind === "openapi3") {
      const key = jsonKey(r.node.content);
      if (key) { const b = bodyOf(ctx, r.node.content[key], "response"); if (b.has || b.hasSchema) return b; }
    } else {
      const media = { schema: r.node.schema };
      const ex = jsonKey(r.node.examples);
      if (ex) media.example = r.node.examples[ex];
      const b = bodyOf(ctx, media, "response");
      if (b.has || b.hasSchema) return b;
    }
  }
  return null;
}

// ---------- the list endpoint ----------
// A bare array, or an object with exactly one array property (an envelope); listKey forces which key.
function listShape(ctx, body, force) {
  if (!body) return null;
  if (body.has) {
    const v = body.value;
    if (Array.isArray(v)) return force ? null : { key: null };
    if (!isObj(v)) return null;
    const arrays = Object.keys(v).filter((k) => Array.isArray(v[k]));
    if (force) return arrays.includes(force) ? { key: force } : null;
    return arrays.length === 1 ? { key: arrays[0] } : null;
  }
  if (!body.hasSchema) return null;
  const r = resolve(ctx, body.schema);
  if (!r) return null;
  const c = collect(ctx, r.node, r.stack);
  if (typeOf(ctx, r.node, []) === "array") return force ? null : { key: null };
  const arrays = Object.entries(c.properties).filter(([, ps]) => typeOf(ctx, ps, r.stack) === "array").map(([k]) => k);
  if (force) return arrays.includes(force) ? { key: force } : null;
  return arrays.length === 1 ? { key: arrays[0] } : null;
}

// ---------- paths ----------
const basePathOf = (doc, kind) => {
  let base = "";
  if (kind === "swagger2") base = typeof doc.basePath === "string" ? doc.basePath : "";
  else {
    const url = Array.isArray(doc.servers) && typeof doc.servers[0]?.url === "string" ? doc.servers[0].url : "";
    if (url && !url.includes("{")) { try { base = new URL(url, "http://x").pathname; } catch { /* no usable server path */ } }
  }
  return base === "/" ? "" : base.replace(/\/+$/, "");
};
// "{orderId}" -> ":orderId". The generator only understands letters and underscores in a parameter name.
const toColon = (p) => p.replace(/\{([^}]+)\}/g, (_, n) => ":" + (n.replace(/[^A-Za-z_]+/g, "_").replace(/^_+|_+$/g, "") || "id"));

// -> { apis, listKey, gaps: [{ kind, endpoint, where, path?, text }], endpoints: [{ method, path, label, request, response }] }
/**
 * Turn a parsed OpenAPI/Swagger document into the `apis` shape the pipeline consumes. Deterministic, no model: a
 * body value is only ever taken from (in order) `example`, `examples`, `default`, or a single-value `enum`;
 * anything else missing is recorded as a gap rather than invented. A list endpoint with no example still gets an
 * empty-shaped body (`[]` or `{key: []}`) and `noExample: true`, so the generated code shape does not depend on
 * having real data.
 *
 * @param {{doc: object, kind: "openapi3"|"swagger2"}} parsed From {@link parseDocument}.
 * @param {{listKey?: string|null}} [options] `listKey`: force which response property is the list (an envelope
 *   override); by default the first GET on a collection path that returns a list is used (bare array, or an
 *   object with exactly one array property).
 * @returns {{apis: object[], listKey: string|null, gaps: {kind: string, endpoint: string, where: string,
 *   path?: string, text: string}[], endpoints: object[]}}
 *   `apis` for the pipeline; `gaps` for open items shown in the run; `endpoints` (every method+path found, each
 *   noting whether it has an example, and `wired: false` when the generator cannot call it).
 */
export function toApis(parsed, { listKey: force = null } = {}) {
  const { doc, kind } = parsed;
  const ctx = { doc, unresolved: new Set() };
  const base = basePathOf(doc, kind);
  const gaps = [], endpoints = [], entries = [];
  const gap = (g) => gaps.push(g);

  for (const [rawPath, item] of Object.entries(doc.paths)) {
    if (!isObj(item)) continue;
    const path = toColon(base + rawPath);
    for (const verb of Object.keys(item).filter((k) => VERBS.includes(k.toLowerCase()))) {
      const op = item[verb];
      const method = verb.toUpperCase();
      const label = `${method} ${path}`;
      if (!isObj(op)) continue;
      const req = requestBody(ctx, op, item, kind);
      const res = responseBody(ctx, op, kind);
      const entry = { method, path };
      if (req?.has) entry.request = req.value;
      if (res?.has) entry.response = res.value;
      // T12.1: which of the values just set above are "assumed" (from the schema's `default`/single-value
      // `enum`, never a real given sample) rather than "real" (from `example`/`examples`). Left off the entry
      // entirely when empty, so a contract that never uses `default`/`enum` produces byte-identical `apis` to
      // before this existed (every shipped example: none currently do).
      if (req?.assumed?.length) entry.requestAssumed = req.assumed;
      if (res?.assumed?.length) entry.responseAssumed = res.assumed;
      // Schema-declared request fields with no example: their types still type the form.
      if (req?.hasSchema && (!req.has || isObj(req.value))) {
        const declared = {};
        const c = (() => { const r = resolve(ctx, req.schema); return r && collect(ctx, r.node, r.stack); })();
        for (const [k, ps] of Object.entries(c?.properties ?? {})) {
          if (req.has && k in req.value) continue;
          const rp = resolve(ctx, ps);
          if (rp?.node.readOnly === true) continue;
          declared[k] = typeOf(ctx, ps) ?? "string";
        }
        if (Object.keys(declared).length) entry.declared = declared;
      }
      const status = (b) => (!b ? "none" : b.has ? "example" : b.hasSchema ? "no-example" : "none");
      // an endpoint with two path parameters, or one that is not last, is an endpoint like any other; `wired: false` says the
      // generator will not call it (see endpoint-paths.mjs). It is not a gap: nothing is missing from the contract.
      endpoints.push({ method, path, label, request: status(req), response: status(res), ...(isWired(path) ? {} : { wired: false }) });
      for (const [where, b] of [["request", req], ["response", res]]) {
        if (!b || b.has || !b.hasSchema) { if (b?.has) for (const m of b.missing) gap({ kind: "field-no-example", endpoint: label, where, path: m, text: `${label} ${where}: the contract has no example for "${m}".` }); continue; }
        gap({ kind: "no-example", endpoint: label, where, text: `${label} ${where}: the contract has no example for it (an example on the ${where}, or on each field, would give it values).` });
      }
      entries.push({ entry, res, isItem: isItemPath(path), wired: isWired(path) });
    }
  }
  for (const ref of ctx.unresolved) gap({ kind: "ref", endpoint: "", where: "file", text: `The contract points to "${ref}", which is not inside the file, so it was not followed.` });

  // The list endpoint: the first GET on a collection path that returns a list, the same rule the matcher uses.
  let listKey = null;
  const found = entries.find((e) => e.entry.method === "GET" && e.wired && !e.isItem && listShape(ctx, e.res, force));
  if (found) {
    listKey = listShape(ctx, found.res, force).key;
    if (!found.res.has) {
      found.entry.response = listKey ? { [listKey]: [] } : [];
      found.entry.noExample = true;
    }
  }
  return { apis: entries.map((e) => e.entry), listKey, gaps, endpoints };
}

/**
 * Parse a contract file's text and extract its `apis` shape in one call.
 *
 * @param {string} text The contract file's text (JSON or YAML).
 * @param {{listKey?: string|null}} [opts] See {@link toApis}.
 * @returns {object} The result of {@link parseDocument} merged with the result of {@link toApis}.
 * @throws {Error} Whatever {@link parseDocument} throws.
 */
export function readOpenApi(text, opts) {
  const parsed = parseDocument(text);
  return { ...parsed, ...toApis(parsed, opts) };
}
