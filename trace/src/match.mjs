// Step 2 — match each dynamic part of the page to the mock API data.
// Brute-force over the closed transform library. Anything with 0 or >1 answers
// becomes a multiple-choice question (see ask.mjs). No model calls.
import { FORMATTERS, AGGREGATES, normalize } from "./transforms.mjs";
import { contractBlock } from "./contract.mjs";
import { isItemPath, isWired } from "./endpoint-paths.mjs";

// ---------- API helpers ----------
// listKey (feature.json "list"): the list lives inside an object response, e.g. { "categories": [ ... ], ... }.
/**
 * Pick out the endpoints the pipeline cares about (list, create, update, remove) from the full `apis` list. Only
 * endpoints the generator can call are considered (see {@link isWired}); a nested endpoint such as
 * `/a/:id/b/:sub` is in `apis` but is neither list nor item here.
 *
 * @param {{method: string, path: string, response?: *}[]} apis The contract's endpoints.
 * @param {string|null} [listKey] From `feature.json`'s `list` (or the contract's own `listKey`): the list lives
 *   inside an object response under this key, e.g. `{ "categories": [...] }`.
 * @returns {{list: object|undefined, listKey: string|null, create: object|undefined, update: object|undefined,
 *   remove: object|undefined}}
 *   The picked endpoints (`undefined` when none matches), and the resolved `listKey` (`null` when the list is a
 *   bare array, or there is no list).
 */
export function findEndpoints(apis, listKey) {
  // only endpoints the generator can call (no parameter, or one trailing parameter: see endpoint-paths.mjs) are picked; a nested one such as /a/:id/b/:sub is in `apis` but is neither list nor item
  const wired = apis.filter((a) => isWired(a.path));
  const list = wired.find((a) => a.method === "GET" && !isItemPath(a.path) && (listKey ? Array.isArray(a.response?.[listKey]) : Array.isArray(a.response)));
  const by = (m, item) => wired.find((a) => a.method === m && isItemPath(a.path) === item);
  return {
    list,
    listKey: list && listKey ? listKey : null,
    create: by("POST", false),
    update: by("PUT", true) || by("PATCH", true),
    remove: by("DELETE", true),
  };
}

// The fields a request body carries, name -> JS type ("string" | "number" | "boolean" | "object"): the ones in the
// example, then the ones the contract's schema declares without an example (`declared`). PUT first, POST after, as the
// old example-only lookup did.
const jsType = (t) => (t === "number" || t === "boolean" || t === "string" ? t : t === "array" || t === "object" ? "object" : "string");
/**
 * The fields one endpoint's request body carries, name -> JS type. Fields from the request example take
 * precedence; fields the contract's schema declares without an example (`declared`) fill in the rest.
 *
 * @param {{request?: object, declared?: Object<string, string>}|undefined} ep A create/update endpoint.
 * @returns {Object<string, "string"|"number"|"boolean"|"object">}
 */
export const endpointFields = (ep) => ({
  ...Object.fromEntries(Object.entries(ep?.request ?? {}).map(([k, v]) => [k, typeof v])),
  ...Object.fromEntries(Object.entries(ep?.declared ?? {}).filter(([k]) => !(k in (ep?.request ?? {}))).map(([k, t]) => [k, jsType(t)])),
});
/**
 * The fields a form could submit: the update endpoint's fields (checked first, matching the old example-only
 * lookup order) merged with the create endpoint's.
 *
 * @param {{update?: object, create?: object}} e From {@link findEndpoints}.
 * @returns {Object<string, string>}
 */
export const requestFields = (e) => ({ ...endpointFields(e.update), ...endpointFields(e.create) });

// Nested item fields become dotted paths ("spend.value"); arrays are skipped. Generated code reads them as item.spend.value.
/**
 * Flatten a nested object to dotted-path keys (e.g. `spend.value`); arrays are skipped (generated code reads
 * flattened paths as `item.spend.value`).
 *
 * @param {object} obj The object to flatten.
 * @param {string} [prefix] Internal: the path prefix for the current recursion level.
 * @param {object} [out] Internal: the accumulator (also the return value).
 * @returns {Object<string, *>} The flattened object.
 */
export function flat(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
    else if (!Array.isArray(v)) out[key] = v;
  }
  return out;
}
/**
 * The list endpoint's array of items.
 *
 * @param {{list?: {response: *}, listKey?: string|null}} e From {@link findEndpoints}.
 * @returns {object[]} The items, or `[]` when there is no list endpoint.
 */
export const listItems = (e) => (e.list ? (e.listKey ? e.list.response[e.listKey] : e.list.response) : []);
/**
 * The list endpoint's items, each flattened (see {@link flat}).
 *
 * @param {{list?: {response: *}, listKey?: string|null}} e From {@link findEndpoints}.
 * @returns {Object<string, *>[]}
 */
export const flatItems = (e) => listItems(e).map((it) => flat(it));
// The rest of the response around the list (header cards etc.), or null when the response is the list itself.
/**
 * The rest of the list response around the list itself (e.g. header-card fields alongside the array).
 *
 * @param {{list?: {response: *}, listKey?: string|null}} e From {@link findEndpoints}.
 * @returns {object|null} The response minus its list property, or `null` when there is no envelope (no list, or
 *   the response is the list itself).
 */
export const envelopeOf = (e) => {
  if (!e.listKey) return null;
  const { [e.listKey]: _list, ...rest } = e.list.response;
  return rest;
};
/**
 * The envelope's scalar fields, flattened (see {@link flat}).
 *
 * @param {{list?: {response: *}, listKey?: string|null}} e From {@link findEndpoints}.
 * @returns {Object<string, *>}
 */
export const envScalars = (e) => flat(envelopeOf(e) ?? {});

// ---------- list rows ----------
// Align each designed row with one item from the mock list, using a field whose
// text appears exactly (e.g. the name column). Returns [itemIndex per row].
function alignRows(rows, items) {
  const dynNames = Object.keys(rows[0] ?? {});
  const itemFields = Object.keys(items[0] ?? {});
  for (const d of dynNames) {
    for (const f of itemFields) {
      const idx = rows.map((r) => items.findIndex((it) => normalize(it[f]) === normalize(r[d])));
      if (idx.every((i) => i >= 0) && new Set(idx).size === idx.length) return { idx, key: { dyn: d, field: f } };
    }
  }
  return null;
}

function matchListField(dyn, rows, alignedItems) {
  const fields = Object.keys(alignedItems[0] ?? {});
  const out = [];
  for (const field of fields) {
    for (const fmt of FORMATTERS) {
      const ok = rows.every((r, i) => {
        const v = alignedItems[i][field];
        if (fmt.accepts && !fmt.accepts(v)) return false;
        try { return normalize(fmt.fn(v)) === normalize(r[dyn]); } catch { return false; }
      });
      if (ok) out.push({ field, formatter: fmt.name, cost: fmt.cost });
    }
  }
  return cheapest(out);
}

function detectSort(idx, items) {
  const n = idx.length;
  const same = (order) => order.slice(0, n).every((v, i) => v === idx[i]);
  const natural = items.map((_, i) => i);
  if (same(natural)) return [{ field: null, dir: "none", label: "keep the API order" }];
  const out = [];
  for (const field of Object.keys(items[0] ?? {})) {
    for (const dir of ["asc", "desc"]) {
      const order = [...natural].sort((a, b) => {
        const x = items[a][field], y = items[b][field];
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return dir === "asc" ? c : -c;
      });
      if (same(order)) out.push({ field, dir, label: `sort by ${field} ${dir === "asc" ? "ascending" : "descending"}` });
    }
  }
  return out;
}

// ---------- single values (outside the list) ----------
function matchValue(example, items, env = {}) {
  const out = [];
  // A scalar field of the response envelope, shown as text or with a formatter.
  for (const [path, val] of Object.entries(env)) {
    if (val == null) continue;
    for (const fmt of FORMATTERS) {
      if (fmt.accepts && !fmt.accepts(val)) continue;
      let text;
      try { text = fmt.fn(val); } catch { continue; }
      if (normalize(text) === normalize(example)) out.push({ agg: "field", field: path, formatter: fmt.name, cost: 1 + fmt.cost });
    }
  }
  const fields = Object.keys(items[0] ?? {});
  for (const agg of AGGREGATES) {
    for (const field of agg.needsField ? fields : [null]) {
      let v;
      try { v = agg.fn(items, field); } catch { continue; }
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      for (const fmt of FORMATTERS) {
        if (fmt.accepts && !fmt.accepts(v)) continue;
        if (normalize(fmt.fn(v)) === normalize(example)) {
          out.push({ agg: agg.name, field, formatter: fmt.name, cost: 1 + fmt.cost + (field ? 1 : 0) });
        }
      }
    }
  }
  return cheapest(out);
}

// Keep only the simplest explanations; equal-cost ties remain (and become a question).
function cheapest(list) {
  if (!list.length) return list;
  const min = Math.min(...list.map((c) => c.cost));
  return list.filter((c) => c.cost === min);
}

// ---------- actions ----------
const VERBS = {
  create: "create", add: "create", new: "create",
  update: "update",
  save: "save", submit: "save",
  delete: "remove", remove: "remove",
  edit: "select", select: "select", open: "select",
  cancel: "clear", reset: "clear", close: "clear",
  refresh: "reload", reload: "reload",
};
/**
 * Whether an action's name (from the design) maps to a known verb.
 *
 * @param {string} v An action name, e.g. `"save"`, `"delete"`.
 * @returns {boolean}
 */
export const knownVerb = (v) => !!VERBS[v.toLowerCase()];
export const ACTION_KINDS = {
  create: "create a new item (POST)",
  update: "update the selected item (PUT)",
  save: "create, or update if an item is selected (POST / PUT)",
  remove: "delete this item (DELETE)",
  select: "select this item for editing (no API call)",
  clear: "clear the selection (no API call)",
  reload: "reload the list (GET)",
  ignore: "nothing — leave it static",
};
const NEEDS = { create: ["create"], update: ["update"], save: ["create", "update"], remove: ["remove"], reload: ["list"] };

function matchAction(verb, endpoints) {
  const kind = VERBS[verb.toLowerCase()];
  if (!kind) return { kind: null, missing: [] };
  const missing = (NEEDS[kind] ?? []).filter((k) => !endpoints[k]);
  return { kind, missing };
}

// ---------- main ----------
/**
 * Match every dynamic part of the extracted page against the mock API data. Brute-force over the closed
 * transform library (see `transforms.mjs`); anything with zero or more than one answer is left as candidates
 * for a question (see `ask.mjs`). No model calls.
 *
 * @param {{lists: object[], values: object[], actions: object[], forms: object[]}} extracted From `extract.mjs`.
 * @param {{apis: object[], list?: string|null, contract?: object|null}} spec The example's spec.
 * @returns {{endpoints: object, list: object|null, values: object[], actions: object[], gaps: string[],
 *   contract: object|null, block: object|null, forms: object[]}}
 *   The match result: matched endpoints, the list (with per-row field candidates, sort candidates and row
 *   actions), page values, page actions, plain-text gaps, the contract, `block` (see `contractBlock`) when the
 *   contract itself is the blocker, and the page's forms (passed through unchanged).
 */
export function match(extracted, spec) {
  const endpoints = findEndpoints(spec.apis, spec.list);
  const items = flatItems(endpoints);
  const env = envScalars(endpoints);
  const result = { endpoints, list: null, values: [], actions: [], gaps: [], contract: spec.contract ?? null };
  // No contract, or none with an example for the list: one reason for everything that would have been matched (hints.mjs)
  result.block = contractBlock(spec.contract, endpoints);

  if (!endpoints.list && !result.block) result.gaps.push(spec.list ? `No GET whose response has a "${spec.list}" array was given, so there is no data to match against.` : "No list endpoint (GET returning an array) was given, so there is no data to match against.");

  const list = extracted.lists[0];
  if (list) {
    const aligned = alignRows(list.rows, items);
    const idx = aligned ? aligned.idx : list.rows.map((_, i) => i);
    const alignedItems = idx.map((i) => items[i]).filter(Boolean);
    result.list = {
      name: list.name,
      alignedBy: aligned?.key ?? null,
      alignedIdx: idx,
      fields: list.fields.map((dyn) => ({
        name: dyn,
        examples: list.rows.map((r) => r[dyn]),
        candidates: alignedItems.length === list.rows.length ? matchListField(dyn, list.rows, alignedItems) : [],
      })),
      sort: aligned ? detectSort(idx, items) : [{ field: null, dir: "none", label: "keep the API order" }],
      actions: list.actions.map((a) => ({ name: a, scope: "row", ...matchAction(a, endpoints) })),
    };
    if (!aligned && !result.block) result.gaps.push(`Could not line up the designed rows of "${list.name}" with the mock list — using API order.`);
  }

  result.values = extracted.values.map((v) => ({ ...v, candidates: matchValue(v.example, items, env) }));
  result.actions = extracted.actions.map((a) => ({ ...a, scope: "page", ...matchAction(a.name, endpoints) }));
  result.forms = extracted.forms;
  return result;
}
