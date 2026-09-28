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
  if (id === "list.sort") return m.list ? { scope: "sort", list: m.list, name: "row order" } : null;
  if (id.startsWith("list.")) { const f = m.list?.fields.find((x) => `list.${x.name}` === id); return f ? { scope: "row", f, name: f.name } : null; }
  if (id.startsWith("value.")) { const v = m.values.find((x) => `value.${x.name}` === id); return v ? { scope: "value", v, name: v.name } : null; }
  if (id.startsWith("action.")) {
    const [, where, ...rest] = id.split("."), name = rest.join(".");
    const a = [...(m.list?.actions ?? []), ...m.actions].find((x) => x.scope === where && x.name === name);
    return a ? { scope: "action", a, name, where } : null;
  }
  return { scope: id.startsWith("form.") ? "form" : "gap", name: id };
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

export function buildForm(st, id) {
  const part = st.parts.find((p) => p.id === id);
  const sc = scopeOf(st, id);
  if (!part || !sc) return null;
  const kind = part.kind;
  let formId = kind ? formFor(kind, part.item) : sc.scope === "sort" ? "which-sort" : sc.scope === "action" ? "which-endpoint" : ["form", "gap"].includes(sc.scope) ? "info" : "confirm-or-pick";
  if (sc.scope === "sort") formId = "which-sort";
  else if (sc.scope === "action") formId = "which-endpoint";
  else if (["form", "gap"].includes(sc.scope)) formId = "info";
  else if (sc.scope === "value" && formId === "which-field") formId = "pick-recipe";
  const form = FORMS[formId];
  const q = st.qAll.find((x) => x.id === id) ?? null;
  const cur = currentValue(st, sc, id);
  const out = { id, form: formId, title: form.title, scope: sc.scope, options: [], applicable: formId !== "info", current: cur };
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
  return mk([], "unproven", "");
}

// Where in the API an option reads from: the endpoint, the path in the response and a small sample of the real response.
export function apiSourceOf(st, sc, value) {
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
