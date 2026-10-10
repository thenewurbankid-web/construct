// The old hand-written contract (`apis` in feature.json) as an OpenAPI 3.0 document. Used once by
// scripts/apis-to-openapi.mjs to migrate the shipped examples. Deterministic: the same `apis` always give the
// same file, and reading the file back with openapi.mjs gives the same `apis` again (the script checks that).
//   :id         ->  {id} with a path parameter
//   a body      ->  `example` (the whole body, exactly as written) plus a schema inferred from it
//   the list    ->  nothing to store: an envelope is found again as "a GET with exactly one array property"

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// A schema that describes one example value. Arrays of objects are described by the union of their properties.
/**
 * Infer a JSON-Schema-shaped type descriptor from one example value.
 *
 * @param {*} v An example value (any JSON-compatible type).
 * @returns {object} A schema fragment: `{type, properties?, items?, format?, nullable?}`. An array of objects is
 *   described by the union of their properties (a property missing on some objects, or seen as `null` before a
 *   non-null value, is still recorded). A date-shaped or date-time-shaped string gets `format: "date"` /
 *   `"date-time"`.
 */
export function inferSchema(v) {
  if (v === null) return { nullable: true };
  if (Array.isArray(v)) {
    const objs = v.filter(isObj);
    if (objs.length && objs.length === v.length) {
      const properties = {};
      for (const o of objs) for (const [k, x] of Object.entries(o)) if (!(k in properties) || (properties[k].nullable && x !== null)) properties[k] = inferSchema(x);
      return { type: "array", items: { type: "object", properties } };
    }
    return { type: "array", items: v.length ? inferSchema(v.find((x) => x !== null) ?? null) : {} };
  }
  if (isObj(v)) return { type: "object", properties: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, inferSchema(x)])) };
  if (typeof v === "number") return { type: Number.isInteger(v) ? "integer" : "number" };
  if (typeof v === "boolean") return { type: "boolean" };
  if (typeof v === "string") {
    if (/^\d{4}-\d\d-\d\d$/.test(v)) return { type: "string", format: "date" };
    if (/^\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:\d\d)?$/.test(v)) return { type: "string", format: "date-time" };
    return { type: "string" };
  }
  return {};
}

const body = (v) => ({ "application/json": { schema: inferSchema(v), example: v } });

/**
 * Turn the old hand-written `apis` list (from `feature.json`) into an OpenAPI 3.0 document. Deterministic: the
 * same `apis` always produce the same document, and reading it back with `openapi.mjs` gives the same `apis`
 * again. `:id`-style path parameters become `{id}`; a request/response body becomes both an inferred schema and
 * the verbatim `example`; a list endpoint stores nothing special (an envelope is found again as "a GET with
 * exactly one array property").
 *
 * @param {{method: string, path: string, request?: *, response?: *}[]} apis The hand-written API list.
 * @param {{title: string}} options `title` for the document's `info`.
 * @returns {object} The OpenAPI 3.0 document (`openapi`, `info`, `paths`).
 */
export function apisToOpenApi(apis, { title }) {
  const paths = {};
  for (const a of apis) {
    const path = a.path.replace(/:([A-Za-z_]+)/g, "{$1}");
    const op = { summary: `${a.method} ${path}` };
    const params = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    if (params.length) op.parameters = params;
    if (a.request !== undefined) op.requestBody = { required: true, content: body(a.request) };
    op.responses = a.response !== undefined ? { 200: { description: "OK", content: body(a.response) } } : { 204: { description: "No content" } };
    (paths[path] ??= {})[a.method.toLowerCase()] = op;
  }
  return { openapi: "3.0.3", info: { title, version: "1.0.0" }, paths };
}
