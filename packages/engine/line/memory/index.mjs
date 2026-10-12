// im3 + j5 -- Line's memory of past answers per step (contract.mjs). The two calls every feeder and reader uses:
//   recordOutcome(root, step, proposal, outcome)   remember what happened to one proposal (slotted, per project)
//   recall(root, step, context, k)                 the past decisions like this one (exact, then similar)
// plus the feeders' shared adapters: a drafted route's key and context (drafter), and a plan event's outcome kind.
import { createMemory } from './store.mjs';
import { lineStateDir } from '../workspace.mjs';

export { createMemory } from './store.mjs';
export { recallFrom, preferenceOf, memoryOver, jaccard, bm25, slotTokens } from './recall.mjs';
export { embeddingsEnabled, createOllamaEmbedder, recallWithEmbeddings, decisionText } from './embed.mjs';
export * from './contract.mjs';
export { TEMPLATE_PHRASE, routePhrase } from './words.mjs';

const stores = new Map();
/**
 * The memory of the project at `root` (one store per root and state folder).
 * @param {string} root
 * @returns {import('./store.mjs').LineMemory}
 */
export function memoryOf(root) {
  let dir = 'line';
  try { dir = lineStateDir(root) || 'line'; } catch { dir = 'line'; }
  const k = `${root}\u0000${dir}`;
  if (!stores.has(k)) stores.set(k, createMemory(root, { stateDir: dir }));
  return /** @type {any} */ (stores.get(k));
}

/**
 * Remember what happened to one proposal in this project's memory.
 * @param {string} root @param {string} step
 * @param {import('./contract.mjs').MemoryProposal} proposal @param {import('./contract.mjs').MemoryOutcome} outcome
 * @returns {Promise<import('./contract.mjs').MemoryRecord>}
 */
export function recordOutcome(root, step, proposal, outcome) {
  return memoryOf(root).recordOutcome(step, proposal, outcome);
}

/**
 * This project's past decisions of `step` like `context`.
 * @param {string} root @param {string} step @param {import('./recall.mjs').RecallContext} context @param {number} [k]
 * @returns {(import('./contract.mjs').Recalled & {i: number})[]}
 */
export function recall(root, step, context, k = 5) {
  return memoryOf(root).recall(step, context, k);
}

// ------------------------------------------------------------------------------------------------ drafter adapter

/**
 * A drafted route's memory key: its id with slot numbers dropped ("via-library:ui:C1>F1" -> "via-library:ui:C>F"), so
 * the same kind of route matches across requests.
 * @param {string} id
 * @returns {string}
 */
export const routeKey = (id) => String(id).replace(/(^|[:>+.@=])([A-Z])\d+(?=$|[:>+.@=])/g, '$1$2');

// TEMPLATE_PHRASE and routePhrase live in ./words.mjs (pure), re-exported above.

/**
 * A draft's recall context: intent, the target's structure hash, slot shapes and layer hashes (no names, no code).
 * @param {{labels: {intent: {id: string}}, from: {project: string, feature: string|null, layers: Record<string, string>}, slots: Record<string, any>}} d
 * @returns {import('./recall.mjs').RecallContext}
 */
export function draftContext(d) {
  const slots = Object.entries(d.slots ?? {}).filter(([, sh]) => !sh?.derived).map(([s, sh]) => [`${s[0]}:${sh.kind}`, sh.itemKind ? `kind=${sh.itemKind}` : '', sh.role ? `role=${sh.role}` : ''].filter(Boolean).join(' '));
  const neighbourhood = Object.entries(d.from?.layers ?? {}).map(([l, h]) => `${l}=${h}`);
  return { intent: d.labels.intent.id, structure: d.from?.feature ?? d.from?.project ?? null, slots, neighbourhood };
}

/** Plan feedback (planService and the Import agent's edits) -> the memory outcome kind. */
export const PLAN_EVENT_KIND = Object.freeze({ approve: 'approved', 'approve-all': 'approved', skip: 'skipped', move: 'reordered', edit: 'edited', refusal: 'refused', 'fix-picked': 'fix-picked' });

/**
 * Who did it, as memory says it ('ui' is a person in Cockpit; anything else is an agent; 'line' is Line itself).
 * @param {string} by
 * @returns {'person'|'agent'|'line'}
 */
export const memoryBy = (by) => (by === 'ui' || by === 'owner' || by === 'person' ? 'person' : by === 'line' ? 'line' : 'agent');
