// #653 (part of #616) -- the proof of a generated screen, on the Requirement screen. Three routes, mounted by
// requirementApi.mjs on the same router (so the session gate, the project-open gate, the Origin check, JSON-only and the body cap
// are the same ones), each POST with `{ feature, plan }`:
//
//   /proof/status  is the plan applied? (the proof file the plan's `test.proof` step names exists in the project)
//   /proof/run     run the read-only `test.proof` block (packages/engine/proofRunner.mjs, the same block `construct test proof` and
//                  the plan step use) and answer its classified result. One run at a time per project, a bounded time.
//   /proof/skip    `{ reason }`: complete the chain without a green proof, on purpose, with a reason that is recorded.
//
// Security and contract:
//   - no path from the client. The client names a feature and sends its plan; the plan is re-validated (validatePlan), the
//     feature must be the one a `test.proof` step of THAT plan names, and it must be a feature on disk (projectPaths). What is
//     run is what is on disk: only generated, marked `*.proof.test.ts` files (proofRunner.mjs), bundled into a throwaway directory;
//     nothing is written in the project.
//   - running before the plan is applied is refused (409 NOT_APPLIED, "approve the plan first"), never a guess.
//   - a run in flight refuses another for the same project (409 RUN_IN_PROGRESS); the lock is held until the run really ends,
//     even when the request gave up at its time limit (TIMEOUT).
//   - a skip needs a reason (min/max length, one line). The skip and the result of a run are recorded as decision traces
//     (docs/DECISION-TRACES.md) outside the project, failure-safe: a failing recording never changes a response.
//   - the last run of each project's feature is held in memory (tracked debt: it is lost on restart), only to say which options
//     were on offer when a person skipped.
import fs from 'node:fs';
import path from 'node:path';
import { validatePlan } from '../../../packages/core/plan.mjs';
import { proofStatus, proofSummary } from '../../../packages/core/proof.mjs';
import { projectPaths } from '../../../packages/engine/testGenerator.mjs';
import { runProofs as defaultRunProofs } from '../../../packages/engine/proofRunner.mjs';
import { recordChoices } from '../../../packages/core/decision-trace-store.mjs';
import { choiceFromProofOptions } from '../../../packages/core/decision-trace-adapters.mjs';

/** The reason of a skip: a sentence, not a shrug. Mirrored by the client's domain/ProofCard.ts. */
export const PROOF_REASON = Object.freeze({ min: 8, max: 200 });
/** A plan is bigger than a sentence; the proof routes take more than the read route (16 KB) and no more than this (under the 100 KB of express.json). */
export const MAX_PROOF_REQUEST_BYTES = 64 * 1024;
export const PROOF_RUN_TIMEOUT_MS = 90_000;
/** The longest message of a failure the response carries (a test's own words, cut). */
const MAX_MESSAGE = 800;

const FEATURE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const PROOF_FILE_RE = /^[A-Za-z][A-Za-z0-9]*\.proof\.test\.ts$/;
const fail = (status, code, error, extra = {}) => ({ status, body: { ok: false, code, error, ...extra } });

/** One run at a time per project: root -> true while a run has not ended. */
const running = new Set();
/** The summary of the last run of a project's feature (`root\0feature`), for the options a skip was chosen among. */
const lastSummary = new Map();
const LAST_LIMIT = 200;
const remember = (key, summary) => {
  if (!lastSummary.has(key) && lastSummary.size >= LAST_LIMIT) lastSummary.delete(lastSummary.keys().next().value);
  lastSummary.set(key, summary);
};

/**
 * What the plan the client sent says about the proof of `feature`: the proof files its `test.proof` steps name, checked against
 * the project on disk. Pure over (body, root) plus reads of the project's folder listing.
 *
 * @param {{ feature?: unknown, plan?: unknown }} body The request body.
 * @param {string} root The open project's root.
 * @returns {{ ok: true, feature: string, names: string[], applied: boolean, genRel: string } | { status: number, body: object }} The target, or the refusal.
 */
export function proofTarget(body, root) {
  const feature = body?.feature;
  if (typeof feature !== 'string' || !FEATURE_RE.test(feature)) return fail(400, 'BAD_FEATURE', 'Send the feature whose proof this is (letters, digits, "_" and "-").');
  const plan = body?.plan;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return fail(400, 'BAD_PLAN', 'Send the plan the proof belongs to.');
  if (!validatePlan(plan).valid) return fail(400, 'BAD_PLAN', 'That plan is not a valid plan.');
  const names = [];
  for (const step of plan.steps) {
    if (step.flow === 'test.proof' && step.args?.feature === feature && typeof step.args?.name === 'string' && PROOF_FILE_RE.test(step.args.name) && !names.includes(step.args.name)) names.push(step.args.name);
  }
  if (!names.length) return fail(400, 'NO_PROOF_IN_PLAN', `The plan has no proof step for the feature "${feature}".`);
  let at;
  try {
    at = projectPaths(root, feature);
  } catch {
    // Not on disk yet: the plan has not been applied. (A project whose architecture.yml cannot be read says so on read/run.)
    return { ok: true, feature, names, applied: false, genRel: '' };
  }
  const applied = names.every((n) => { try { return fs.statSync(path.join(at.genDir, n)).isFile(); } catch { return false; } });
  return { ok: true, feature, names, applied, genRel: at.genRel };
}

/** A failure as the response carries it: what the Tests screen shows (kind, summary, expected, reached, fix), the message cut. */
function shapeFailure(f = {}) {
  const cut = (s) => String(s ?? '').slice(0, MAX_MESSAGE);
  return {
    kind: f.kind === 'app' || f.kind === 'convention' ? f.kind : 'other',
    title: cut(f.title),
    summary: cut(f.summary ?? String(f.message ?? '').split('\n')[0]),
    message: cut(f.message),
    ...(f.expected !== undefined ? { expected: cut(f.expected) } : {}),
    ...(f.reached !== undefined ? { reached: cut(f.reached) } : {}),
    ...(f.selector !== undefined ? { selector: cut(f.selector) } : {}),
    ...(f.fix !== undefined ? { fix: cut(f.fix) } : {}),
  };
}

/** A `runProofs` result as the answer of the run route: the chain state, the counts, each failed test classified, the fixed summary. */
export function shapeRun(result) {
  const chain = proofStatus([{ id: 'proof', result }]);
  if (!result.ok) {
    const summary = proofSummary({ chain, counts: { total: 0, passed: 0, failed: 0 }, tests: [] });
    return { state: chain.state, complete: chain.complete, durationMs: 0, counts: { total: 0, passed: 0, failed: 0 }, failures: [], error: { code: result.error?.code ?? 'RUN_FAILED', message: String(result.error?.message ?? 'The proof could not run.').slice(0, MAX_MESSAGE) }, summary };
  }
  const failures = result.tests.filter((t) => t.status === 'failed').map((t) => ({ test: String(t.title).slice(0, 160), ...shapeFailure(t.failure) }));
  return { state: chain.state, complete: chain.complete, durationMs: result.durationMs, counts: result.counts, failures, error: null, summary: proofSummary({ ...result, chain }) };
}

/** Normalise a skip reason: one trimmed line of PROOF_REASON.min..max characters, or the refusal. */
export function checkReason(reason) {
  if (typeof reason !== 'string') return { ok: false, error: 'Give a reason for skipping the proof.' };
  const text = reason.trim();
  if (/[\r\n\u0000-\u001f]/.test(text)) return { ok: false, error: 'The reason is one line of plain text.' };
  if (text.length < PROOF_REASON.min) return { ok: false, error: `Give a reason of at least ${PROOF_REASON.min} characters, so the skip says why.` };
  if (text.length > PROOF_REASON.max) return { ok: false, error: `Keep the reason to ${PROOF_REASON.max} characters.` };
  return { ok: true, reason: text };
}

/**
 * The three handlers, each `(body, root) => Promise<{ status, body }>`. `runProofs` and `timeoutMs` are test seams.
 *
 * @param {{ runProofs?: typeof defaultRunProofs, timeoutMs?: number }} [deps] The runner and the time a request waits for it.
 * @returns {{ status: Function, run: Function, skip: Function }} The handlers.
 */
export function createProofHandlers({ runProofs = defaultRunProofs, timeoutMs = PROOF_RUN_TIMEOUT_MS } = {}) {
  const record = (root, feature, summary, chosen, outcome) => recordChoices(root, [choiceFromProofOptions(feature, summary, chosen)], { suggestWith: null, ...(outcome ? { outcome } : {}) }).catch(() => null);

  return {
    async status(body, root) {
      const t = proofTarget(body, root);
      if (!t.ok) return t;
      return { status: 200, body: { ok: true, feature: t.feature, applied: t.applied, files: t.names } };
    },

    async run(body, root) {
      const t = proofTarget(body, root);
      if (!t.ok) return t;
      if (!t.applied) return fail(409, 'NOT_APPLIED', 'Approve the plan first: its files are not in the project yet, so there is nothing to prove.');
      if (running.has(root)) return fail(409, 'RUN_IN_PROGRESS', 'A proof is already running in this project. Wait for it to finish.');
      running.add(root);
      const started = runProofs(root, t.feature, t.names.length === 1 ? { name: t.names[0] } : {})
        .catch((e) => ({ ok: false, error: { code: 'RUN_FAILED', message: String(e?.message ?? e) } }))
        .finally(() => running.delete(root));
      let timer;
      const gaveUp = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
      const result = await Promise.race([started, gaveUp]);
      clearTimeout(timer);
      if (result === null) return fail(504, 'TIMEOUT', `The proof took longer than ${Math.round(timeoutMs / 1000)} seconds and is still being stopped. Try again in a moment.`);
      const run = shapeRun(result);
      remember(`${root}\0${t.feature}`, run.summary);
      // The choice a person made was "run the proof" (of run and skip); the outcome is whether it passed. A run that could not start has no outcome.
      await record(root, t.feature, proofSummary(null), 'run-proof', result.ok ? { testsPassed: run.state === 'green' } : undefined);
      return { status: 200, body: { ok: true, feature: t.feature, run } };
    },

    async skip(body, root) {
      const t = proofTarget(body, root);
      if (!t.ok) return t;
      const r = checkReason(body?.reason);
      if (!r.ok) return fail(400, 'REASON_REQUIRED', r.error);
      const last = lastSummary.get(`${root}\0${t.feature}`);
      // A green last run offers nothing (2 to 5 options make a trace): the skip was then chosen among the first two, run or skip.
      const offered = last && last.options.length >= 2 ? last : proofSummary(null);
      await record(root, t.feature, offered, 'skip-proof');
      const chain = proofStatus([{ id: 'proof', result: { skipped: r.reason } }]);
      return { status: 200, body: { ok: true, feature: t.feature, skipped: true, reason: r.reason, complete: chain.complete, state: chain.state } };
    },
  };
}
