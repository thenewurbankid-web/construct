// Action items by team, and the email each team would get. Routing is a fixed rule (no model), and the email is
// composed from the same facts, so it is the same every time.
//   backend   an API endpoint or field is missing, or the contract and the design disagree about data
//   product   a decision or requirement: which field means what, what a button does, where a value comes from
//   design    a component, style or input the design lacks (or needs built): charts, missing form inputs
//   frontend  everything else: stubs to write, wiring
import { plainTemplate } from "./ai/explain.mjs";
import { questionContext } from "./question-context.mjs";

export const TEAMS = [
  { key: "backend", label: "Backend / API", scope: "endpoints, fields and contract" },
  { key: "product", label: "Product", scope: "product logic and requirements" },
  { key: "design", label: "Design", scope: "style and new components" },
  { key: "frontend", label: "Frontend", scope: "everything else" },
];

/**
 * Route one open item to a team by a fixed rule (no model): backend for missing endpoints/fields and contract
 * problems, product for ties and most skipped/missing decisions, design for missing form inputs, frontend for
 * everything else (stubs, wiring).
 *
 * @param {{id: string, why: string, hint: string, state: string, origin?: string}} o An open item.
 * @returns {"backend"|"product"|"design"|"frontend"} The routed team's key (see {@link TEAMS}).
 */
export function teamFor(o) {
  const id = o.id, text = `${o.why} ${o.hint}`;
  if (id.startsWith("contract")) return "backend"; // providing or fixing the contract is the backend's
  if (o.state === "gap") return /^form\.missing\./.test(id) ? "design" : /^form\./.test(id) ? "backend" : "frontend";
  if (o.state === "tie") return "product";
  if (o.state === "placeholder") return /service layer/i.test(o.why) ? "backend" : "frontend";
  const action = id.startsWith("action.");
  if (o.state === "missing") return action ? (/endpoint|wasn't given/i.test(text) ? "backend" : "product") : "backend";
  if (o.state === "skipped") return action ? "product" : o.origin === "missing" ? "backend" : "product";
  return "frontend";
}

/**
 * Turn the run's open items and undescribed visuals into action items, grouped by team.
 *
 * @param {object} run
 * @param {object[]} run.open Open items from matching (each with `id`, `part`, `state`, `why`, `hint`,
 *   `viaContract`, `origin`).
 * @param {{tag: string, where: string}[]} [run.visuals] Visual elements (chart/graphic/etc.) with no data or
 *   component behind them; one design item and one backend item are added per distinct `tag`+`where`.
 * @param {object} run.matched The match result, passed to {@link questionContext} for each item's context.
 * @param {object} run.spec `{feature, apis}` for the example, also passed to {@link questionContext}.
 * @returns {{key: string, label: string, scope: string, items: object[]}[]} {@link TEAMS}, each with its
 *   `items` (missing when a contract problem exists, the parts that only wait for it are folded into one item
 *   instead of repeated).
 */
export function buildActions({ open, visuals = [], matched, spec }) {
  // With no contract, one item asks for it; the parts that only wait for it are not repeated as items of their own.
  const folded = open.filter((o) => o.viaContract).length;
  const items = open.filter((o) => !o.viaContract).map((o) => {
    if (o.id.startsWith("contract")) {
      return { id: o.id, part: o.part, team: "backend", state: "missing", title: o.why, why: folded ? `${folded} part${folded === 1 ? "" : "s"} of the page wait for it, and the generated code is only stubs until then.` : "Without it the generated code has nothing to match the page against.", next: o.hint, detail: o.why, ctx: null };
    }
    // a skipped item is worded by what was wrong with it (nothing in the API, a tie, a gap), not by "skipped"
    const eff = o.state === "skipped" && o.origin ? { ...o, state: o.origin } : o;
    const t = plainTemplate(eff);
    return { id: o.id, part: o.part, team: teamFor(o), state: eff.state, title: t.headline, why: t.why, next: t.action, detail: o.why, ctx: safeCtx(o, matched, spec) };
  });
  // charts and graphics: design has to say what they are, backend has to provide their data
  const seen = new Set();
  for (const v of visuals) {
    const k = `${v.tag}|${v.where}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const kind = { svg: "graphic or chart", canvas: "chart", progress: "progress bar", img: "image", iframe: "embedded frame" }[v.tag] ?? v.tag;
    items.push({ id: `visual.${v.tag}`, part: `${kind} in ${v.where}`, team: "design", state: "missing", title: `A ${kind} in ${v.where} has no component or data behind it`, why: "It is drawn in the design, but nothing supplies its data and no reusable component is named.", next: "Confirm the component and its variants, and what it should show.", detail: `${v.tag} element`, ctx: null });
    items.push({ id: `visual.${v.tag}.data`, part: `data for the ${kind} in ${v.where}`, team: "backend", state: "missing", title: `The ${kind} in ${v.where} needs data the API does not return`, why: "The design shows a visual that needs a series or value per row.", next: "Add the field (for a chart, the series) to the response.", detail: `${v.tag} element`, ctx: null });
  }
  return TEAMS.map((t) => ({ ...t, items: items.filter((i) => i.team === t.key) }));
}

function safeCtx(o, matched, spec) {
  try { return questionContext({ id: o.id }, matched, spec); } catch { return null; }
}

// One email per team, from the team's items. Plain text so it survives any mail client.
/**
 * Compose the plain-text email for one team, listing its action items with what was seen, why it matters, and
 * what is needed. Deterministic: the same items and spec always give the same email.
 *
 * @param {{label: string, scope: string, items: object[]}} team One entry from {@link buildActions}'s result.
 * @param {string} feature The feature name, used in the subject and body.
 * @param {{apis: {method: string, path: string}[]}} spec The example's spec, for the "Contract we used" line.
 * @returns {{subject: string, body: string}} The email.
 */
export function composeEmail(team, feature, spec) {
  const n = team.items.length;
  const endpoints = spec.apis.map((a) => `${a.method} ${a.path}`).join(", ") || "none yet (no OpenAPI file for this feature)";
  const lines = [
    `Hi ${team.label} team,`,
    "",
    `While wiring the "${feature}" screen (design → API contract) we found ${n} thing${n === 1 ? "" : "s"} that need${n === 1 ? "s" : ""} ${team.label === "Product" ? "a decision from" : "input from"} you (${team.scope}).`,
    "",
  ];
  team.items.forEach((it, i) => {
    lines.push(`${i + 1}. ${it.title}`, `   What we saw: ${it.detail}`);
    if (it.ctx?.design?.length) lines.push(`   The design shows: ${it.ctx.design.join(", ")}`);
    if (it.ctx?.endpoint) lines.push(`   API: ${it.ctx.endpoint}`);
    if (it.ctx?.candidates?.length) lines.push(`   Candidates: ${it.ctx.candidates.map((c) => `${c.label}${c.samples?.length ? ` → ${c.samples.join(", ")}` : ""}`).join("; ")}`);
    else if (it.ctx?.available?.length && it.team === "backend") lines.push(`   What the API returns today: ${it.ctx.available.slice(0, 8).map((a) => a.label + (a.sample ? `: ${a.sample}` : "")).join(", ")}`);
    lines.push(`   Why it matters: ${it.why}`, `   What we need: ${it.next}`, "");
  });
  lines.push(`Contract we used: ${endpoints}`, "", "Thanks,", "(generated from the Trace run summary)");
  return { subject: `[${feature}] ${team.label}: ${n} action item${n === 1 ? "" : "s"}`, body: lines.join("\n") };
}
