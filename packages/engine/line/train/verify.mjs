// Train Line "Try it" and gold verification: a route's steps run in a SCRATCH copy of its world (never a real project),
// each write through the same plan tool code Cockpit runs (planTools.mjs runChange -> applyChange, i.e. Construct's
// transactional writer with the line profile as the gate), then the route's checks (Line's one expression language,
// ../expr.mjs) run over the facts after (../facts.mjs buildFacts, with what the change added and how it was refused).
// A refusal route passes when Construct refuses as the route says (with a typed fix when it names a rule);
// a question route passes when the tool really cannot run without the missing detail (its schema refuses).
import fs from 'node:fs';
import { LineOpError } from '../contract.mjs';
import { runChange, previewStep, createLinePlanRegistry } from '../planTools.mjs';
import { readLineProject } from '../model.mjs';
import { buildFacts, addedFindings } from '../facts.mjs';
import { evaluate, describe } from '../expr.mjs';
import { materialize, worldSpec } from './corpus.mjs';
import { factsOf } from './facts.mjs';
import { bindSlots, fill } from './slots.mjs';

const lower = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1);

/**
 * The domain words of a world (texts point at them by "word#i"); none for the sample.
 * @param {any} world
 * @returns {string[]}
 */
export const wordsOf = (world) => (world.kind === 'corpus' ? worldSpec(world.id).words : []);

/**
 * Run one route in a scratch copy of its world.
 * @param {{world: any, slots: Record<string, any>, route: any}} req
 * @returns {import('./contract.mjs').TryResult & {filled?: any}}
 */
export function tryRoute({ world, slots, route }) {
  const dir = materialize(world);
  try {
    const before = factsOf(dir);
    const beforeFindings = buildFacts(dir).findings;
    const words = wordsOf(world);
    const b = /** @type {any} */ (bindSlots(slots, before, words));
    if (!b.ok) return { ok: false, sentence: `This cannot be tried here: ${lower(b.sentence)}`, steps: [], checks: [] };
    if (route.outcome === 'question') return tryQuestion(dir, route, b.bound);
    /** @type {{sentence: string, ok: boolean, code?: string}[]} */
    const steps = [];
    const plan = [];
    for (const s of route.steps) {
      const args = fill(s.args, b.bound, { asArg: true });
      try {
        previewStep(dir, s.tool, args);
      } catch (e) {
        if (!(e instanceof LineOpError) && /** @type {any} */ (e)?.name !== 'LineOpError') throw e;
        steps.push({ sentence: `Construct refused: ${lower(/** @type {any} */ (e).sentence)}`, ok: false, code: /** @type {any} */ (e).code });
        plan.push({ tool: s.tool, ok: false, code: /** @type {any} */ (e).code });
        break;
      }
      const r = runChange(dir, s.tool, args);
      if (!r.apply.ok) {
        const first = r.apply.findings.find((f) => f.severity === 'error') ?? r.apply.findings[0];
        steps.push({ sentence: r.apply.sentence, ok: false, ...(first ? { code: first.rule } : {}) });
        plan.push({ tool: s.tool, ok: false, rule: first?.rule, fixes: Boolean(first?.fixes?.length) });
        break;
      }
      steps.push({ sentence: r.apply.sentence, ok: true });
      plan.push({ tool: s.tool, ok: true });
    }
    const project = readLineProject(dir);
    const last = plan.at(-1);
    const facts = buildFacts(dir, {
      project,
      findingsNew: addedFindings(beforeFindings, buildFacts(dir, { project }).findings),
      plan: last ? { tool: last.tool, staged: true, applied: last.ok, files: [], refusal: last.ok ? null : { code: last.code ?? null, rule: last.rule ?? null, fixes: Boolean(last.fixes) } } : null,
    });
    const exprs = fill(route.expect, b.bound, { asArg: true });
    const checks = exprs.map((x) => { const r = evaluate(facts, x); return { sentence: r.ok ? describe(x) : r.failed[0].sentence, ok: r.ok }; });
    const stepsOk = route.outcome === 'refusal' ? plan.some((p) => !p.ok) : steps.every((s) => s.ok) && steps.length === route.steps.length;
    const ok = stepsOk && checks.every((c) => c.ok);
    const passed = checks.filter((c) => c.ok).length;
    const sentence = ok
      ? (route.outcome === 'refusal' ? `Construct refused it as expected, and ${passed} of ${checks.length} checks pass.` : `It works in a scratch copy: ${passed} of ${checks.length} checks pass.`)
      : (route.outcome === 'refusal' && !plan.some((p) => !p.ok) ? 'Construct did not refuse it, so this refusal is wrong.' : `It does not work as it stands: ${passed} of ${checks.length} checks pass.`);
    return { ok, sentence, steps, checks };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function tryQuestion(dir, route, bound) {
  const q = route.question ?? {};
  const tool = createLinePlanRegistry({ root: dir }).list().find((t) => t.name === q.tool);
  const args = fill(q.args ?? {}, bound, { asArg: true });
  const parsed = tool?.schema?.safeParse(args);
  const refuses = Boolean(parsed && !parsed.success);
  const sentence = fill(q.sentence ?? 'What is missing?', bound);
  return {
    ok: refuses,
    sentence: refuses ? `Line must ask first: ${sentence}` : 'The step could run without asking, so this question is not needed.',
    steps: [],
    checks: [{ sentence: refuses ? `Without the ${q.about}, the step cannot run.` : `The step runs without the ${q.about}.`, ok: refuses }],
  };
}

/**
 * Verify every gold route of a case (each in its own scratch copy).
 * @param {any} c A case (stored form).
 * @returns {{ok: boolean, routes: Record<string, {ok: boolean, sentence: string}>}}
 */
export function verifyCase(c) {
  /** @type {Record<string, {ok: boolean, sentence: string}>} */
  const routes = {};
  for (const r of c.gold.routes) {
    const t = tryRoute({ world: c.world, slots: c.slots, route: r });
    routes[r.id] = { ok: t.ok, sentence: t.sentence };
  }
  return { ok: Object.values(routes).every((r) => r.ok), routes };
}
