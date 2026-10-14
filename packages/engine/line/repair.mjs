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
import { repairLoop, optionSchema, REPAIR_STEP } from '@line/construct-core/line-decide';
import { stepProfile } from '@line/construct-core/ai-profiles';
import { fillOne, ollamaGenerate } from './coder/prefill/index.mjs';

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
 * @returns {{sentence: string, rule: string|null, code: string|null, finding: string|null, fixes: {id: string, sentence: string, rank: number, step: any}[], line?: number|null}}
 */
export function refusalOf(res) {
  const first = res.apply.findings?.find((f) => f.severity === 'error') ?? res.apply.findings?.[0] ?? null;
  const fixes = (res.options ?? []).filter((o) => o.id === 'fix').map((o, i) => ({ id: String(o.fixId ?? `fix${i + 1}`), sentence: one(o.sentence), rank: o.recommended ? 1 : i + 2, step: o.step ?? null }));
  return { sentence: one(res.apply.sentence) || 'Construct refused the change.', rule: first?.rule ?? null, code: res.apply.code ?? null, finding: first ? one(first.message ?? first.sentence ?? '') || null : null, fixes, line: first?.line ?? null };
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

// #948: a code tool's repair (line.setCode, line.setFragment) as the prefilled one-function fill: the function the
// finding's line points at (else the file's first), its signature prefilled, only the last refusal in the request.
const codeFill = (generate) => async (option, refusal) => {
  const a = option.args ?? {};
  const file = String(a.file ?? 'x.tsx');
  const facts = [`Construct refused this change to ${file}: ${one(refusal?.sentence)}`, refusal?.finding ? `Finding: ${[refusal.rule, refusal.finding].filter(Boolean).join(': ')}` : '', ...(refusal?.fixes ?? []).slice(0, 3).map((f) => `Typed fix: ${one(f.sentence)}`)].filter(Boolean).join('\n');
  if (option.tool === 'line.setFragment') {
    const r = await fillOne({ source: `const fragment = () => {\n  return (${a.code});\n};\n`, file: 'fragment.tsx', target: { name: 'fragment' }, generate, gate: false, maxAttempts: 2, user: `${facts}\n\nThe fragment now: ${a.code}\nReturn the corrected expression.` });
    const expr = r.ok ? r.body.trim().replace(/^return\s*/, '').replace(/;\s*$/, '') : '';
    return expr ? { args: { ...a, code: expr }, reason: 'The prefilled fill rewrote the fragment the error points at.' } : null;
  }
  const r = await fillOne({ source: String(a.code ?? ''), file, target: { line: refusal?.line ?? null }, generate, maxAttempts: 2, user: `${facts}\n\nThe file:\n${a.code ?? ''}` });
  return r.ok ? { args: { ...a, code: r.source }, reason: `The prefilled fill rewrote ${r.name}, the function the error points at.` } : null;
};

/**
 * The repair loop for a project: repairLoop with the tool's own schema, Construct's check (`check`, default on a scratch
 * copy of the project), up to the profile's maxAttempts, and the attempt kept slotted in the plan records.
 * @param {string} root
 * @param {{propose?: (q: any) => Promise<string>, generate?: (q: any) => Promise<string>, where?: string, record?: boolean, write?: (line: string) => void, maxAttempts?: number}} [o]
 *   `propose`: the model call (tests pass a mock; default Ollama with the construct.repair profile's model). `generate`
 *   (#948): the prefilled one-function request a code tool's repair uses (default Ollama /api/generate, same model).
 * @returns {(option: {tool: string, args: any}, refusal: any, c?: {check?: ((option: any) => any) | null, onProgress?: (sentence: string, n: number) => void}) => Promise<import('./contract.mjs').RepairAttempt>}
 *   `check: null` skips the check (one proposal; the caller checks it as a plan step); `onProgress`: one sentence per attempt.
 */
export function createRepairer(root, o = {}) {
  return async (option, refusal, c = {}) => {
    const check = c.check === null ? undefined : c.check ?? ((x) => checkOnCopy(root, x));
    const generate = o.generate ?? ollamaGenerate({ model: /** @type {any} */ (stepProfile(REPAIR_STEP)).model ?? 'qwen2.5-coder:1.5b' });
    const attempt = await repairLoop(option, refusal, { schema: optionSchema(option, toolArgsSchema(option.tool)), check, onProgress: c.onProgress, fill: codeFill(generate), ...(o.maxAttempts ? { maxAttempts: o.maxAttempts } : {}), ...(o.propose ? { propose: o.propose } : {}) });
    if (o.record !== false && !['no-model', 'off'].includes(attempt.outcome)) recordRepair(root, attempt, { where: o.where, write: o.write });
    return attempt;
  };
}
