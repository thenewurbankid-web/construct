// #892: the intent shadow. Static classify() decides; jev answers the same closed questions beside it, and the pair is
// logged with jev's confidence and the fork candidates (labels where they differ, or jev is unsure):
//
//   <state>/drafter/jev-shadow.jsonl   one IntentShadowRecord per request, slot form like the drafter's records: the
//                                      request is the normalized one and a slot is "<kind>:<slot id>", never a name
//
// Switches (packages/core/ai-profiles.json step construct.intent, a project's <state>/ai-profiles.json overrides):
//   shadow  `steps["construct.intent"].shadow: true` in the project's file, or LINE_JEV_SHADOW=1: draft() asks jev in the
//           background and logs; off by default (no network call, nothing written).
//   on      jev's labels are USED only when the step is on AND records a measured win (stepOnFor, the one rule). Ships off.
import { writeLineState } from '../../transactionalWriter.mjs';
import { listStepProfiles, projectStepOn, stepOnFor, PROJECT_PROFILES_FILE } from '../../../core/ai-profiles.mjs';
import { classifyJev, closedLabels, forksOf, INTENT_STEP, DEFAULT_GATE } from './classifyJev.mjs';
import fs from 'node:fs';
import path from 'node:path';

export const SHADOW_FILE = 'drafter/jev-shadow.jsonl';

/**
 * One shadow record. `static` and `jev` hold the four closed labels; `forks` is what a beam would open (#893).
 * @typedef {object} IntentShadowRecord
 * @property {1} v
 * @property {string} at                ISO time.
 * @property {'intent'} decision        Which closed decision this is (the beam's other choices log the same shape, #895).
 * @property {string} request           The normalized request (slot form).
 * @property {{intent: string, object: string|null, slot: string|null, layers: string[], via: string}} static
 * @property {({intent: string, object: string|null, slot: string|null, layers: string[], confidence: {intent: number, object: number, slot: number, layers: Record<string, number>}})|null} jev  null: jev did not answer.
 * @property {{label: string, static: any, jev: any, confidence: number, reason: string}[]} forks
 * @property {number} gate
 * @property {boolean} used             Whether jev's labels were used (only with the switch on and a measured win).
 */

/**
 * The switches for a project: whether the shadow runs and whether jev's labels are used.
 * @param {string} root @param {string} [stateDir]
 * @returns {{shadow: boolean, on: boolean, gate: number}}
 */
export function intentSwitch(root, stateDir = 'line') {
  let own = null;
  try { own = JSON.parse(fs.readFileSync(path.join(root, stateDir, PROJECT_PROFILES_FILE), 'utf8'))?.steps?.[INTENT_STEP] ?? null; } catch { /* none */ }
  let on = false;
  try { const p = listStepProfiles().find((x) => x.step === INTENT_STEP); on = p ? stepOnFor(p, projectStepOn(root, INTENT_STEP, stateDir)) : false; } catch { on = false; }
  const env = process.env.LINE_JEV_SHADOW;
  const shadow = env === '1' ? true : env === '0' ? false : own?.shadow === true;
  const g = Number(own?.gate ?? process.env.JEV_MIN_CONFIDENCE ?? DEFAULT_GATE);
  return { shadow: shadow || on, on, gate: Number.isFinite(g) ? g : DEFAULT_GATE };
}

/**
 * Build the shadow record for one request (no write).
 * @param {{normalized: any, slots: Record<string, any>, catalog: any[], labels: any}} ctx
 * @param {{choose?: any, baseUrl?: string, timeoutMs?: number, gate?: number, used?: boolean}} [o]
 * @returns {Promise<{record: IntentShadowRecord, jevLabels: any}>} `jevLabels`: jev's full Labels (ask.mjs shows them with names).
 */
export async function shadowRecord(ctx, o = {}) {
  const gate = o.gate ?? DEFAULT_GATE;
  const jl = await classifyJev(ctx.normalized, ctx.slots, ctx.catalog, o);
  // No bindings: the log holds slot ids ("page:P1"), never the project's names.
  const st = closedLabels(ctx.labels, ctx.slots);
  const jv = closedLabels(jl, ctx.slots);
  const record = {
    v: /** @type {1} */ (1),
    at: new Date().toISOString(),
    decision: /** @type {'intent'} */ ('intent'),
    request: ctx.normalized.text ?? ctx.normalized.tokens.map((x) => x.t).join(' '),
    static: { .../** @type {any} */ (st), via: ctx.labels.via ?? 'rules' },
    jev: jv && jl ? { ...jv, confidence: { intent: jl.confidences.intent, object: jl.confidences.object, slot: jl.confidences.slot, layers: jl.confidences.layers } } : null,
    forks: forksOf(st, jv, jl?.confidences, gate),
    gate,
    used: Boolean(o.used && jl),
  };
  return { record, jevLabels: jl };
}

/**
 * Append a shadow record to the project's Line state (through Construct's writer). Never throws.
 * @param {string} root @param {IntentShadowRecord} record @param {string} [stateDir]
 * @returns {string|null} The file written, or null.
 */
export function appendShadow(root, record, stateDir = 'line') {
  try { return writeLineState(root, `${stateDir}/${SHADOW_FILE}`, `${JSON.stringify(record)}\n`, { append: true, stateDir }); } catch { return null; }
}

/**
 * draft()'s hook: when the project's shadow switch is on, ask jev in the background and log. Returns the pending promise
 * (draft() does not wait for it; ask.mjs and tests do). Never throws, never rejects.
 * @param {string} root
 * @param {{normalized: any, slots: Record<string, any>, catalog: any[], labels: any, bindings?: Record<string, any>, stateDir?: string}} ctx
 * @param {{force?: boolean, choose?: any, baseUrl?: string, timeoutMs?: number}} [o] `force`: run even with the switch off (ask.mjs, eval).
 * @returns {Promise<IntentShadowRecord|null>|null}
 */
export function runIntentShadow(root, ctx, o = {}) {
  const stateDir = ctx.stateDir ?? 'line';
  const sw = intentSwitch(root, stateDir);
  if (!sw.shadow && !o.force) return null;
  return shadowRecord(ctx, { ...o, gate: sw.gate, used: false })
    .then(({ record }) => { appendShadow(root, record, stateDir); return record; })
    .catch(() => null);
}

/**
 * Read a project's shadow log (newest last); bad lines are skipped.
 * @param {string} root @param {string} [stateDir]
 * @returns {IntentShadowRecord[]}
 */
export function readShadow(root, stateDir = 'line') {
  try {
    return fs.readFileSync(path.join(root, stateDir, SHADOW_FILE), 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  } catch { return []; }
}

/**
 * The labels an async caller uses: jev's only when the switch is on (profile on AND a measured win) and jev answered
 * every label at or above the gate; static otherwise. While construct.intent ships off this is always static.
 * @param {any} staticLabels @param {any} jevLabels @param {{on: boolean, gate: number}} sw
 * @returns {{labels: any, used: boolean}}
 */
export function pickLabels(staticLabels, jevLabels, sw) {
  const c = jevLabels?.confidences;
  const sure = Boolean(c) && c.intent >= sw.gate && c.slot >= sw.gate && Object.values(c.layers).every((x) => /** @type {number} */ (x) >= sw.gate);
  return sw.on && jevLabels && sure ? { labels: jevLabels, used: true } : { labels: staticLabels, used: false };
}

// ------------------------------------------------------------------------------------------------ NLP arms (#903)
// The beam's candidate readers (trace/src/beam/arms.mjs): static classify() is the default; each other arm has its own
// step, off and unmeasured, and runs in shadow only when switched on for a project (or LINE_ARMS_SHADOW=1 / a list).

/** Each arm's step profile (packages/core/ai-profiles.json). jev reuses construct.intent. */
export const ARM_STEPS = Object.freeze({ static: null, lr: 'construct.intent-lr', nb: 'construct.intent-nb', spacy: 'construct.intent-spacy', jev: INTENT_STEP, nli: 'construct.intent-nli' });
export const ARMS_SHADOW_FILE = 'drafter/arms-shadow.jsonl';

/**
 * Per arm: whether it runs in shadow, and whether it is ON (its readings join static's: profile on AND a measured win).
 * @param {string} root @param {string} [stateDir]
 * @returns {{shadow: string[], on: string[]}}
 */
export function armsSwitch(root, stateDir = 'line') {
  /** @type {Record<string, any>} */
  let own = {};
  try { own = JSON.parse(fs.readFileSync(path.join(root, stateDir, PROJECT_PROFILES_FILE), 'utf8'))?.steps ?? {}; } catch { /* none */ }
  /** @type {any[]} */
  let profiles = [];
  try { profiles = listStepProfiles(); } catch { profiles = []; }
  const env = process.env.LINE_ARMS_SHADOW;
  const envList = env === '1' ? Object.keys(ARM_STEPS) : env && env !== '0' ? env.split(',').map((x) => x.trim()) : [];
  /** @type {string[]} */
  const shadow = [];
  /** @type {string[]} */
  const on = [];
  for (const [arm, step] of Object.entries(ARM_STEPS)) {
    if (!step) continue;
    const p = profiles.find((x) => x.step === step);
    const isOn = p ? stepOnFor(p, projectStepOn(root, step, stateDir)) : false;
    if (isOn) on.push(arm);
    if (isOn || envList.includes(arm) || (env !== '0' && own[step]?.shadow === true)) shadow.push(arm);
  }
  return { shadow, on };
}

/**
 * draft()'s hook for the arms: when any arm's shadow is on, read the request with every such arm in the background and
 * log the readings beside static's (<state>/drafter/arms-shadow.jsonl). Off by default: no import, no network call,
 * nothing written. Returns the pending promise (draft() does not wait); never throws, never rejects.
 * @param {string} root
 * @param {{request: string, normalized: any, slots: Record<string, any>, bindings?: Record<string, any>, catalog: any[], labels: any, map?: any, stateDir?: string}} ctx
 * @param {{force?: boolean, arms?: string[], post?: any, baseUrl?: string, timeoutMs?: number}} [o]
 * @returns {Promise<any>|null}
 */
export function runArmsShadow(root, ctx, o = {}) {
  const stateDir = ctx.stateDir ?? 'line';
  const sw = armsSwitch(root, stateDir);
  if (!sw.shadow.length && !o.force) return null;
  // A computed specifier: the engine's type check does not pull Trace in (Trace is optional here).
  const spec = ['..', '..', '..', '..', 'trace', 'src', 'beam', 'arms.mjs'].join('/');
  return import(spec)
    .then(async (m) => {
      const res = await m.readCandidates(ctx, { ...o, arms: ['static', ...(o.arms ?? sw.shadow)], on: sw.on });
      const record = m.armsRecord(ctx, res);
      try { writeLineState(root, `${stateDir}/${ARMS_SHADOW_FILE}`, `${JSON.stringify(record)}\n`, { append: true, stateDir }); } catch { /* never throws */ }
      return record;
    })
    .catch(() => null);
}
