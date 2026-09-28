// Ground truth vocabulary and the bridge from Trace's internal objects to it.
//
// Every wiring is written as one short "canonical" string, so ground truth is readable in a JSON file and
// two wirings are equal iff their strings are:
//   f:<field>|<formatter>            a list column from an item field          f:lead|asText
//   a:<agg>(<field>)|<formatter>     a value from an aggregate of the list      a:sum(budget)|moneyCompact
//   e:<path>|<formatter>             a value from the response envelope         e:meta.snapshot_date|dateShort
//   s:<field>:<dir> | s:none         the row order
//   x:<kind>                         what an action does                         x:remove
//   ep:<METHOD> <path>               which endpoint feeds the list
//   gap:todo | gap:static | gap:custom   no data source: a TODO, static text, or a placeholder someone writes
//   u:<field>|<recipe>               the truth is a wiring outside Trace's closed transform library
import { ACTION_KINDS } from "../src/match.mjs";

export const KINDS = ["match", "needs-answer", "gap"];

export function canonCandidate(c) {
  if (c == null) return null;
  if (typeof c === "string") return `x:${c}`; // an action kind
  if (c.todo) return c.skipped ? "gap:skipped" : "gap:todo";
  if (c.static) return "gap:static";
  if (c.custom) return "gap:custom";
  if (c.skipped && c.dir === undefined && c.field === undefined) return "gap:skipped";
  if ("dir" in c) return c.dir === "none" ? "s:none" : `s:${c.field}:${c.dir}`;
  if (c.agg === "field") return `e:${c.field}|${c.formatter}`;
  if (c.agg) return `a:${c.agg}(${c.field ?? ""})|${c.formatter}`;
  if (c.field !== undefined) return `f:${c.field}|${c.formatter}`;
  return `?:${JSON.stringify(c)}`;
}
export const canonOption = (o) => (o.custom ? "gap:custom" : canonCandidate(o.value));

// The parts of a screen, in a fixed order, each pointing at the object in `matched` that holds its state.
// Ids equal the question ids (so an answer keyed by question id finds its part); a repeated id gets #2, #3.
export function enumerateParts(matched) {
  const out = [];
  const seen = new Map();
  const add = (id, cls, ref, extra = {}) => {
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    out.push({ id: n === 1 ? id : `${id}#${n}`, qid: id, cls, ref, ...extra });
  };
  for (const f of matched.list?.fields ?? []) add(`list.${f.name}`, "row", f, { name: f.name, example: f.examples?.[0] });
  if (matched.list) add("list.sort", "sort", matched.list);
  for (const v of matched.values) add(`value.${v.name}`, "value", v, { name: v.name, example: v.example });
  for (const a of matched.list?.actions ?? []) add(`action.${a.scope}.${a.name}`, "action", a, { name: a.name });
  for (const a of matched.actions) add(`action.${a.scope}.${a.name}`, "action", a, { name: a.name });
  return out;
}

const endpointCanon = (m) => (m.endpoints.list ? `ep:${m.endpoints.list.method} ${m.endpoints.list.path}` : "ep:none");

// What Trace does with each part BEFORE anyone answers: it either settles it on its own ("accept") or asks.
// The question's options are recorded in canonical form; the default is what --yes would pick (options[0]).
export function describeParts(matched, questions, { endpoint = false } = {}) {
  const byId = new Map();
  for (const q of questions) {
    if (q.sub) continue;
    if (!byId.has(q.id)) byId.set(q.id, []);
    byId.get(q.id).push(q);
  }
  const parts = enumerateParts(matched).map((p) => {
    const q = byId.get(p.qid)?.shift() ?? null;
    let accepted = null;
    if (!q) {
      if (p.cls === "sort") accepted = matched.list.sort.length === 1 ? canonCandidate(matched.list.sort[0]) : null;
      else if (p.cls === "action") accepted = p.ref.kind && !p.ref.missing.length ? canonCandidate(p.ref.kind) : null;
      else accepted = p.ref.candidates.length ? canonCandidate(p.ref.candidates[0]) : null;
    }
    const options = q ? q.options.map(canonOption) : [];
    const cands = p.cls === "sort" ? matched.list.sort.map(canonCandidate) : p.cls === "action" ? [] : p.ref.candidates.map(canonCandidate);
    return {
      id: p.id, qid: p.qid, cls: p.cls, name: p.name, example: p.example,
      outcome: q ? "ask" : "accept", accepted, options, default: options[0] ?? null, candidates: cands,
    };
  });
  if (endpoint) parts.push({ id: "endpoint.list", qid: "endpoint.list", cls: "endpoint", name: "list endpoint", outcome: "accept", accepted: endpointCanon(matched), options: [], default: null, candidates: [] });
  return parts;
}

// The wiring each part ends up with after answers were applied (read from the same objects makePlan reads).
export function finalWiring(matched, { endpoint = false } = {}) {
  const out = {};
  for (const p of enumerateParts(matched)) {
    const r = p.ref;
    if (p.cls === "sort") out[p.id] = r.sort.length === 1 ? canonCandidate(r.sort[0]) : "gap:open";
    else if (p.cls === "action") out[p.id] = r.skipped ? "gap:skipped" : r.kind === "custom" ? "gap:custom" : r.kind && !r.missing.length ? canonCandidate(r.kind) : r.kind ? `x:${r.kind}` : "gap:open";
    else out[p.id] = r.candidates.length === 1 ? canonCandidate(r.candidates[0]) : "gap:open";
  }
  if (endpoint) out["endpoint.list"] = endpointCanon(matched);
  return out;
}

// The answer a person who knows the truth would give, as the value resolveQuestions accepts in answers.json.
// null when the truth is not among the options (Trace cannot express it).
export function oracleValue(want, part, questionOptions) {
  if (want === "gap:todo") return { todo: true };
  if (want === "gap:static") return { static: true };
  if (want === "gap:custom") {
    const pascal = String(part.name ?? "part").replace(/(^|[-_\s.]+)(\w)/g, (_, __, c) => c.toUpperCase());
    return part.cls === "action"
      ? { custom: true, from: "handler", fn: `handle${pascal}` }
      : { custom: true, from: "controller", inputs: [], fn: `get${pascal}` };
  }
  const opt = questionOptions.find((o) => !o.custom && canonOption(o) === want);
  return opt ? opt.value : null;
}

export const knownActionKinds = Object.keys(ACTION_KINDS);
