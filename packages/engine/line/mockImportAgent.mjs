// ci2 -- the Import agent's mock: the REAL process (importAgent.mjs createImportAgent) over in-memory stand-ins, so the
// Cockpit screen (?line=mock), the contract tests and other agents can build against it with no server and no disk:
//   - the import ops are ci1's mock (mockImport.mjs: examples/import-sample's folder src/alerts);
//   - the plan service is a small in-memory cp1 plan (createMockPlanService: waiting -> approve -> run, needs-fix, fixOf,
//     retry with `stopped`, leaveAsIs), with one planted refusal: the first run of the step for AlertRow's feature item
//     is refused with one typed fix (the fix lands, the retry passes), so the correction loop shows in mock mode;
//   - the store keeps the file in memory; verify passes validate and says why types and tests did not run;
//   - the Line Import v2 loop runs on importLoopMock.mjs createMockLogic: a fixed logic map of src/alerts whose units
//     move with each landed step, three characterization tests that pass (o.logic replaces it, e.g. to plant a lost unit).
import { LineOpError } from './contract.mjs';
import { createImportAgent } from './importAgent.mjs';
import { createMockImport } from './mockImport.mjs';
import { createMockLogic } from './importLoopMock.mjs';

const lower = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1);

/**
 * An in-memory cp1 plan service (planService.mjs shape: view, addStep, approve, runNext) for import steps.
 * @param {{refuse?: (step: any, tries: number) => boolean, stopAfterFix?: boolean}} [o] `refuse(step, tries)` plants a refusal; `stopAfterFix` makes the retry after a fix pass no more checks (so the agent must ask).
 * @returns {any}
 */
export function createMockPlanService(o = {}) {
  const refuse = o.refuse ?? ((s, tries) => s.tool === 'line.import.toFeature' && s.args.name === 'AlertRow' && tries === 0);
  const steps = [];
  const tries = new Map();
  // Like planService.mjs stepView: a step that needed the person is done once a later step retries it or leaves it as is.
  const resolver = (s) => steps.find((r) => r.n > s.n && (r.args.retry?.of === s.id || (r.tool === 'line.leaveAsIs' && r.args.stepId === s.id))) ?? null;
  const shown = (s) => ((s.state === 'needs-fix' || s.state === 'needs-you') && resolver(s) ? { ...s, state: 'done', sentence: resolver(s).tool === 'line.leaveAsIs' ? `Left as it is in step ${resolver(s).n}.` : `Tried again as step ${resolver(s).n}.` } : { ...s });
  const ok = (message) => ({ ok: /** @type {const} */ (true), sessionId: 'ses-cockpit', planId: steps.length ? 'plan-cockpit-1' : null, version: steps.length, status: steps.length ? 'draft' : null, steps: steps.map(shown), store: { linked: false, sentence: 'Mock plan store (in memory).' }, ...(message ? { message } : {}) });
  const no = (code, sentence) => ({ ok: /** @type {const} */ (false), code, sentence });
  const needing = () => steps.find((s) => (s.state === 'needs-fix' || s.state === 'needs-you') && !resolver(s));
  const result = (passed, sentence, extra = {}) => ({ apply: { ok: passed === 2, sentence, files: [], findings: extra.findings ?? [] }, checks: [], passed, total: 2, needsYou: passed < 2, options: extra.options ?? [], stopped: extra.stopped ?? false, sentence });
  return {
    view: async () => ok(),
    async addStep(req, by) {
      const of = req.args?.retry ? steps.find((s) => s.id === req.args.retry.of) : null;
      if (req.args?.retry && of?.result?.stopped) return no('STOPPED', `Trying step ${of.n} again did not pass more checks last time, so Line will not retry it.`);
      const args = of ? { ...of.args, retry: { of: of.id, passed: of.result?.passed ?? 0 } } : { ...req.args };
      const n = steps.length + 1;
      const tool = of ? of.tool : req.tool;
      const why = req.why ?? (of ? `Try step ${of.n} again: ${lower(of.why)}` : tool === 'line.leaveAsIs' ? 'Carry on without fixing it.' : `Run ${tool}.`);
      steps.push({ id: `step-${n}`, n, tool, args, why, kind: 'write', state: 'waiting', sentence: `Waiting for your approval: ${why}`, gap: [], result: null, error: null, by });
      return { ...ok(), stepId: `step-${n}` };
    },
    async approve(id, by) {
      const s = steps.find((x) => x.id === id);
      if (!s) return no('PLAN_NOT_FOUND', `There is no step ${id}.`);
      if (by === 'agent') return no('PLAN_PERSON_ONLY', 'Only a person approves a write.');
      s.state = 'ready'; s.sentence = `Approved, ready to run: ${s.why}`;
      return ok();
    },
    async runNext(by, id) {
      const s = steps.find((x) => x.id === id);
      if (!s || s.state !== 'ready') return no('PLAN_NOT_READY', 'That step is not ready to run.');
      const blocked = needing();
      const resolves = blocked && (s.args.retry?.of === blocked.id || s.args.fixOf === blocked.id || (s.tool === 'line.leaveAsIs' && s.args.stepId === blocked.id));
      if (blocked && !resolves) return no('NEEDS_YOU', `Step ${blocked.n} needs you first.`);
      const key = `${s.tool}:${s.args.name ?? s.args.tool ?? ''}`;
      const t = tries.get(key) ?? 0;
      tries.set(key, t + 1);
      if (s.tool !== 'line.leaveAsIs' && s.tool !== 'line.import.fix' && refuse(s, t)) {
        const stopped = Boolean(s.args.retry);
        const fix = { id: 'fix', fixId: 'set-base', sentence: 'Point AlertRow at the library AlertRow.', recommended: true, step: { tool: 'line.import.fix', args: { folder: s.args.folder, tool: 'line.setBase', args: { file: 'features/alerts/components/AlertRow.tsx', libraryId: 'components/AlertRow' } } } };
        s.result = result(1, `This needs you: 1 of 2 checks passed. Validate found a new problem: AlertRow has no library base.`, { stopped, options: [fix, { id: 'leave', sentence: 'Leave it as it is and carry on.' }], findings: [{ sentence: 'AlertRow has no library base.', rule: 'LINE-BASE', severity: 'error', file: 'features/alerts/components/AlertRow.tsx', line: 1 }] });
        s.state = 'needs-fix'; s.sentence = s.result.sentence;
        return ok();
      }
      s.result = s.tool === 'line.leaveAsIs' ? { left: s.args.stepId, sentence: 'Carried on; the step was left as it is.' } : result(2, `Saved. ${s.why}`);
      s.state = 'done'; s.sentence = s.result.sentence;
      if (o.stopAfterFix && s.tool === 'line.import.fix') tries.set('line.import.toFeature:AlertRow', 0);
      return ok();
    },
    steps,
  };
}

/**
 * In-memory store for the import plan file.
 * @returns {any}
 */
export function createMemoryStore() {
  let doc = null;
  return { read: () => (doc ? JSON.parse(JSON.stringify(doc)) : null), write: (d) => { doc = JSON.parse(JSON.stringify(d)); }, peek: () => doc };
}

/**
 * A mock Import agent service (the server's import-agent routes, in memory).
 * @param {any} [o]
 * @returns {any}
 */
export function createMockImportAgentService(o = {}) {
  const ops = createMockImport();
  const planService = o.planService ?? createMockPlanService();
  const agents = new Map();
  let clock = 0;
  const agentFor = (folder) => {
    if (folder !== 'src/alerts') throw new LineOpError(`The project has no folder "${folder}"; pick one of its folders.`, 'BAD_FOLDER');
    if (!agents.has(folder)) {
      agents.set(folder, createImportAgent({
        root: '/mock/import-sample', folder, planService, store: createMemoryStore(), reason: o.reason ?? null, logic: 'logic' in o ? o.logic : createMockLogic(),
        importOps: { scan: (_r, f) => ops.scan({ folder: f }), plan: (_r, f, answers) => ops.plan({ folder: f, answers }) },
        now: () => new Date(Date.UTC(2026, 9, 11, 9, 0, clock++)).toISOString(),
        verify: async () => ({ ok: true, checks: [
          { id: 'validate', state: 'pass', sentence: 'Validate (profile line) finds no new problems in the folder. 2 problems were already there before the import.' },
          { id: 'types', state: 'skipped', sentence: 'Types were not checked: TypeScript is not installed in the project (run npm install there first).' },
          { id: 'tests', state: 'skipped', sentence: 'There are no tests in src/alerts yet, so none ran.' },
        ] }),
      }));
    }
    return agents.get(folder);
  };
  return { agentFor, planService };
}
