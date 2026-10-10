// The Page map's decisions: a sidecar `pagemap.json` in the example folder (sorted keys) and an append-only history
// `pagemap.history.jsonl`, the same idea as the inspector's answers.json / answers.history.jsonl (and it reuses that
// module's `stable` and `fold`). The design source is never touched here. The only clock is `at` in a history line,
// metadata that no result depends on.
//
//   decision  { act:"accept"|"reject"|"change"|"add", cls?, name?, by:"user"|"rule", anchor:{line,col,path,text} }
//             by "rule": the user accepted what a rule proposed; by "user": the user chose the class, name or rejected it
//   history   { v:1, n, op:"set", id, from, to, source, group?, at } | { v:1, n, op:"undo"|"redo", of, id, group?, at }
// Undo takes back the newest change (with the rest of its group), Redo the newest undone one; a change made by hand in
// pagemap.json since is never overwritten: Undo says so instead.
import fs from "node:fs";
import path from "node:path";
import { stable, fold } from "../inspector/history.mjs";

const same = (a, b) => stable(a ?? null) === stable(b ?? null);

/** Fixed file names for a page. `key` is null for an example's own page.jsx/tsx, else the real page's base name. */
export const filesFor = (key = null) => ({
  json: key ? `pagemap.${key}.json` : "pagemap.json",
  history: key ? `pagemap.${key}.history.jsonl` : "pagemap.history.jsonl",
});

const pretty = (v) => {
  const sort = (x) => (Array.isArray(x) ? x.map(sort) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k])])) : x);
  return JSON.stringify(sort(v), null, 2) + "\n";
};
const atomic = (file, text) => { const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); };

export const MAX_SIDECAR_BYTES = 2 * 1024 * 1024; // the guard's body limit: a bigger sidecar is not a sidecar this page wrote
export const MAX_DECISIONS = 5000;
const KEY_OK = /^[ns][0-9a-f]{8,40}$/;
const ACTS = new Set(["accept", "reject", "change", "add"]);
const CLASSES = new Set(["dynamic", "static", "list", "action", "input", "visual"]);
const NAME_OK = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Keep only decisions this page could have written: string keys that look like ids, object values with a known `act`,
 * a class from the fixed list when present, a usable name when present, an object `anchor` when present. Everything else is dropped
 * and reported, so a hand-edited or damaged sidecar can never reach the code that reads `d.anchor`.
 *
 * @param {unknown} raw Whatever the file held under `decisions`.
 * @returns {{decisions: Object<string,object>, warnings: string[]}} Clean decisions and one warning per problem.
 */
export function sanitizeDecisions(raw) {
  const warnings = [];
  if (raw === undefined) return { decisions: {}, warnings };
  if (!isObj(raw)) return { decisions: {}, warnings: [`the sidecar's "decisions" is not an object (ignored)`] };
  const decisions = {};
  let kept = 0, dropped = 0;
  for (const k of Object.keys(raw).sort()) {
    const d = raw[k];
    const why = !KEY_OK.test(k) ? "its key is not a node id" : !isObj(d) ? "it is not an object" : !ACTS.has(d.act) ? "its act is unknown" : (d.cls !== undefined && !CLASSES.has(d.cls)) ? "its class is unknown" : (d.name !== undefined && !(typeof d.name === "string" && NAME_OK.test(d.name))) ? "its name is not usable" : d.anchor !== undefined && !isObj(d.anchor) ? "its anchor is not an object" : (d.act === "change" || d.act === "add") && d.cls === undefined ? "it has no class" : null;
    if (why) { dropped++; if (dropped <= 5) warnings.push(`a saved decision was ignored: ${why}${KEY_OK.test(k) ? ` (${k})` : ""}`); continue; }
    if (kept >= MAX_DECISIONS) { dropped++; continue; }
    decisions[k] = { act: d.act, by: d.by === "rule" ? "rule" : "user", ...(d.cls !== undefined ? { cls: d.cls } : {}), ...(d.name !== undefined ? { name: d.name } : {}), ...(d.anchor ? { anchor: d.anchor } : {}) };
    kept++;
  }
  if (dropped > 5) warnings.push(`${dropped} saved decisions were ignored in all`);
  return { decisions, warnings };
}

/**
 * The decisions on disk, checked. Never throws: invalid JSON, a file over 2 MB, a non-object root or bad entries give `{}` or fewer
 * decisions and a warning each.
 *
 * @param {string} dir The example folder.
 * @param {string|null} key Real page base name, or null.
 * @returns {{decisions: Object<string,object>, warnings: string[]}} The clean decisions and what was wrong with the file.
 */
export function readDecisionsChecked(dir, key = null) {
  const file = path.join(dir, filesFor(key).json);
  let text;
  try { const st = fs.statSync(file); if (st.size > MAX_SIDECAR_BYTES) return { decisions: {}, warnings: [`${filesFor(key).json} is larger than ${MAX_SIDECAR_BYTES} bytes: ignored`] }; text = fs.readFileSync(file, "utf8"); } catch { return { decisions: {}, warnings: [] }; }
  let j;
  try { j = JSON.parse(text); } catch { return { decisions: {}, warnings: [`${filesFor(key).json} is not valid JSON: ignored`] }; }
  if (!isObj(j)) return { decisions: {}, warnings: [`${filesFor(key).json} is not an object: ignored`] };
  return sanitizeDecisions(j.decisions);
}

export function readDecisions(dir, key = null) {
  return readDecisionsChecked(dir, key).decisions;
}
function writeDecisions(dir, key, page, decisions) {
  let violations;
  try { const v = JSON.parse(fs.readFileSync(path.join(dir, filesFor(key).json), "utf8")).violations; violations = Array.isArray(v) ? v : undefined; } catch {}
  atomic(path.join(dir, filesFor(key).json), pretty({ v: 1, page, decisions, ...(violations ? { violations } : {}) }));
}

/**
 * Store the tracked violation list in the sidecar next to the decisions (key `violations`), so a run summary or a team email
 * can read it without opening the page. Nothing is written when there is no sidecar and nothing was decided yet.
 *
 * @param {string} dir The example folder.
 * @param {string|null} key Real page base name, or null.
 * @param {string} page The page file name.
 * @param {object[]} violations From `buildViolations`.
 * @returns {boolean} True when the sidecar was written.
 */
export function saveViolations(dir, key, page, violations) {
  const file = path.join(dir, filesFor(key).json);
  const decisions = readDecisions(dir, key);
  if (!fs.existsSync(file) && !Object.keys(decisions).length) return false;
  atomic(file, pretty({ v: 1, page, decisions, violations }));
  return true;
}
export function readHistory(dir, key = null) {
  try { return fs.readFileSync(path.join(dir, filesFor(key).history), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}
const append = (dir, key, entries) => fs.appendFileSync(path.join(dir, filesFor(key).history), entries.map((e) => stable(e) + "\n").join(""));

/** What Undo and Redo would do now (the newest applied / undone change), for the buttons. */
export function summary(dir, key = null) {
  const h = fold(readHistory(dir, key));
  const top = (m) => [...m.entries()].filter(([, s]) => s.length).map(([id, s]) => ({ id, n: s.at(-1) }));
  const newest = (list, by) => list.sort((a, b) => by.get(b.n) - by.get(a.n))[0] ?? null;
  const undo = newest(top(h.applied), h.touched), redo = newest(top(h.redoable), h.undoneAt);
  return { undo: undo && { id: undo.id, n: undo.n, group: h.sets.get(undo.n).group ?? null }, redo: redo && { id: redo.id, n: redo.n, group: h.sets.get(redo.n).group ?? null }, changes: [...h.applied.values()].reduce((n, s) => n + s.length, 0) };
}

/**
 * Record decisions. `changes` is `[{id, to}]` where `to` is a decision or `null` (remove it).
 * One shared group when there are several, so Undo takes them back together.
 *
 * @param {string} dir The example folder.
 * @param {string|null} key Real page base name, or null.
 * @param {string} page The page file name (recorded in the sidecar).
 * @param {{id:string, to:object|null}[]} changes The changes.
 * @param {{now?:()=>string}} [opts] Clock for the history line's `at` (metadata only).
 * @returns {{entries:object[], decisions:object}} The lines appended and the decisions now on disk.
 */
export function setDecisions(dir, key, page, changes, { now = () => new Date().toISOString() } = {}) {
  const decisions = readDecisions(dir, key);
  const h = fold(readHistory(dir, key));
  const real = changes.filter((c) => !same(decisions[c.id], c.to));
  if (!real.length) return { entries: [], decisions };
  const group = real.length > 1 ? `g${h.next}` : null;
  const at = now();
  let n = h.next;
  const entries = real.map((c) => ({ v: 1, n: n++, op: "set", id: c.id, from: decisions[c.id] ?? null, to: c.to, source: c.to?.by ?? "user", ...(group ? { group } : {}), at }));
  for (const c of real) { if (c.to == null) delete decisions[c.id]; else decisions[c.id] = c.to; }
  writeDecisions(dir, key, page, decisions);
  append(dir, key, entries);
  return { entries, decisions };
}

function step(dir, key, page, dirn, now) {
  const entries = readHistory(dir, key), h = fold(entries), sum = summary(dir, key);
  const target = dirn === "undo" ? sum.undo?.n : sum.redo?.n;
  if (target == null) return { error: dirn === "undo" ? "There is nothing to undo." : "There is nothing to redo." };
  const t = h.sets.get(target), group = t.group;
  const tops = (m) => [...m.entries()].filter(([, s]) => s.length).map(([, s]) => h.sets.get(s.at(-1)));
  const batch = group ? tops(dirn === "undo" ? h.applied : h.redoable).filter((e) => e.group === group) : [t];
  const decisions = readDecisions(dir, key);
  for (const e of batch) {
    const expect = dirn === "undo" ? e.to : e.from;
    if (!same(decisions[e.id], expect)) return { error: `The decision for ${e.id} was changed outside the Page map since, so ${dirn} would overwrite it. Nothing was changed.`, conflict: e.id };
  }
  const at = now(), out = [];
  let n = h.next;
  for (const e of batch) {
    const value = dirn === "undo" ? e.from : e.to;
    if (value == null) delete decisions[e.id]; else decisions[e.id] = value;
    out.push({ v: 1, n: n++, op: dirn, of: e.n, id: e.id, ...(e.group ? { group: e.group } : {}), at });
  }
  writeDecisions(dir, key, page, decisions);
  append(dir, key, out);
  return { ids: batch.map((e) => e.id), decisions };
}
export const undo = (dir, key, page, now = () => new Date().toISOString()) => step(dir, key, page, "undo", now);
export const redo = (dir, key, page, now = () => new Date().toISOString()) => step(dir, key, page, "redo", now);
