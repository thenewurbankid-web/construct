// The static (rules-only) context-line scorer (#881; moved here from trace/tools/jev in #886, which re-exports it):
// Line ranks the context lines of a refusal with it (hints.mjs) and the bench builder keeps the top ones. Deterministic.
//
// Every candidate line Line returned since the builder's last action gets a score in [0, 1]; the builder is shown
// the top lines under an adaptive cap (5, or 15 once the same refusal repeats). Rank by rule first (fix steps >
// paths and exports in a refusal > status with a concrete key > other), then by lexical overlap with the step being
// attempted. This is the default scorer; jev (tools/jev/train_context.py) only runs in shadow until it beats it.

/** The base score of each line kind. */
export const KIND_SCORE = {
  fix: 0.9,             // a fix step, or a sentence that says what to send instead
  'refusal-path': 0.75, // a path, export or tool named inside a refusal
  status: 0.45,         // "Step 3 joined the plan; run-next lands it", "Read x.tsx (8 lines)"
  'result-other': 0.4,
  'refusal-other': 0.35,
  'list-item': 0.25,    // one entry of a long list (all Line tools, all feature pages)
  field: 0.15,          // code / tool / stepId / state / landed / rules
};

/** Field lines that name something the next step may carry (a step id for fixOf, a landed state) rank above codes. */
const FIELD_SCORE = { stepId: 0.3, state: 0.25, landed: 0.15, tool: 0.15, code: 0.05, rules: 0.3 };

const words = (s) => new Set(String(s ?? '').toLowerCase().split(/[^a-z0-9_.<>/-]+/).filter((w) => w.length > 2));

/** Jaccard overlap of two texts' words. */
export function overlap(a, b) {
  const A = words(a); const B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n += 1;
  return n / (A.size + B.size - n);
}

/**
 * Score one line. `attempt` is the step the builder just attempted (the action Line answered).
 * @param {{text: string, kind: string, src?: string, keys?: string[]}} line @param {{attempt?: string}} [ctx]
 * @returns {number} in [0, 1]
 */
export function scoreLine(line, ctx = {}) {
  let s = KIND_SCORE[line.kind] ?? 0.3;
  if (line.kind === 'field') s = FIELD_SCORE[String(line.src ?? '').split('.').pop()] ?? s;
  const keys = line.keys ?? [];
  if (keys.length) s += 0.1; else s -= 0.15;                          // nothing concrete to act on
  if (keys.some((k) => k.includes('/') || /^[A-Z][a-z]+[A-Z]/.test(k))) s += 0.05; // a path or an export name
  s += 0.15 * overlap(line.text, ctx.attempt ?? '');
  return Math.max(0, Math.min(1, +s.toFixed(4)));
}

/** The cap on lines shown: 5, or 15 when the same refusal repeats. */
export const capFor = (refusalRepeat = 0) => (refusalRepeat >= 1 ? 15 : 5);

/**
 * Rank one turn's candidate lines (highest score first; ties keep Line's order) and keep the top `cap`.
 * @template {{text: string, kind: string}} L
 * @param {L[]} lines @param {{attempt?: string, cap?: number, score?: (l: L) => number}} [opts]
 * @returns {{ranked: (L & {score: number})[], kept: (L & {score: number})[]}}
 */
export function rankLines(lines, opts = {}) {
  const score = opts.score ?? ((l) => scoreLine(l, { attempt: opts.attempt }));
  const ranked = lines.map((l, i) => ({ ...l, score: score(l), _i: i }))
    .sort((a, b) => b.score - a.score || a._i - b._i)
    .map(({ _i, ...l }) => l);
  return { ranked, kept: ranked.slice(0, opts.cap ?? 5) };
}
