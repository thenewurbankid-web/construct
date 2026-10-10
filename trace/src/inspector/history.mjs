// answers.history.jsonl: one line per change made through the inspector, so Undo and Redo work per part and for the
// whole example. Lines are JSON with sorted keys and are only ever appended. The only clock in here is `at`, metadata
// that no result depends on (preview, replay and the generated code never read it).
//
//   { v:1, n, op:"set",  id, from, to, source, model?, fact?, group?, at }   answers.json[id] changed from -> to (null = no answer)
//   { v:1, n, op:"undo", of, id, group?, at }                                undoes the set numbered `of`
//   { v:1, n, op:"redo", of, id, group?, at }                                puts it back
// Undo takes back the newest applied change of a part (or of the whole example), Redo the newest undone one; a new set on
// a part clears that part's Redo. A change made by hand in answers.json since is never overwritten: Undo says so instead.
import fs from "node:fs";
import path from "node:path";
import { readAnswers, writeAnswers } from "./state.mjs";

export const HISTORY = "answers.history.jsonl";

// JSON with sorted keys, at every depth, so a line is the same whichever order the keys were built in.
export function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
const same = (a, b) => stable(a ?? null) === stable(b ?? null);

export function readHistory(dir) {
  try { return fs.readFileSync(path.join(dir, HISTORY), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}
const append = (dir, entries) => fs.appendFileSync(path.join(dir, HISTORY), entries.map((e) => stable(e) + "\n").join(""));

// The state the history leaves: for every part the stack of applied changes and of undone ones.
export function fold(entries) {
  const sets = new Map(), applied = new Map(), redoable = new Map(), touched = new Map(), undoneAt = new Map();
  const stack = (m, id) => { if (!m.has(id)) m.set(id, []); return m.get(id); };
  for (const e of entries) {
    if (e.op === "set") { sets.set(e.n, e); stack(applied, e.id).push(e.n); redoable.set(e.id, []); touched.set(e.n, e.n); }
    else if (e.op === "undo") { const s = stack(applied, e.id); if (s.at(-1) === e.of) { s.pop(); stack(redoable, e.id).push(e.of); undoneAt.set(e.of, e.n); } }
    else if (e.op === "redo") { const r = stack(redoable, e.id); if (r.at(-1) === e.of) { r.pop(); stack(applied, e.id).push(e.of); touched.set(e.of, e.n); } }
  }
  return { sets, applied, redoable, touched, undoneAt, next: (entries.at(-1)?.n ?? 0) + 1 };
}

// What one part's history says, and what Undo / Redo would do to the whole example.
export function summary(dir, id = null) {
  const h = fold(readHistory(dir));
  const top = (m) => [...m.entries()].filter(([, s]) => s.length).map(([pid, s]) => ({ id: pid, n: s.at(-1) }));
  const newest = (list, by) => list.sort((a, b) => by.get(b.n) - by.get(a.n))[0] ?? null;
  const undo = newest(top(h.applied), h.touched), redo = newest(top(h.redoable), h.undoneAt);
  const mine = id ? h.applied.get(id) ?? [] : [];
  const last = mine.length ? h.sets.get(mine.at(-1)) : null;
  const edited = [...h.applied.entries()].filter(([, s]) => s.length).map(([pid]) => pid).sort();
  return {
    edited,
    undo: undo && { id: undo.id, n: undo.n, group: h.sets.get(undo.n).group ?? null },
    redo: redo && { id: redo.id, n: redo.n, group: h.sets.get(redo.n).group ?? null },
    part: id ? { edited: mine.length > 0, canUndo: mine.length > 0, canRedo: (h.redoable.get(id) ?? []).length > 0, last: last && { source: last.source, model: last.model ?? null, fact: last.fact ?? null, at: last.at } } : null,
  };
}

// changes: [{ id, value }]. Writes answers.json and appends one "set" line per change (one shared group when several).
export function applyChanges(dir, changes, { source = "inspector", model = null, fact = null, now = () => new Date().toISOString() } = {}) {
  const answers = readAnswers(dir);
  const h = fold(readHistory(dir));
  const group = changes.length > 1 ? `g${h.next}` : null;
  const at = now();
  const entries = [];
  let n = h.next;
  for (const c of changes) {
    const from = c.id in answers ? answers[c.id] : null;
    entries.push({ v: 1, n: n++, op: "set", id: c.id, from, to: c.value, source, ...(model ? { model } : {}), ...(fact ? { fact } : {}), ...(group ? { group } : {}), at });
    answers[c.id] = c.value;
  }
  writeAnswers(dir, answers);
  append(dir, entries);
  return { entries, answers };
}

// Undo or redo: of one part (id) or, without an id, of the newest change of the example (with the rest of its group).
function step(dir, dirn, id, now) {
  const entries = readHistory(dir), h = fold(entries), sum = summary(dir);
  const target = id ? (dirn === "undo" ? (h.applied.get(id) ?? []).at(-1) : (h.redoable.get(id) ?? []).at(-1)) : (dirn === "undo" ? sum.undo?.n : sum.redo?.n);
  if (target == null) return { error: dirn === "undo" ? "There is nothing to undo." : "There is nothing to redo." };
  const t = h.sets.get(target), group = t.group;
  const tops = (m) => [...m.entries()].filter(([, s]) => s.length).map(([pid, s]) => h.sets.get(s.at(-1)));
  const batch = group && !id ? tops(dirn === "undo" ? h.applied : h.redoable).filter((e) => e.group === group) : [t];
  const answers = readAnswers(dir), at = now(), out = [];
  let n = h.next;
  for (const e of batch) {
    const cur = e.id in answers ? answers[e.id] : null;
    const expect = dirn === "undo" ? e.to : e.from;
    if (!same(cur, expect)) return { error: `The answer for ${e.id} was changed outside the inspector since, so ${dirn} would overwrite it. Nothing was changed.`, conflict: e.id };
  }
  for (const e of batch) {
    const value = dirn === "undo" ? e.from : e.to;
    if (value == null) delete answers[e.id]; else answers[e.id] = value;
    out.push({ v: 1, n: n++, op: dirn, of: e.n, id: e.id, ...(e.group ? { group: e.group } : {}), at });
  }
  writeAnswers(dir, answers);
  append(dir, out);
  return { ids: batch.map((e) => e.id), answers };
}
export const undo = (dir, id = null, now = () => new Date().toISOString()) => step(dir, "undo", id, now);
export const redo = (dir, id = null, now = () => new Date().toISOString()) => step(dir, "redo", id, now);
