// #892: gold labels for the drafter's intent classifier, and the one way every jev intent tool reads a request.
//
// Gold record (data/intent-gold.jsonl, one per line):
//   {id, project, request, gold: {intent, object, slot, layers}, source: "hand"|"requester", uncertain?, from?, note?}
//   - project   the Line project the request is read against (repo-relative dir), so its names become slots
//   - request   what a person types, in the project's words
//   - gold      the four closed labels: intent id from the catalog (verb.object, or "unknown"), object, the target as
//               "<slot kind>:<name>" ("page:OrdersPage", "feature:orders", null for none), layers the change touches
//   - source    "hand" (a person labelled it) or "requester" (written with hidden gold by the Requester, #894)
//   - uncertain a sentence when the labeller was not sure (eval reports these rows apart)
// The gold block is never passed to the drafter, classifyJev or a grader: tools read `request` and compare after.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { draft } from '../../../packages/engine/line/drafter/index.mjs';
import { buildIntentCatalog, VERBS, OBJECTS, LAYERS } from '../../../packages/engine/line/drafter/contract.mjs';
import { LINE_PLAN_TOOLS } from '../../../packages/engine/line/contract.mjs';
import { closedLabels } from '../../../packages/engine/line/drafter/classifyJev.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../../..');
export const GOLD_FILE = path.join(HERE, 'data', 'intent-gold.jsonl');
export const CATALOG = buildIntentCatalog(LINE_PLAN_TOOLS.map((t) => t.name));
export const DEFAULT_PROJECT = 'examples/line-sample';

/**
 * Throws unless g is a well-formed gold block.
 * @param {any} g @param {string} [where]
 */
export function assertGold(g, where = 'gold') {
  const ids = new Set(CATALOG.map((e) => e.id));
  if (g?.intent !== 'unknown' && !ids.has(g?.intent)) throw new Error(`${where}.intent must be a catalog id (verb.object) or "unknown", not ${g?.intent}`);
  const obj = g.intent === 'unknown' ? null : g.intent.split('.').slice(1).join('.');
  if ((g.object ?? null) !== obj) throw new Error(`${where}.object must be the intent's object (${obj})`);
  if (g.slot !== null && !/^[a-z-]+:.+$/.test(String(g.slot))) throw new Error(`${where}.slot must be "<kind>:<name>" or null`);
  if (!Array.isArray(g.layers) || g.layers.some((l) => !LAYERS.includes(l))) throw new Error(`${where}.layers must be a list of ${LAYERS.join(', ')}`);
}

/** @param {string} [file] @returns {any[]} */
export function readGold(file = GOLD_FILE) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l, i) => { try { return JSON.parse(l); } catch { throw new Error(`${file}:${i + 1} is not JSON`); } });
}

/** @param {any[]} rows @param {string} [file] */
export function writeGold(rows, file = GOLD_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}

/** The next free id with a prefix ("hand-034"). @param {any[]} rows @param {string} prefix */
export function nextId(rows, prefix = 'hand') {
  const n = rows.map((r) => /^(?:[a-z]+)-(\d+)$/.exec(r.id)?.[1]).filter(Boolean).map(Number);
  return `${prefix}-${String((n.length ? Math.max(...n) : 0) + 1).padStart(3, '0')}`;
}

/**
 * Read a request the way the drafter does (no verification, no shadow): the draft, the static closed labels with names,
 * and what jev needs (normalized tokens, slots).
 * @param {string} project repo-relative or absolute dir @param {string} request @param {{verify?: boolean}} [o]
 */
export function readRequest(project, request, o = {}) {
  const root = path.isAbsolute(project) ? project : path.join(REPO, project);
  const d = draft(root, request, { verify: o.verify ?? false, shadow: false });
  return { root, d, normalized: { text: d.request, tokens: d.tokens }, staticLabels: closedLabels(d.labels, d.slots, d.bindings) };
}

/**
 * Parse a gold block from CLI flags: --intent verb.object --slot kind:name|none --layers ui,workflow.
 * @param {{intent?: string, slot?: string, layers?: string}} f
 * @param {{intent: string, slot: string|null, layers: string[]}|null} fallback static's guess (used for flags left out)
 */
export function goldFromFlags(f, fallback) {
  const intent = f.intent ?? fallback?.intent ?? 'unknown';
  const slot = f.slot === undefined ? fallback?.slot ?? null : f.slot === 'none' || f.slot === '' ? null : f.slot;
  const layers = f.layers === undefined ? fallback?.layers ?? [] : f.layers.split(',').map((x) => x.trim()).filter(Boolean).sort();
  const g = { intent, object: intent === 'unknown' ? null : intent.split('.').slice(1).join('.'), slot, layers };
  assertGold(g);
  return g;
}

/**
 * Deterministic held-out split: a row is "test" when its seeded hash falls under `share`.
 * @param {string} id @param {number} seed @param {number} [share]
 * @returns {'train'|'test'}
 */
export function splitOf(id, seed, share = 0.3) {
  let h = 2166136261 ^ seed;
  for (const ch of `${seed}:${id}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return (h % 1000) / 1000 < share ? 'test' : 'train';
}

export { VERBS, OBJECTS, LAYERS };
