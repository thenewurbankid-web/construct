// Step 4 — turn the resolved matches into a plan: which layers, which functions, and why.
import { FORMATTERS } from "./transforms.mjs";
import { flatItems, requestFields } from "./match.mjs";

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const pascal = (s) => s.split(/[-_\s]+/).map(cap).join("");
const singular = (s) => (s.endsWith("ies") ? s.slice(0, -3) + "y" : s.endsWith("s") ? s.slice(0, -1) : s);

/**
 * Derive the generated code's naming set from the feature name.
 *
 * @param {string} feature The feature's name (from `feature.json`), e.g. `"categories"`.
 * @returns {{feature: string, fid: string, Feature: string, Item: string, item: string}}
 *   `fid`: the feature name as a JS identifier (camelCase); `Feature`: PascalCase; `Item`/`item`: the singular
 *   form, Pascal/camelCase.
 */
export function makeNames(feature) {
  return {
    feature,
    fid: feature.replace(/[-_\s]+(\w)/g, (_, c) => c.toUpperCase()), // feature name as a JS identifier
    Feature: pascal(feature),
    Item: pascal(singular(feature)),
    item: singular(feature).replace(/[-_\s](\w)/g, (_, c) => c.toUpperCase()),
  };
}

/**
 * Turn the resolved matches into a plan: names, resolved fields/values/actions/form, which layers are needed and
 * why, and any placeholders still to fill in. This is the shape `emit.mjs` and `rewrite-page.mjs` read from.
 *
 * @param {{feature: string, route: string, forms: object[]}} spec The example's spec.
 * @param {object} m The (answered) match result.
 * @returns {{names: object, placeholders: object[], route: string, listKey: string|null, idField: string,
 *   rowFields: object[], values: object[], sort: object, actions: object[], form: object|null,
 *   endpoints: object, layers: {name: string, why: string}[], gaps: string[], contract: object|null,
 *   block: object|null}}
 *   The plan. Placeholder function names are de-duplicated against generated identifiers and each other.
 */
export function makePlan(spec, m) {
  const feature = spec.feature;
  const names = makeNames(feature);
  const sample = flatItems(m.endpoints)[0] ?? {};
  const idField = "id" in sample ? "id" : Object.keys(sample).find((k) => /(^|[._])id$/.test(k)) ?? m.list?.alignedBy?.field ?? Object.keys(sample)[0] ?? "id"; // "id" when there is no example row at all

  const rowFields = (m.list?.fields ?? []).map((f) => ({ name: f.name, examples: f.examples, ...(f.candidates[0] ?? { static: true }) }));
  const values = m.values.map((v) => ({ name: v.name, example: v.example, ...(v.candidates[0] ?? { todo: true }) }));
  const sort = m.list?.sort?.[0] ?? { dir: "none" };
  const actions = [
    ...(m.list?.actions ?? []).map((a) => ({ name: a.name, scope: "row", kind: a.kind ?? "ignore", fn: a.fn })),
    ...m.actions.map((a) => ({ name: a.name, scope: "page", element: a.element, kind: a.kind ?? "ignore", fn: a.fn })),
  ].filter((a) => a.kind !== "ignore");

  // Placeholders the user asked for in Q&A. Their function names are free text, so keep them from
  // colliding with each other or with names the generated files already use.
  const taken = new Set([
    "state", "send", "items", "selectedId", "error", "domain", "service", "useState", "useEffect", "useMachine", "row", "item", "id",
    `to${names.Item}Rows`, `find${names.Item}`, `to${names.Item}Input`, "toFormValues",
    ...FORMATTERS.map((f) => f.name), ...values.filter((v) => !v.custom).map((v) => v.name),
  ]);
  const unique = (o, key) => {
    let name = o[key], k = 2;
    while (taken.has(name)) name = `${o[key]}${k++}`;
    taken.add(name);
    o[key] = name;
  };
  for (const o of [...rowFields, ...values]) if (o.custom) unique(o, "fn");
  for (const a of actions) if (a.kind === "custom") unique(a, "fn");

  const placeholders = [
    ...rowFields.filter((f) => f.custom).map((f) => ({ part: `row.${f.name}`, fn: f.fn, layer: f.from === "controller" ? "Controller" : "Domain", from: f.from, inputs: f.inputs })),
    ...values.filter((v) => v.custom).map((v) => ({ part: v.name, fn: v.fn, layer: { fields: "Domain", controller: "Controller", api: "Service" }[v.from], from: v.from, inputs: v.inputs })),
    ...actions.filter((a) => a.kind === "custom").map((a) => ({ part: `${a.name} (${a.scope} action)`, fn: a.fn, layer: "Controller", from: "handler", inputs: [] })),
  ];

  // Types for form input come from the example request bodies.
  const reqTypes = requestFields(m.endpoints);
  const form = m.forms[0]
    ? {
        action: m.forms[0].action,
        fields: m.forms[0].fields.map((f) => ({ ...f, apiType: reqTypes[f.name] ?? "undefined" })),
        missing: Object.keys(reqTypes).filter((k) => !m.forms[0].fields.some((f) => f.name === k)),
      }
    : null;

  const kinds = new Set(actions.map((a) => a.kind));
  const needsDomain =
    rowFields.some((f) => (f.formatter && f.formatter !== "asText") || f.from === "fields") ||
    values.some((v) => v.agg || v.from === "fields") ||
    sort.dir !== "none" ||
    !!form;

  const layers = [];
  const add = (name, why) => layers.push({ name, why });
  add("Route", `the feature is reached at ${spec.route}`);
  add("Controller", `${values.length + (m.list ? 1 : 0)} data props and ${actions.length} actions must be wired to the page`);
  if (m.endpoints.list || kinds.size) add("Workflow", `states: loading/ready/failed${kinds.has("save") || kinds.has("create") ? "/creating" : ""}${kinds.has("save") || kinds.has("update") ? "/updating" : ""}${kinds.has("remove") ? "/removing" : ""}; events: ${actions.map((a) => a.name.toUpperCase()).join(", ") || "none"}`);
  add("Service", `${Object.values(m.endpoints).filter(Boolean).length} API endpoints are called`);
  if (needsDomain) {
    const why = [];
    if (values.some((v) => v.agg)) why.push(`computed values (${values.filter((v) => v.agg).map((v) => v.name).join(", ")})`);
    if (rowFields.some((f) => f.formatter && f.formatter !== "asText")) why.push("formatted row fields");
    if (sort.dir !== "none") why.push(`sorting by ${sort.field}`);
    if (form) why.push("turning form input into API types");
    add("Domain", why.join(", "));
  }
  add("Page", "the designed JSX, rewritten to take props");
  if (m.list) add("Component", `the repeated "${m.list.name}" row becomes ${names.Item}Row`);

  return { names, placeholders, route: spec.route, listKey: m.endpoints.listKey, idField, rowFields, values, sort, actions, form, endpoints: m.endpoints, layers, gaps: m.gaps, contract: m.contract, block: m.block };
}
