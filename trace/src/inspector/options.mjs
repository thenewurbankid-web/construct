// The question form of one part: which options it has, in which order, what each one produces on the design's own
// example values, and where in the API it comes from. Everything here is a pure function of the matched state
// (state.mjs): the same inputs always give the same options in the same order, and no model is involved.
//
// Order of options (fixed, see FORMS in ui/issues.mjs):
//   candidates   sorted by cost, then by label (plain string comparison, not locale dependent)
//   gap          "leave it as a Gap"
//   stub         from fields, from the controller, from a new endpoint
//   static       fixed text (last, and never chosen by the AI)
// The first option is the rule-based default and is marked "Rule default" (it is only the first option by the rules' order, not evidence that it is right).
import { FORMATTERS, AGGREGATES, normalize } from "../transforms.mjs";
import { flatItems, envScalars, listItems, envelopeOf, ACTION_KINDS } from "../match.mjs";
import { describeField, describeValue, describeCustom } from "../ask.mjs";
import { evalExpression } from "../ai/index.mjs";
import { formFor, FORMS } from "../ui/issues.mjs";
import { humanize } from "../ui/vocab.mjs";
import { buildInventory, descendants } from "../pagemap/inventory.mjs";
import { sha1 } from "../pagemap/shape.mjs";

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const short = (v, n = 60) => { const s = String(v); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const fmt = (name, v) => { try { return String(FORMATTERS.find((f) => f.name === name)?.fn(v) ?? v); } catch { return String(v); } };
const getPath = (o, p) => String(p).split(".").reduce((x, k) => x?.[k], o);

const FORMAT_WORDS = { asText: "", moneyCompact: ", as compact money", moneyFull: ", as full money", percentWhole: ", as a whole percent", percent: ", as a percent", dateShort: ", as a short date" };
const optionLabel = (c) => {
  if (c.agg === "count") return "The number of rows" + (FORMAT_WORDS[c.formatter] ?? "");
  if (c.agg && c.agg !== "field") return `The ${c.agg} of ${c.field}${FORMAT_WORDS[c.formatter] ?? ""}`;
  return `The field ${c.field}${FORMAT_WORDS[c.formatter] ?? ""}`;
};

// What kind of part an id is, with the matcher's own object for it.
export function scopeOf(st, id) {
  const m = st.fresh;
  if (st.parts.find((p) => p.id === id)?.exprKind) return { scope: "exprkind", name: id };
  if (id === "list.sort") return m.list ? { scope: "sort", list: m.list, name: "row order" } : null;
  if (id.startsWith("list.")) { const f = m.list?.fields.find((x) => `list.${x.name}` === id); return f ? { scope: "row", f, name: f.name } : null; }
  if (id.startsWith("value.")) { const v = m.values.find((x) => `value.${x.name}` === id); return v ? { scope: "value", v, name: v.name } : null; }
  if (id.startsWith("action.")) {
    const [, where, ...rest] = id.split("."), name = rest.join(".");
    const a = [...(m.list?.actions ?? []), ...m.actions].find((x) => x.scope === where && x.name === name);
    return a ? { scope: "action", a, name, where } : null;
  }
  if (id.startsWith("form.")) return { scope: "form", name: id };
  if (id.startsWith("gap.")) return { scope: "gap", name: id };
  // Anything else is not one of the matcher's own parts (T14): a pagemap text-node id (src/pagemap/classify.mjs
  // shapes those "n<hash>") or any id the matcher does not otherwise know. It still gets its own scope, so a
  // kind-based form (e.g. "data-or-copy" for ISSUES.unclassified/ambiguous) can apply; buildForm falls back to
  // "info" when nothing gives it a form of its own, the same as before this scope existed.
  return { scope: "text", name: id };
}

// The value that is in force for this part right now (or null when it is open), from the resolved state.
function currentValue(st, sc, id) {
  const m = st.resolved;
  if (sc.scope === "row") { const c = m.list?.fields.find((x) => `list.${x.name}` === id)?.candidates ?? []; return c.length === 1 && !c[0].skipped ? c[0] : null; }
  if (sc.scope === "value") { const c = m.values.find((x) => `value.${x.name}` === id)?.candidates ?? []; return c.length === 1 && !c[0].skipped ? c[0] : null; }
  if (sc.scope === "sort") { const s = m.list?.sort ?? []; return s.length === 1 && !s[0].skipped ? s[0] : null; }
  if (sc.scope === "action") {
    const a = [...(m.list?.actions ?? []), ...m.actions].find((x) => `action.${x.scope}.${x.name}` === id);
    if (!a || a.skipped) return null;
    if (a.kind === "custom") return { custom: true, from: "handler", fn: a.fn };
    return a.kind && !a.missing.length && a.kind !== "ignore" ? a.kind : null;
  }
  return null;
}

// API fields that can feed a Stub, the ones sharing a word with the part first (a fixed rule: score, then name).
export function rankedFields(st, sc, name) {
  const items = flatItems(st.fresh.endpoints);
  const fields = Object.keys(items[0] ?? {});
  const env = sc.scope === "value" ? Object.keys(envScalars(st.fresh.endpoints)).map((p) => "data." + p) : [];
  const words = humanize(name).toLowerCase().split(" ").filter((w) => w.length > 2);
  const score = (f) => words.filter((w) => f.toLowerCase().includes(w)).length;
  return [...fields, ...env].map((f) => ({ f, s: score(f) })).sort((a, b) => b.s - a.s || cmp(a.f, b.f)).map((x) => x.f);
}

// A managed-expression part ("if", "list", see state.mjs): one fixed, rule-default option, applied/undone
// through the exact same history mechanism as any other part's answer -- but keyed to this part's own synthetic
// id, never the real matcher's value/list/action answer, so applying it can never corrupt a real field's match.
const EXPR_KIND_LABEL = { if: "Make it conditional", list: "Make it a list", ternary: "Make it conditional", switch: "Make it a switch" };

// ---------- managed-expression bodies (docs/design/mark-as-list-managed-expressions.md §4a/§4b/§4c) ----------
// Every body is computed deterministically from the part's own data plus the page's own inventory (re-parsed here,
// same as state.mjs's own detection -- a request is one inventory build, not a cache worth keeping) and the API
// shape already available via flatItems/envScalars. Nothing here guesses: a piece that cannot be derived this way
// comes back empty (renders as a Gap, spec §8), never a placeholder value.
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const stripQuotes = (s) => String(s ?? "").trim().replace(/^["'`]|["'`]$/g, "");
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Every field the API list/envelope offers, scored against `name`'s words -- the same rule rankedFields uses, but
// returning the scores too (rankedFields only returns the sorted names), so a fit/tie/gap verdict can be told apart.
function fieldScores(st, scope, name) {
  const items = flatItems(st.fresh.endpoints);
  const fields = Object.keys(items[0] ?? {});
  const env = scope === "value" ? Object.keys(envScalars(st.fresh.endpoints)).map((p) => "data." + p) : [];
  const words = humanize(name).toLowerCase().split(" ").filter((w) => w.length > 2);
  const score = (f) => words.filter((w) => f.toLowerCase().includes(w)).length;
  return [...fields, ...env].map((f) => ({ f, s: score(f) }));
}
function verdictFor(scores) {
  const max = scores.length ? Math.max(...scores.map((x) => x.s)) : 0;
  if (!scores.length || max === 0) return { match: null, verdict: "gap" };
  const top = scores.filter((x) => x.s === max).sort((a, b) => cmpStr(a.f, b.f));
  return top.length === 1 ? { match: top[0].f, verdict: "fit" } : { match: top[0].f, verdict: "tie" };
}

// The repeated group (state.mjs's "list" exprKind) this part's own id was minted from -- recomputed the same way
// state.mjs minted it (same hash of file + "list" + the group's own id), not re-derived from the id's shape.
function findListGroup(inv, spec, part) {
  for (const g of inv.groups) {
    if (!g.mapped) continue;
    const parent = inv.byId.get(g.parent);
    if (parent?.props?.["data-list"] !== undefined) continue;
    if ("s" + sha1(`${spec.page}|list|${g.id}`).slice(0, 8) === part.id) return g;
  }
  return null;
}
// The fields the item template's own text-expression nodes actually reference (`{item.name}` -> "name"), plus
// whether the template just prints the bare item itself (`{tag}`, a list of primitives, not objects).
function listItemFields(inv, member) {
  const param = member?.via?.src?.match(/\.(?:map|flatMap)\(\s*\(?\s*([A-Za-z_$][\w$]*)/)?.[1] ?? null;
  if (!param) return { param: null, fields: [], whole: false };
  const fields = new Set();
  let whole = false;
  for (const n of descendants(inv, member.id)) {
    if (n.kind !== "text" || n.textKind !== "expression") continue;
    const text = n.text.trim();
    if (text === param) { whole = true; continue; }
    const m = text.match(new RegExp(`^${escapeRe(param)}\\.(\\w+)`));
    if (m) fields.add(m[1]);
  }
  return { param, fields: [...fields], whole };
}
function buildListBody(st, part) {
  const inv = buildInventory(st.source, { file: st.spec.page });
  const g = findListGroup(inv, st.spec, part);
  const e = st.fresh.endpoints;
  const sourceList = e.list ? { id: "api-list", label: `${e.list.method} ${e.list.path}`, selected: true } : null;
  if (!g) return { sourceList, itemFields: [] };
  const member = inv.byId.get(g.members[0]);
  const { fields, whole } = listItemFields(inv, member);
  const names = fields.length ? fields : whole ? ["value"] : [];
  const itemFields = names.map((name) => ({ name, ...verdictFor(fieldScores(st, "row", name)) }));
  return { sourceList, itemFields };
}

// The "then"/"else" branch records this ternary's id and `exprElseId` point at (state.mjs), re-found by id in a
// fresh inventory build so their source span (start/end) is available -- state.mjs itself only keeps the ids.
function buildTernaryBody(st, part) {
  const inv = buildInventory(st.source, { file: st.spec.page });
  const conditionals = inv.states.filter((s) => s.source === "conditional");
  const thenRec = conditionals.find((r) => r.id === part.id);
  const elseRec = conditionals.find((r) => r.id === part.exprElseId);
  const condText = part.exprCondition ?? "";
  const name = condText.match(/^\(?\s*([A-Za-z_$][\w$.]*)/)?.[1] ?? condText;
  const condition = { raw: condText, ...verdictFor(fieldScores(st, "value", name)) };
  return {
    condition,
    thenBranch: { source: thenRec ? st.source.slice(thenRec.start, thenRec.end) : "" },
    elseBranch: { source: elseRec ? st.source.slice(elseRec.start, elseRec.end) : "" },
  };
}

// Top-level `?`/`:` split points of a chained ternary (depth/quote tracking identical to state.mjs's ternaryLinks,
// extended here to record *where* each link is instead of only counting them) -- one scanner, two jobs.
function splitTernaryChain(text) {
  const marks = [];
  let depth = 0, quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === "\\") { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (depth === 0 && c === "?" && text[i + 1] !== ".") marks.push(i);
    else if (depth === 0 && c === ":") marks.push(i);
  }
  if (!marks.length || marks.length % 2 !== 0) return null; // malformed, or not a chain at all: never guessed
  const segs = [];
  let prev = 0;
  for (const i of marks) { segs.push(text.slice(prev, i).trim()); prev = i + 1; }
  segs.push(text.slice(prev).trim());
  return segs;
}
function parseTernaryCases(text, discriminant) {
  const segs = splitTernaryChain(text);
  if (!segs || segs.length < 3) return null;
  const cases = [];
  for (let i = 0; i + 1 < segs.length - 1; i += 2) {
    const eq = segs[i].match(new RegExp(`${escapeRe(discriminant)}\\s*===?\\s*(.+)$`));
    const literal = eq ? stripQuotes(eq[1]) : null;
    cases.push({ match: literal ?? segs[i], branch: stripQuotes(segs[i + 1]), verdict: literal != null ? "fit" : "gap" });
  }
  return { cases, default: stripQuotes(segs[segs.length - 1]) };
}
// Top-level comma split (brace/quote aware, same scanner shape as splitTernaryChain) -- for a `{ k: v, ... }` body.
function splitTopLevel(text, sep) {
  const out = [];
  let depth = 0, quote = null, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === "\\") { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (depth === 0 && c === sep) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}
// `const LOOKUP = { "pending": <Badge .../>, ... }` -- the object's own literal declaration in the page source,
// found and brace-matched directly (no AST here, same deterministic-text-match level state.mjs's own detection
// already uses for this page). Returns null when there is no such literal to parse -- never guessed (spec §4c).
export function parseLookupObject(source, varName) {
  const m = source.match(new RegExp(`\\bconst\\s+${escapeRe(varName)}\\s*=\\s*\\{`));
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0, end = -1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  const cases = [];
  for (const entry of splitTopLevel(source.slice(start + 1, end), ",")) {
    const kv = entry.match(/^(?:"([^"]+)"|'([^']+)'|(\w+))\s*:\s*([\s\S]+)$/);
    if (!kv) continue;
    cases.push({ match: kv[1] ?? kv[2] ?? kv[3], branch: stripQuotes(kv[4]), verdict: "fit" });
  }
  return cases.length ? { cases, default: null } : null;
}
function buildSwitchBody(st, part) {
  const inv = buildInventory(st.source, { file: st.spec.page });
  const condText = part.exprCondition ?? "";
  const discriminant = { raw: condText, ...verdictFor(fieldScores(st, "value", condText)) };
  let node = null;
  for (const n of inv.nodes) {
    if (n.kind !== "text" || n.textKind !== "expression") continue;
    if ("s" + sha1(`${st.spec.page}|switch|${n.id}`).slice(0, 8) === part.id) { node = n; break; }
  }
  if (!node) return { discriminant, cases: [], default: null };
  const text = node.text.trim();
  const lookup = text.match(/^([A-Za-z_$][\w$]*)\s*\[/);
  const parsed = (lookup ? parseLookupObject(st.source, lookup[1]) : null) ?? parseTernaryCases(text, condText);
  return parsed ? { discriminant, ...parsed } : { discriminant, cases: [], default: null };
}

function buildExprKindForm(st, id, part) {
  const applied = st.answers[id]?.exprKind === part.exprKind;
  const body = part.exprKind === "list" ? buildListBody(st, part) : part.exprKind === "ternary" ? buildTernaryBody(st, part) : part.exprKind === "switch" ? buildSwitchBody(st, part) : null;
  const opt = { id: `exprKind.${part.exprKind}`, group: "exprKind", label: EXPR_KIND_LABEL[part.exprKind] ?? "Make it managed", ruleDefault: true, current: applied, exprBody: body, value: { exprKind: part.exprKind, ...(body ?? {}) } };
  // The rail's "Bind this condition" bind rides on top of this option's own value as an extra `bind` property
  // (inspect.mjs's resolveChoice merges it in at apply time) -- surfaced here read-only so callers (inspectPart,
  // /api/parts, /api/part) can show a part's persisted bind without reconstructing it.
  const boundTo = st.answers[id]?.bind ?? null;
  return { id, form: `exprkind-${part.exprKind}`, title: "How is this part built?", scope: "exprkind", options: [opt], applicable: true, current: applied ? opt.value : null, boundTo };
}

export function buildForm(st, id) {
  const part = st.parts.find((p) => p.id === id);
  const sc = scopeOf(st, id);
  if (!part || !sc) return null;
  if (sc.scope === "exprkind") return buildExprKindForm(st, id, part);
  const kind = part.kind;
  let formId = kind ? formFor(kind, part.item) : sc.scope === "sort" ? "which-sort" : sc.scope === "action" ? "which-endpoint" : ["form", "gap"].includes(sc.scope) ? "info" : "confirm-or-pick";
  if (sc.scope === "sort") formId = "which-sort";
  else if (sc.scope === "action") formId = "which-endpoint";
  // A "text" part (T14) only ever gets a form from its kind (unclassified/ambiguous -> data-or-copy); anything
  // else about it is still closed outside this screen, same as a real "form"/"gap" id.
  else if (["form", "gap"].includes(sc.scope) || (sc.scope === "text" && formId !== "data-or-copy")) formId = "info";
  else if (sc.scope === "value" && formId === "which-field") formId = "pick-recipe";
  const form = FORMS[formId];
  const cur = currentValue(st, sc, id);
  const out = { id, form: formId, title: form.title, scope: sc.scope, options: [], applicable: formId !== "info", current: cur };
  // data-or-copy answers a fixed two-choice question, not the groups a matcher-backed part builds from its own
  // question object (FORMS["data-or-copy"].groups is deliberately empty, ui/issues.mjs) — this id may have no
  // entry in st.qAll at all (a pagemap text node is not one of the matcher's own questions).
  if (formId === "data-or-copy") {
    const choices = [
      { id: "data", label: "Data from the API", value: { classified: "data" } },
      { id: "copy", label: "Fixed copy", value: { classified: "copy" } },
    ];
    out.options = choices.map((o) => ({ ruleDefault: false, group: "classify", ...o, current: cur != null && same(o.value, cur) }));
    return out;
  }
  const q = st.qAll.find((x) => x.id === id) ?? null;
  if (!q || formId === "info") return out;

  const opts = [];
  const push = (o) => opts.push({ ruleDefault: false, current: false, ...o });
  for (const g of form.groups) {
    if (g === "candidates") {
      q.options.filter((o) => !o.custom && !o.value?.todo && !o.value?.static)
        .sort((a, b) => (a.value.cost ?? 0) - (b.value.cost ?? 0) || cmp(a.label, b.label))
        .forEach((o, i) => push({ id: `pick:${i}`, group: g, label: optionLabel(o.value), detail: o.label, value: o.value }));
    } else if (g === "sorts") {
      [...q.options].sort((a, b) => cmp(a.value.label, b.value.label)).forEach((o, i) => push({ id: `sort:${i}`, group: g, label: o.value.label[0].toUpperCase() + o.value.label.slice(1), value: o.value }));
      if (!q.options.length) push({ id: "sort:none", group: g, label: "Keep the API order", value: { field: null, dir: "none", label: "keep the API order" } });
    } else if (g === "kinds") {
      q.options.filter((o) => !o.custom).forEach((o) => push({ id: `kind:${o.value}`, group: g, label: o.label[0].toUpperCase() + o.label.slice(1), value: o.value }));
    } else if (g === "gap") {
      push({ id: "gap", group: g, label: "Not in the API yet, leave it as a Gap", value: { todo: true } });
    } else if (g === "static") {
      push({ id: "static", group: g, label: "Just fixed text, not data", value: { static: true } });
    } else if (g === "stub" || g === "handler") {
      const builder = q.options.find((o) => o.custom)?.custom;
      if (!builder) continue;
      const sources = g === "handler" ? ["handler"] : sc.scope === "value" ? ["fields", "controller", "api"] : ["fields", "controller"];
      const LABEL = { fields: "Combine API fields (a Stub)", controller: "The app supplies it (a Stub)", api: "A new endpoint that doesn't exist yet (a Stub)", handler: "Something else, name my own handler (a Stub)" };
      // T12.4: customOption()'s row/value placeholder builder is now one joint question with its own
      // `defaultName` map for every source, not a sequential `steps` chain; customActionOption's single-step
      // "handler" builder (actions) is unchanged, so its `steps` path still applies.
      const jointDefaults = builder.joint ? builder.joint().defaultName : null;
      for (const from of sources) {
        const fn = jointDefaults ? jointDefaults[from] : builder.steps[builder.steps.length - 1]({ from: { value: from } }).default;
        push({ id: `stub:${from}`, group: "stub", label: LABEL[from], stub: { from, fn, fields: from === "fields" ? rankedFields(st, sc, sc.name) : [], expression: from === "fields" } });
      }
    }
  }
  if (opts.length) opts[0].ruleDefault = true;
  for (const o of opts) {
    if (o.stub) o.current = !!cur?.custom && cur.from === o.stub.from;
    else o.current = cur != null && same(o.value, cur);
  }
  out.options = opts;
  out.builder = q.options.find((o) => o.custom)?.custom ? true : false;
  return out;
}

// ---------- what an option produces, against what the design shows ----------
const rowsOf = (st, sc) => {
  const items = flatItems(st.fresh.endpoints), raw = listItems(st.fresh.endpoints), idx = st.fresh.list?.alignedIdx ?? [];
  return sc.f.examples.map((design, i) => ({ design, item: items[idx[i]], raw: raw[idx[i]] }));
};

// Cases an expression is checked on: the same the AI's drafting uses (src/ai/index.mjs draft()).
export function expressionCases(st, sc) {
  if (sc.scope === "row") return rowsOf(st, sc).map((r) => ({ scope: { item: r.raw ?? {} }, want: r.design }));
  if (sc.scope === "value") return [{ scope: { items: listItems(st.fresh.endpoints), data: envelopeOf(st.fresh.endpoints) ?? {} }, want: sc.v.example }];
  return [];
}
export function runExpression(st, sc, expr) {
  const rows = [];
  for (const c of expressionCases(st, sc)) {
    let got, error = null;
    try { got = String(evalExpression(expr, c.scope)); } catch (e) { error = e.message; }
    rows.push({ design: String(c.want), produced: error ? null : got, match: !error && normalize(got) === normalize(c.want), error });
  }
  return { rows, verified: rows.length > 0 && rows.every((r) => r.match) };
}

export function proofOf(st, sc, value, opt = null) {
  const mk = (rows, verdict, note) => ({ rows, verdict, note, matched: rows.filter((r) => r.match).length, total: rows.length });
  if (sc.scope === "row" || sc.scope === "value") {
    const items = flatItems(st.fresh.endpoints), env = envScalars(st.fresh.endpoints);
    const cases = sc.scope === "row" ? rowsOf(st, sc).map((r) => ({ design: r.design, item: r.item })) : [{ design: sc.v.example }];
    const rowsFor = (produce) => cases.map((c) => { const p = produce(c); return { design: String(c.design), produced: p == null ? null : String(p), match: p != null && normalize(p) === normalize(c.design) }; });
    if (!value || value.todo) return mk(rowsFor(() => null), "nothing", "Shows nothing until the API has it.");
    if (value.static) return mk(rowsFor((c) => c.design).map((r) => ({ ...r, match: true })), "fixed", "The same words every time. It will not follow the data.");
    if (value.custom) {
      if (value.from === "fields" && value.body) {
        const r = runExpression(st, sc, value.body);
        return mk(r.rows, r.verified ? "reproduces" : "differs", r.verified ? "The expression reproduces the design on every example." : "The expression does not reproduce the design yet.");
      }
      if (value.from === "fields") {
        const raw = listItems(st.fresh.endpoints), idx = st.fresh.list?.alignedIdx ?? [];
        const rows = sc.scope === "row" ? cases.map((c, i) => { const p = value.inputs.map((k) => getPath(raw[idx[i]], k)).join(" "); return { design: String(c.design), produced: p, match: normalize(p) === normalize(c.design) }; }) : rowsFor((c) => c.design).map((r) => ({ ...r, match: null }));
        return mk(rows, "unproven", "A starting point only: the Stub returns what its inputs give until someone writes the real logic.");
      }
      return mk(rowsFor(() => null).map((r) => ({ ...r, match: null })), "unproven", value.from === "api" ? "A new endpoint will supply it. Nothing to check yet." : "The app will supply it. Nothing to check yet.");
    }
    const produce = (c) => {
      try {
        if (sc.scope === "row") return fmt(value.formatter, c.item?.[value.field]);
        if (value.agg === "field") return fmt(value.formatter, env[value.field]);
        return fmt(value.formatter, AGGREGATES.find((a) => a.name === value.agg).fn(items, value.field));
      } catch { return null; }
    };
    const r = mk(rowsFor(produce), null, null);
    r.verdict = r.total && r.matched === r.total ? "reproduces" : "differs";
    r.note = r.verdict === "reproduces" ? `Reproduces the design on ${r.total} of ${r.total} example${r.total === 1 ? "" : "s"}.` : `Matches ${r.matched} of ${r.total} examples.`;
    return r;
  }
  if (sc.scope === "sort") {
    const key = st.fresh.list?.alignedBy, items = flatItems(st.fresh.endpoints);
    const dyn = st.fresh.list?.fields.find((f) => f.name === key?.dyn);
    if (!key || !dyn) return mk([], "unproven", "The rows could not be lined up with the API, so the order cannot be checked.");
    const n = dyn.examples.length, natural = items.map((_, i) => i);
    const order = !value?.field ? natural : [...natural].sort((a, b) => {
      const x = items[a][value.field], y = items[b][value.field];
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return value.dir === "asc" ? c : -c;
    });
    const rows = dyn.examples.map((design, i) => ({ design: String(design), produced: String(items[order[i]]?.[key.field] ?? ""), match: normalize(items[order[i]]?.[key.field]) === normalize(design) }));
    const r = mk(rows, null, null);
    r.verdict = r.matched === n ? "reproduces" : "differs";
    r.note = r.verdict === "reproduces" ? `The first ${n} rows come out in the designed order.` : "This order differs from the design.";
    return r;
  }
  if (sc.scope === "action") {
    const kind = typeof value === "string" ? value : value?.custom ? "custom" : null;
    return mk([], "behaviour", kind === "custom" ? `A handler called ${value.fn}() that you write.` : kind ? `The button will ${ACTION_KINDS[kind] ?? kind}.` : "Nothing is wired yet.");
  }
  if (sc.scope === "text") return mk([], "behaviour", value?.classified === "data" ? "Marked as data from the API." : value?.classified === "copy" ? "Marked as fixed copy." : "Not decided yet.");
  return mk([], "unproven", "");
}

// Where in the API an option reads from: the endpoint, the path in the response and a small sample of the real response.
export function apiSourceOf(st, sc, value) {
  if (sc.scope === "text") return null; // a data-or-copy choice ("Data" / "Fixed copy") names no one API field
  if (sc.scope === "exprkind") return null; // the condition names no one API field (yet) -- it is bound separately, §5 of the spec
  const e = st.fresh.endpoints, key = e.listKey ?? "";
  const endpoint = e.list ? `${e.list.method} ${e.list.path}${key ? ` → ${key}[]` : ""}` : null;
  const pathOf = (f) => (String(f).startsWith("data.") ? String(f).slice(5) : `${key}[]${key ? "." : "."}${f}`.replace(/^\[\]\./, "[]."));
  const raw = listItems(e), envelope = envelopeOf(e) ?? {};
  const snippet = (o) => JSON.stringify(o, null, 2).split("\n").slice(0, 14).join("\n");
  const pickFields = (fields) => raw.slice(0, 2).map((it) => Object.fromEntries(fields.map((f) => [f, getPath(it, f)])));
  if (sc.scope === "action") {
    const kind = typeof value === "string" ? value : null;
    const eps = { create: [e.create], update: [e.update], save: [e.create, e.update], remove: [e.remove], reload: [e.list] }[kind] ?? [];
    const list = eps.filter(Boolean);
    if (!list.length) return null;
    return { endpoint: list.map((x) => `${x.method} ${x.path}`).join(", "), path: "the request and response of that call", sample: snippet(list[0].request ?? list[0].response ?? {}) };
  }
  if (!value || value.todo || value.static || value.skipped) return null;
  if (sc.scope === "sort") return value.field ? { endpoint, path: pathOf(value.field), sample: snippet(pickFields([value.field])) } : { endpoint, path: key ? `${key}[]` : "the list as it comes", sample: "" };
  if (value.custom) {
    if (value.from !== "fields" || !value.inputs?.length) return null;
    const dataIn = value.inputs.filter((f) => f.startsWith("data.")), rowIn = value.inputs.filter((f) => !f.startsWith("data."));
    return { endpoint, path: value.inputs.map(pathOf).join(", "), sample: snippet({ ...(rowIn.length ? { [key || "items"]: pickFields(rowIn) } : {}), ...Object.fromEntries(dataIn.map((f) => [f, getPath(envelope, f.slice(5))])) }) };
  }
  if (sc.scope === "value" && value.agg === "field") return { endpoint, path: pathOf("data." + value.field), sample: snippet({ [value.field]: getPath(envelope, value.field) }) };
  if (sc.scope === "value" && value.agg === "count") return { endpoint, path: key ? `${key}[]` : "the list", sample: `${raw.length} items in the response` };
  const field = value.field;
  return { endpoint, path: sc.scope === "value" ? `${pathOf(field)} (${value.agg} of the list)` : pathOf(field), sample: snippet(pickFields([field])) };
}

// A stub option's answer, built by the same builder the terminal questions use, so it is a valid answer or an error.
export function buildStubValue(st, id, form, choice) {
  const opt = form.options.find((o) => o.id === choice.option && o.stub);
  const q = st.qAll.find((x) => x.id === id);
  const builder = q?.options.find((o) => o.custom)?.custom;
  if (!opt || !builder) return { error: "That option is not available for this part." };
  const { from } = opt.stub;
  const inputs = (choice.inputs ?? []).map(String);
  if (from === "fields" && !inputs.length) return { error: "Pick at least one API field for the Stub." };
  if (from !== "fields" && inputs.length) return { error: "Only a Stub built from fields takes inputs." };
  const value = builder.build({ from: { value: from }, inputs: inputs.map((v) => ({ value: v })), fn: String(choice.fn ?? opt.stub.fn) });
  if (!(q.validCustom?.(value) ?? true)) return { error: "One of the chosen fields is not in the API response." };
  return { value, opt };
}

export const describeAnswer = (v) => (v == null ? "no answer" : v.custom ? describeCustom(v) : v.todo ? "not in the API yet" : v.static ? "fixed text" : typeof v === "string" ? ACTION_KINDS[v] ?? v : v.label ?? (v.agg ? describeValue(v) : describeField(v)));
