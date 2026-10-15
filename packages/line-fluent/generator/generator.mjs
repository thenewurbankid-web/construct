// T5.1 atom generator (docs/line/FLUENT-PLAN-2026-10-15.md, E5): one C1 reference entry -> C2 answer through the
// stage 1 pipeline (buildRequest -> runPilot -> runGate) -> a pending proposal file. Only approveProposal adds an
// atom, and only for a proposal that passed the gate and adds a new atom or molecule. It writes line-smith's
// hand-kept src/atoms/approved.json; gen-atoms merges that into catalog.json on every run.
//
//   const { proposal } = await generate('Array.prototype.flatMap', { model: mockModel(fixtures) });
//   writeProposal(proposal, dir);              // pending, nothing else written
//   approveProposal(file);                     // owner step: appends to approved.json, marks the proposal approved
//   node packages/line-smith/scripts/gen-atoms.mjs   // rebuilds catalog.json + generated/approved.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkApproved, emitApproved, newVerbs } from '../../line-smith/scripts/lib-approved.mjs';
import { runGate } from '../gate/assemble.mjs';
import { checkGrammar } from '../gate/grammar/grammar.mjs';
import { buildRequest, MAX_CANDIDATES } from '../pilot/request/request.mjs';
import { memberPattern } from '../pilot/entries/array.mjs';
import { runPilot } from '../pilot/runner/runner.mjs';

export const REFERENCE_PATH = fileURLToPath(new URL('../../line-codemod/bench/atoms/js-reference/reference.json', import.meta.url));
export const CATALOG_PATH = fileURLToPath(new URL('../../line-smith/src/atoms/catalog.json', import.meta.url));
export const APPROVED_PATH = fileURLToPath(new URL('../../line-smith/src/atoms/approved.json', import.meta.url));
export const NAMING_PATH = fileURLToPath(new URL('../../line-smith/src/atoms/naming.json', import.meta.url));
export const GEN_ATOMS_PATH = fileURLToPath(new URL('../../line-smith/scripts/gen-atoms.mjs', import.meta.url));
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

/**
 * The approved.json source entry an answer becomes (line-smith scripts/lib-approved.mjs); null when the decision adds
 * no atom. gen-atoms derives the catalog entry and the wrapper from it.
 */
export function approvedEntry(answer, { entry }) {
  if (!ADDS_ATOM.includes(answer?.decision)) return null;
  const out = { atom: answer.atom, entry: entry.id, fluent: answer.sentence, js: answer.js, params: answer.params, kind: answer.kind };
  if (answer.decision === 'molecule') out.parts = answer.parts;
  return out;
}

/** The catalog entry gen-atoms will emit for an approved source entry (a preview; approve does not write it). */
export function catalogPreview(source) {
  return emitApproved([source]).entries[0];
}

/**
 * One entry through the stage 1 pipeline. `model` defaults to the rules-only model; a real model is the caller's
 * explicit choice. Returns {proposal, result} and writes nothing.
 */
export async function generate(id, {
  model, gate = defaultGate(), maxRetries = 1, modelName,
  reference, catalog = loadCatalog(CATALOG_PATH), approved = loadCatalog(APPROVED_PATH),
  now = () => new Date().toISOString(),
} = {}) {
  const entry = findEntry(id, reference ? { reference } : {});
  if (!entry) throw new Error(`No reference entry has the id ${JSON.stringify(id)}.`);
  const candidates = candidatesFor(entry, catalog).slice(0, MAX_CANDIDATES);
  const run = model ?? rulesModel(candidates);
  const build = (e, { refusal }) => buildRequest(e, { candidates, refusal });
  const { results } = await runPilot([entry], { model: run, gate, build, maxRetries });
  const result = results[0];
  const taken = result.answer?.atom && [...catalog, ...approved].some((a) => a.atom === result.answer.atom);
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
    approvedEntry: result.answer && result.gate?.pass ? approvedEntry(result.answer, { entry }) : null,
    catalogEntry: null,
  };
  if (proposal.adds) {
    try {
      checkApproved([proposal.approvedEntry]);
      proposal.catalogEntry = catalogPreview(proposal.approvedEntry);
    } catch (e) {
      proposal.adds = false;
      proposal.note = e.message;
    }
  }
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
 * Owner step: add the proposal's atom to line-smith's hand-kept approved.json and mark the proposal approved. Throws,
 * writing nothing, unless the proposal is pending, passed the gate, adds an atom, and the atom id is free in both the
 * catalog and approved.json. The catalog itself is rebuilt by line-smith's gen-atoms (`npm run gen:atoms`), which
 * merges approved.json in, so approved atoms survive every regeneration.
 */
export function approveProposal(file, {
  approved = APPROVED_PATH, catalog = CATALOG_PATH, naming = NAMING_PATH, now = () => new Date().toISOString(),
} = {}) {
  const proposal = readJson(file);
  if (proposal.status !== 'pending') throw new Error(`The proposal for ${proposal.entry} is ${proposal.status}, not pending.`);
  if (!proposal.gate?.pass) throw new Error(`The proposal for ${proposal.entry} did not pass the gate: ${proposal.gate?.refusal ?? 'no gate result'}`);
  const decision = proposal.answer?.decision;
  if (!ADDS_ATOM.includes(decision) || !proposal.approvedEntry) {
    throw new Error(`The proposal for ${proposal.entry} is ${decision}; it adds no atom to the catalog.`);
  }
  const data = readJson(approved);
  const atom = proposal.approvedEntry.atom;
  if (loadCatalog(catalog).some((a) => a.atom === atom)) throw new Error(`The catalog already has an atom named ${atom}.`);
  const approvedAt = now();
  const source = { ...proposal.approvedEntry, approvedAt };
  // Same rules gen-atoms applies, so an approved atom never breaks the next regeneration.
  checkApproved([...data.atoms, source]);
  data.atoms.push(source);
  writeFileSync(approved, `${JSON.stringify(data, null, 2)}\n`);
  // A new verb the shape gate let through joins the grammar, so the trie reads the sentence from now on.
  // Only the verbs array is rewritten, so the rest of the hand-kept file keeps its layout.
  const text = readFileSync(naming, 'utf8');
  const { grammar } = JSON.parse(text);
  const verbs = newVerbs(source.fluent, grammar);
  if (verbs.length) {
    const all = [...new Set([...grammar.verbs, ...verbs])].sort();
    writeFileSync(naming, text.replace(/("verbs": \[)[^\]]*?(\s*\])/, (_, open, close) => `${open}${all.map((v) => `\n      ${JSON.stringify(v)}`).join(',')}${close}`));
  }
  const done = { ...proposal, status: 'approved', approvedAt, approved, newVerbs: verbs };
  writeFileSync(file, `${JSON.stringify(done, null, 2)}\n`);
  return done;
}
