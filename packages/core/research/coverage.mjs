// #673 (R5, part of #576 / #570) -- the traceability report of a machine-spec.v1: which functions and
// generated files realize each requirement sentence, and, the other way round, which functions cite no
// sentence at all.
//
// The spec's own `SPEC-010` check already refuses a sentence nothing claims; this is the same question
// answered as a map instead of a verdict. Per sentence: covered (by which states, events, transitions
// and functions, and so in which generated files), out of scope (with the spec's reason), or uncovered
// (nothing claims it and it is not out of scope: the only status a person has to act on). Per function:
// the sentences it cites, or `orphan` when none of its `req` links resolves to a sentence of the
// requirement (a link to an id the requirement does not have is `unknownReq`, SPEC-009). Per generated
// file: the sentences it serves.
//
// The file paths are the R2 generator's own (`plannedSpecFiles` in specToCode.mjs, which
// `generateFromSpec` itself calls), so the report names exactly where `--generate` puts things, before
// or without running it. What it maps to a file: a function to its `defineService` stub
// (`services/<name>.ts`); a state, event or transition to the machine's three files (the workflow, its
// typed state union, the locked every-path unit test), because the generator writes the whole machine
// into those, not one file per item. The declared `types` carry no `req`, so `types.ts` is not listed.
//
// Deterministic, offline, no model. Input is a spec that is well formed apart from possibly the
// traceability rules SPEC-009 and SPEC-010 (the CLI checks first and prints the plain validation report
// for anything else, e.g. a broken structure or a sentence marked out of scope that an item still claims).
// The result is fixed-size per spec and its ids are the spec's own (sentence ids, function names,
// transition ids), so they stay valid across runs and across edits to other items.
//
// Result shape (`construct.machine-spec-coverage.v1`, fixed):
//   { schema, name, feature,
//     sentences: [{ id, text, status: 'covered'|'out-of-scope'|'uncovered', reason,
//                   functions: [name], machine: { states: [id], events: [id], transitions: [id] }, files: [path] }],
//     functions: [{ name, file, status: 'cites'|'orphan', req: [sentence id], unknownReq: [id] }],
//     files: [{ path, kind: 'workflow'|'state'|'test'|'service', sentences: [sentence id] }],
//     counts: { sentences, covered, outOfScope, uncovered, functions, orphanFunctions, files } }

import path from 'node:path';
import { plannedSpecFiles } from './specToCode.mjs';

/** The `schema` value of a coverage result, so a consumer can tell the shape and its version. */
export const COVERAGE_SCHEMA = 'construct.machine-spec-coverage.v1';

/** The `SPEC-*` rules a spec may still break and get a coverage report: the two this report is about. Anything else is refused with the plain validation report first. */
export const COVERAGE_TOLERATED_RULES = Object.freeze(['SPEC-009', 'SPEC-010']);

const posix = (root, abs) => path.relative(root, abs).split(path.sep).join('/');

/**
 * Map every requirement sentence to the functions and generated files that realize it, and every
 * function back to the sentences it cites.
 *
 * @param {string} root Project root (only used to compute the project-relative generated paths).
 * @param {object} spec A machine-spec.v1 object whose only violations, if any, are SPEC-009/SPEC-010.
 * @param {{feature?: string}} [options] `feature` is used only when the spec has no `feature` field.
 * @returns {{schema: string, name: string, feature: string, sentences: object[], functions: object[], files: object[], counts: object}}
 *   `sentences` follow the requirement's order; `functions` and `files` the generator's order (functions in the spec's order; files: workflow, state union, unit test, then the function stubs).
 * @throws {ConstructError} Usage error (exit code 2) when neither `spec.feature` nor `options.feature` is given.
 *
 * @example
 * const cov = coverageOfMachineSpec(root, spec);
 * const gaps = cov.sentences.filter((s) => s.status === 'uncovered').map((s) => s.id);
 */
export function coverageOfMachineSpec(root, spec, { feature } = {}) {
  const plan = plannedSpecFiles(root, spec, { feature });
  const machineFiles = [
    { path: posix(root, plan.workflow.file), kind: 'workflow' },
    { path: posix(root, plan.workflow.stateFile), kind: 'state' },
    { path: plan.unitTest, kind: 'test' },
  ];
  const fileOfFunction = new Map(plan.functions.map((f) => [f.name, posix(root, f.file)]));
  const known = new Set(spec.requirement.map((r) => r.id));
  const outOfScope = new Map((spec.outOfScope ?? []).map((o) => [o.req, o.reason]));
  const claiming = (list, id, idOf) => (list ?? []).filter((it) => (it.req ?? []).includes(id)).map(idOf);

  const sentences = spec.requirement.map((r) => {
    const functions = claiming(spec.functions, r.id, (f) => f.name);
    const machine = {
      states: claiming(spec.states, r.id, (s) => s.id),
      events: claiming(spec.events, r.id, (e) => e.id),
      transitions: claiming(spec.transitions, r.id, (t) => t.id ?? `${t.from}--${t.event}-->${t.to}`),
    };
    const inMachine = machine.states.length + machine.events.length + machine.transitions.length > 0;
    const status = outOfScope.has(r.id) ? 'out-of-scope' : functions.length + Number(inMachine) > 0 ? 'covered' : 'uncovered';
    const files = [...(inMachine ? machineFiles.map((f) => f.path) : []), ...functions.map((name) => fileOfFunction.get(name))];
    return { id: r.id, text: r.text, status, reason: outOfScope.get(r.id) ?? null, functions, machine, files };
  });

  const functions = spec.functions.map((f) => {
    const req = f.req.filter((id) => known.has(id));
    return { name: f.name, file: fileOfFunction.get(f.name), status: req.length ? 'cites' : 'orphan', req, unknownReq: f.req.filter((id) => !known.has(id)) };
  });

  const served = (pathOf) => sentences.filter((s) => s.files.includes(pathOf)).map((s) => s.id);
  const files = [...machineFiles, ...functions.map((f) => ({ path: f.file, kind: 'service' }))].map((f) => ({ ...f, sentences: served(f.path) }));

  const count = (status) => sentences.filter((s) => s.status === status).length;
  return {
    schema: COVERAGE_SCHEMA,
    name: spec.name,
    feature: plan.feature,
    sentences,
    functions,
    files,
    counts: { sentences: sentences.length, covered: count('covered'), outOfScope: count('out-of-scope'), uncovered: count('uncovered'), functions: functions.length, orphanFunctions: functions.filter((f) => f.status === 'orphan').length, files: files.length },
  };
}

/** Sentence ids the person has to act on: nothing claims them and they are not out of scope. */
export const uncoveredSentences = (coverage) => coverage.sentences.filter((s) => s.status === 'uncovered').map((s) => s.id);

const list = (items) => items.join(', ');

/**
 * Render a coverage result as text (one block per sentence, then the functions, then the files) or as its JSON.
 *
 * @param {ReturnType<typeof coverageOfMachineSpec>} coverage From `coverageOfMachineSpec`.
 * @param {{format?: 'text'|'json'}} [options]
 * @returns {string}
 */
export function renderCoverage(coverage, { format = 'text' } = {}) {
  if (format === 'json') return JSON.stringify(coverage, null, 2);
  const fileOf = new Map(coverage.functions.map((f) => [f.name, f.file]));
  const lines = [`Coverage of "${coverage.name}" (feature ${coverage.feature})`, '', 'Sentences'];
  for (const s of coverage.sentences) {
    lines.push(`${s.id}: ${s.text}`);
    if (s.status === 'out-of-scope') lines.push(`  Out of scope: ${s.reason}`);
    if (s.status === 'uncovered') lines.push('  NOT covered: no state, event, transition or function cites it, and it is not marked out of scope.');
    for (const name of s.functions) lines.push(`  function ${name} -> ${fileOf.get(name)}`);
    const m = s.machine;
    const parts = [['states', m.states], ['events', m.events], ['transitions', m.transitions]].filter(([, ids]) => ids.length).map(([kind, ids]) => `${kind} ${list(ids)}`);
    if (parts.length) lines.push(`  machine (${parts.join('; ')}) -> ${list(coverage.files.filter((f) => f.kind !== 'service').map((f) => f.path))}`);
    lines.push('');
  }
  lines.push('Functions and the sentences they cite');
  for (const f of coverage.functions) {
    const unknown = f.unknownReq.length ? ` (unknown link ${list(f.unknownReq)})` : '';
    lines.push(f.status === 'orphan' ? `  ${f.name}: cites no sentence of the requirement${unknown}` : `  ${f.name}: ${list(f.req)}${unknown}`);
  }
  lines.push('', 'Generated files and the sentences they serve');
  for (const f of coverage.files) lines.push(`  ${f.path}: ${f.sentences.length ? list(f.sentences) : 'no sentence'}`);
  lines.push('');
  const c = coverage.counts;
  lines.push(`${c.sentences} sentence(s): ${c.covered} covered, ${c.outOfScope} out of scope${c.uncovered ? `, ${c.uncovered} NOT covered` : ''}; ${c.functions} function(s)${c.orphanFunctions ? `, ${c.orphanFunctions} citing no sentence` : ''}; ${c.files} generated file(s).`);
  return lines.join('\n');
}
