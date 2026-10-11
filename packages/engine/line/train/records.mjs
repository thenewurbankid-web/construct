// Train Line's cases as the drafter's retrieval records (../drafter/retrieval.mjs): the SAME slotted transition index the
// drafter reads its approved transitions from, so training changes what the drafter drafts. Each eligible case is
// normalized by the drafter's own domain map of its world (the request becomes the drafter's slotted text, e.g.
// "make <new:N1> in <feature:F1> based on <library:L1>"), and each gold route's steps are rewritten from the world's
// names to the drafter's slot refs (<F1>, <C1.file>, <F1>/components/<N1>). A route that cannot be written in slots
// alone (a fix id, a content hash, new code) is left out; nothing with a project or domain word is ever kept.
//
// Leakage rule (owner, 2026-10-11): ONLY train-split cases on train worlds feed retrieval. A held-out case, or any case
// on a held-out world (w30-w39), never does, whatever its split field or status says; a disputed case never does.
import { isHeldOut } from './corpus.mjs';
import { worldFacts } from './generate.mjs';
import { bindSlots, fill } from './slots.mjs';
import { wordsOf } from './verify.mjs';
import { worldMap } from './draft.mjs';
import { normalize } from '../drafter/domainMap.mjs';
import { SLOT_KINDS } from '../drafter/contract.mjs';
import { projectWordIn } from '../slots.mjs';
import { worldIdentifiers } from './service.mjs';

const TEMPLATE_OF = Object.freeze({ 'line.baseOn': 'base-on', 'line.promote': 'promote', 'line.setPageProp': 'set-prop', 'line.setFragment': 'set-fragment', 'line.fix': 'fix', 'line.setBase': 'set-base' });
/** The drafter template a route's steps are (a two-step route is via-library or a combination). */
const templateOf = (steps) => (steps.length === 1 ? TEMPLATE_OF[steps[0].tool] ?? 'combo' : steps[0].tool === 'line.promote' && steps[1]?.tool === 'line.baseOn' ? 'via-library' : 'combo');
const KINDS = new Set(['components', 'pages', 'workflows', 'fixtures']);
/** Step args kept as literals: Line's own vocabulary, never a project word. */
const LITERAL_ARGS = Object.freeze({ kind: /^(string|number|boolean)$/, nodeId: /^n\d+$/ });

/**
 * Whether a case may feed the drafter's retrieval: train split, a train world (never w30-w39), not disputed, and every
 * gold route verified by Construct.
 * @param {any} c A stored Train case.
 * @returns {boolean}
 */
export function feedsRetrieval(c) {
  if (!c || c.split !== 'train' || c.status === 'disputed') return false;
  if (c.world?.kind === 'corpus' && isHeldOut(String(c.world.id))) return false;
  if (c.world?.kind !== 'corpus' && c.world?.kind !== 'sample') return false;
  const v = c.verified?.routes ?? {};
  return c.gold.routes.every((r) => v[r.id]?.ok === true);
}

/**
 * One bound value as the drafter's slot form, or undefined when it cannot be written in slots alone.
 * @param {unknown} v @param {Record<string, any>} b The drafter's bindings. @param {string} [arg] The step arg's name.
 * @returns {unknown}
 */
function slotted(v, b, arg) {
  if (typeof v === 'number' || typeof v === 'boolean') {
    const s = Object.keys(b).find((k) => k[0] === 'V' && b[k] === v);
    return s ? `<${s}>` : arg === 'kind' ? undefined : v;
  }
  if (typeof v !== 'string') return undefined;
  if (arg && LITERAL_ARGS[arg]?.test(v)) return v;
  const whole = (x) => {
    for (const [s, val] of Object.entries(b)) {
      if (s[0] === 'U') continue;
      if (typeof val === 'string' && val === x) return `<${s}>`;
      if (val && typeof val === 'object') {
        if (val.id === x) return `<${s}>`;
        if (val.file === x) return `<${s}.file>`;
        if (val.name === x) return `<${s}.name>`;
        if (val.base === x) return `<${s}.base>`;
      }
    }
    return null;
  };
  const w = whole(v);
  if (w) return w;
  const parts = v.split('/');
  if (parts.length < 2) return undefined;
  const out = parts.map((p) => (KINDS.has(p) ? p : whole(p)));
  return out.every(Boolean) ? out.join('/') : undefined;
}

/** The committed retrieval index of the seed (training-root relative): per case key, its records. */
export const INDEX = 'train/retrieval-index.json';
/**
 * A case's key in the index: its id and its review status (agreeing or disputing a case changes its records).
 * @param {{id: string, status: string}} c
 * @returns {string}
 */
export const caseKey = (c) => `${c.id}:${c.status}`;

/**
 * One eligible case's records (see `trainRecords`); [] when it cannot be written in slots alone.
 * @param {any} c
 * @returns {any[]}
 */
export function recordsOfCase(c) {
  /** @type {any[]} */
  const out = [];
  const facts = worldFacts(c.world);
  const gb = /** @type {any} */ (bindSlots(c.slots, facts, wordsOf(c.world)));
  if (!gb.ok) return out;
  const n = normalize(fill(c.request, gb.bound), worldMap(c.world));
  if (n.questions.length) return out;
  // The one leak guard: a world word the map could not slot (a feature called "parts" reads as grammar) keeps the case out.
  const words = worldIdentifiers(c.world, facts);
  if (projectWordIn(n.text, words)) return out;
  const shapes = Object.fromEntries(Object.keys(n.bindings).map((s) => [s, { kind: SLOT_KINDS[s[0]] ?? 'other' }]));
  for (const r of c.gold.routes) {
    const base = { v: 1, request: n.text, intent: c.intent, from: null, routeId: `train:${c.id}:${r.id}`, template: 'base-on', to: null, approved: true, group: c.id, preferred: r.id === c.gold.preferred, outcome: r.outcome, source: /** @type {'train'} */ ('train'), agreed: c.status === 'agreed' };
    if (r.outcome === 'question') { out.push({ ...base, slots: shapes, steps: [], expect: [], delta: [], about: r.question?.about ?? 'detail' }); continue; }
    const steps = [];
    let ok = true;
    for (const s of r.steps) {
      const args = {};
      for (const [k, v] of Object.entries(fill(s.args, gb.bound, { asArg: true }))) { const x = slotted(v, n.bindings, k); if (x === undefined) { ok = false; break; } args[k] = x; }
      if (!ok) break;
      steps.push({ tool: s.tool, args });
    }
    if (!ok || projectWordIn(steps, words)) continue;
    const used = new Set(JSON.stringify(steps).match(/[A-Z]\d+/g) ?? []);
    // No delta: the structure-hash check is skipped for a retrieved route (`unpredicted`); Construct and the checks still run.
    out.push({ ...base, template: templateOf(steps), slots: Object.fromEntries(Object.entries(shapes).filter(([s]) => used.has(s))), steps, expect: [{ noNewFindings: true }], delta: [], unpredicted: true });
  }
  return out;
}

/**
 * Train Line's eligible cases as drafter transition records (approved, delexicalized, slot form). Records of one case
 * share `group`; `preferred` marks the gold preferred route; a question outcome is a record with no steps.
 * @param {any[]} cases Stored Train cases (any split: only the eligible ones are used).
 * @param {{memo?: Map<string, any[]>}} [o] `memo`: records already built, by `caseKey` (e.g. the committed index); new
 *   ones are added to it. Eligibility is checked first, so a held-out case is never looked up.
 * @returns {(import('../drafter/contract.mjs').TransitionRecord & {group: string, preferred: boolean, outcome: string, about?: string, source: 'train', agreed: boolean})[]}
 */
export function trainRecords(cases, o = {}) {
  /** @type {any[]} */
  const out = [];
  for (const c of cases.filter(feedsRetrieval)) {
    const k = caseKey(c);
    let recs = o.memo?.get(k);
    if (!recs) { recs = recordsOfCase(c); o.memo?.set(k, recs); }
    out.push(...recs);
  }
  return out;
}

/**
 * The index file's text for a set of cases (what packages/tools/line-train/retrieval-index.mjs commits).
 * @param {any[]} cases
 * @returns {string}
 */
export function indexText(cases) {
  const byCase = Object.fromEntries(cases.filter(feedsRetrieval).map((c) => [caseKey(c), recordsOfCase(c)]));
  return `${JSON.stringify({ v: 1, note: 'Train Line train-split cases as the System 1 drafter\'s retrieval records (slot form, no project words). Generated by packages/tools/line-train/retrieval-index.mjs.', cases: byCase })}\n`;
}

/**
 * A memo from an index file's text (a missing or unreadable index is an empty memo: the records are then built).
 * @param {string|null} text
 * @returns {Map<string, any[]>}
 */
export function memoOf(text) {
  try { return new Map(Object.entries(JSON.parse(String(text)).cases ?? {})); } catch { return new Map(); }
}
