// Tied parts are never resolved for you. When several parts are tied between the same set of fields
// and you have already resolved one of them to a field, the later question carries a plain note saying
// so ("lead" is already used by "row.owner"). It is information, not a decision: you still answer.
const sig = (c) => `${c.agg ?? ""}(${c.field ?? ""})|${c.formatter}`;

const partsOf = (m) => [
  ...(m.list?.fields ?? []).map((p) => ({ p, id: `list.${p.name}`, label: `row.${p.name}` })),
  ...m.values.map((p) => ({ p, id: `value.${p.name}`, label: p.name })),
];

// Call once, right after matching, before any answer is applied.
/**
 * Record each part's tie signature (a sorted, joined key of its candidates) before any answer is applied, so a
 * later resolved part can still be recognised as having once tied with others. Mutates `m` in place.
 *
 * @param {object} m The match result (`list.fields`, `values`, each part carrying `candidates`).
 * @returns {void}
 */
export function snapshotTies(m) {
  for (const { p } of partsOf(m)) p.tie = p.candidates.length > 1 ? p.candidates.map(sig).sort().join(",") : null;
}

// A note for the question with this id, or null. Evaluated when the question is shown.
/**
 * A plain-language note for the question with this id, naming any other part that already claimed a field this
 * part was once tied with. Never resolves the tie itself — it is information, not a decision.
 *
 * @param {object} m The match result, after {@link snapshotTies} has run.
 * @param {string} id The question's part id, e.g. `list.owner` or `value.total`.
 * @returns {string|null} The note, or `null` when the part was never tied or nothing else has claimed a field.
 */
export function noteFor(m, id) {
  const parts = partsOf(m);
  const me = parts.find((x) => x.id === id);
  if (!me?.p.tie) return null;
  const used = parts
    .filter((x) => x !== me && x.p.tie === me.p.tie && x.p.candidates.length === 1 && x.p.candidates[0].field)
    .map((x) => `"${x.p.candidates[0].field}" is already used by "${x.label}"`);
  return used.length ? `${used.join("; ")}. This part is still yours to decide.` : null;
}
