// im2 -- Construct's side of the repair loop (packages/core/line-decide.mjs repairLoop): the schema a repaired option
// must fit (the tool's own arguments, from the one plan-tool registry), Construct's check of an option on a scratch copy
// of the project (planned, then written only by Construct's writer in the copy; the real project is never touched), the
// refusal in the shape repairLoop reads (sentence, finding, typed fixes), and the attempt kept slotted in the plan
// records folder (`<state>/records/repairs.jsonl`, through the writer's Line-state path; never a project name).
import fs from 'node:fs';
import { runChange, previewStep, lineToolSpecs } from './planTools.mjs';
import { scratchCopy } from './drafter/verify.mjs';
import { readLineProject } from './model.mjs';
import { createSlotter } from './records.mjs';
import { projectWordIn } from './slots.mjs';
import { lineStateDir } from './workspace.mjs';
import { writeLineState } from '../transactionalWriter.mjs';
import { assertRepairAttempt } from './contract.mjs';
import { repairLoop, optionSchema } from '@line/construct-core/line-decide';

const PLAN_ONLY = new Set(['expect', 'retry', 'fixOf']);
const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * The arguments schema of a plan tool (plan-only extras left out), or null for an unknown tool.
 * @param {string} tool
 * @returns {any|null}
 */
export function toolArgsSchema(tool) {
  const spec = lineToolSpecs().find((t) => t.name === tool);
  if (!spec?.args) return null;
  const properties = Object.fromEntries(Object.entries(spec.args.properties ?? {}).filter(([k]) => !PLAN_ONLY.has(k)));
  return { type: 'object', properties, required: (spec.args.required ?? []).filter((k) => !PLAN_ONLY.has(k)), additionalProperties: false };
}

/**
 * runChange's refusal as repairLoop reads it: the sentence, the first finding's rule and message, the typed fixes.
 * @param {any} res A runChange result whose apply was refused.
 * @returns {{sentence: string, rule: string|null, code: string|null, finding: string|null, fixes: {id: string, sentence: string, rank: number, step: any}[]}}
 */
export function refusalOf(res) {
  const first = res.apply.findings?.find((f) => f.severity === 'error') ?? res.apply.findings?.[0] ?? null;
  const fixes = (res.options ?? []).filter((o) => o.id === 'fix').map((o, i) => ({ id: String(o.fixId ?? `fix${i + 1}`), sentence: one(o.sentence), rank: o.recommended ? 1 : i + 2, step: o.step ?? null }));
  return { sentence: one(res.apply.sentence) || 'Construct refused the change.', rule: first?.rule ?? null, code: res.apply.code ?? null, finding: first ? one(first.message ?? first.sentence ?? '') || null : null, fixes };
}

/**
 * Construct's check of one option on a scratch copy of the project: ok, or the refusal with its typed fixes.
 * @param {string} root
 * @param {{tool: string, args: any}} option
 * @returns {{ok: boolean, refusal: ReturnType<typeof refusalOf> | null}}
 */
export function checkOnCopy(root, option) {
  const dir = scratchCopy(root);
  try {
    try { previewStep(dir, option.tool, option.args); } catch (e) {
      return { ok: false, refusal: { sentence: one(/** @type {any} */ (e)?.sentence ?? /** @type {any} */ (e)?.message ?? e), rule: null, code: /** @type {any} */ (e)?.code ?? null, finding: null, fixes: [] } };
    }
    const res = runChange(dir, option.tool, option.args);
    return res.apply.ok ? { ok: true, refusal: null } : { ok: false, refusal: refusalOf(res) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A repair attempt with every project name slotted (the same slotter as plan records), ready to keep.
 * @param {import('./contract.mjs').RepairAttempt} attempt
 * @param {any} project readLineProject's view
 * @param {{where?: string, at?: string}} [o] `where`: which loop it came from (drafter, import, decide).
 * @returns {any}
 */
export function slotRepair(attempt, project, o = {}) {
  assertRepairAttempt(attempt);
  const slotter = createSlotter(project);
  slotter.learnArgs(attempt.before.args ?? {});
  if (attempt.option) slotter.learnArgs(attempt.option.args ?? {});
  for (const t of attempt.tries ?? []) if (t.option) slotter.learnArgs(t.option.args ?? {});
  const step = (s) => (s ? { tool: s.tool, args: slotter.args(s.args ?? {}) } : null);
  const rec = {
    v: 1, kind: 'repair', at: o.at ?? new Date().toISOString(), where: o.where ?? 'decide', step: attempt.step, model: attempt.model,
    outcome: attempt.outcome, attempts: attempt.attempts,
    before: step(attempt.before), option: step(attempt.option),
    refusal: { sentence: slotter.text(attempt.refusal.sentence, { free: true }), rule: attempt.refusal.rule, code: attempt.refusal.code, fixes: attempt.refusal.fixes.length },
    after: attempt.after ? { sentence: slotter.text(attempt.after.sentence, { free: true }), rule: attempt.after.rule, code: attempt.after.code } : null,
    tries: (attempt.tries ?? []).map((t) => ({ n: t.n, reason: slotter.text(t.reason ?? '', { free: true }), option: step(t.option), outcome: t.outcome, refusal: t.refusal ? slotter.text(t.refusal.sentence, { free: true }) : null, passed: t.passed })),
    ms: attempt.ms, slots: slotter.slots(),
  };
  const leak = projectWordIn(rec, slotter.names().filter((n) => !n.includes('/')));
  if (leak) throw new Error(`the repair record would hold the project name "${leak}"`);
  return rec;
}

/**
 * Keep one repair attempt, slotted, in `<state>/records/repairs.jsonl`. Never throws: a record is best effort.
 * @param {string} root
 * @param {import('./contract.mjs').RepairAttempt} attempt
 * @param {{where?: string, write?: (line: string) => void}} [o]
 * @returns {{ok: boolean, sentence: string}}
 */
export function recordRepair(root, attempt, o = {}) {
  try {
    const rec = slotRepair(attempt, readLineProject(root), o);
    const stateDir = lineStateDir(root);
    const line = `${JSON.stringify(rec)}\n`;
    if (o.write) o.write(line); else writeLineState(root, `${stateDir}/records/repairs.jsonl`, line, { append: true, stateDir });
    return { ok: true, sentence: 'The repair attempt is kept in the plan records, with names as slots.' };
  } catch (e) {
    return { ok: false, sentence: `The repair attempt could not be kept: ${one(/** @type {any} */ (e)?.message ?? e)}.` };
  }
}

/**
 * The repair loop for a project: repairLoop with the tool's own schema, Construct's check (`check`, default on a scratch
 * copy of the project), up to the profile's maxAttempts, and the attempt kept slotted in the plan records.
 * @param {string} root
 * @param {{propose?: (q: any) => Promise<string>, where?: string, record?: boolean, write?: (line: string) => void, maxAttempts?: number}} [o]
 *   `propose`: the model call (tests pass a mock; default Ollama with the construct.repair profile's model).
 * @returns {(option: {tool: string, args: any}, refusal: any, c?: {check?: ((option: any) => any) | null, onProgress?: (sentence: string, n: number) => void}) => Promise<import('./contract.mjs').RepairAttempt>}
 *   `check: null` skips the check (one proposal; the caller checks it as a plan step); `onProgress`: one sentence per attempt.
 */
export function createRepairer(root, o = {}) {
  return async (option, refusal, c = {}) => {
    const check = c.check === null ? undefined : c.check ?? ((x) => checkOnCopy(root, x));
    const attempt = await repairLoop(option, refusal, { schema: optionSchema(option, toolArgsSchema(option.tool)), check, onProgress: c.onProgress, ...(o.maxAttempts ? { maxAttempts: o.maxAttempts } : {}), ...(o.propose ? { propose: o.propose } : {}) });
    if (o.record !== false && attempt.outcome !== 'no-model') recordRepair(root, attempt, { where: o.where, write: o.write });
    return attempt;
  };
}
