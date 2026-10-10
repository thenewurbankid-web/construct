// Every interaction should RESOLVE to an API endpoint, a controller function, or a marked stub (the flow definition).
// A stub is any function with an unused input or nothing returned: `onClick={(event) => {}}` is one. This lists every
// interaction of a page with that resolution status, so the map shows what still has no home. Pure and deterministic; the
// contract is read only through match.mjs (findEndpoints / match), never a model.
//
//   api          the verb is a known kind (create, update, save, delete, reload) and the contract has the endpoint(s) it needs
//   controller   the verb is a known UI-only kind (select/open/edit, clear/cancel/close/reset): a controller function, no API call
//   stub         no home yet, and the handler in the design is a stub (empty or an unused input): a marked stub to write
//   unresolved   no home and no stub marker: an unknown verb, no handler, or a known verb whose endpoint the contract lacks (`endpoint-missing`)
import { match, ACTION_KINDS } from "../match.mjs";
import { readSpec } from "../contract.mjs";

/**
 * Read a handler expression: is it a stub, and why.
 *
 * @param {string} text Source of the attribute, e.g. `onClick={(event) => {}}`.
 * @returns {{present:boolean, stub:boolean, why:string}} `present` false when there is no handler text at all.
 */
export function handlerStub(text) {
  if (!text) return { present: false, stub: false, why: "no handler" };
  const m = text.match(/=\s*\{?\s*(async\s+)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*(?::[^=>]+)?=>\s*([\s\S]*?)\}?\s*$/);
  if (!m) return { present: true, stub: false, why: "a handler that is not an inline function" };
  const params = (m[2] ?? m[3] ?? "").split(",").map((p) => p.trim().replace(/^\.\.\./, "").split(/[:=]/)[0].trim()).filter(Boolean);
  let body = m[4].trim();
  if (body.startsWith("{")) body = body.replace(/^\{/, "").replace(/\}$/, "");
  body = body.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (!body || /^(void 0|undefined|null)$/.test(body)) return { present: true, stub: true, why: params.length ? `empty body, input "${params[0]}" unused` : "empty body: nothing returned" };
  const unused = params.filter((p) => !new RegExp(`\\b${p.replace(/[$]/g, "\\$")}\\b`).test(body));
  return unused.length ? { present: true, stub: true, why: `input "${unused[0]}" is never used` } : { present: true, stub: false, why: "the handler does something" };
}

/**
 * The interactions of a page and how each resolves.
 *
 * @param {ReturnType<typeof import("./inventory.mjs").buildInventory>} inv The inventory.
 * @param {string} source The page source.
 * @param {Object<string, {name?:string, cls:string}>} proposals Proposals by node id (the verb is the proposal's name).
 * @param {string|null} exampleDir The example folder whose contract to read, or null.
 * @returns {{id:string, line:number, label:string, verb:string, handler:"none"|"stub"|"function", resolution:"api"|"controller"|"stub"|"unresolved", detail:string, endpointMissing?:boolean}[]} In source order.
 */
export function resolveInteractions(inv, source, proposals, exampleDir) {
  // With or without a contract the verb's KIND is the pipeline's (match.mjs matchAction): edit/open/select and cancel/close/reset are UI-only.
  // Without a usable contract there are no endpoints to look for, so a verb that needs one stays unresolved (nothing is claimed).
  let spec = null;
  try { if (exampleDir) { spec = readSpec(exampleDir); if (!spec.contract?.usable) spec = null; } } catch { spec = null; }
  const kindSpec = spec ?? { apis: [] };
  const out = [];
  for (const n of inv.nodes) {
    if (n.kind !== "interaction") continue;
    const p = proposals[n.id];
    const verb = (n.props["data-action"] && typeof n.props["data-action"] === "string" ? n.props["data-action"] : p?.name) ?? n.details.verb;
    const handlerAttr = n.spans.attrs.find((a) => /^on(Click|Submit)$/.test(a.name));
    const h = handlerStub(handlerAttr ? source.slice(handlerAttr.start, handlerAttr.end) : "");
    let resolution, detail, endpointMissing = false;
    const m = match({ values: [], lists: [], actions: [{ name: verb, element: n.tag }], forms: [] }, kindSpec).actions[0];
    const ui = m?.kind && /no API call/.test(ACTION_KINDS[m.kind] ?? "");
    if (m?.kind && (ui || (spec && !m.missing?.length))) {
      resolution = ui ? "controller" : "api";
      detail = ACTION_KINDS[m.kind];
    } else if (m?.kind && !spec) {
      resolution = "unresolved"; detail = `"${verb}" needs an API endpoint (${ACTION_KINDS[m.kind]}) and there is no API contract to check it against`;
    } else if (m?.kind) {
      resolution = "unresolved"; endpointMissing = true; detail = `"${verb}" needs an endpoint the contract lacks (${m.missing.join(", ")})`;
    } else if (h.stub) { resolution = "stub"; detail = `a marked stub to write: ${h.why}`; }
    else if (!spec) { resolution = "unresolved"; detail = "no API contract to resolve it against" + (h.present ? "" : " and no handler"); }
    else { resolution = "unresolved"; detail = h.present ? `"${verb}" is not a known action and the handler is not a stub` : `"${verb}" is not a known action and there is no handler`; }
    out.push({ id: n.id, line: n.line, label: n.details.label || n.tag, verb, handler: h.present ? (h.stub ? "stub" : "function") : "none", resolution, detail, ...(endpointMissing ? { endpointMissing } : {}) });
  }
  return out;
}

/**
 * The overall interaction-coverage figure: one rounded percentage plus the counts behind it. "Coverage" reads the flow
 * rule's own words -- every interaction resolves to an endpoint, a controller function OR a marked stub, OR IT IS
 * FLAGGED AS UNRESOLVED -- as three positive outcomes against one negative one, so `rate` is the share that is NOT
 * unresolved (api + controller + stub, out of the total). A stricter reading (only api/controller truly "resolved", a
 * stub still being work to do) is also given as `resolvedStrict` / `rateStrict`, since the flow rule text supports
 * either count and picking one silently would hide the other from whoever reads this. Always defined: a page with no
 * interactions reads as 100% (nothing left unresolved), not NaN.
 *
 * @param {ReturnType<typeof resolveInteractions>} interactions
 * @returns {{total:number, api:number, controller:number, stub:number, unresolved:number, rate:number, resolvedStrict:number, rateStrict:number}}
 */
export function interactionCoverage(interactions) {
  const total = interactions.length;
  const by = (k) => interactions.filter((i) => i.resolution === k).length;
  const api = by("api"), controller = by("controller"), stub = by("stub"), unresolved = by("unresolved");
  const resolvedStrict = api + controller;
  return { total, api, controller, stub, unresolved, rate: total ? Math.round(((total - unresolved) / total) * 100) : 100, resolvedStrict, rateStrict: total ? Math.round((resolvedStrict / total) * 100) : 100 };
}
