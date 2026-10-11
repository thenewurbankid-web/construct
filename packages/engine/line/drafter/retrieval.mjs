// Training records and nearest-shape retrieval. A record is one TRANSITION, delexicalized: the normalized request,
// slot shapes, intent, the structure hashes before, the route's slot-form steps, expressions and delta, the hashes
// after, and whether a person approved it. Deltas (not whole-project hashes, which rarely repeat) are what a future
// model learns from. Records live inside the project (<state>/drafter/transitions.jsonl) and are written only through
// Construct's writer. They stay apart from the plan records (<state>/records/plans.jsonl, ../records.mjs): a plan record
// is one finished, approved plan step with its checks' outcomes; a transition is one drafted route a person picked,
// with the request and its slot shapes. Both use the same structure hashes (../structure.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { createTransaction } from '../../transactionalWriter.mjs';
import { LineOpError } from '../contract.mjs';
import { SLOT_REF } from './contract.mjs';

/**
 * The records file of a project (root-relative).
 * @param {{layout: {state: string}}} summary
 * @returns {string}
 */
export const recordsFile = (summary) => `${summary.layout.state || 'line'}/drafter/transitions.jsonl`;

/**
 * The stored record of one route of a draft (no bindings, no names).
 * @param {import('./contract.mjs').Draft} draft
 * @param {string} routeId
 * @param {boolean} approved
 * @returns {import('./contract.mjs').TransitionRecord}
 */
export function toRecord(draft, routeId, approved) {
  const r = draft.routes.find((x) => x.id === routeId);
  if (!r) throw new LineOpError(`There is no route ${routeId} in this draft.`, 'UNKNOWN_ROUTE');
  const used = new Set(JSON.stringify([r.steps, r.expect, r.delta, draft.request]).match(/[A-Z]\d+/g) ?? []);
  const slots = Object.fromEntries(Object.entries(draft.slots).filter(([s]) => used.has(s)).map(([s, sh]) => [s, sh]));
  return {
    v: 1, request: draft.request, slots, intent: r.intent, from: draft.from, routeId: r.id, template: r.template,
    steps: r.steps, expect: r.expect, delta: r.delta, to: /** @type {any} */ (r).actual ?? r.predicted ?? null, approved,
  };
}

/**
 * Read a project's records (a missing or unreadable file is no records).
 * @param {string} root
 * @param {{layout: {state: string}}} summary
 * @returns {import('./contract.mjs').TransitionRecord[]}
 */
export function readRecords(root, summary) {
  let text = '';
  try { text = fs.readFileSync(path.join(root, recordsFile(summary)), 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/**
 * Append a record through Construct's writer.
 * @param {string} root
 * @param {{layout: {state: string}}} summary
 * @param {import('./contract.mjs').TransitionRecord} record
 * @returns {string} The file written.
 */
export function appendRecord(root, summary, record) {
  const file = recordsFile(summary);
  let text = '';
  try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { /* first record */ }
  const txn = createTransaction(root);
  txn.writeFile(file, `${text}${JSON.stringify(record)}\n`);
  let result;
  try { result = txn.commit({ validate: () => ({ violations: [], ok: true }) }); } catch { txn.reset(); result = { committed: false }; }
  if (!result.committed) throw new LineOpError('The training record could not be saved; nothing was changed.', 'WRITE_FAILED');
  return file;
}

const tokens = (s) => new Set(String(s).toLowerCase().split(/\s+/).filter(Boolean));
const jaccard = (a, b) => { const x = tokens(a); const y = tokens(b); const inter = [...x].filter((t) => y.has(t)).length; return inter / (x.size + y.size - inter || 1); };

/**
 * The nearest approved record (deterministic): same intent required; then same feature hash, matching layer hashes,
 * and the normalized requests' word overlap. Ties keep the earlier record.
 * @param {import('./contract.mjs').TransitionRecord[]} records
 * @param {{intent: string, request: string, from: import('./contract.mjs').StructureHashes}} q
 * @returns {{record: import('./contract.mjs').TransitionRecord, score: number}|null}
 */
export function nearest(records, q) {
  let best = null;
  for (const r of records) {
    if (!r.approved || r.intent !== q.intent) continue;
    const layers = Object.keys(q.from.layers ?? {}).filter((l) => r.from?.layers?.[l] === q.from.layers[l]).length;
    const score = (r.from?.feature && r.from.feature === q.from.feature ? 2 : 0) + layers * 0.5 + jaccard(r.request, q.request);
    if (!best || score > best.score) best = { record: r, score };
  }
  return best;
}

/**
 * The retrieved record as a route of this draft, when every slot it uses exists here with the same kind.
 * @param {import('./contract.mjs').TransitionRecord} record
 * @param {Record<string, import('./contract.mjs').SlotShape>} slots  This draft's slots.
 * @param {number} score
 * @returns {import('./contract.mjs').Route|null}
 */
export function routeFromRecord(record, slots, score) {
  const refs = new Set([...JSON.stringify([record.steps, record.expect, record.delta]).matchAll(SLOT_REF)].map((m) => `${m[1]}${m[2]}`));
  for (const s of refs) if (!slots[s] || slots[s].kind !== record.slots[s]?.kind) return null;
  return {
    id: `retrieval:${record.routeId}`, template: record.template, label: 'Do what was approved for a request like this before.', intent: record.intent,
    scope: { layers: [], features: [...refs].filter((s) => s[0] === 'F'), library: [...refs].filter((s) => s[0] === 'L'), scope: 'feature' },
    steps: record.steps, expect: record.expect, pre: [], delta: record.delta, predicted: null,
    cost: { steps: record.steps.length, files: record.steps.length, layers: 1 }, risk: 'Repeats an earlier approved change on this project\'s shape.',
    via: 'retrieval', confidence: Math.round(Math.min(0.9, 0.4 + score / 4) * 100) / 100, status: 'unverified', refusal: null, invented: [], failed: [],
    ...(/** @type {any} */ (record).unpredicted ? { unpredicted: true } : {}),
  };
}

/** The slots a slotted request names, as a sorted signature ("<feature:F1> <library:L1>"). */
const slotSignature = (text) => (String(text).match(/<[a-z-]+:[A-Z]\d+>/g) ?? []).sort().join(' ');

/**
 * A strong precedent: the approved records of the one earlier request (a record `group`, e.g. one Train Line case) whose
 * slotted request names exactly the same slots and shares at least `min` of its words (Jaccard). Unlike `nearest`, it
 * does not need the classifier's intent: an approved request worded like this one says what this one is. Ties keep a
 * person-agreed record, then the earlier one (deterministic).
 * @param {(import('./contract.mjs').TransitionRecord & {group?: string, agreed?: boolean})[]} records
 * @param {{request: string}} q  The normalized request.
 * @param {{min?: number}} [o]
 * @returns {{score: number, intent: string, records: any[]}|null}
 */
export function precedent(records, q, o = {}) {
  const min = o.min ?? 0.75;
  const sig = slotSignature(q.request);
  let best = null;
  for (const r of records) {
    if (!r.approved || slotSignature(r.request) !== sig) continue;
    const score = jaccard(r.request, q.request);
    if (score < min) continue;
    if (!best || score > best.score || (score === best.score && r.agreed && !best.agreed)) best = { score, group: r.group ?? r.routeId, agreed: Boolean(r.agreed) };
  }
  if (!best) return null;
  const group = records.filter((r) => (r.group ?? r.routeId) === best.group);
  return { score: best.score, intent: group[0].intent, records: group };
}
