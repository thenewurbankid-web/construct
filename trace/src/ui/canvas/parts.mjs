// From the run's result to the facts the canvas draws: for each part of the page, its outcome (Fit, Waiting, Gap, Tie or Stub),
// the endpoint of the contract it traces back to, and one plain sentence saying so. Pure functions, no DOM. The same
// sentences fill the list next to the Map, so everything the canvas shows is also there as text.
import { TERMS, humanize, scrub } from "../vocab.mjs";

export const endpointKey = (api) => `${api.method} ${api.path}`;
const METHOD = /\b(GET|POST|PUT|PATCH|DELETE)\b/g;
const KEY = /\b(GET|POST|PUT|PATCH|DELETE) (\/\S*)/;

// "What the design calls it", in the words of the demo (never the pipeline's ids).
export function partName(leaf) {
  const id = String(leaf.id ?? ""), c0 = (leaf.cells ?? [])[0];
  if (id === "list.sort") return "Row order";
  if (id.startsWith("action.")) { const p = id.split("."); return `The ${p.slice(2).join(".")} button`; }
  if (id.startsWith("form.missing.")) return `${humanize(id.split(".").pop())}, which the API expects`;
  if (id.startsWith("form.")) return `${humanize(id.split(".").pop())} input`;
  if (id.startsWith("gap.")) return scrub(c0?.sub || "Something not on the page");
  return humanize(id.split(".").pop());
}

const firstWith = (apis, test) => apis.find(test);

// Which endpoint of the contract a part traces back to, and which field of it. Read from the API side of the result
// ("listOrders() · GET /api/orders", "POST / PUT body", ...). A Gap has no field behind it, so it is aimed at the endpoint
// it should have come from (the list for a value or a row part, the form's endpoint for an input), and stops short of it.
// A part that is Waiting for an answer is aimed the same way, but it only pauses near the part: nothing is settled yet.
export function sourceOf(leaf, term, apis = []) {
  const id = String(leaf.id ?? ""), cells = leaf.cells ?? [], api = cells[2] ?? null;
  const has = (k) => apis.some((a) => endpointKey(a) === k);
  let endpoint = null, field = null, need = null;
  const sub = String(api?.sub ?? ""), title = String(api?.title ?? "");
  const direct = KEY.exec(sub);
  if (direct && has(direct[0])) endpoint = direct[0];
  else if (api?.state === "ok" || api?.state === "ask") {
    const path = /· (\/\S+)/.exec(sub)?.[1];
    const methods = [...title.matchAll(METHOD)].map((m) => m[1]);
    const body = /^((?:GET|POST|PUT|PATCH|DELETE)(?: \/ (?:POST|PUT|PATCH))*) body$/.exec(sub);
    if (path && methods.length) { const a = firstWith(apis, (x) => x.path === path && methods.includes(x.method)); if (a) endpoint = endpointKey(a); }
    else if (body) { const ms = [...body[1].matchAll(METHOD)].map((m) => m[1]); const a = firstWith(apis, (x) => ms.includes(x.method) && x.request); if (a) endpoint = endpointKey(a); }
  }
  if (term === "fit" && endpoint && api?.state === "ok" && !id.startsWith("action.") && title !== "whole list") field = title;
  if (term === "gap" || term === "wait") {
    need = term === "gap" ? /^needs (.+)$/.exec(sub)?.[1]?.replace("+", " and ") ?? null : null;
    if (!endpoint) {
      if (/^(value|list)\./.test(id)) { const a = firstWith(apis, (x) => x.method === "GET"); if (a) endpoint = endpointKey(a); }
      else if (id.startsWith("form.")) { const a = firstWith(apis, (x) => x.method === "POST" && x.request) ?? firstWith(apis, (x) => x.request); if (a) endpoint = endpointKey(a); }
    }
  }
  const kept = term === "fit" && !endpoint; // nothing in the contract is involved: the design keeps it as it is
  if (term === "stub") endpoint = null; // a Stub, by definition, is not in the contract yet
  return { endpoint, field, need, kept };
}

// One plain sentence for a part: "Total: Fit, from GET /api/orders (total)".
// count: how many parts of the page share this one (two buttons with one name are traced once, and listed as "x2").
export function describe(leaf, term, src, count = 1) {
  const name = count > 1 ? `${partName(leaf)} ×${count}` : partName(leaf), word = TERMS[term].phrase ?? TERMS[term].word;
  let where;
  if (term === "fit") where = src.kept ? "kept from the design, no API needed" : `from ${src.endpoint}${src.field ? ` (${src.field})` : ""}`;
  else if (term === "wait") where = "an Ask is open, so nothing is decided yet";
  else if (term === "gap") where = src.need ? `nothing behind it, the API needs ${src.need}` : "nothing behind it in the API";
  else if (term === "tie") where = `two or more fields fit equally${src.endpoint ? ` in ${src.endpoint}` : ""}, so someone has to choose`;
  else where = "a marked stand-in until the API has it";
  return { name, term, word, where, count, text: `${name}: ${word}, ${where}` };
}

// Every part of the page, in page order, with its outcome and source. states: id -> term (vocab.summarize().states).
// The rule for counts: a part is a part of the design, so two buttons with one name are two parts. They are traced (and listed)
// once, with count 2, so the parts add up to the same total as the ring (partTotal).
export function buildParts(tree, states, apis = []) {
  const first = new Map(), counts = new Map(), out = [];
  for (const g of tree?.groups ?? []) for (const leaf of g.leaves) counts.set(leaf.id, (counts.get(leaf.id) ?? 0) + 1);
  for (const g of tree?.groups ?? []) for (const leaf of g.leaves) {
    if (first.has(leaf.id)) continue;
    first.set(leaf.id, true);
    const term = states[leaf.id] ?? "fit", src = sourceOf(leaf, term, apis);
    out.push({ id: leaf.id, group: g.title, ...describe(leaf, term, src, counts.get(leaf.id)), src, dataType: leaf.cells[0]?.dataType ?? null, order: out.length });
  }
  return out;
}
export const partTotal = (parts) => parts.reduce((n, p) => n + (p.count ?? 1), 0);

// Which of an endpoint's fields (request or response example) have runtime type t — the same "example JSON's
// runtime typeof" inference the contract panel already needs for its per-field badges (LIN-90 §4.4).
const inferType = (v) => (Array.isArray(v) ? "array" : v === null || v === undefined ? null : typeof v);
export function fieldTypesOf(api) {
  const types = new Set();
  const collect = (obj) => { if (Array.isArray(obj)) collect(obj[0]); else if (obj && typeof obj === "object") for (const v of Object.values(obj)) { const t = inferType(v); if (t) types.add(t); } };
  collect(api.request); collect(api.response);
  return types;
}

// Every field on an endpoint's request/response example, by name, with its inferred type and its example
// value (LIN-90 §5: the adapter dialog's field picker lists every field regardless of type — the whole point
// of an adapter is to bridge a type gap — and needs the real value to preview a mapping against).
export function fieldsOf(api) {
  const out = [];
  const collect = (obj) => {
    if (Array.isArray(obj)) collect(obj[0]);
    else if (obj && typeof obj === "object") for (const [name, v] of Object.entries(obj)) { const t = inferType(v); if (t) out.push({ name, type: t, value: v }); }
  };
  collect(api.request); collect(api.response);
  return out;
}

// A Tie's pluggable endpoints (LIN-90 §4.4): a pure, deterministic filter over data already loaded client-side —
// no model call, so it can run at pointer/keyboard speed. A part with no known expected type has nothing to
// match against, so it is never offered a "compatible" endpoint.
export function compatibleEndpoints(part, apis = []) {
  if (!part?.dataType) return [];
  return apis.filter((a) => fieldTypesOf(a).has(part.dataType));
}

// The Map's nodes and edges. Left: the parts. Right: each endpoint of the contract with the fields parts trace to, then
// (only if used) one node each for "which field?", "nothing behind it", "a Stub" and "kept from the design".
// `openEndpoint` (docs/design/panel-layout-focus-slot.md §4): while that endpoint's own details are the one open in the
// focus slot, its Gap parts each get their own right-side node (planted right after that endpoint's block, at that row's
// position) instead of sharing the generic "gap" node — closing the panel (openEndpoint back to null) restores it.
export function buildMap(parts, apis = [], { openEndpoint = null } = {}) {
  const left = parts.map((p) => ({ id: p.id, label: p.name, term: p.term }));
  const right = [], edges = [], idOf = new Map();
  const add = (n) => { if (!idOf.has(n.id)) { idOf.set(n.id, right.length); right.push(n); } return n.id; };
  const fieldsByEp = new Map(), tiesByEp = new Map(), gapsByEp = new Map();
  for (const p of parts) {
    const { endpoint, field } = p.src;
    if (p.term === "fit" && endpoint && field) { if (!fieldsByEp.has(endpoint)) fieldsByEp.set(endpoint, []); if (!fieldsByEp.get(endpoint).includes(field)) fieldsByEp.get(endpoint).push(field); }
    if (p.term === "tie" && endpoint) tiesByEp.set(endpoint, true);
    if (p.term === "gap" && endpoint && endpoint === openEndpoint) { if (!gapsByEp.has(endpoint)) gapsByEp.set(endpoint, []); gapsByEp.get(endpoint).push(p); }
  }
  for (const a of apis) {
    const k = endpointKey(a);
    add({ id: `ep:${k}`, label: k, kind: "endpoint", method: a.method });
    for (const f of fieldsByEp.get(k) ?? []) add({ id: `f:${k}:${f}`, label: f, kind: "field" });
    if (tiesByEp.get(k)) add({ id: `tie:${k}`, label: "Which field? (a Tie)", kind: "special", term: "tie" });
    for (const p of gapsByEp.get(k) ?? []) add({ id: `gap:${p.id}`, label: p.name, kind: "special", term: "gap" });
  }
  const used = (t) => parts.some((p) => p.term === t);
  const missingEp = (p) => !p.src.endpoint;
  const opened = (p) => p.term === "gap" && p.src.endpoint && p.src.endpoint === openEndpoint;
  if (parts.some((p) => p.term === "tie" && missingEp(p))) add({ id: "tie:none", label: "Which field? (a Tie)", kind: "special", term: "tie" });
  if (used("wait")) add({ id: "wait", label: "Waiting for your answer", kind: "special", term: "wait" });
  if (parts.some((p) => p.term === "gap" && !opened(p))) add({ id: "gap", label: "Nothing behind it (a Gap)", kind: "special", term: "gap" });
  if (used("stub")) add({ id: "stub", label: "A marked stand-in (a Stub)", kind: "special", term: "stub" });
  if (parts.some((p) => p.src.kept)) add({ id: "kept", label: "Kept from the design", kind: "special", term: "fit" });
  for (const p of parts) {
    const { endpoint, field, kept } = p.src;
    let to;
    if (p.term === "fit") to = kept ? "kept" : field ? `f:${endpoint}:${field}` : `ep:${endpoint}`;
    else if (p.term === "wait") to = "wait";
    else if (p.term === "gap") to = opened(p) ? `gap:${p.id}` : "gap";
    else if (p.term === "stub") to = "stub";
    else to = endpoint ? `tie:${endpoint}` : "tie:none";
    edges.push({ from: p.id, to, term: p.term });
  }
  return { left, right, edges };
}

// What each endpoint of the contract ended up with, for the rail: { fit, wait, gap, tie } counts per endpoint key (in parts).
export function breakdownByEndpoint(parts) {
  const m = new Map();
  for (const p of parts) {
    if (!p.src.endpoint || p.term === "stub") continue;
    const c = m.get(p.src.endpoint) ?? m.set(p.src.endpoint, { fit: 0, wait: 0, gap: 0, tie: 0 }).get(p.src.endpoint);
    c[p.term] += p.count ?? 1;
  }
  return m;
}

// LIN-117 §3: the currently open Ask's own field candidates, as (index, field, option) rows, when that Ask
// belongs to one of this endpoint's own open ties (see docs/design/panel-layout-focus-slot.md §3). `question`
// is the run's live `run.question`; `tieParts` is this endpoint's own tie-term parts (from buildParts). Every
// row returned here is already a field the matching engine judged plausible for this part — there is no
// "incompatible" candidate to filter out, only the tail options (skip, "not in the API", custom) with no `.field`.
export function tieCandidateRows(question, tieParts) {
  if (!tieParts.length || !question || question.sub) return [];
  if (!tieParts.some((p) => question.id.split("#")[0] === p.id)) return [];
  const cands = question.context?.candidates ?? [];
  return question.options.map((o, i) => ({ i, field: cands[i]?.field, option: o })).filter((r) => r.field);
}

// LIN-117 §4: this endpoint's own gap-term parts, as dashed "missing" rows for the details card (see
// docs/design/panel-layout-focus-slot.md §4) — a field the design needs but this endpoint's contract doesn't
// have. Text is the field name `sourceOf` parsed out of the API-layer cell (`src.need`) when there was one to
// parse, else the part's own design name (`p.name`), so a row is never blank.
export function missingRows(gapParts) {
  return gapParts.map((p) => ({ id: p.id, text: p.src.need ?? p.name }));
}

// LIN-224 §5 ("list"): a page's list item fields all land on one `list.<field>` id namespace and one tree
// group (model.mjs's `foundTree`), so the endpoint panel's "Fields used by this run" rows can group them back
// under that one name with a ×N count, instead of one flat `<li>` per field. `list.sort` is row-order, not an
// item field, so it is excluded from the group (and never appears alone either). Order is preserved — a list's
// first-seen position in `fit` is where its one grouped entry sits.
export function fitRowGroups(fit) {
  const out = [], byGroup = new Map();
  for (const p of fit) {
    if (p.id === "list.sort") continue;
    if (!p.id.startsWith("list.")) { out.push({ kind: "single", part: p }); continue; }
    let entry = byGroup.get(p.group);
    if (!entry) { entry = { kind: "list", group: p.group, parts: [] }; byGroup.set(p.group, entry); out.push(entry); }
    entry.parts.push(p);
  }
  return out;
}
