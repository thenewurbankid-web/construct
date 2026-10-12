// cu2 -- Line's one set of per-step AI profiles (ai-profiles.json; shape: StepProfile in packages/engine/line/contract.mjs).
// Cockpit's LLM capabilities, Trace's AI tasks and the @mx/reason pairs read their model, reply cap and ladder from here:
//
//   listStepProfiles()   every profile, with Trace's overrides (trace/ai.config.json) applied and `modelFrom` saying so
//   stepProfile(step)    one profile (throws a TypeError for an unknown step: a programming error, not a user's)
//   stepModel(step)      the model a step uses (the 1.5B unless overridden; null for a hosted step)
//   reasonPairOf(p)      the profile as an @mx/reason pair (StepProfileInput) for runLadder / createJevPicker
//   readAiProfiles()     GET /api/line/ai-profiles: the profiles plus whether @mx/reason is linked, in one sentence
//
// Reads two JSON files and never touches a model or the network.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkStatus } from '../line-links/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROFILES_FILE = path.join(HERE, 'ai-profiles.json');
/** Trace's per-task override file (only overrides now; the defaults live in PROFILES_FILE). */
export const TRACE_AI_CONFIG = path.resolve(HERE, '../../trace/ai.config.json');

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const LINE_DEFAULT = "Line's default";
/** The local model when ai-profiles.json names none (the contract's DEFAULT_STEP_MODEL; JSON is the source). */
const DEFAULT_STEP_MODEL = 'qwen2.5-coder:1.5b';

/**
 * Every step profile, Trace's overrides applied.
 * @param {{ file?: string, traceConfig?: string | object | null }} [o] `traceConfig`: a path or an already-read object (null: none).
 * @returns {import('../engine/line/contract.mjs').StepProfile[]}
 */
export function listStepProfiles(o = {}) {
  const data = readJson(o.file ?? PROFILES_FILE);
  if (!data || !Array.isArray(data.profiles)) throw new TypeError(`ai-profiles: ${o.file ?? PROFILES_FILE} could not be read`);
  const defaultModel = typeof data.defaultModel === 'string' && data.defaultModel ? data.defaultModel : DEFAULT_STEP_MODEL;
  const trace = o.traceConfig === undefined ? readJson(TRACE_AI_CONFIG) : (typeof o.traceConfig === 'string' ? readJson(o.traceConfig) : o.traceConfig);
  const traceDefault = trace?.default?.provider === 'ollama' || trace?.default?.provider === undefined ? trace?.default?.model : null;
  return data.profiles.map((raw) => {
    const p = { ...raw, fallback: 'static', ladder: { ...raw.ladder } };
    if (p.provider === 'hosted') { p.model = raw.model ?? null; p.modelFrom = 'the hosted model you choose in Settings'; }
    // A step may name its own model when it measured better (construct.repair: the 7B, im2); it says so.
    else { p.model = raw.model ?? defaultModel; p.modelFrom = raw.model ? (raw.modelFrom ?? 'chosen for this step') : LINE_DEFAULT; }
    if (p.source === 'trace' && trace) {
      const task = p.step.slice('trace.'.length);
      const own = trace.tasks?.[task];
      const m = own?.model ?? traceDefault;
      if (typeof m === 'string' && m && m !== p.model && (own?.provider ?? trace.default?.provider ?? 'ollama') === 'ollama') {
        p.model = m;
        p.modelFrom = 'trace/ai.config.json';
      }
    }
    return p;
  });
}

/**
 * One AI step's profile (Line's default plus the project's overrides); throws for a step Line does not know.
 * @param {string} step
 * @param {Parameters<typeof listStepProfiles>[0]} [o]
 * @returns {import('../engine/line/contract.mjs').StepProfile}
 */
export function stepProfile(step, o) {
  const p = listStepProfiles(o).find((x) => x.step === step);
  if (!p) throw new TypeError(`ai-profiles: no profile for step "${step}"`);
  return p;
}

/**
 * The model a step uses: its profile's (the 1.5B by default), or null for a hosted step.
 * @param {string} step
 * @param {Parameters<typeof listStepProfiles>[0]} [o]
 * @returns {string | null}
 */
export const stepModel = (step, o) => stepProfile(step, o).model;

/**
 * reason's ids are dotted identifiers: "trace.pick-fields" -> "trace.pickFields".
 * @param {string} step
 * @returns {string}
 */
export const reasonId = (step) => step.replace(/-(\w)/g, (_, c) => c.toUpperCase());

/**
 * The profile as an @mx/reason pair for one pick question (reason's `StepProfileInput` plus `models`).
 * @param {import('../engine/line/contract.mjs').StepProfile & { guidance?: string, question?: string }} p
 * @returns {any} The pair.
 */
export function reasonPairOf(p) {
  const model = p.model ?? DEFAULT_STEP_MODEL;
  return {
    pairId: `${reasonId(p.step)}.pick`,
    stepId: reasonId(p.step),
    qwenGuidance: p.guidance ?? p.label,
    maxOptions: 5,
    proposeRetries: 0,
    jevFrame: p.step,
    review: { enabled: false, maxRounds: 1 },
    ladder: { static: { ...p.ladder.static }, options: { ...p.ladder.options }, review: { ...p.ladder.review } },
    success: 'The person keeps the decided option.',
    askUser: 'whenWeak',
    coderReview: false,
    models: { suggest: model, pick: model, review: model },
    plan: { version: '1', questions: [{ id: 'pick', kind: 'pick', note: p.question ?? p.label }] },
  };
}

/**
 * GET /api/line/ai-profiles.
 * @param {{ status?: () => { ok: boolean, packages: { name: string, ok: boolean, message: string }[] } } & Parameters<typeof listStepProfiles>[0]} [o]
 * @returns {import('../engine/line/contract.mjs').AiProfiles}
 */
export function readAiProfiles(o = {}) {
  const profiles = listStepProfiles(o).map(({ guidance, question, ...p }) => p);
  let reason = { linked: false, sentence: 'jev and the ladder are not linked, so every AI step uses its static path.' };
  try {
    const st = (o.status ?? linkStatus)();
    const r = st.packages.find((x) => x.name === '@mx/reason');
    if (r?.ok) reason = { linked: true, sentence: 'jev and the ladder (@mx/reason) are linked, so decide steps ask jev when the local model is running.' };
    else if (r) reason = { linked: false, sentence: `${r.message.replace(/\.$/, '')}; every AI step uses its static path.` };
  } catch { /* keep the static sentence */ }
  const data = readJson(o.file ?? PROFILES_FILE);
  return { defaultModel: data?.defaultModel ?? DEFAULT_STEP_MODEL, profiles, reason };
}
