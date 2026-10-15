// T5.1 atom generator (docs/line/FLUENT-PLAN-2026-10-15.md, E5): one C1 reference entry -> C2 answer through the
// stage 1 pipeline (buildRequest -> runPilot -> runGate) -> a pending proposal file. Only approveProposal writes to
// the catalog, and only for a proposal that passed the gate and adds a new atom or molecule.
//
//   const { proposal } = await generate('Array.prototype.flatMap', { model: mockModel(fixtures) });
//   await writeProposal(proposal, dir);        // pending, catalog untouched
//   approveProposal(file, { catalog });        // owner step: appends the atom, marks the proposal approved
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reading } from '../../line-smith/scripts/lib-sentence.mjs';
import { runGate } from '../gate/assemble.mjs';
import { checkGrammar } from '../gate/grammar/grammar.mjs';
import { buildRequest, MAX_CANDIDATES } from '../pilot/request/request.mjs';
import { memberPattern } from '../pilot/entries/array.mjs';
import { runPilot } from '../pilot/runner/runner.mjs';

export const REFERENCE_PATH = fileURLToPath(new URL('../../line-codemod/bench/atoms/js-reference/reference.json', import.meta.url));
export const CATALOG_PATH = fileURLToPath(new URL('../../line-smith/src/atoms/catalog.json', import.meta.url));
export const PROPOSALS_DIR = fileURLToPath(new URL('./proposals/', import.meta.url));

/** Decisions that add an atom to the catalog; `existing` and `not-expressible` add nothing. */
export const ADDS_ATOM = ['new-atom', 'molecule'];

// Catalog module for an entry's section when no candidate atom names one.
const SECTION_MODULES = {
  Array: 'lists', String: 'text', Object: 'objects', Number: 'numbers', Math: 'math', Date: 'dates',
  RegExp: 'patterns', JSON: 'json', Promise: 'promises', Map: 'collections', Set: 'collections',
  WeakMap: 'collections', WeakSet: 'collections', Boolean: 'values', BigInt: 'numbers', Function: 'functions',
};

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const loadCatalog = (path) => readJson(path).atoms;

/**
 * The C1 entry with this key, else the first with this id, or null. Keys are unique; ids repeat across overloads,
 * which are addressed by key (`new Array #2`).
 */
export function findEntry(id, { reference = readJson(REFERENCE_PATH).entries } = {}) {
  return reference.find((e) => e.key === id) ?? reference.find((e) => e.id === id) ?? null;
}

// Construct and call entries need the section name; memberPattern (pilot) hard-codes Array for them.
function patternFor(entry) {
  const name = entry.section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (entry.kind === 'construct') return new RegExp(`\\bnew ${name}\\(`);
  if (entry.kind === 'call') return new RegExp(`(?<!new )(?<![\\w$.])${name}\\(`);
  return memberPattern(entry);
}

const plainModule = (module) => String(module ?? '').replace(/^generated\//, '');

/**
 * Catalog atoms whose `js` uses the entry's member: [{atom, fluent, js, module}], any section. `.includes(` matches
 * both String and Array atoms, so the best match comes first: atoms in the section's own module, then atoms whose
 * `js` names more of the entry's params (`fromIndex` picks hasItem over hasText). The sort is stable.
 */
export function candidatesFor(entry, catalog) {
  const pattern = patternFor(entry);
  if (!pattern) return [];
  const home = SECTION_MODULES[entry.section];
  const names = (entry.params ?? []).map((p) => p.name);
  const score = (c) => (plainModule(c.module) === home ? 100 : 0)
    + names.filter((n) => c.js.some((js) => new RegExp(`\\b${n}\\b`).test(js))).length;
  return catalog
    .filter((a) => Array.isArray(a.js) && a.js.some((js) => pattern.test(js)))
    .map((a) => ({ atom: a.atom, fluent: a.fluent, js: a.js, module: a.module, mutates: a.mutates }))
    .sort((a, b) => score(b) - score(a));
}

// C2 kind of a catalog sentence, for reuse answers: the first word gives it (R5, R9).
function sentenceKind(atom) {
  if (atom.fluent.startsWith('checks(')) return 'question';
  if (atom.fluent.startsWith('clones(')) return 'copy';
  return atom.mutates ? 'in-place' : 'value';
}

/**
 * Rules-only model, the default: no network, no fixtures. With a candidate that has a fluent sentence it answers
 * `existing` with that atom; otherwise `not-expressible`, so a new atom always needs --real or fixtures.
 */
export function rulesModel(candidates) {
  const reuse = candidates.find((c) => c.fluent);
  return async () => {
    const answer = reuse
      ? { decision: 'existing', atom: null, existing: reuse.atom, kind: null, sentence: null, js: null, params: [], parts: null, reason: null }
      : { decision: 'not-expressible', atom: null, existing: null, kind: null, sentence: null, js: null, params: [], parts: null, reason: 'The rules-only generator has no candidate atom for this entry; run it with a model.' };
    if (reuse) {
      // Reusing an atom keeps its sentence and JS, so the gate's grammar check still reads a sentence.
      Object.assign(answer, { kind: sentenceKind(reuse), sentence: reuse.fluent, js: [].concat(reuse.js)[0] });
    }
    const { decision, ...rest } = answer;
    const text = `${decision}", ${JSON.stringify(rest).slice(1)}`;
    return { text, tokensIn: 0, tokensOut: 0 };
  };
}

/** C3 gate as wired today: schema + grammar; equivalence and types plug in through `checks` once they land. */
export function defaultGate(checks = {}) {
  return async (answer) => runGate(answer, { grammar: checkGrammar, ...checks });
}

function moduleFor(entry, candidates) {
  const named = candidates.find((c) => c.module)?.module;
  return named ? plainModule(named) : SECTION_MODULES[entry.section] ?? 'fluent';
}

/** The catalog entry an approved answer becomes; null when the decision adds no atom. */
export function catalogEntry(answer, { entry, candidates = [] }) {
  if (!ADDS_ATOM.includes(answer?.decision)) return null;
  const mutates = answer.kind === 'in-place';
  const out = {
    generated: false,
    atom: answer.atom,
    module: moduleFor(entry, candidates),
    reads: reading(answer.sentence),
    js: [answer.js],
    pure: !mutates && answer.kind !== 'effect',
    mutates,
    fluent: answer.sentence,
    params: answer.params,
  };
  if (answer.decision === 'molecule') out.parts = answer.parts;
  out.verified = false;
  out.unverifiedReason = 'added by the fluent generator; no check set yet';
  return out;
}

/**
 * One entry through the stage 1 pipeline. `model` defaults to the rules-only model; a real model is the caller's
 * explicit choice. Returns {proposal, result} and writes nothing.
 */
export async function generate(id, {
  model, gate = defaultGate(), maxRetries = 1, modelName,
  reference, catalog = loadCatalog(CATALOG_PATH), now = () => new Date().toISOString(),
} = {}) {
  const entry = findEntry(id, reference ? { reference } : {});
  if (!entry) throw new Error(`No reference entry has the id ${JSON.stringify(id)}.`);
  const candidates = candidatesFor(entry, catalog).slice(0, MAX_CANDIDATES);
  const run = model ?? rulesModel(candidates);
  const build = (e, { refusal }) => buildRequest(e, { candidates, refusal });
  const { results } = await runPilot([entry], { model: run, gate, build, maxRetries });
  const result = results[0];
  const taken = result.answer?.atom && catalog.some((a) => a.atom === result.answer.atom);
  const proposal = {
    version: 1,
    status: 'pending',
    entry: entry.id,
    key: entry.key,
    model: modelName ?? (model ? 'injected' : 'rules'),
    createdAt: now(),
    candidates: candidates.map((c) => c.atom),
    answer: result.answer,
    gate: result.gate,
    tries: result.tries,
    adds: Boolean(result.gate?.pass && !taken && ADDS_ATOM.includes(result.answer?.decision)),
    catalogEntry: result.answer && result.gate?.pass ? catalogEntry(result.answer, { entry, candidates }) : null,
  };
  if (taken) proposal.note = `The catalog already has an atom named ${result.answer.atom}.`;
  return { proposal, result };
}

/** File name for an entry's proposal: its key with every run of non-word characters as one dash. */
export function proposalName(key) {
  return `${key.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}.json`;
}

export function writeProposal(proposal, dir = PROPOSALS_DIR) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, proposalName(proposal.key ?? proposal.entry));
  writeFileSync(file, `${JSON.stringify(proposal, null, 2)}\n`);
  return file;
}

/**
 * Owner step: append the proposal's catalog entry to the catalog and mark the proposal approved. Throws, writing
 * nothing, unless the proposal is pending, passed the gate, adds an atom, and the atom id is free.
 */
export function approveProposal(file, { catalog = CATALOG_PATH, now = () => new Date().toISOString() } = {}) {
  const proposal = readJson(file);
  if (proposal.status !== 'pending') throw new Error(`The proposal for ${proposal.entry} is ${proposal.status}, not pending.`);
  if (!proposal.gate?.pass) throw new Error(`The proposal for ${proposal.entry} did not pass the gate: ${proposal.gate?.refusal ?? 'no gate result'}`);
  const decision = proposal.answer?.decision;
  if (!ADDS_ATOM.includes(decision) || !proposal.catalogEntry) {
    throw new Error(`The proposal for ${proposal.entry} is ${decision}; it adds no atom to the catalog.`);
  }
  const data = readJson(catalog);
  const atom = proposal.catalogEntry.atom;
  if (data.atoms.some((a) => a.atom === atom)) throw new Error(`The catalog already has an atom named ${atom}.`);
  const approvedAt = now();
  data.atoms.push({ ...proposal.catalogEntry, source: { by: 'line-fluent/generator', entry: proposal.entry, approvedAt } });
  writeFileSync(catalog, `${JSON.stringify(data, null, 1)}\n`);
  const approved = { ...proposal, status: 'approved', approvedAt, catalog };
  writeFileSync(file, `${JSON.stringify(approved, null, 2)}\n`);
  return approved;
}
