// Line logic verification: the UnitVerdict builder, its one-line sentence, and the step summary for the Cockpit step
// view ("N proven, M tested, K unverified" plus the divergences) and "How smart is it" (the share per feature).
// Pure; shapes and rules are contract.mjs.
import { LOGIC_UNIT_WORDS } from '../importV2/contract.mjs';
import { LAYER_WORDS, VERDICT_STATUSES, assertUnitVerdict, assertStepSummary, inClosedSet } from './contract.mjs';

/** @typedef {import('./contract.mjs').UnitVerdict} UnitVerdict */
/** @typedef {import('./contract.mjs').StepSummary} StepSummary */
/** @typedef {import('./contract.mjs').VerdictStatus} VerdictStatus */

const MAX_INPUT = 60;

/**
 * A short JSON rendering of a failing input, cut at MAX_INPUT characters.
 * @param {unknown} input
 * @returns {string}
 */
function inputText(input) {
  let s;
  // Z3 counterexamples are IEEE doubles: NaN, the infinities and -0 are written as JS writes them, not as JSON's null/0.
  const num = (_k, v) => (typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0)) ? `@@num:${Object.is(v, -0) ? '-0' : v}@@` : v);
  try { s = (JSON.stringify(input, num) ?? String(input)).replace(/"@@num:([^@]+)@@"/g, '$1'); } catch { s = String(input); }
  s = s.replace(/\s+/g, ' ');
  return s.length > MAX_INPUT ? `${s.slice(0, MAX_INPUT - 3)}...` : s;
}

/**
 * The one-line plain-English sentence for a verdict (everything but `sentence` is read).
 * @param {Omit<UnitVerdict, 'sentence'>} v
 * @returns {string}
 * @example
 * verdictSentence({unit: {fn: 'isAdult', kind: 'export', file: 'src/age.ts', ...}, status: 'proven', layer: 'L0-canonical', ...})
 * // "isAdult (export in src/age.ts) is proven unchanged by the canonical compare."
 */
export function verdictSentence(v) {
  const who = `${v.unit.fn} (${LOGIC_UNIT_WORDS[v.unit.kind] ?? v.unit.kind} in ${v.unit.file})`;
  const by = LAYER_WORDS[v.layer] ?? v.layer;
  switch (v.status) {
    case 'proven': return `${who} is proven unchanged by ${by}.`;
    case 'tested':
      return inClosedSet(v.transforms)
        ? `${who} behaved the same under ${by}, so it is tested, not proven.`
        : `${who} behaved the same under ${by}, but it was edited outside Line's transforms, so it is tested, not proven.`;
    case 'changed': {
      // the sentence names the changed node (the astPath's last segment); the full path stays in `location`
      const at = v.location ? ` at ${v.location.side === 'before' ? 'the old ' : ''}${v.location.file}:${v.location.line} (${v.location.astPath.split('/').at(-1)})` : '';
      const input = v.input !== undefined ? ` for input ${inputText(v.input)}` : '';
      return `${who} changed${at}${input}, found by ${by}.`;
    }
    case 'not-extracted': return `${who} is not extracted: it sits in no atom or block.`;
    default: return `${who} is unverified: ${v.layer === 'none' ? 'no layer ran' : `${by} could not decide`}, so it is not assumed fine.`;
  }
}

/**
 * Build a UnitVerdict: fills the sentence and refuses (TypeError, one sentence) anything the contract forbids, such as
 * "proven" for code changed outside the closed transform set.
 * @param {Omit<UnitVerdict, 'sentence'> & {sentence?: string}} fields
 * @returns {UnitVerdict}
 */
export function buildUnitVerdict(fields) {
  /** @type {UnitVerdict} */
  const v = {
    unit: fields.unit, purity: fields.purity, effectChain: fields.effectChain, status: fields.status, layer: fields.layer,
    transforms: fields.transforms === undefined ? null : fields.transforms,
    ...(fields.location !== undefined ? { location: fields.location } : {}),
    ...(fields.input !== undefined ? { input: fields.input } : {}),
    sentence: '',
  };
  v.sentence = verdictSentence(v);
  assertUnitVerdict(v);
  return v;
}

/**
 * Counts per status, every status present.
 * @param {UnitVerdict[]} verdicts
 * @returns {Record<VerdictStatus, number>}
 */
export function countStatuses(verdicts) {
  const counts = /** @type {Record<VerdictStatus, number>} */ (Object.fromEntries(VERDICT_STATUSES.map((s) => [s, 0])));
  for (const v of verdicts) counts[v.status] += 1;
  return counts;
}

/**
 * "N proven, M tested, K unverified" plus the changed and not-extracted counts when there are any.
 * @param {Record<VerdictStatus, number>} c
 * @returns {string}
 */
export function stepSentence(c) {
  const tail = [c.changed ? `${c.changed} changed` : '', c['not-extracted'] ? `${c['not-extracted']} not extracted` : ''].filter(Boolean);
  return `${c.proven} proven, ${c.tested} tested, ${c.unverified} unverified${tail.length ? `, ${tail.join(', ')}` : ''}.`;
}

/**
 * The step summary for one checked step.
 * @param {string} step
 * @param {UnitVerdict[]} verdicts
 * @returns {StepSummary}
 */
export function summarizeStep(step, verdicts) {
  const counts = countStatuses(verdicts);
  const divergences = verdicts.filter((v) => v.status === 'changed').map((v) => ({
    unit: v.unit, layer: v.layer, location: /** @type {import('./contract.mjs').VerdictLocation} */ (v.location),
    ...(v.input !== undefined ? { input: v.input } : {}), sentence: v.sentence,
  }));
  const s = { step, counts, total: verdicts.length, divergences, sentence: stepSentence(counts) };
  assertStepSummary(s);
  return s;
}

/**
 * "How smart is it": the proven / tested / unverified share of a feature's units (0..1, rounded to 3 places; changed
 * and not-extracted units count in the total, so the three shares sum to at most 1).
 * @param {Record<VerdictStatus, number>} counts
 * @returns {{proven: number, tested: number, unverified: number, total: number}}
 */
export function shareOf(counts) {
  const total = VERDICT_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0);
  const r = (n) => (total ? Math.round((n / total) * 1000) / 1000 : 0);
  return { proven: r(counts.proven ?? 0), tested: r(counts.tested ?? 0), unverified: r(counts.unverified ?? 0), total };
}
