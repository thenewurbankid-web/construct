// Fork points of a Trace match result, and the forks themselves (#901).
// Where makePlan would take the first of several candidates (plan.mjs: a part's candidates[0], m.list.sort[0],
// m.forms[0]), the beam forks instead: one copy of the match per candidate, that point trimmed to it. Pure.
import { describeField, describeValue } from "../ask.mjs";

/**
 * One multi-candidate point of a match result.
 * @typedef {object} ForkPoint
 * @property {string} point  Stable id: "list.<field>", "value.<name>", "list.sort", "forms", "ref:<slot>", "reading".
 * @property {{pick: string, label: string, index: number, cost: number}[]} candidates  In the matcher's order (index 0 = what makePlan takes today).
 */

/** Stable id of a part candidate (the structural gate's signature). */
export const candidateId = (c) => `${c.agg ?? ""}(${c.field ?? ""})|${c.formatter ?? ""}`;
const sortId = (s) => `${s.field ?? ""}:${s.dir}`;

/**
 * Every point of `m` where makePlan would pick the first of several, in screen order: list fields, page values,
 * the list's sort, the forms.
 * @param {any} m A match() result.
 * @returns {ForkPoint[]}
 */
export function forkPoints(m) {
  const out = [];
  const part = (point, cands, describe) => {
    if (cands.length > 1) out.push({ point, candidates: cands.map((c, index) => ({ pick: candidateId(c), label: describe(c), index, cost: c.cost ?? 0 })) });
  };
  for (const f of m.list?.fields ?? []) part(`list.${f.name}`, f.candidates, describeField);
  for (const v of m.values ?? []) part(`value.${v.name}`, v.candidates, describeValue);
  const sort = m.list?.sort ?? [];
  if (sort.length > 1) out.push({ point: "list.sort", candidates: sort.map((s, index) => ({ pick: sortId(s), label: s.label ?? sortId(s), index, cost: index })) });
  const forms = m.forms ?? [];
  if (forms.length > 1) out.push({ point: "forms", candidates: forms.map((f, index) => ({ pick: f.action, label: `the "${f.action}" form`, index, cost: index })) });
  return out;
}

/**
 * A copy of `m` with one point trimmed to one candidate. Points this function does not own ("ref:", "reading") leave
 * the match as it is (they fork the reading, not the page).
 * @param {any} m
 * @param {string} point
 * @param {string} pick
 * @returns {any} A new match result; `m` is untouched.
 */
export function trimTo(m, point, pick) {
  const c = structuredClone(m);
  const keepOne = (part) => {
    const hit = part.candidates.find((x) => candidateId(x) === pick);
    if (!hit) throw new Error(`fork: ${point} has no candidate ${pick}`);
    part.candidates = [hit];
  };
  if (point.startsWith("list.") && point !== "list.sort") keepOne(c.list.fields.find((f) => `list.${f.name}` === point));
  else if (point.startsWith("value.")) keepOne(c.values.find((v) => `value.${v.name}` === point));
  else if (point === "list.sort") c.list.sort = c.list.sort.filter((s) => sortId(s) === pick);
  else if (point === "forms") c.forms = c.forms.filter((f) => f.action === pick);
  return c;
}

/**
 * Reference ambiguity from project facts, no model: domain-map normalize() output -> fork points. One match closes
 * (no point), zero is a new name (the "create" pick, no fork), several are a fork point with one pick per key.
 * @param {{ambiguous?: Record<string, string[]>, bindings?: Record<string, any>}} normalized normalize(request, map)'s result.
 * @returns {ForkPoint[]}
 */
export function refPoints(normalized) {
  return Object.entries(normalized.ambiguous ?? {})
    .filter(([, keys]) => keys.length > 1)
    .map(([slot, keys]) => ({ point: `ref:${slot}`, candidates: keys.map((k, index) => ({ pick: k, label: k.split(":").slice(1).join(":") || k, index, cost: index })) }));
}

/** Where a function a plan needs comes from, stub first. */
export const LAYER_REFS = Object.freeze(["stub", "fn", "create"]);

/**
 * The Trace map, stub-first: an existing stub of that name (a generated placeholder still marked TODO) wins, then an
 * existing function of that name, else create it.
 * @param {string} name The function name the plan uses.
 * @param {Record<string, string>} existing The feature's files already on disk (relative path -> source); {} for none.
 * @returns {{ref: 'stub'|'fn'|'create', file: string|null}}
 */
export function layerRef(name, existing) {
  const decl = new RegExp(`export\\s+(?:async\\s+)?function\\s+${name.replace(/[$]/g, "\\$")}\\s*\\(([^)]*)\\)\\s*\\{([\\s\\S]*?)\\n\\}`);
  let fn = null;
  for (const [file, src] of Object.entries(existing ?? {})) {
    const m = decl.exec(src);
    if (!m) continue;
    if (/TODO/.test(m[2])) return { ref: "stub", file };
    fn ??= file;
  }
  return fn ? { ref: "fn", file: fn } : { ref: "create", file: null };
}
