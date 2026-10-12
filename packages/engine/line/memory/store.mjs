// im3 -- one project's memory store: `<state>/memory/<step>.jsonl`, appended through Construct's writer
// (writeLineState, one O_APPEND line under the file lock), read only from this project's own state folder. Nothing
// here opens a socket or sends a record anywhere; a record that holds a project word or code text is refused.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeLineState } from '../../transactionalWriter.mjs';
import { LineOpError } from '../contract.mjs';
import { projectWordIn, splitWords } from '../slots.mjs';
import { MEMORY_VERSION, MEMORY_DIR, STEP_ID, assertMemoryRecord, assertMemoryExport } from './contract.mjs';
import { recallFrom, preferenceOf } from './recall.mjs';

/** @typedef {import('./contract.mjs').MemoryRecord} MemoryRecord */
/** @typedef {import('./contract.mjs').MemoryProposal} MemoryProposal */
/** @typedef {import('./contract.mjs').MemoryOutcome} MemoryOutcome */

const uniq = (xs) => [...new Set((xs ?? []).map(String))];
/**
 * Line's own structural vocabulary (layers, kinds, roles, template and verb words): a record is made of these, so a
 * project name that happens to be one of them ("data", "list") is not a leak of the record. Everything else is.
 */
export const LINE_VOCAB = new Set(['ui', 'workflow', 'workflows', 'data', 'library', 'feature', 'features', 'component', 'components', 'page', 'pages', 'fixture',
  'fixtures', 'atom', 'molecule', 'organism', 'role', 'kind', 'new', 'add', 'update', 'remove', 'promote', 'fix', 'all', 'problem', 'prop', 'handler', 'route',
  'step', 'base', 'based', 'via', 'set', 'item', 'items', 'name', 'part', 'unbased', 'layout', 'create', 'combo', 'fragment', 'retrieval', 'line', 'sha256']);

/**
 * The project's names and domain words, for the leak guard (read lazily; an unreadable project has none).
 * @param {string} root
 * @returns {Promise<string[]>}
 */
async function readProjectWords(root) {
  try {
    const { readLineProject } = await import('../model.mjs');
    const { wordsOf } = await import('../records.mjs');
    const p = readLineProject(root);
    const names = [...(p.library ?? []).map((l) => l.name), ...(p.features ?? []).flatMap((f) => [f.name, ...(f.items ?? []).map((i) => i.name)])];
    return uniq(names.flatMap((n) => [String(n ?? '').toLowerCase(), ...wordsOf(String(n ?? ''))]).filter((w) => w.length >= 3));
  } catch {
    return [];
  }
}

/**
 * The memory of one project.
 * @param {string} root The project root (its memory never leaves `<root>/<stateDir>/memory/`).
 * @param {{stateDir?: string, words?: string[], now?: () => string}} [o] `words`: the project's names and domain words
 *   for the leak guard (default: read from the project); `stateDir`: the Line state folder (default `line`).
 * @returns The store: records, recordOutcome, recall, prefer, sizes, forget, remove, exportAll, importAll.
 */
export function createMemory(root, o = {}) {
  const stateDir = (o.stateDir ?? 'line').replace(/\/+$/, '');
  const now = o.now ?? (() => new Date().toISOString());
  let words = o.words ?? null;
  const wordsNow = async () => (words ??= await readProjectWords(root));
  const rel = (step) => `${stateDir}/${MEMORY_DIR}/${step}.jsonl`;
  const checkStep = (step) => { if (typeof step !== 'string' || !STEP_ID.test(step)) throw new LineOpError(`"${String(step).slice(0, 40)}" is not a memory step.`, 'BAD_STEP'); };

  /**
   * One step's records, oldest first (a missing file is none; a bad line is skipped).
   * @param {string} step
   * @returns {MemoryRecord[]}
   */
  function records(step) {
    checkStep(step);
    let text = '';
    try { text = fs.readFileSync(path.join(root, rel(step)), 'utf8'); } catch { return []; }
    return text.split('\n').filter(Boolean).map((l) => { try { const r = JSON.parse(l); assertMemoryRecord(r); return r; } catch { return null; } }).filter((r) => r && r.step === step);
  }

  /** The guard every stored record passes: the shape, then no project word. */
  async function guard(r) {
    try { assertMemoryRecord(r); } catch (e) { throw new LineOpError(`Line did not remember this: ${/** @type {any} */ (e).message}`, 'BAD_RECORD'); }
    const own = new Set([...LINE_VOCAB, ...splitWords(r.intent)]);
    const leak = projectWordIn(r, (await wordsNow()).filter((w) => !own.has(w.toLowerCase())));
    if (leak) throw new LineOpError(`Line did not remember this: the record holds the project word "${leak}", and memory keeps slots only.`, 'LEAK');
  }

  /**
   * im3: remember what happened to one proposal (append-only, through the writer).
   * @param {string} step @param {MemoryProposal} proposal @param {MemoryOutcome} outcome
   * @returns {Promise<MemoryRecord>}
   */
  async function recordOutcome(step, proposal, outcome) {
    checkStep(step);
    /** @type {MemoryRecord} */
    const r = {
      v: MEMORY_VERSION, id: `m-${crypto.randomBytes(6).toString('hex')}`, step, at: now(),
      intent: String(proposal?.intent ?? ''), structure: proposal?.structure ?? null,
      slots: uniq(proposal?.slots), neighbourhood: uniq(proposal?.neighbourhood), options: uniq(proposal?.options),
      proposed: proposal?.proposed ?? null, kind: /** @type {any} */ (outcome?.kind), chosen: outcome?.chosen ?? null,
      by: /** @type {any} */ (outcome?.by), agreed: Boolean(outcome?.chosen) && outcome?.chosen === (proposal?.proposed ?? null),
    };
    await guard(r);
    try { writeLineState(root, rel(step), `${JSON.stringify(r)}\n`, { append: true, stateDir }); } catch (e) {
      throw new LineOpError(`Line could not save this memory; nothing was changed (${String(/** @type {any} */ (e)?.message ?? e).slice(0, 100)}).`, 'WRITE_FAILED');
    }
    return r;
  }

  /**
   * j5: the past decisions of `step` like this one (exact first, then similar over slots and structure).
   * @param {string} step @param {import('./recall.mjs').RecallContext} context @param {number} [k]
   */
  function recall(step, context, k = 5) {
    return recallFrom(records(step), step, context, k);
  }

  /**
   * The option memory prefers among `optionIds` (all already checked), or null.
   * @param {string} step @param {import('./recall.mjs').RecallContext} context @param {string[]} optionIds
   * @param {{labelOf?: (id: string) => string, k?: number}} [o2]
   */
  function prefer(step, context, optionIds, o2 = {}) {
    return preferenceOf(recall(step, context, o2.k ?? 10), optionIds, { labelOf: o2.labelOf });
  }

  /** Every step with memory and its size. @returns {Record<string, number>} */
  function sizes() {
    const dir = path.join(root, stateDir, MEMORY_DIR);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return {}; }
    return Object.fromEntries(files.map((f) => f.replace(/\.jsonl$/, '')).filter((s) => STEP_ID.test(s)).map((s) => [s, records(s).length]).filter(([, n]) => Number(n) > 0));
  }

  /** Rewrite one step's file atomically (writeLineState: a temp file then rename). */
  const rewrite = (step, recs) => writeLineState(root, rel(step), recs.map((r) => `${JSON.stringify(r)}\n`).join(''), { stateDir });

  /** Forget one step's memory (every record). @param {string} step @returns {{step: string, removed: number}} */
  function forget(step) {
    const n = records(step).length;
    if (n) rewrite(step, []);
    return { step, removed: n };
  }

  /** Delete one record; it is never recalled again. @param {string} step @param {string} id @returns {boolean} */
  function remove(step, id) {
    const recs = records(step);
    const kept = recs.filter((r) => r.id !== id);
    if (kept.length === recs.length) return false;
    rewrite(step, kept);
    return true;
  }

  /**
   * Correct one record in place (the Memory tab's edit): `change` returns the new record, which must keep its id and
   * step and pass the record's shape check. Returns the stored record, or null when there is no such record.
   * @param {string} step @param {string} id @param {(r: MemoryRecord) => MemoryRecord} change
   * @returns {MemoryRecord|null}
   */
  function update(step, id, change) {
    const recs = records(step);
    const i = recs.findIndex((r) => r.id === id);
    if (i < 0) return null;
    const next = change({ ...recs[i] });
    try { assertMemoryRecord(next); } catch (e) { throw new LineOpError(`Line did not change this memory: ${/** @type {any} */ (e).message}`, 'BAD_RECORD'); }
    if (next.id !== id || next.step !== step) throw new LineOpError('Line did not change this memory: a record keeps its id and step.', 'BAD_RECORD');
    recs[i] = next;
    rewrite(step, recs);
    return next;
  }

  /** Export every step's records (slots only, nothing of the project's names). @returns {import('./contract.mjs').MemoryExport} */
  function exportAll() {
    return { v: MEMORY_VERSION, kind: 'line-memory', steps: Object.fromEntries(Object.keys(sizes()).sort().map((s) => [s, records(s)])) };
  }

  /**
   * Import an export: each record passes the shape check and THIS project's leak guard; records already here are skipped.
   * @param {any} bundle @returns {Promise<{added: number, skipped: number}>}
   */
  async function importAll(bundle) {
    try { assertMemoryExport(bundle); } catch (e) { throw new LineOpError(`That is not a Line memory export: ${/** @type {any} */ (e).message}`, 'BAD_EXPORT'); }
    let added = 0; let skipped = 0;
    for (const [step, recs] of Object.entries(bundle.steps)) {
      const have = new Set(records(step).map((r) => r.id));
      const fresh = [];
      for (const r of recs) { if (have.has(r.id)) { skipped += 1; continue; } await guard(r); fresh.push(r); }
      if (fresh.length) writeLineState(root, rel(step), fresh.map((r) => `${JSON.stringify(r)}\n`).join(''), { append: true, stateDir });
      added += fresh.length;
    }
    return { added, skipped };
  }

  return { root, stateDir, records, recordOutcome, recall, prefer, sizes, forget, remove, update, exportAll, importAll };
}

/** @typedef {ReturnType<typeof createMemory>} LineMemory */
