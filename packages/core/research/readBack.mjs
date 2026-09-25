// #672 (R4, part of #576 / #570) -- read a machine-spec.v1 back in plain English, sentence by sentence.
//
// The person who wrote (or approved a model's draft of) a requirement confirms what was understood
// before anything is generated: for each requirement sentence, the states, events, transitions and
// functions whose `req` points at it, each in plain words, and every sentence marked out of scope
// listed as such. Nothing is dropped: an item that claims several sentences shows under each of them,
// and the spec's declared `types` (which carry no `req`) come last.
//
// Deterministic, offline, no model. The English is the workflow narrator's own
// (packages/engine/workflowNarrator.mjs): the flow summary is `narrateMachine`'s, every transition
// is `transitionSentence`'s (so a guarded branch and its "Otherwise" fallback read exactly as
// `construct research workflow` reads them, guards worded by `guardText`), and names go through
// `humanize` / `stateLabel`. This module only groups by sentence and words the parts the narrator has no notion of
// (an event's payload, a function's precondition and postcondition).
//
// Input is an ACCEPTED spec (`validateMachineSpec` passed; the CLI checks first). On a spec that was
// never validated it still never throws on a well-formed shape and marks a sentence nothing claims
// as `uncovered` instead of hiding it.
//
// Result shape (`construct.machine-spec-readback.v1`, fixed; ids are the spec's own so they are
// stable across runs and across edits to other items):
//   { schema, name, feature, summary, sentences: [{ id, text, status: 'covered'|'out-of-scope'|'uncovered',
//     reason, states: [{ id, req, text }], events: [...], transitions: [...], functions: [...] }],
//     types: [{ id, text }], counts }

import { narrateMachine, transitionSentence, humanize, stateLabel } from '../../engine/workflowNarrator.mjs';

/** The `schema` value of a read-back result, so a consumer can tell the shape and its version. */
export const READ_BACK_SCHEMA = 'construct.machine-spec-readback.v1';

const code = (s) => `\`${s}\``;

/** The spec as the machine descriptor the narrator reads (`workflowExtractor`'s shape, minus source positions). */
function describeMachine(spec) {
  const initial = (spec.states ?? []).find((s) => s.initial)?.id;
  return {
    id: spec.name,
    initial,
    states: (spec.states ?? []).map((s) => ({ name: s.id, path: s.id, type: s.final ? 'final' : 'atomic', final: !!s.final, entry: [], exit: [], invokes: [] })),
    transitions: (spec.transitions ?? []).map((t) => ({ kind: 'on', event: t.event, from: t.from, target: t.to, targetless: false, guard: t.guard, actions: [] })),
    context: [],
  };
}

const stateText = (s) => {
  const role = s.initial ? 'The flow starts here' : s.final ? 'An end state, the flow stops here' : 'A step of the flow';
  return `${stateLabel(s.id)}: ${role}.${s.description ? ` ${s.description}` : ''}`;
};

const eventText = (e) => `"${humanize(e.id)}" (${code(e.id)}) is something that can happen${e.payload ? `, carrying ${code(e.payload)}` : ', carrying nothing'}.`;

const functionText = (f) => {
  const parts = [`${code(f.name)} takes ${code(f.input)} and gives back ${code(f.output)}.`];
  if (f.precondition) parts.push(`It expects: ${f.precondition}`);
  if (f.postcondition) parts.push(`It promises: ${f.postcondition}`);
  return parts.join(' ');
};

/** Per transition id, its sentence: same-`from`/`event` branches are ordered guarded first (as `--generate` writes them) so the unguarded one reads "Otherwise". */
function transitionTexts(spec, machine) {
  const groups = new Map();
  spec.transitions.forEach((t, i) => {
    const key = `${t.from}|${t.event}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ t, d: machine.transitions[i] });
  });
  const ctx = { machine, servicesOf: () => [], compound: false };
  const texts = new Map();
  for (const group of groups.values()) {
    const ordered = [...group.filter((g) => g.d.guard), ...group.filter((g) => !g.d.guard)];
    ordered.forEach((g, i) => {
      const sentence = transitionSentence(g.d, i, ordered.slice(0, i).map((p) => p.d), ctx);
      texts.set(g.t.id, `In ${stateLabel(g.t.from)}: ${sentence}`);
    });
  }
  return texts;
}

/**
 * Read an accepted machine-spec.v1 back as plain English, grouped by requirement sentence.
 *
 * @param {object} spec A machine-spec.v1 object that passed `validateMachineSpec`.
 * @returns {{schema: string, name: string, feature: string|null, summary: string, sentences: object[], types: object[], counts: object}}
 *   `sentences` follows the requirement's order; each has `id` (the spec's sentence id), `text`, `status`
 *   (`covered`, `out-of-scope` with its `reason`, or `uncovered` for a spec that was never validated) and
 *   `states`, `events`, `transitions`, `functions` lists of `{ id, req, text }`. `types` are the declared
 *   types (no `req`); `counts` are totals.
 *
 * @example
 * const rb = readBackMachineSpec(JSON.parse(fs.readFileSync('spec.json', 'utf8')));
 * for (const s of rb.sentences) console.log(s.id, s.status, s.transitions.map((t) => t.text));
 */
export function readBackMachineSpec(spec) {
  const machine = describeMachine(spec);
  const trText = transitionTexts(spec, machine);
  const outOfScope = new Map((spec.outOfScope ?? []).map((o) => [o.req, o.reason]));
  const claims = (item, id) => (item.req ?? []).includes(id);
  const pick = (list, id, idOf, textOf) => (list ?? []).filter((it) => claims(it, id)).map((it) => ({ id: idOf(it), req: [...it.req], text: textOf(it) }));
  const sentences = spec.requirement.map((r) => {
    const states = pick(spec.states, r.id, (s) => s.id, stateText);
    const events = pick(spec.events, r.id, (e) => e.id, eventText);
    const transitions = pick(spec.transitions, r.id, (t) => t.id, (t) => trText.get(t.id));
    const functions = pick(spec.functions, r.id, (f) => f.name, functionText);
    const claimed = states.length + events.length + transitions.length + functions.length > 0;
    const status = outOfScope.has(r.id) ? 'out-of-scope' : claimed ? 'covered' : 'uncovered';
    return { id: r.id, text: r.text, status, reason: outOfScope.get(r.id) ?? null, states, events, transitions, functions };
  });
  const types = (spec.types ?? []).map((t) => ({ id: t.name, text: `${code(t.name)} is ${code(t.definition)}${t.description ? `: ${t.description}` : ''}` }));
  const count = (status) => sentences.filter((s) => s.status === status).length;
  return {
    schema: READ_BACK_SCHEMA,
    name: spec.name,
    feature: spec.feature ?? null,
    summary: narrateMachine(machine).summary,
    sentences,
    types,
    counts: { sentences: sentences.length, covered: count('covered'), outOfScope: count('out-of-scope'), uncovered: count('uncovered'), types: types.length },
  };
}

const GROUPS = ['states', 'events', 'transitions', 'functions'];

/**
 * Render a read-back as text (one block per sentence) or as its JSON.
 *
 * @param {ReturnType<typeof readBackMachineSpec>} readBack From `readBackMachineSpec`.
 * @param {{format?: 'text'|'json'}} [options]
 * @returns {string}
 */
export function renderReadBack(readBack, { format = 'text' } = {}) {
  if (format === 'json') return JSON.stringify(readBack, null, 2);
  const lines = [`Read-back of "${readBack.name}"${readBack.feature ? ` (feature ${readBack.feature})` : ''}`, readBack.summary, ''];
  for (const s of readBack.sentences) {
    lines.push(`${s.id}: ${s.text}`);
    if (s.status === 'out-of-scope') lines.push(`  Out of scope: ${s.reason}`);
    if (s.status === 'uncovered') lines.push('  Not covered by anything, and not marked out of scope.');
    for (const key of GROUPS) for (const it of s[key]) lines.push(`  - ${it.text}`);
    lines.push('');
  }
  if (readBack.types.length) {
    lines.push('Types the spec declares');
    for (const t of readBack.types) lines.push(`  - ${t.text}`);
    lines.push('');
  }
  const c = readBack.counts;
  lines.push(`${c.sentences} sentence(s): ${c.covered} covered, ${c.outOfScope} out of scope${c.uncovered ? `, ${c.uncovered} NOT covered` : ''}.`);
  return lines.join('\n');
}
