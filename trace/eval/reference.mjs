// An independent reference for "what does the closed transform library explain?".
//
// The generator builds designs from these formatters and aggregates, and its ground truth is checked against
// the explainers below. They are deliberately a separate, plain copy of src/transforms.mjs and of the cost rule
// in src/match.mjs: the corpus must not move when the algorithm under test changes, and if Trace's real library
// drifts from this reference, the eval shows it as lost recall instead of silently re-defining the truth.
// (No Date: dates are formatted from the ISO string.)
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const REF_FORMATTERS = {
  asText: { cost: 0, fn: (v) => String(v) },
  moneyCompact: {
    cost: 1,
    fn: (v) => {
      const n = Number(v);
      for (const [size, s] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]]) if (Math.abs(n) >= size) return "$" + (n / size).toFixed(1) + s;
      return "$" + n.toFixed(0);
    },
  },
  moneyFull: { cost: 1, fn: (v) => "$" + Number(v).toLocaleString("en-US") },
  percentWhole: { cost: 1, fn: (v) => Math.round(Number(v) * 100) + "%" },
  percent: { cost: 1, fn: (v) => (Number(v) * 100).toFixed(1) + "%" },
  dateShort: {
    cost: 1,
    accepts: (v) => typeof v === "string" && /^\d{4}-\d\d-\d\d/.test(v),
    fn: (v) => { const [y, m, d] = v.slice(0, 10).split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; },
  },
};
export const FORMATTER_NAMES = Object.keys(REF_FORMATTERS);

export const REF_AGGS = {
  count: { needsField: false, fn: (items) => items.length },
  sum: { needsField: true, fn: (items, f) => items.reduce((s, x) => s + Number(x[f]), 0) },
  average: { needsField: true, fn: (items, f) => items.reduce((s, x) => s + Number(x[f]), 0) / items.length },
  max: { needsField: true, fn: (items, f) => Math.max(...items.map((x) => Number(x[f]))) },
  min: { needsField: true, fn: (items, f) => Math.min(...items.map((x) => Number(x[f]))) },
};

export const norm = (s) => String(s).replace(/\s+/g, " ").trim();
export const applyFmt = (name, v) => REF_FORMATTERS[name].fn(v);
export const applyAgg = (agg, items, field) => REF_AGGS[agg].fn(items, field);

// Every wiring of a list column that reproduces `texts` (one per designed row) for the aligned items,
// keeping only the cheapest, like Trace does. Canonical strings (see truth.mjs).
export function explainColumn(items, texts) {
  const out = [];
  for (const field of Object.keys(items[0] ?? {})) {
    for (const [name, f] of Object.entries(REF_FORMATTERS)) {
      const ok = texts.every((t, i) => {
        const v = items[i][field];
        if (f.accepts && !f.accepts(v)) return false;
        try { return norm(f.fn(v)) === norm(t); } catch { return false; }
      });
      if (ok) out.push({ canon: `f:${field}|${name}`, cost: f.cost });
    }
  }
  return cheapest(out);
}

// Every wiring of a page value (an aggregate of the whole list, or a scalar of the response envelope).
export function explainValue(allItems, envScalars, text) {
  const out = [];
  for (const [path, val] of Object.entries(envScalars)) {
    if (val == null) continue;
    for (const [name, f] of Object.entries(REF_FORMATTERS)) {
      if (f.accepts && !f.accepts(val)) continue;
      if (norm(f.fn(val)) === norm(text)) out.push({ canon: `e:${path}|${name}`, cost: 1 + f.cost });
    }
  }
  const fields = Object.keys(allItems[0] ?? {});
  for (const [agg, a] of Object.entries(REF_AGGS)) {
    for (const field of a.needsField ? fields : [null]) {
      let v;
      try { v = a.fn(allItems, field); } catch { continue; }
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      for (const [name, f] of Object.entries(REF_FORMATTERS)) {
        if (f.accepts && !f.accepts(v)) continue;
        if (norm(f.fn(v)) === norm(text)) out.push({ canon: `a:${agg}(${field ?? ""})|${name}`, cost: 1 + f.cost + (field ? 1 : 0) });
      }
    }
  }
  return cheapest(out);
}

// The sorts that reproduce the designed order: idx = the item index shown in each designed row.
export function explainSort(items, idx) {
  const n = idx.length;
  const natural = items.map((_, i) => i);
  if (natural.slice(0, n).every((v, i) => v === idx[i])) return ["s:none"];
  const out = [];
  for (const field of Object.keys(items[0] ?? {})) {
    for (const dir of ["asc", "desc"]) {
      const order = [...natural].sort((a, b) => {
        const x = items[a][field], y = items[b][field];
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return dir === "asc" ? c : -c;
      });
      if (order.slice(0, n).every((v, i) => v === idx[i])) out.push(`s:${field}:${dir}`);
    }
  }
  return out;
}

function cheapest(list) {
  if (!list.length) return [];
  const min = Math.min(...list.map((c) => c.cost));
  return list.filter((c) => c.cost === min).map((c) => c.canon);
}

// ---------------------------------------------------------------------------------------------------------------
// The screen as the reference sees it: which endpoint is the list, its flat items, the response scalars, and which
// item each designed row shows. Used to derive the KIND of a hand-written label (match or tie) without asking Trace.
// ---------------------------------------------------------------------------------------------------------------
export function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else if (!Array.isArray(v)) out[key] = v;
  }
  return out;
}

export function refListEndpoint(spec) {
  const isItem = (p) => /\/:[A-Za-z_]+$/.test(p);
  const list = (spec.apis ?? []).find((a) => a.method === "GET" && !isItem(a.path) && (spec.list ? Array.isArray(a.response?.[spec.list]) : Array.isArray(a.response)));
  const rows = list ? (spec.list ? list.response[spec.list] : list.response) : [];
  const { [spec.list]: _drop, ...envelope } = spec.list && list ? list.response : {};
  return { list, items: rows.map((r) => flatten(r)), envScalars: spec.list ? flatten(envelope) : {} };
}

// designed rows -> item index, by a column whose text appears exactly and uniquely (the name column)
export function refAlign(rows, items) {
  const dyn = Object.keys(rows[0] ?? {});
  for (const d of dyn) {
    for (const f of Object.keys(items[0] ?? {})) {
      const idx = rows.map((r) => items.findIndex((it) => norm(it[f]) === norm(r[d])));
      if (idx.every((i) => i >= 0) && new Set(idx).size === idx.length) return idx;
    }
  }
  return rows.map((_, i) => i);
}

// How many cheapest wirings the library finds for a part, given the parsed page (rows, value examples).
export function referenceExplain(spec, extracted, partId) {
  const { items, envScalars } = refListEndpoint(spec);
  const list = extracted.lists[0];
  const idx = list ? refAlign(list.rows, items) : [];
  const shown = idx.map((i) => items[i]).filter(Boolean);
  if (partId === "list.sort") return explainSort(items, idx);
  if (partId.startsWith("list.")) return list && shown.length === list.rows.length ? explainColumn(shown, list.rows.map((r) => r[partId.slice(5)])) : [];
  if (partId.startsWith("value.")) {
    const v = extracted.values.find((x) => x.name === partId.slice(6));
    return v ? explainValue(items, envScalars, v.example) : [];
  }
  return [];
}
