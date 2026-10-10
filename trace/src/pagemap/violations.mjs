// Suggested markers are SUGGESTED by Trace, CONFIRMED by the user, and STORED AS VIOLATIONS: a tracked list, one entry per
// open question about the page, with the rule id, the node id, why, and the proposed edit. The shape is Construct's
// `makeViolation` diagnostic ({rule, severity, file, line, message, why, expected, suggestedFix}) plus the tracking fields
// (id, nodeId, status, team). Pure and deterministic. The list is shown in the page's summary, stored in the sidecar
// (`pagemap.json`, key `violations`) after every change, and is what a run summary or a team email reads later.
//
// Rules: pagemap/dynamic-value | list | action | input   a proposed marker (strong = warning, weak or unsure = info)
//        pagemap/unsure                                 the rules disagree (info)
//        pagemap/state/<kind>                            a state or conditional that needs a requirement (info)
//        pagemap/interaction-unresolved                  an interaction with no API endpoint, controller or marked stub (warning)
//        pagemap/interaction-stub                        an interaction that resolves to a stub (info)
//        pagemap/chart-mapping                           a chart's series and axis labels need mapping to data items (info)
// status: suggested (waiting), confirmed (the user accepted or changed it), dismissed (the user rejected it),
//         orphan (the proposed edit points at something that is not on the page: recorded, never written, never thrown on).
import { sha1 } from "./shape.mjs";
import { editSummary } from "./apply.mjs";
import { rootOf } from "./classify.mjs";

const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
const MARKER = { dynamic: "dynamic-value", list: "list", action: "action", input: "input" };

/**
 * Build Trace's violation object with the field set of Construct's `makeViolation` (which also wants a `module` from a closed list, so it
 * is not called here; a test validates the shape against it when a checkout is present).
 *
 * @param {{rule:string, severity:"error"|"warning"|"info", file:string, line:number, message:string, why:string, expected?:string[], suggestedFix?:string, nodeId:string, status:string, team?:string}} v The fields.
 * @returns {object} The violation with a stable `id`.
 */
export function makeViolation(v) {
  return { id: "v" + sha1(`${v.rule}|${v.nodeId}`).slice(0, 10), rule: v.rule, severity: v.severity, file: v.file, line: v.line, message: v.message, why: v.why, expected: v.expected ?? [], suggestedFix: v.suggestedFix, nodeId: v.nodeId, status: v.status, team: v.team ?? "Product" };
}

/**
 * The tracked list for a page.
 *
 * @param {object} ctx `{inv, follow, proposals, source, states, interactions, mappings}` (the service's analysis).
 * @param {Object<string,object>} decisions Decisions by node or state id.
 * @returns {object[]} Violations sorted by line, then rule, then node id.
 */
export function buildViolations(ctx, decisions) {
  const { inv, follow, proposals, states = [], interactions = [], mappings = {} } = ctx;
  const file = inv.file;
  const out = [];
  const statusOf = (id) => { const d = decisions[rootOf(follow, id)] ?? decisions[id]; return !d ? "suggested" : d.act === "reject" ? "dismissed" : "confirmed"; };
  for (const n of inv.nodes) {
    if (n.id === "root" || follow[n.id]) continue;
    const p = proposals[n.id];
    if (p.existing || p.delegate) continue;
    const cls = p.cls === "unsure" ? p.lean : p.cls;
    if (!MARKER[cls]) continue;
    const text = n.kind === "text" ? `"${clip(n.text, 50)}"` : `<${n.tag}>${n.details?.label ? ` ${clip(n.details.label, 30)}` : ""}`;
    let suggestedFix;
    try { suggestedFix = editSummary(ctx, n.id); } catch (e) { suggestedFix = `orphan: the edit could not be worked out (${e.message})`; } // never throws out of the list
    if (/^none/.test(suggestedFix) && n.kind === "text") continue; // attribute text and expressions cannot carry a marker
    const orphan = /^orphan/.test(suggestedFix);
    out.push(makeViolation({
      rule: p.cls === "unsure" ? "pagemap/unsure" : `pagemap/${MARKER[cls]}`, severity: p.strength === "strong" && p.cls !== "unsure" ? "warning" : "info", file, line: n.line,
      message: `${text} looks like ${{ dynamic: "data from the API", list: "a repeated list", action: "a control that should call the API", input: "a field the user fills in" }[cls]} (${p.strength}).`,
      why: p.reasons.join("; ") + (p.risk ? `. May be wrong: ${p.risk}.` : ""), expected: [{ dynamic: "data-dyn", list: "data-list", action: "data-action", input: "name" }[cls]], suggestedFix, nodeId: n.id, status: orphan ? "orphan" : statusOf(n.id), team: "Product",
    }));
  }
  for (const s of states) {
    out.push(makeViolation({
      rule: `pagemap/state/${s.stateKind}`, severity: "info", file, line: s.line,
      message: `A ${s.stateKind} state: ${s.source === "conditional" ? "shown only when" : s.source === "prop" ? `set by ${s.prop}=` : s.source === "text" ? "wording" : s.source} \`${clip(s.condition, 60)}\`.`,
      why: `The design shows something that depends on a condition or a state, and nobody has said when. ${s.requirement}`, expected: [`a requirement for ${s.team}`], suggestedFix: s.requirement, nodeId: s.id, status: statusOf(s.id), team: s.team,
    }));
  }
  for (const i of interactions) {
    if (i.resolution === "api" || i.resolution === "controller") continue;
    out.push(makeViolation({
      rule: i.resolution === "stub" ? "pagemap/interaction-stub" : "pagemap/interaction-unresolved", severity: i.resolution === "stub" ? "info" : "warning", file, line: i.line,
      message: `"${clip(i.label, 40)}" ${i.resolution === "stub" ? "resolves to a stub" : "has no API endpoint, controller function or marked stub"}.`,
      why: i.detail, expected: ["an API endpoint", "a controller function", "a marked stub"], suggestedFix: i.resolution === "stub" ? `Write the function behind "${i.verb}" (${i.detail}).` : i.endpointMissing ? "Ask backend for the endpoint, or choose a controller function." : `Give "${i.label}" an action: pick an endpoint or a controller function, or mark it a stub.`, nodeId: i.id, status: statusOf(i.id), team: "Product",
    }));
  }
  for (const [id, m] of Object.entries(mappings)) {
    const n = inv.byId.get(id);
    if (follow[id]) continue;
    out.push(makeViolation({
      rule: "pagemap/chart-mapping", severity: "info", file, line: n.line,
      message: `A ${n.details.media} needs its series and axis labels mapped to data items.`,
      why: m.labels.length ? `Labels in it: ${m.labels.map((l) => `"${clip(l.label, 30)}" -> ${l.items.length ? l.items.join(", ") : "no data item found"}`).join("; ")}.` : "It carries no label text, so nothing says which data it draws.",
      expected: ["a series -> data item mapping", "an axis label -> data item mapping"], suggestedFix: m.labels.some((l) => l.items.length) ? "Confirm the candidate data items above." : "Name each series and axis and say which API field it draws.", nodeId: id, status: statusOf(id), team: "Design",
    }));
  }
  return out.sort((a, b) => a.line - b.line || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : a.nodeId < b.nodeId ? -1 : 1));
}

/** Counts for the summary: total, by status, by severity. */
export function summarizeViolations(list) {
  const by = (k) => list.reduce((a, v) => ((a[v[k]] = (a[v[k]] ?? 0) + 1), a), {});
  return { total: list.length, byStatus: by("status"), bySeverity: by("severity"), open: list.filter((v) => v.status === "suggested").length };
}
