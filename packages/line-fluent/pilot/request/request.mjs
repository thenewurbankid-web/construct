// Pilot request builder (leaf t1-3a-request, docs/line/FLUENT-PLAN-2026-10-15.md "Wave 2 leaves").
// buildRequest(entry, {candidates, refusal}) -> {system, user, prefill}: one C1 reference entry per request,
// fixed deterministic text, no model call. The model's answer is a C2 object, checked by the gate.

import { FIELDS, DECISIONS, KINDS } from '../../contract/validate.mjs';
import { SHAPES } from '../../gate/grammar/shapes.mjs';

export const MAX_CANDIDATES = 5;

// One line per rule, summarising packages/line-smith/ENGLISH-RULES.md (R1-R9).
export const RULES = [
  'R1. Verbs are third person singular (compares, sorts, trims); no base form or past participle, except inside every() (R9).',
  'R2. A sentence starts with a verb (checks, clones, when, chooses, matches, attempts) or a subject (text(s), list(xs), number(n), date(d), record(o), map(m), set(s)).',
  'R3. One argument per word, carried by a preposition or role noun: if, than, to, by, with, from, at, of, between(low).and(high).',
  'R4. Questions use is, has, can or does, split into words: checks().if(a).is().greater().than(b).',
  'R5. A changed copy starts with clones(): clones().text(s).and().trims(); in-place changes and questions never take clones().',
  'R6. Connectors and, then, also, but, otherwise join clauses and take no argument; only if() takes one.',
  'R7. Every chain ends in a plain value and calls exactly one atom.',
  "R8. A new atom's plain name is the chain's words after the subject in camelCase, arguments in order: isGreaterThan, clonesAndSortsBy.",
  'R9. Callbacks become every() sentences: every(x).in(xs).is().mapped()...; the first word gives the result: checks() yes/no, every() list, the().first() one item, folds() one value, does() nothing.',
];

// Every sentence shape the grammar gate accepts, each with one real example (gate/grammar/shapes.mjs).
export const SHAPE_LINES = [...SHAPES.entries()].map(([shape, example]) => `- ${shape}   e.g. ${example}`);

export const SYSTEM = [
  'Task: write one fluent answer for one JavaScript reference entry, in Smith Atomic English.',
  'Reply with one JSON object and nothing else.',
  `Fields, in this order: ${FIELDS.join(', ')}. No other fields.`,
  `decision: one of ${DECISIONS.join(' | ')}.`,
  `kind: one of ${KINDS.join(' | ')}; null only when decision is not-expressible.`,
  'atom: a camelCase atom id, or null. existing: a catalog atom id when decision is existing, else null.',
  'sentence: the Atomic English sentence; js: the plain JS it stands for; both null when decision is not-expressible.',
  'params: a list of [name, type] pairs. parts: catalog atom ids when decision is molecule, else null.',
  'reason: one plain sentence when decision is not-expressible, else null.',
  'Reuse an existing atom first: if a candidate already does this, answer decision existing with its id.',
  'Rules:',
  ...RULES,
].join('\n');

const describeParam = (p) => `${p.rest ? '...' : ''}${p.name}${p.optional ? '?' : ''}: ${p.type}`;

// The shapes section: opt-in, since it doubles the request (the student's budget is 4000 chars; Claude's is not).
export const SHAPES_SECTION = [
  'The sentence must have one of these shapes (VERB is a verb slot: a known verb or a new third-person verb such as copies; · marks an argument). Each shape is followed by a real sentence of that shape:',
  ...SHAPE_LINES,
].join('\n');

export function buildRequest(entry, { candidates = [], refusal = null, shapes = false } = {}) {
  const params = (entry.params ?? []).map(describeParam);
  const lines = [
    `Entry: ${entry.id}`,
    `Section: ${entry.section}`,
    `Kind: ${entry.kind}`,
    `Params: ${params.length ? params.join(', ') : '(none)'}`,
  ];
  const shown = candidates.slice(0, MAX_CANDIDATES);
  if (shown.length) {
    lines.push('Candidate catalog atoms:');
    for (const c of shown) lines.push(`- ${c.atom}: ${c.fluent} (js: ${c.js})`);
  } else {
    lines.push('Candidate catalog atoms: (none)');
  }
  if (refusal) lines.push(`Your last answer was refused: ${refusal} Answer again.`);
  return {
    system: shapes ? `${SYSTEM}\n${SHAPES_SECTION}` : SYSTEM,
    user: lines.join('\n'),
    prefill: `{"entry": ${JSON.stringify(entry.id)}, "decision": "`,
  };
}
