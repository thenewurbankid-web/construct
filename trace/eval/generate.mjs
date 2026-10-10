// Seeded synthetic cases. `generateCase({ name, seed, params })` builds a whole screen (page.jsx, the API contract,
// an optional story) AND its ground truth from nothing but the seed: no Math.random, no clock. Same seed, same case.
//
// Ground truth is never hand-labelled here. A builder states what each part is MEANT to show (a field with a
// formatter, an aggregate, or "no source"); the kind is then derived with the independent reference explainers
// (reference.mjs): if exactly one cheapest wiring reproduces the design the part is `match`; if several do it is
// `needs-answer` (a tie the data cannot settle); if none does it is `gap`, and if something does anyway it is a
// `coincidence`. A builder that promised one thing and got another is rejected and re-drawn with the next attempt,
// so a committed case can never carry a label the reference does not agree with.
import { rngTools } from "./util.mjs";
import { applyFmt, applyAgg, explainColumn, explainValue, explainSort } from "./reference.mjs";

const PEOPLE = ["Lena", "Arjun", "Mia", "Prerna", "Ravi", "Sofia", "Kenji", "Amara", "Tomas", "Ines", "Noor", "Felix"];
const NAMES = ["Kestrel Packaging", "Oriel Chemicals", "Northwind Freight", "Bluepeak IT", "Harbor Logistics", "Cedar Textiles", "Delta Robotics", "Ember Foods", "Fjord Marine", "Granite Works", "Helix Bio", "Iris Optics", "Juniper Labs", "Keystone Steel", "Lumen Energy", "Maple Dairy", "Nimbus Cloud", "Orchid Pharma", "Pioneer Rail", "Quartz Media", "Rivet Tools", "Sable Apparel", "Tundra Cold", "Umber Paints"];
const THEMES = ["invoices", "projects", "vendors", "shipments", "accounts", "campaigns", "tickets", "contracts", "assets", "orders"];
const STATUS = ["Open", "Overdue", "Partial", "Paid", "Draft", "Blocked"];
const FIELD_POOLS = {
  person: ["lead", "deputy", "owner", "requester", "assignee", "reviewer", "manager", "approver"],
  money: ["amount", "budget", "forecast", "spend", "revenue", "cost", "total", "balance"],
  pct: ["margin", "conversion", "share", "progress", "utilization"],
  date: ["dueDate", "createdOn", "closeOn", "placedOn", "shipDate"],
  count: ["stock", "seats", "headcount", "openTasks"],
};
const FMT_FOR = { money: ["moneyCompact", "moneyFull"], pct: ["percent", "percentWhole"], date: ["dateShort"], count: ["asText"] };

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const human = (f) => cap(f.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase());
const fieldWords = (f) => f.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

// Thrown by a builder or by finalize() when the draw did not turn out as promised; generateCase() re-draws.
class Reject extends Error {}

// ---------------------------------------------------------------------------------------------------------------
// A screen under construction
// ---------------------------------------------------------------------------------------------------------------
class Screen {
  constructor(rng, { n = 7, rows = 4, feature }) {
    this.rng = rng;
    this.feature = feature ?? rng.pick(THEMES);
    this.items = Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
    this.k = Math.min(rows, n); // rows shown in the design
    this.order = this.items.map((_, i) => i); // item index shown in each designed row
    this.cols = [];
    this.vals = [];
    this.sortIntent = null;
    this.sortExpect = "unique";
    this.story = [];
    this.used = new Set(["id"]);
    this.personFields = [];
    this.moneyBands = 0;
    this.api = { list: true, create: true, update: true, remove: true, extras: [], decoyFirst: false };
    this.envelope = null; // { listKey, meta } when the list sits inside an object response
    this.actions = { rowEdit: true, rowDelete: true, save: true, cancel: true, extra: [] };
    this.actionTruth = {};
    this.endpointTruth = null;
    this.about = null;
  }
  count() { return this.items.length; }

  claim(name) {
    if (this.used.has(name)) throw new Reject(`field ${name} already used`);
    this.used.add(name);
    return name;
  }
  fieldName(type) {
    const free = FIELD_POOLS[type].filter((f) => !this.used.has(f));
    if (!free.length) throw new Reject(`out of ${type} names`);
    return this.claim(this.rng.pick(free));
  }

  // ---- fields. Values are drawn distinct (money in its own band per field) so accidental ties are rare;
  // whatever slips through is caught by the reference check in finalize().
  addKey(name = "name") {
    const names = this.rng.sample(NAMES, this.count());
    this.items.forEach((it, i) => (it[name] = names[i]));
    this.claim(name);
    this.keyField = name;
    return name;
  }
  addPerson(name = null, { same = null } = {}) {
    name = name ? this.claim(name) : this.fieldName("person");
    if (same) this.items.forEach((it) => (it[name] = it[same]));
    else {
      this.items.forEach((it) => {
        const taken = new Set(this.personFields.map((f) => it[f]));
        it[name] = this.rng.pick(PEOPLE.filter((p) => !taken.has(p)));
      });
      this.personFields.push(name);
    }
    return name;
  }
  addMoney(name = null, { same = null } = {}) {
    name = name ? this.claim(name) : this.fieldName("money");
    if (same) { this.items.forEach((it) => (it[name] = it[same])); return name; }
    const lo = this.moneyBands++ * 1e7 + 1e6;
    const vals = new Set();
    while (vals.size < this.count()) vals.add(this.rng.int(0, 80) * 1e5 + lo + this.rng.int(0, 9) * 1e4);
    [...vals].forEach((v, i) => (this.items[i][name] = v));
    return name;
  }
  addPct(name = null) {
    name = name ? this.claim(name) : this.fieldName("pct");
    const vals = new Set();
    while (vals.size < this.count()) vals.add(this.rng.int(11, 989) / 1000);
    [...vals].forEach((v, i) => (this.items[i][name] = v));
    return name;
  }
  addDate(name = null) {
    name = name ? this.claim(name) : this.fieldName("date");
    const days = new Set();
    while (days.size < this.count()) days.add(this.rng.int(0, 330));
    [...days].forEach((d, i) => {
      this.items[i][name] = `2026-${String(1 + Math.floor(d / 28)).padStart(2, "0")}-${String(1 + (d % 28)).padStart(2, "0")}`;
    });
    return name;
  }
  addCount(name = null) {
    name = name ? this.claim(name) : this.fieldName("count");
    const band = this.rng.int(1, 6) * 40; // 40..280 plus noise: never equals the row count
    const vals = new Set();
    while (vals.size < this.count()) vals.add(band + this.rng.int(0, 30));
    [...vals].forEach((v, i) => (this.items[i][name] = v));
    return name;
  }
  addStatus(name = "status") {
    this.claim(name);
    this.items.forEach((it) => (it[name] = this.rng.pick(STATUS)));
    return name;
  }
  setValues(name, values) {
    this.claim(name);
    this.items.forEach((it, i) => (it[name] = values[i]));
    return name;
  }

  sortBy(field, dir) {
    this.order = this.items.map((_, i) => i).sort((a, b) => (dir === "asc" ? 1 : -1) * (this.items[a][field] - this.items[b][field]));
    this.sortIntent = `s:${field}:${dir}`;
  }

  // ---- parts. `expect` is what the builder promises:
  //   "match"     the data settles it        "tie"       the data cannot settle it
  //   "gap"       nothing explains it        "spurious"  no real source, but exactly one wrong wiring reproduces it
  column({ dyn, header, field = null, fmt = "asText", gap = null, text = null, expect = "match", couple = null, note = null, noise = null }) {
    dyn ??= field;
    this.cols.push({ dyn, header: header ?? human(dyn), field, fmt, gap, text, expect, couple, note, noise });
  }
  value({ dyn, label = null, agg = null, field = null, fmt = "asText", env = null, gap = null, text = null, expect = "match", couple = null, note = null }) {
    this.vals.push({ dyn, label: label ?? human(dyn), agg, field, fmt, env, gap, text, expect, couple, note });
  }
  sentence(s) { this.story.push(s); }
}

// ---------------------------------------------------------------------------------------------------------------
// Rendering: the design page, the contract, the truth
// ---------------------------------------------------------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, "and").replace(/[<>{}]/g, "");

// How a designer's text can differ from the library's output. Whitespace is normalised by Trace (supported); the
// rest is outside its closed library, so the truth for those parts is a `u:` wiring Trace cannot express.
const NOISE = {
  ws: { supported: true, fn: (t) => `  ${t}  \n  ` },
  upper: { supported: false, fn: (t) => String(t).toUpperCase() },
  lower: { supported: false, fn: (t) => String(t).toLowerCase() },
  hash: { supported: false, fn: (t) => `#${t}` },
  locale: { supported: false, fn: (t) => String(t).replace(/^\$/, "").replace(/,/g, " ").replace(/\./g, ",") + " €" },
  spaced: { supported: false, fn: (t) => String(t).replace(/^\$/, "$ ") },
};

const colText = (S, c, item) => (c.text ? c.text(item, S) : c.noise ? NOISE[c.noise].fn(applyFmt(c.fmt, item[c.field])) : applyFmt(c.fmt, item[c.field]));
const valText = (S, v) => (v.text ? v.text(S) : v.env ? applyFmt(v.fmt, v.env.value) : applyFmt(v.fmt, applyAgg(v.agg, S.items, v.field)));

function flatEnv(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatEnv(v, key, out);
    else if (!Array.isArray(v)) out[key] = v;
  }
  return out;
}

function finalize(S, { verify = true } = {}) {
  const truth = {};
  const shown = S.order.slice(0, S.k).map((i) => S.items[i]);
  const noData = !S.api.list; // the contract has no list endpoint: nothing can be wired to data
  const envScalars = S.envelope ? flatEnv(S.envelope.meta) : {};

  // Derives the kind from what the reference finds, and rejects a draw that is not what the builder promised.
  const classify = (id, want, E, expect, part) => {
    let kind, coincidence = false;
    if (want.startsWith("gap:")) {
      kind = "gap";
      coincidence = E.length > 0;
      if (verify && expect === "gap" && E.length) throw new Reject(`${id}: a gap was explained by chance ${E}`);
      if (verify && expect === "spurious" && E.length !== 1) throw new Reject(`${id}: wanted exactly one spurious explanation, got ${E.length}`);
    } else if (want.startsWith("u:")) {
      kind = "match";
      if (verify && E.length) throw new Reject(`${id}: an outside-library part was explained anyway ${E}`);
    } else if (!verify) {
      kind = "match";
    } else {
      if (!E.includes(want)) throw new Reject(`${id}: intended ${want} is not reproduced (${E})`);
      kind = E.length === 1 ? "match" : "needs-answer";
      coincidence = E.length > 1;
      if (expect === "match" && kind !== "match") throw new Reject(`${id}: wanted a unique match, got ${E}`);
      if (expect === "tie" && kind !== "needs-answer") throw new Reject(`${id}: wanted a tie, got ${E}`);
    }
    const t = { kind, want, label: "reference" };
    if (want === "gap:?") Object.assign(t, { want: "gap:todo", also: ["gap:custom", "gap:static"], resolutionUnknown: true });
    if (coincidence) t.coincidence = true;
    if (part.couple) t.couple = part.couple;
    if (part.note) t.why = part.note;
    truth[id] = t;
  };
  const wantGap = (g) => (g === "?" ? "gap:?" : `gap:${g}`);

  const cols = S.cols.map((c) => ({ ...c, texts: shown.map((it) => colText(S, c, it)) }));
  for (const c of cols) {
    let want;
    if (noData) want = "gap:?";
    else if (c.gap) want = wantGap(c.gap);
    else if (c.noise && !NOISE[c.noise].supported) want = `u:${c.field}|${c.noise}`;
    else want = `f:${c.field}|${c.fmt}`;
    classify(`list.${c.dyn}`, want, verify && !noData ? explainColumn(shown, c.texts) : [], noData ? "gap" : c.expect, c);
  }
  const vals = S.vals.map((v) => ({ ...v, textv: valText(S, v) }));
  for (const v of vals) {
    let want;
    if (noData) want = "gap:?";
    else if (v.gap) want = wantGap(v.gap);
    else if (v.env) want = `e:${v.env.path}|${v.fmt}`;
    else want = `a:${v.agg}(${v.field ?? ""})|${v.fmt}`;
    classify(`value.${v.dyn}`, want, verify && !noData ? explainValue(S.items, envScalars, v.textv) : [], noData ? "gap" : v.expect, v);
  }
  if (S.cols.length) {
    const E = explainSort(S.items, S.order.slice(0, S.k));
    const want = S.sortIntent ?? "s:none";
    if (noData) truth["list.sort"] = { uncertain: "no list endpoint: the row order cannot be judged", label: "reference" };
    else {
      if (verify && !E.includes(want)) throw new Reject(`sort: intended ${want}, explained by ${E}`);
      if (verify && S.sortExpect === "tie" && E.length < 2) throw new Reject("sort: wanted a tie");
      if (verify && S.sortExpect === "unique" && E.length > 1) throw new Reject(`sort: unexpected tie ${E}`);
      truth["list.sort"] = { label: "reference", kind: !verify || E.length === 1 ? "match" : "needs-answer", want, ...(verify && E.length > 1 ? { coincidence: true } : {}) };
    }
  }
  // actions: Trace maps the verb, and a verb whose endpoint is missing becomes a question
  const act = (id, kind, needs, override) => {
    truth[id] = { label: "reference", ...(override ?? (needs && !S.api[needs] ? { kind: "gap", want: "gap:custom" } : { kind: "match", want: `x:${kind}` })) };
  };
  if (S.actions.rowEdit) act("action.row.edit", "select", null);
  if (S.actions.rowDelete) act("action.row.delete", "remove", "remove", S.actionTruth.delete);
  if (S.actions.save) act("action.page.save", "save", null, S.actionTruth.save);
  if (S.actions.cancel) act("action.page.cancel", "clear", null);
  for (const a of S.actions.extra) truth[`action.${a.scope}.${a.verb}`] = { label: "reference", kind: "gap", want: "gap:custom", why: "a verb Trace does not know: a handler of our own" };
  if (S.endpointTruth) truth["endpoint.list"] = { label: "reference", kind: "match", want: S.endpointTruth };
  return { truth, cols, vals, shown };
}

const formFieldNames = (S, cols) => [...new Set([S.keyField, ...cols.filter((c) => c.field && !c.gap && !c.noise).map((c) => c.field)].filter(Boolean))].slice(0, 3);

function renderPage(S, cols, vals, shown) {
  const formFields = formFieldNames(S, cols);
  const rowsJsx = shown.map((_, r) => {
    const tds = cols.map((c) => `            <td data-dyn="${c.dyn}">${esc(c.texts[r])}</td>`);
    const acts = [
      S.actions.rowEdit ? `              <button data-action="edit">Edit</button>` : "",
      S.actions.rowDelete ? `              <button data-action="delete" className="danger">Delete</button>` : "",
      ...S.actions.extra.filter((a) => a.scope === "row").map((a) => `              <button data-action="${a.verb}">${cap(a.verb)}</button>`),
    ].filter(Boolean);
    return `          <tr>\n${tds.join("\n")}\n            <td className="actions">\n${acts.join("\n")}\n            </td>\n          </tr>`;
  });
  const meta = vals.map((v) => `          {" ${esc(v.label)} "}<span data-dyn="${v.dyn}">${esc(v.textv)}</span>`);
  const form = S.actions.save
    ? `      <form className="card form" data-action="save">\n${formFields.map((f) => `        <input name="${f}" placeholder="${human(f)}" required />`).join("\n")}\n        <button type="submit" className="primary">Save</button>\n${S.actions.cancel ? `        <button type="button" data-action="cancel">Cancel</button>\n` : ""}      </form>\n`
    : "";
  const pageActs = S.actions.extra.filter((a) => a.scope === "page").map((a) => `      <button data-action="${a.verb}">${cap(a.verb)}</button>\n`).join("");
  const table = cols.length
    ? `      <table className="card table">
        <thead>
          <tr>
${cols.map((c) => `            <th>${esc(c.header)}</th>`).join("\n")}
            <th></th>
          </tr>
        </thead>
        <tbody data-list="${S.feature}">
${rowsJsx.join("\n")}
        </tbody>
      </table>
`
    : "";
  return `// Generated by eval/generate.mjs (${S.feature}). Do not edit: change the seed or the generator.
export default function DesignedPage() {
  return (
    <main className="page">
      <header className="header">
        <h1>${cap(S.feature)}</h1>
        <p className="meta">
${meta.join("\n")}
        </p>
      </header>
${form}${pageActs}${table}    </main>
  );
}
`;
}

function renderContract(S, cols) {
  const base = `/api/${S.feature}`;
  const listBody = S.envelope ? { ...S.envelope.meta, [S.envelope.listKey]: S.items } : S.items;
  const formKeys = formFieldNames(S, cols);
  const reqBody = Object.fromEntries(formKeys.map((f) => [f, typeof S.items[0][f] === "number" ? 1 : "new"]));
  const listApi = { method: "GET", path: base, response: listBody };
  const extras = S.api.extras.map((e) => ({ method: "GET", path: e.path, response: e.response }));
  const apis = S.api.list ? (S.api.decoyFirst ? [...extras, listApi] : [listApi, ...extras]) : [...extras];
  if (S.api.create) apis.push({ method: "POST", path: base, request: reqBody, response: { ...S.items[0], id: S.count() + 1 } });
  if (S.api.update) apis.push({ method: "PUT", path: `${base}/:id`, request: reqBody, response: S.items[0] });
  if (S.api.remove) apis.push({ method: "DELETE", path: `${base}/:id` });
  const spec = { feature: S.feature, route: `/${S.feature}`, page: "page.jsx", about: `generated: ${S.about ?? "synthetic"}`, apis };
  if (S.envelope) spec.list = S.envelope.listKey;
  return spec;
}

// ---------------------------------------------------------------------------------------------------------------
// Category builders. Each states what the design MEANS; finalize() works out what the data can settle.
// ---------------------------------------------------------------------------------------------------------------

// A common base: the key column, a few typed columns with formatters, and the row-count value.
function base(S, { cols = 3 } = {}) {
  S.addKey();
  S.column({ dyn: "name", header: "Name", field: "name" });
  const made = [];
  for (const t of S.rng.shuffle(["money", "pct", "date", "count", "person"]).slice(0, cols)) {
    const f = { money: () => S.addMoney(), pct: () => S.addPct(), date: () => S.addDate(), count: () => S.addCount(), person: () => S.addPerson() }[t]();
    const fmt = t === "person" ? "asText" : S.rng.pick(FMT_FOR[t]);
    S.column({ dyn: f, field: f, fmt });
    made.push({ t, f, fmt });
  }
  S.value({ dyn: "itemCount", label: "items", agg: "count" });
  return made;
}

// The first money column, adding one if the base has none.
function moneyColumn(S, made) {
  const m = made.find((x) => x.t === "money");
  if (m) return m;
  const f = S.addMoney();
  S.column({ dyn: f, field: f, fmt: "moneyCompact" });
  const r = { t: "money", f, fmt: "moneyCompact" };
  made.push(r);
  return r;
}

const BUILDERS = {
  // Everything is determined by the data: the happy path (with a response envelope half the time).
  clean(S, p) {
    const made = base(S, { cols: p.cols ?? 3 });
    const m = moneyColumn(S, made);
    if (S.rng.chance(0.5)) {
      S.value({ dyn: `total${cap(m.f)}`, label: `total ${fieldWords(m.f)}`, agg: "sum", field: m.f, fmt: "moneyCompact" });
      S.sortBy(m.f, "desc");
    }
    if (p.envelope ?? S.rng.chance(0.4)) {
      const total = S.items.reduce((s, it) => s + it[m.f], 0) + 12345;
      const refreshed = `2026-0${S.rng.int(1, 9)}-1${S.rng.int(0, 9)}T10:00:00Z`;
      S.envelope = { listKey: "records", meta: { meta: { refreshed }, summary: { grand: total } } };
      S.value({ dyn: "grandTotal", label: "grand total", env: { path: "summary.grand", value: total }, fmt: "moneyCompact" });
      S.value({ dyn: "refreshedAt", label: "refreshed", env: { path: "meta.refreshed", value: refreshed }, fmt: "dateShort" });
    }
    S.about = "clean";
  },

  // Two fields share their values in every row: the design's column can be either. The data cannot say which.
  "coincidence-shared"(S, p) {
    base(S, { cols: 2 });
    const a = S.addPerson("lead");
    const b = S.addPerson("deputy", { same: a });
    const truthField = S.rng.chance(0.5) ? a : b;
    S.column({ dyn: "owner", header: "Owner", field: truthField, expect: "tie", note: "lead and deputy are identical in every row" });
    if (p.value ?? S.rng.chance(0.5)) {
      const m1 = S.addMoney("budget");
      const m2 = S.addMoney("forecast", { same: m1 });
      S.value({ dyn: "plannedTotal", label: "planned", agg: "sum", field: S.rng.chance(0.5) ? m1 : m2, fmt: "moneyCompact", expect: "tie", note: "budget and forecast are identical in every row" });
    }
    if (p.story ?? S.rng.chance(0.5)) S.sentence(`Owner is the project ${truthField}.`);
    S.about = "coincidence-shared";
  },

  // The design shows something the API cannot produce, but an unrelated field or aggregate gives the same text.
  "coincidence-spurious"(S, p) {
    const made = base(S, { cols: 2 });
    for (const kind of S.rng.sample(["rank", "count", "max"], p.parts ?? S.rng.int(1, 3))) {
      if (kind === "rank") {
        // a "#" column showing 1..k in order; `id` is 1..n in the same order
        S.column({ dyn: "rank", header: "#", gap: "custom", text: (it, s) => String(s.order.indexOf(s.items.indexOf(it)) + 1), expect: "spurious", note: "the position in the table; id is 1,2,3.. by chance" });
      } else if (kind === "count") {
        S.value({ dyn: "openCount", label: "open", gap: "custom", text: (s) => String(s.count()), expect: "spurious", note: "how many are open; equals the row count by chance" });
      } else {
        const m = moneyColumn(S, made);
        S.value({ dyn: "topOpen", label: "largest open", gap: "custom", text: (s) => applyFmt("moneyCompact", applyAgg("max", s.items, m.f)), expect: "spurious", note: "the largest OPEN amount; the overall maximum is the same by chance" });
      }
    }
    S.about = "coincidence-spurious";
  },

  // The designed order fits several sorts (correlated fields).
  "ties-sort"(S, p) {
    base(S, { cols: 1 });
    S.addMoney("amount");
    S.column({ dyn: "amount", field: "amount", fmt: "moneyCompact" });
    S.addMoney("balance");
    // balance follows amount's order exactly
    const ranked = S.items.map((it, i) => [it.amount, i]).sort((x, y) => x[0] - y[0]);
    const bvals = S.items.map((it) => it.balance).sort((x, y) => x - y);
    ranked.forEach(([, i], r) => (S.items[i].balance = bvals[r]));
    S.sortBy("amount", "desc");
    S.sortExpect = "tie";
    if (p.story ?? S.rng.chance(0.5)) S.sentence("Rows are listed with the largest amount first.");
    S.about = "ties-sort";
  },

  // Aggregates that coincide: a column with a single nonzero value (sum = max), or a constant column (average = max = min).
  "ties-agg"(S, p) {
    base(S, { cols: 2 });
    const story = p.story ?? S.rng.chance(0.5);
    if ((p.mode ?? S.rng.pick(["single", "constant"])) === "single") {
      S.setValues("bonus", S.items.map((_, i) => (i === 2 ? S.rng.int(3, 90) * 100 : 0)));
      const agg = S.rng.pick(["sum", "max"]);
      S.value({ dyn: "bonusFigure", label: agg === "sum" ? "bonus total" : "largest bonus", agg, field: "bonus", fmt: "moneyCompact", expect: "tie", note: "only one row is nonzero, so sum and max agree" });
      if (story) S.sentence(agg === "sum" ? "The header shows the total bonus paid." : "The header shows the largest bonus paid.");
    } else {
      S.setValues("cap", S.items.map(() => 500000));
      const agg = S.rng.pick(["average", "max", "min"]);
      S.value({ dyn: "capFigure", label: `${agg} cap`, agg, field: "cap", fmt: "moneyCompact", expect: "tie", note: "cap is constant, so average, max and min agree" });
      if (story) S.sentence(`The header shows the ${agg} cap.`);
    }
    S.about = "ties-agg";
  },

  // k columns tied between the same k fields: answering one settles the rest.
  coupled(S, p) {
    base(S, { cols: 1 });
    const k = p.k ?? S.rng.int(2, 3);
    const first = S.addPerson();
    const fields = [first, ...Array.from({ length: k - 1 }, () => S.addPerson(null, { same: first }))];
    const order = S.rng.shuffle(fields);
    ["owner", "backup", "contact"].slice(0, k).forEach((r, i) =>
      S.column({ dyn: r, header: cap(r), field: order[i], expect: "tie", couple: "people", note: `${k} columns tied between ${k} identical fields` }));
    if (p.totals ?? S.rng.chance(0.5)) {
      const m1 = S.addMoney("budget");
      const m2 = S.addMoney("forecast", { same: m1 });
      const o = S.rng.shuffle([m1, m2]);
      S.value({ dyn: "plannedTotal", label: "planned", agg: "sum", field: o[0], fmt: "moneyCompact", expect: "tie", couple: "totals" });
      S.value({ dyn: "forecastTotal", label: "forecast", agg: "sum", field: o[1], fmt: "moneyCompact", expect: "tie", couple: "totals" });
    }
    S.about = "coupled";
  },

  // Columns and values with no source in the API.
  "missing-field"(S, p) {
    base(S, { cols: 2 });
    const res = () => p.resolution ?? S.rng.pick(["todo", "custom", "?"]);
    const pool = [
      () => S.column({ dyn: "stage", header: "Stage", gap: res(), text: (it, s) => STATUS[(s.items.indexOf(it) * 5 + 2) % STATUS.length], expect: "gap", note: "no such field in the API" }),
      () => S.column({ dyn: "region", header: "Region", gap: res(), text: (it, s) => ["EMEA", "APAC", "AMER", "LATAM"][(s.items.indexOf(it) * 3 + 1) % 4], expect: "gap", note: "no such field in the API" }),
      () => S.value({ dyn: "syncedAt", label: "synced", gap: res(), text: () => "26 Sep 2026", expect: "gap", note: "when the data was synced; not in the API" }),
      () => S.value({ dyn: "weighted", label: "weighted", gap: res(), text: () => "$137.6M", expect: "gap", note: "a weighted total; not an aggregate the library has" }),
    ];
    S.rng.sample(pool, p.parts ?? S.rng.int(1, 3)).forEach((f) => f());
    S.about = "missing-field";
  },

  // The design has actions the API cannot serve, an action verb nobody knows, or no list endpoint at all.
  "missing-endpoint"(S, p) {
    base(S, { cols: 2 });
    const mode = p.mode ?? S.rng.pick(["no-delete", "no-write", "no-list", "unknown-verb"]);
    const closes = () => (S.rng.chance(0.5) ? { kind: "gap", want: "gap:custom" } : { kind: "gap", want: "x:ignore" });
    if (mode === "no-delete") { S.api.remove = false; S.actionTruth.delete = closes(); }
    else if (mode === "no-write") { S.api.create = false; S.api.update = false; S.actionTruth.save = closes(); }
    else if (mode === "unknown-verb") S.actions.extra.push({ scope: "row", verb: "archive" });
    else { S.api.list = false; S.endpointTruth = "ep:none"; }
    S.about = `missing-endpoint:${mode}`;
  },

  // Text formats the designer typed differently from anything in the library (and whitespace, which Trace copes with).
  noisy(S, p) {
    const made = base(S, { cols: 2 });
    const kinds = p.noise ?? S.rng.sample(["ws", "case", "hash", "locale", "spaced"], S.rng.int(2, 3));
    if (kinds.includes("ws")) S.cols.find((c) => c.field === "name").noise = "ws";
    if (kinds.includes("case")) {
      S.addStatus();
      S.column({ dyn: "status", field: "status", noise: S.rng.pick(["upper", "lower"]) });
    }
    if (kinds.includes("hash")) S.column({ dyn: "ref", header: "Ref", field: "id", noise: "hash" });
    if (kinds.includes("locale") || kinds.includes("spaced")) {
      const m = moneyColumn(S, made);
      const c = S.cols.find((x) => x.field === m.f);
      c.fmt = "moneyCompact";
      c.noise = kinds.includes("locale") ? "locale" : "spaced";
    }
    S.about = "noisy";
  },

  // Near-copies of the true field: one differs in a shown row (harmless), or agrees on the shown rows only (a tie).
  "decoy-fields"(S, p) {
    base(S, { cols: 2 });
    S.addMoney("amount");
    S.column({ dyn: "amount", field: "amount", fmt: "moneyCompact", expect: p.hidden ? "tie" : "match", note: p.hidden ? "a second field agrees with amount on the shown rows only" : undefined });
    S.sortBy("amount", "desc");
    // amountPrev overtakes the top row in ONE shown row, so it differs as a column and as a sort key
    const lead = S.items[S.order[0]].amount - S.items[S.order[1]].amount;
    S.setValues("amountPrev", S.items.map((it, i) => (i === S.order[1] ? it.amount + lead + 10000 : it.amount)));
    if (p.hidden) {
      const shownIdx = new Set(S.order.slice(0, S.k));
      S.setValues("amountAdj", S.items.map((it, i) => (shownIdx.has(i) ? it.amount : it.amount + 250000)));
      S.sortExpect = "any";
    }
    S.about = p.hidden ? "decoy-fields:hidden" : "decoy-fields:visible";
  },

  // Two list endpoints: which one feeds the screen?
  "decoy-endpoint"(S, p) {
    base(S, { cols: 2 });
    const decoyFirst = p.decoyFirst ?? S.rng.chance(0.6);
    const other = S.items.map((it, i) => {
      const o = { ...it, id: it.id + 100, name: `Archived ${i + 1}` };
      for (const k of Object.keys(o)) if (typeof o[k] === "number" && k !== "id") o[k] = Math.round(o[k] * 1.37 * 1000) / 1000;
      return o;
    });
    S.api.extras = [{ path: `/api/${S.feature}/archived`, response: other }];
    S.api.decoyFirst = decoyFirst;
    S.endpointTruth = `ep:GET /api/${S.feature}`;
    S.about = `decoy-endpoint:${decoyFirst ? "decoy-first" : "true-first"}`;
  },

  // Many aggregates over a few numeric fields, and optionally one that coincides.
  "multi-agg"(S, p) {
    S.addKey();
    S.column({ dyn: "name", header: "Name", field: "name" });
    const money = [S.addMoney(), S.addMoney()];
    const pct = S.addPct();
    const count = S.addCount();
    S.column({ dyn: money[0], field: money[0], fmt: "moneyCompact" });
    const specs = [];
    for (const f of money) for (const agg of ["sum", "average", "max", "min"]) specs.push({ agg, field: f, fmt: S.rng.pick(FMT_FOR.money) });
    for (const agg of ["average", "max", "min"]) specs.push({ agg, field: pct, fmt: S.rng.pick(FMT_FOR.pct) });
    specs.push({ agg: "sum", field: count, fmt: "asText" }, { agg: "max", field: count, fmt: "asText" });
    S.rng.sample(specs, p.values ?? 8).forEach((s) => S.value({ dyn: `${s.agg}${cap(s.field)}`, label: `${s.agg} ${fieldWords(s.field)}`, ...s }));
    S.value({ dyn: "itemCount", label: "items", agg: "count" });
    if (p.tie ?? S.rng.chance(0.5)) {
      S.setValues("bonus", S.items.map((_, i) => (i === 1 ? 4200 : 0)));
      const agg = S.rng.pick(["sum", "max"]);
      S.value({ dyn: "bonusFigure", label: agg === "sum" ? "bonus total" : "largest bonus", agg, field: "bonus", fmt: "moneyCompact", expect: "tie", note: "only one row is nonzero, so sum and max agree" });
    }
    S.about = "multi-agg";
  },
};

// Scale: `parts` dynamic parts (half columns, half values) against a contract of matching size. Values are exact
// (moneyFull / asText) and drawn from disjoint ranges per field, so there are no accidental ties by construction.
function scaleScreen(rng, parts) {
  const S = new Screen(rng, { n: 8, rows: 6, feature: "scale" });
  S.addKey();
  S.column({ dyn: "name", header: "Name", field: "name" });
  const nCols = Math.floor(parts / 2), nVals = parts - nCols - 1;
  const fields = [];
  for (let i = 0; i < Math.max(nCols, nVals); i++) {
    const name = `f${i}`;
    S.setValues(name, S.items.map((_, r) => (i * 8 + r + 1) * 1000 + r));
    fields.push({ name, fmt: i % 2 ? "moneyFull" : "asText" });
  }
  for (let i = 0; i < nCols - 1; i++) S.column({ dyn: fields[i].name, header: fields[i].name, field: fields[i].name, fmt: fields[i].fmt });
  const aggs = ["sum", "average", "max", "min"];
  for (let i = 0; i < nVals; i++) S.value({ dyn: `v${i}`, label: `v${i}`, agg: aggs[i % 4], field: fields[i].name, fmt: fields[i].fmt });
  S.about = `scale-${parts}`;
  return S;
}

export const CATEGORIES = Object.keys(BUILDERS);

// ---------------------------------------------------------------------------------------------------------------
export function generateCase({ name, seed, params = {} }) {
  const isScale = name.startsWith("scale-");
  if (!isScale && !BUILDERS[name]) throw new Error(`unknown generator "${name}" (known: ${CATEGORIES.join(", ")}, scale-<parts>)`);
  let last = "";
  for (let attempt = 0; attempt < 60; attempt++) {
    const rng = rngTools((seed + attempt * 7919) >>> 0);
    const S = isScale ? scaleScreen(rng, Number(name.slice(6))) : new Screen(rng, { n: rng.int(5, 8), rows: rng.int(3, 5) });
    try {
      if (!isScale) {
        BUILDERS[name](S, params);
        // Field order in the contract decides the order of tie options (the --yes default). Without this the truth
        // would always be the earlier-declared field, and "would the default have been right" would measure the generator.
        const keys = rng.shuffle(Object.keys(S.items[0]).filter((k) => k !== "id"));
        S.items = S.items.map((it) => Object.fromEntries(["id", ...keys].map((k) => [k, it[k]])));
      }
      const { truth, cols, vals, shown } = finalize(S, { verify: !isScale });
      const story = S.story.length ? S.story.map((s) => `- ${s}`).join("\n") + "\n" : null;
      return { spec: renderContract(S, cols), pageSource: renderPage(S, cols, vals, shown), story, truth, meta: { name, seed, attempt, about: S.about } };
    } catch (e) {
      if (!(e instanceof Reject)) throw e;
      last = e.message;
    }
  }
  throw new Error(`generator ${name} seed ${seed}: no valid draw in 60 attempts (last: ${last})`);
}
