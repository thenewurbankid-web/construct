// #932 the coder's scratchpad: its own working notes (its plan, the current hypothesis, a short draft before it
// submits), as entries. It is not project state: it never touches project files, never counts as a write or a human
// intervention, and lives in the run's log folder (logs/scratch.md; each version and every removal also go to
// turns.jsonl for review). It is distinct from the ledger (ledger.mjs): the ledger is what Line verified, the
// scratchpad is what the model thinks, and scratch text never goes into the ledger. Deterministic, no model call.
//
// Each entry: {id: "n3", turn, step (the current point id or file when it was written), about? (a file or point id),
// pin?, text}. gc() runs before each turn is built and drops, logging {id, reason}:
//   1. entries whose step or `about` is a point now covered, or a file whose step landed at or after the entry's turn
//   2. entries superseded by a newer entry with the same `about`
//   3. entries older than `keep` turns (6) unless pinned (at most 2 pinned)
//   4. still over `cap` characters: the oldest unpinned first
// The cap refusal stays as a last resort (one entry, plus the pinned ones, over the cap).
//
//   createScratch({file, cap, fenceLines, keep})  {entries, text, write(args, at), read(), gc(state)}
import fs from 'node:fs';
import path from 'node:path';

export const SCRATCH_CAP = 1500;
export const SCRATCH_FENCE_LINES = 5;
export const SCRATCH_KEEP_TURNS = 6;
export const SCRATCH_MAX_PINS = 2;

/** @typedef {{id: string, turn: number, step: string|null, about: string|null, pin: boolean, text: string}} ScratchEntry */

/** The longest code fence of `text`, in lines (0 when it has none). */
function longestFence(text) {
  let most = 0;
  for (const m of String(text).matchAll(/```[^\n]*\n([^]*?)(?:```|$)/g)) most = Math.max(most, m[1].replace(/\n$/, '').split('\n').length);
  return most;
}

const lineOf = (e) => `- [${e.id}, turn ${e.turn}${e.step ? `, at ${e.step}` : ''}${e.about ? `, about ${e.about}` : ''}${e.pin ? ', pinned' : ''}] ${e.text}`;
const size = (es) => es.reduce((n, e) => n + e.text.length, 0);

/**
 * A scratchpad of entries, mirrored to `file` (logs/scratch.md) after each change.
 * @param {{file?: string|null, cap?: number, fenceLines?: number, keep?: number}} [o]
 */
export function createScratch({ file = null, cap = SCRATCH_CAP, fenceLines = SCRATCH_FENCE_LINES, keep = SCRATCH_KEEP_TURNS } = {}) {
  /** @type {ScratchEntry[]} */
  let entries = [];
  let next = 1;
  const text = () => entries.map(lineOf).join('\n');
  const save = () => { if (file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, entries.length ? `${text()}\n` : ''); } };
  const refuse = (code, wrong, rule, example) => ({ ok: false, code, sentence: [`Refused (${code}): ${wrong}`, `Rule: ${rule}.`, `A correct call: scratch_write ${JSON.stringify(example)}`].join('\n') });
  /** Oldest unpinned first, until the notes fit `limit`; returns the removals. */
  const fit = (limit, reason) => {
    const out = [];
    while (size(entries) > limit) {
      const i = entries.findIndex((e) => !e.pin);
      if (i < 0) break;
      out.push({ id: entries[i].id, reason });
      entries.splice(i, 1);
    }
    return out;
  };
  return {
    get entries() { return entries.map((e) => ({ ...e })); },
    get text() { return text(); },
    /**
     * Add one entry. `at`: {turn, step} of the turn writing it.
     * @param {{text?: unknown, about?: unknown, pin?: unknown, mode?: unknown}} a @param {{turn: number, step?: string|null}} at
     */
    write(a, at) {
      const t = a?.text; const mode = a?.mode ?? 'append';
      if (typeof t !== 'string' || !t.trim()) return refuse('BAD_ARGS', 'text must be a non-empty string of plain English notes.', 'scratch_write takes {text, about?, pin?, mode?}', { text: 'Plan: fix line 7 of PicksPage, then run it.', about: 'features/picks/pages/PicksPage.tsx' });
      if (mode !== 'append' && mode !== 'replace') return refuse('BAD_ARGS', `mode "${String(mode)}" is neither append nor replace.`, 'mode is append (add an entry, the default) or replace (clear the unpinned entries first)', { text: t.slice(0, 80), mode: 'append' });
      const fence = longestFence(t);
      if (fence > fenceLines) return refuse('SCRATCH_CODE', `the note holds a code block of ${fence} lines.`, `the scratchpad is plain English notes; a code block is at most ${fenceLines} lines, and a code draft goes to plan_add`, { text: "Hypothesis: getItem can return null, so add ?? '[]' on line 7.", about: 'PCK-1' });
      const pin = a?.pin === true;
      if (pin && entries.filter((e) => e.pin).length >= SCRATCH_MAX_PINS) return refuse('SCRATCH_PINS', `${SCRATCH_MAX_PINS} entries are pinned already (${entries.filter((e) => e.pin).map((e) => e.id).join(', ')}).`, `at most ${SCRATCH_MAX_PINS} entries are pinned; write this one unpinned, or replace the notes`, { text: t.slice(0, 80), pin: false });
      const pinned = size(entries.filter((e) => e.pin));
      if (t.length + pinned > cap) return refuse('SCRATCH_TOO_LONG', `the note is ${t.length} characters and the pinned notes ${pinned}, over the ${cap}-character cap.`, `the notes hold at most ${cap} characters: keep one short line per thought`, { text: "Now: PicksPage line 7 needs ?? '[]'; then PCK-2.", about: 'PCK-1' });
      const removed = [];
      if (mode === 'replace') { for (const e of entries.filter((x) => !x.pin)) removed.push({ id: e.id, reason: 'replaced' }); entries = entries.filter((e) => e.pin); }
      const about = typeof a?.about === 'string' && a.about.trim() ? a.about.trim() : null;
      const e = { id: `n${next}`, turn: at?.turn ?? 0, step: at?.step ?? null, about, pin, text: t.trim() };
      next += 1;
      entries.push(e);
      removed.push(...fit(cap, 'over the cap'));
      save();
      return { ok: true, id: e.id, length: size(entries), cap, removed, sentence: `Saved note ${e.id} (${size(entries)} of ${cap} characters in your notes). Your notes are shown to you each turn.` };
    },
    read() { return { ok: true, length: size(entries), cap, entries: entries.length, sentence: entries.length ? `Your notes (${size(entries)} of ${cap} characters):\n${text()}` : 'Your notes are empty.' }; },
    /**
     * The garbage collection before a turn (see the header).
     * @param {{turn: number, covered?: Iterable<string>, landed?: Map<string, number> | Record<string, number>}} s
     *   `covered`: point ids now covered; `landed`: file -> the turn its step landed (approved and ran).
     * @returns {{id: string, reason: string}[]} The removals.
     */
    gc(s) {
      const covered = new Set(s.covered ?? []);
      const landed = s.landed instanceof Map ? s.landed : new Map(Object.entries(s.landed ?? {}));
      const removed = [];
      const drop = (pred) => { entries = entries.filter((e) => { const r = pred(e); if (r) removed.push({ id: e.id, reason: r }); return !r; }); };
      drop((e) => {
        for (const k of [e.step, e.about]) {
          if (!k) continue;
          if (covered.has(k)) return `point ${k} is covered`;
          const at = landed.get(k);
          if (at !== undefined && at >= e.turn) return `the step on ${k} landed (turn ${at})`;
        }
        return null;
      });
      drop((e) => (e.about && entries.some((x) => x.about === e.about && x.turn >= e.turn && x !== e && Number(x.id.slice(1)) > Number(e.id.slice(1))) ? `superseded about ${e.about}` : null));
      drop((e) => (!e.pin && s.turn - e.turn > keep ? `older than ${keep} turns` : null));
      removed.push(...fit(cap, 'over the cap'));
      if (removed.length) save();
      return removed;
    },
  };
}
