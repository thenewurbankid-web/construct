// T27.1: structural drift between two OpenAPI/Swagger contracts (the stored contract and a freshly-fetched one).
// Deterministic, no model: the same two documents always give the same report. Reuses `parseDocument` / `toApis`
// from openapi.mjs (the existing, already-tested contract parser) rather than writing a second one; this module
// only compares the two parsed shapes.
//
// Endpoints are matched by method + path with param NAMES erased ("/orders/:id" and "/orders/:orderId" both key
// as "GET /orders/:param"), so a renamed path parameter is reported once, as "param-renamed", rather than as an
// unrelated removed+added pair. An endpoint that moves to a genuinely different path (different literal segments)
// has no shared key and is reported as removed+added, like any other endpoint that no longer exists at that path.
//
//   diffContracts(beforeText, afterText) -> { added, removed, changed, hasDrift }
//     added/removed:  [{ method, path }]
//     changed:        [{ kind: "param-renamed", method, before, after }
//                       | { kind: "request-changed"|"response-changed", method, path, before, after, textDiff? }]
//   textDiff is only present when Construct's core/text-diff.mjs (buildDiffView) is available via CONSTRUCT_ROOT
//   (src/construct.mjs); it is a rendering convenience (a line diff of the two example bodies as pretty JSON),
//   not part of the structural comparison, so its absence changes no other field.
import { parseDocument, toApis } from "./openapi.mjs";
import { loadConstructTextDiff } from "./construct.mjs";

// A stable structural summary of a JSON value: enough to say "the shape changed" without caring about key order
// or the specific example values. Depth-capped so a pathological cyclic-looking example can't loop.
function shapeOf(value, depth = 0) {
  if (depth > 8) return "…";
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length ? `array<${shapeOf(value[0], depth + 1)}>` : "array<empty>";
  if (typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${k}:${shapeOf(value[k], depth + 1)}`).join(",")}}`;
  return typeof value;
}

// Erases path-parameter names so an endpoint can be matched across a rename: "/orders/:orderId" -> "/orders/:param".
const paramKey = (path) => path.replace(/:[A-Za-z_]+/g, ":param");

// method+erased-path -> { method, path, wired, request: status, response: status, requestValue, responseValue }
// `endpoints` and `apis` are built in the same loop over the same paths/verbs in toApis, so they line up by index.
function indexContract(text) {
  const parsed = parseDocument(text);
  const { apis, endpoints } = toApis(parsed);
  const out = new Map();
  endpoints.forEach((e, i) => {
    const api = apis[i] ?? {};
    const key = `${e.method} ${paramKey(e.path)}`;
    // two endpoints erasing to the same key (e.g. both already ":param") would collide; keep the first, as encountered
    if (!out.has(key)) {
      out.set(key, { method: e.method, path: e.path, wired: e.wired !== false, request: e.request, response: e.response, requestValue: api.request, responseValue: api.response });
    }
  });
  return out;
}

const sortKey = (x) => `${x.method} ${x.path ?? x.before ?? ""}`;
const byKey = (a, b) => sortKey(a).localeCompare(sortKey(b));

/**
 * Structural drift between two OpenAPI/Swagger documents (as text: JSON or YAML, whatever `parseDocument` reads).
 *
 * @param {string} beforeText The stored contract.
 * @param {string} afterText The freshly-fetched contract.
 * @returns {{added: Array<{method:string,path:string}>, removed: Array<{method:string,path:string}>,
 *   changed: Array<object>, hasDrift: boolean}}
 */
export function diffContracts(beforeText, afterText) {
  const before = indexContract(beforeText);
  const after = indexContract(afterText);
  const textDiff = loadConstructTextDiff();
  const added = [], removed = [], changed = [];

  for (const [key, b] of before) {
    const a = after.get(key);
    if (!a) { removed.push({ method: b.method, path: b.path }); continue; }
    if (a.path !== b.path) { changed.push({ kind: "param-renamed", method: b.method, before: b.path, after: a.path }); continue; }
    for (const where of ["request", "response"]) {
      const valueKey = `${where}Value`;
      const bShape = b[where] === "example" ? shapeOf(b[valueKey]) : b[where];
      const aShape = a[where] === "example" ? shapeOf(a[valueKey]) : a[where];
      if (bShape === aShape) continue;
      const entry = { kind: `${where}-changed`, method: b.method, path: b.path, before: bShape, after: aShape };
      if (textDiff && b[where] === "example" && a[where] === "example") {
        entry.textDiff = textDiff.buildDiffView(JSON.stringify(b[valueKey], null, 2), JSON.stringify(a[valueKey], null, 2));
      }
      changed.push(entry);
    }
  }
  for (const [key, a] of after) if (!before.has(key)) added.push({ method: a.method, path: a.path });

  added.sort(byKey);
  removed.sort(byKey);
  changed.sort(byKey);
  return { added, removed, changed, hasDrift: added.length > 0 || removed.length > 0 || changed.length > 0 };
}
