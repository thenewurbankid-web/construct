// ci2 -- the Import agent: one agent in Import mode, run as a fixed typed process (an xstate machine):
//
//   scan -> map -> characterize -> classify (fit) -> plan -> review -> execute -> verify -> done
//
// Line Import v2 (docs/line/import-v2/CONTRACT.md): the input is a folder, or a route (its RouteClosure seeds the map) with
// the folder the import writes into. `map` builds the logic map of the unmodified app; `characterize` writes the
// characterization tests and runs them in the app's own runner, and every one must pass before anything moves; `classify`
// also fits every unit into ONE Line block (the FitProposal), and for a route the plan ends with the extract steps that
// land those blocks. After each import plan step lands (a person approved it), the loop (importLoop.mjs) rebuilds the map,
// diffs it, runs the tests and checks the moved files' behaviour; it goes on only when every check passes, else it stops
// with one sentence plus typed fixes (the extract step that puts a lost unit back into its block, undo, waive) and asks.
// Each checked step leaves an ImportLoopState in the file and in the plan records (records/import-loop.jsonl, slotted).
// Only a person can waive a lost unit; an agent's waiver is refused.
//
// Its whole state is ONE file inside the chosen folder, `<folder>/line/import-plan.json` (contract.mjs ImportPlanFile),
// written only through Construct's writer (applyChange with the folder as root). So the process can be paused and
// resumed (also across a server restart), and a person in Cockpit or an agent over MCP can edit, skip, reorder or
// approve its steps; every change is recorded in the file's `changes`.
//
// What the agent may do, and nothing more:
//   - read the folder (import.mjs scanImport / planImport: static rules, no model);
//   - decide through @mx/reason (packages/core/reason-provider.mjs: static order when reason is not linked, jev when a
//     picker is given) -- classify questions and which typed fix to try when a step is refused;
//   - execute ONLY by adding cp1 plan steps (line.import.*, line.import.fix, line.leaveAsIs) to the project's plan session
//     and running them once approved. A person approves every write: either in the review (the person approved that
//     exact step) or in the Plan panel / Import agent screen. An agent's own approval never approves a write.
//
// All or nothing (iv2-bugs): the plan steps land one by one (each is approved and checked on its own), so before the first
// one lands the agent saves the folder as it is (`o.snapshot`, importAgentDisk.mjs: `<folder>/line/import-undo.json`
// through the writer). When a later step is refused and cannot be fixed, the person's question offers "Undo the import"
// (recommended when no typed fix exists): `o.rollback` puts every file of the folder back as it was, in ONE writer
// transaction, every step that landed is marked undone and the import ends. Only Line's own state folder (`line/`, with
// this plan file) stays. Choosing "Leave it as it is" instead keeps what landed, as the person's decision.
//
// Correction loop (owner, 11 Oct): a refused step's sentence and typed fixes go back into the decision (jev picks,
// usually the top fix), the fix runs, the step is tried again; when a round does not pass more checks than the one
// before (cp1's `stopped`), or after MAX_ROUNDS, the process stops and asks the person ONE question.
//
// This module is pure (no Node imports), so Cockpit's mock mode runs the same process in the browser; the disk version
// (the file store, the real scan and plan) is importAgentDisk.mjs.
import { createMachine, getNextSnapshot } from 'xstate';
import { IMPORT_AGENT_STAGES, IMPORT_EDITABLE, LEVELS, LineOpError, assertImportPlanFile, importFolderProblem } from './contract.mjs';
import { newLogic, measure, loopChecks, loopState, loopQuestion, addWaivers, logicView, mapSummary, fitSummary, fitPlanSteps, LOOP_LIMITS } from './importLoop.mjs';

/** Fix rounds per step before the agent asks the person, even when each round improved. */
export const MAX_ROUNDS = 3;

// ------------------------------------------------------------------------------------------------- the process
/** The fixed process. Events are the only way between states; pause/resume is a flag beside the state. */
export const importMachine = createMachine({
  id: 'line-import',
  initial: 'scan',
  states: {
    scan: { on: { SCANNED: 'map' } },
    map: { on: { MAPPED: 'characterize' } },
    characterize: { on: { CHARACTERIZED: 'classify' } },
    classify: { on: { CLASSIFIED: 'plan' } },
    plan: { on: { PLANNED: 'review' } },
    review: { on: { REVIEWED: 'execute' } },
    execute: { on: { EXECUTED: 'verify', REOPENED: 'review', UNDONE: 'done' } },
    verify: { on: { VERIFIED: 'done', FINISHED: 'done' } },
    done: { type: 'final' },
  },
});

/**
 * The next state for `event`, or a LineOpError when the process does not allow it.
 * @param {any} state
 * @param {any} event
 * @returns {any}
 */
export function nextState(state, event) {
  const snap = importMachine.resolveState({ value: state, context: {} });
  const next = getNextSnapshot(importMachine, snap, { type: event });
  if (next.value === state && !(state === 'review' && event === 'REOPENED')) throw new LineOpError(`The import cannot go from "${state}" on ${event}.`, 'BAD_STATE');
  return /** @type {string} */ (next.value);
}

// ------------------------------------------------------------------------------------------------- the file
const lower = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1);
const asSentence = (s) => { const t = String(s ?? '').trim().replace(/\s+/g, ' '); return /[.?!]$/.test(t) ? t : `${t}.`; };
const refusal = (code, sentence) => ({ ok: /** @type {const} */ (false), code, sentence: asSentence(sentence) });

/**
 * The sentence a step says, from its args (used again after an edit).
 * @param {any} tool
 * @param {any} a
 * @returns {any}
 */
export function stepSentence(tool, a) {
  if (tool === 'line.import.mark') {
    const f = Array.isArray(a.features) ? a.features : [];
    return `Marks ${a.folder} as a Line folder, with a library and ${f.length === 1 ? `the feature ${f[0]}` : f.length ? `the features ${f.join(', ')}` : 'no features'}.`;
  }
  if (tool === 'line.import.toLibrary') return `Moves ${a.name} into the library${a.level ? ` as ${a.level === 'atom' ? 'an' : 'a'} ${a.level}` : ''} and points its users at it.`;
  if (a.mode === 'move') return `Moves ${a.name} into feature ${a.feature}, based on the library ${String(a.base).split('/').pop()}.`;
  return `Adds ${a.name} to feature ${a.feature}, based on the library ${String(a.base).split('/').pop()}${a.route ? `, serving ${a.route}` : ''}.`;
}

/** Check one edit of a step's args; a LineOpError says what is wrong. */
function checkEdit(tool, patch) {
  const allowed = IMPORT_EDITABLE[tool] ?? [];
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (!allowed.includes(k)) throw new LineOpError(`${k} cannot be changed on this step; you can change ${allowed.join(', ')}.`, 'NOT_EDITABLE');
    if (k === 'features' && (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !/^[a-z][a-z0-9-]*$/.test(x)))) throw new LineOpError('Features are names like orders or user-settings.', 'BAD_ARGS');
    if (k === 'level' && v !== undefined && !LEVELS.includes(v)) throw new LineOpError(`A level is one of ${LEVELS.join(', ')}.`, 'BAD_ARGS');
    if (k === 'keepShim' && typeof v !== 'boolean') throw new LineOpError('keepShim is true or false.', 'BAD_ARGS');
    if (k === 'feature' && (typeof v !== 'string' || !/^[a-z][a-z0-9-]*$/.test(v))) throw new LineOpError('A feature name is like orders or user-settings.', 'BAD_ARGS');
    if ((k === 'name') && (typeof v !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(v))) throw new LineOpError('A name is one word like AlertRow.', 'BAD_ARGS');
    if (k === 'base' && (typeof v !== 'string' || !/^(components|pages|workflows|fixtures)\/[A-Za-z][\w-]*$/.test(v))) throw new LineOpError('A base is a library item like components/Button.', 'BAD_ARGS');
  }
}

function newDoc(folder, route) {
  return { version: 1, folder, logic: newLogic(route), state: 'scan', paused: false, waiting: null, found: [], answers: {}, decisions: [], steps: [], cursor: { pending: null, origin: null, phase: null }, verify: null, changes: [] };
}

/** Where the process is, in one sentence. */
function whereSentence(doc) {
  if (!doc) return 'The import has not started; pick a folder and start it.';
  if (doc.paused) return `Paused at "${IMPORT_AGENT_STAGES.find((s) => s.id === doc.state)?.label}"; resume to carry on.`;
  if (doc.waiting) return doc.waiting.sentence;
  if (doc.state === 'done' && doc.undo === 'undone') return `Undone: ${doc.folder} is back as it was before the import; nothing of it stayed.`;
  if (doc.state === 'done') {
    const left = doc.steps.filter((s) => s.run === 'left').length;
    const done = doc.steps.filter((s) => s.run === 'done').length;
    return `Done: ${done} step${done === 1 ? '' : 's'} landed${left ? `, ${left} left as ${left === 1 ? 'it was' : 'they were'}` : ''}${doc.verify && !doc.verify.ok ? ', and some checks still fail' : ''}.`;
  }
  return `Working: ${lower(IMPORT_AGENT_STAGES.find((s) => s.id === doc.state)?.label ?? doc.state)}.`;
}

/**
 * The view every route answers (contract.mjs ImportAgentView).
 * @param {any} folder
 * @param {any} doc
 * @param {any} decider
 * @returns {any}
 */
export function agentView(folder, doc, decider) {
  const at = doc ? IMPORT_AGENT_STAGES.findIndex((s) => s.id === doc.state) : -1;
  return {
    ok: /** @type {const} */ (true),
    folder,
    state: doc ? doc.state : 'idle',
    paused: doc ? doc.paused : false,
    waiting: doc ? doc.waiting : null,
    // Where the process is, as the screen marks it: the stages before it done, its own stage current ("Done" too, once
    // it has finished), the ones after it still to do.
    stages: IMPORT_AGENT_STAGES.map((s, i) => ({ id: s.id, label: s.label, status: /** @type {'done'|'current'|'todo'} */ (doc && i < at ? 'done' : doc && i === at ? 'current' : 'todo') })),
    sentence: whereSentence(doc),
    steps: doc ? doc.steps : [],
    decisions: doc ? doc.decisions : [],
    changes: doc ? doc.changes.slice(-100) : [],
    verify: doc ? doc.verify : null,
    logic: doc ? logicView(doc.logic) : null,
    decider,
  };
}

// ------------------------------------------------------------------------------------------------- decisions
const BY = { 'It is the only step that passed the checks.': 'single', 'It came first in the checked steps; no model was asked.': 'order' };

/**
 * Decide one closed question through the reason provider (packages/core/reason-provider.mjs), recommended option first.
 * @param {{suggest: (summary: any) => Promise<{option: string, reason: string} | null>, lastNote?: () => string | null}} provider
 * @returns {Promise<{picked: string, by: 'static'|'single'|'order'|'jev', reason: string}>}
 */
export async function decideWith(provider, id, question, optionIds) {
  const fallback = { picked: optionIds[0], by: /** @type {const} */ ('static'), reason: 'Line took the recommended option, because no decision module answered.' };
  if (!provider) return fallback;
  let s = null;
  try { s = await provider.suggest({ id, question, options: optionIds.map((o) => ({ id: o, enabled: true })), chosen: null }); } catch { return fallback; }
  if (!s || !optionIds.includes(s.option)) return fallback;
  const note = provider.lastNote ? provider.lastNote() : null;
  const by = note ? 'static' : BY[s.reason] ?? 'jev';
  return { picked: s.option, by, reason: asSentence(s.reason) };
}

// ------------------------------------------------------------------------------------------------- the agent
/**
 * The Import agent for one folder of one project.
 * @param {{root: string, folder: string, planService: {view: () => Promise<any>, addStep: (req: any, by: string) => Promise<any>, approve: (id: string, by: string) => Promise<any>, runNext: (by: string, id?: string) => Promise<any>}, reason?: {suggest: (summary: any) => Promise<any>, lastNote?: () => string | null} | null, verify?: (root: string, folder: string, baseline: string[]) => Promise<{ok: boolean, checks: any[]}>, baseline?: (root: string, folder: string) => Promise<string[]> | string[], importOps: {scan: (root: string, folder: string) => any, plan: (root: string, folder: string, answers: Record<string, string>, target?: {route: string}) => any}, store: {read: () => any, write: (doc: any) => void}, logic?: any, checkFolder?: () => void, snapshot?: (root: string, folder: string) => unknown, rollback?: (root: string, folder: string) => {ok: boolean, sentence: string, files: string[]} | Promise<{ok: boolean, sentence: string, files: string[]}>, now?: () => string, decider?: string}} o `importOps` and `store` are the disk ones in importAgentDisk.mjs (createImportAgentOnDisk), in-memory ones in the mock. `logic` is the import loop's ops (importLoop.mjs): importLoopDisk.mjs createLogicOnDisk on disk, importLoopMock.mjs createMockLogic in the mock; without it the map, characterize and loop checks say they are not set up and pass through.
 * @returns {any}
 */
export function createImportAgent(o) {
  const { root, folder, planService: svc } = o;
  const bad = importFolderProblem(folder);
  if (bad) throw new LineOpError(`The import folder ${bad}.`, 'BAD_FOLDER');
  const { store, importOps } = o;
  const now = o.now ?? (() => new Date().toISOString());
  const decider = o.decider ?? (o.reason ? 'Decisions go through @mx/reason; when it is not linked, Line takes the recommended option.' : 'Line takes the recommended option for each decision (no decision module is set up).');
  let queue = Promise.resolve();
  const serial = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

  const record = (doc, by, action, sentence, stepId) => doc.changes.push({ n: doc.changes.length + 1, at: now(), by, action, ...(stepId ? { stepId } : {}), sentence: asSentence(sentence) });
  const go = (doc, by, event) => {
    const from = doc.state;
    doc.state = nextState(doc.state, event);
    record(doc, 'line', 'state', `moved from ${from} to ${doc.state}`);
  };
  const save = (doc) => { assertImportPlanFile(doc); store.write(doc); };
  const view = (doc, message) => ({ ...agentView(folder, doc, decider), ...(message ? { message: asSentence(message) } : {}) });
  const load = () => { const d = store.read(); if (d) assertImportPlanFile(d); return d; };
  const stepOf = (doc, id) => doc.steps.find((s) => s.id === id);
  const current = (doc) => doc.steps.find((s) => s.review !== 'skipped' && s.run !== 'done' && s.run !== 'left') ?? null;

  /** A question about the current step, asked once a round stopped improving (or there is nothing to try). */
  function askAboutStep(doc, step, ps, why) {
    const fixes = (ps?.result?.options ?? []).filter((x) => x.id === 'fix' && x.step);
    const options = [
      ...fixes.map((x) => ({ id: `fix:${x.fixId}`, sentence: asSentence(x.sentence) })),
      ...(undoSentence(doc) ? [{ id: 'undo', sentence: /** @type {string} */ (undoSentence(doc)) }] : []),
      { id: 'leave', sentence: `Leave ${step.args.name ?? 'this item'} as it is and carry on with the next step.` },
    ];
    step.run = 'needs-you';
    doc.waiting = {
      for: 'answer', stepId: step.id, sentence: asSentence(`${step.args.name ?? 'This step'} needs you: ${lower(asSentence(why))}`),
      question: { id: `step:${step.id}`, sentence: `What should Line do with ${step.args.name ?? 'this step'}?`, options, recommended: options[0].id },
    };
  }

  // ----------------------------------------------------------------------------------------------- the loop (v2)
  const looping = (doc) => Boolean(o.logic && doc.logic?.map);

  /** After a step landed: rebuild the map, diff it, run the tests, check behaviour; keep and record the ImportLoopState. */
  async function checkStep(doc, step, by) {
    const m = await measure(o.logic, { root, folder, logic: doc.logic });
    const checks = loopChecks(m, doc.logic, { at: 'step', folder });
    const n = doc.steps.indexOf(step) + 1;
    const before = doc.logic.loop.at(-1)?.mapAfter ?? doc.logic.map;
    const state = loopState({ step, n, at: now(), before, m, checks, logic: doc.logic });
    doc.logic.loop.push(state);
    if (doc.logic.loop.length > LOOP_LIMITS.states) doc.logic.loop.splice(0, doc.logic.loop.length - LOOP_LIMITS.states);
    doc.logic.last = { kept: m.diff.kept.length + m.diff.moved.length, missing: state.diff.missing.filter((u) => !u.waived), coverage: state.coverage, tests: state.tests };
    try { o.logic.record?.(state); } catch { /* a record that cannot be written never stops the import */ }
    const failing = checks.filter((c) => c.state === 'fail');
    record(doc, 'line', 'loop', state.status === 'ok' ? `checked step ${n}: ${lower(state.sentence)}` : `stopped after step ${n}: ${lower(state.sentence)}`, step.id);
    if (failing.length) {
      doc.logic.pending = { at: 'step', stepId: step.id, checks: failing };
      doc.waiting = { for: 'answer', stepId: step.id, sentence: asSentence(`Step ${n} stopped the import: ${lower(state.sentence)}`), question: loopQuestion(`loop:${step.id}`, failing, `What should Line do about step ${n}?`, { undo: undoSentence(doc) }) };
    } else doc.logic.pending = null;
    return state;
  }

  /** The undo option's sentence, when the folder was saved before the first step (else none). */
  function undoSentence(doc) {
    if (!(o.rollback && doc.undo === 'saved')) return undefined;
    const landed = doc.steps.filter((x) => x.run === 'done').length;
    return `Undo the import: put ${folder} back as it was before it started${landed ? ` (${landed} step${landed === 1 ? '' : 's'} landed)` : ''}.`;
  }

  /** Fit every unit of the baseline map into ONE Line block (the FitProposal) and keep it with its extract steps. */
  async function fitStage(doc) {
    if (!looping(doc) || !o.logic.fit) return;
    const map = await o.logic.load('logic-map');
    const fit = await o.logic.fit(root, folder, doc.logic.closure, map ?? { units: [] });
    await o.logic.save('fit', fit);
    doc.logic.fit = fitSummary(fit.proposal, fit.steps.length);
    record(doc, 'line', 'classify', `fitted the logic: ${lower(doc.logic.fit.sentence)}`);
  }

  /** Map the unmodified app (the folder, or the route's closure) and keep it as the baseline. */
  async function mapStage(doc) {
    if (!o.logic) { record(doc, 'line', 'map', 'no logic map is set up for this import, so its units are not checked'); return; }
    const closure = await o.logic.closure(root, folder, doc.logic.route);
    const map = await o.logic.buildMap(root, folder, closure);
    await o.logic.save('logic-map', map);
    await o.logic.save('baseline', { files: map.files });
    doc.logic.closure = { routes: closure.routes ?? [], files: closure.files ?? [], external: closure.external ?? [] };
    doc.logic.map = mapSummary(map);
    const files = doc.logic.closure.files.length;
    record(doc, 'line', 'map', `mapped ${map.units.length} logic unit${map.units.length === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}${doc.logic.route ? ` of route ${doc.logic.route}` : ''}`);
  }

  /** Characterization tests on the unmodified app: written once, and every one must pass before anything moves. */
  async function characterizeStage(doc) {
    if (!looping(doc)) { record(doc, 'line', 'characterize', 'no characterization tests are set up for this import'); return true; }
    if (!doc.logic.baselineTests) {
      const map = await o.logic.load('logic-map');
      const c = await o.logic.characterize(root, folder, doc.logic.closure, map ?? { units: [] });
      doc.logic.tests = c.tests;
    }
    const t = await o.logic.runTests(root, folder, doc.logic.tests);
    doc.logic.baselineTests = { state: t.state, passed: t.passed, failed: t.failed, total: t.total, sentence: asSentence(t.sentence) };
    if (t.state === 'fail') {
      doc.logic.pending = { at: 'characterize', failures: t.failures ?? [] };
      doc.waiting = {
        for: 'answer', sentence: asSentence(`${t.failed} of ${t.total} characterization tests fail on the app before anything moved, so they cannot prove its behaviour is kept${t.failures?.[0] ? `; the first: ${t.failures[0].title}` : ''}`),
        question: { id: 'characterize', sentence: 'What should Line do about the failing tests?', options: [{ id: 'recheck', sentence: 'Fix the tests (or the app), then run them again.' }, { id: 'waive', sentence: 'Carry on without the failing tests: you accept that they prove nothing (owner only).' }], recommended: 'recheck' },
      };
      return false;
    }
    record(doc, 'line', 'characterize', t.state === 'skipped' ? lower(asSentence(t.sentence)) : `ran ${t.total} characterization test${t.total === 1 ? '' : 's'} on the unmodified app: all pass`);
    return true;
  }

  /** Add one cp1 plan step; a person-driven request approves the steps the person asked for. */
  async function addPlanStep(doc, step, req, by, approveAsPerson) {
    const r = await svc.addStep(req, 'agent');
    if (!r.ok) return r;
    step.planStepIds.push(r.stepId);
    record(doc, 'agent', 'add-step', `added a plan step for ${step.args.name ?? step.id}: ${lower(asSentence(r.steps.find((s) => s.id === r.stepId)?.why ?? req.tool))}`, step.id);
    if (approveAsPerson && by === 'ui') {
      const a = await svc.approve(r.stepId, 'ui');
      if (a.ok) record(doc, 'ui', 'approve', `approved the plan step for ${step.args.name ?? step.id}`, step.id);
    }
    return r;
  }

  /** One move of the execute stage. 'more' to keep going, 'wait' when the person (or a running step) is needed. */
  async function executeOnce(doc, by, answered) {
    if (doc.cursor.phase === 'putback') return putBackOnce(doc, by);
    const step = current(doc);
    if (!step) { doc.cursor = { pending: null, origin: null, phase: null }; go(doc, by, 'EXECUTED'); return 'more'; }
    if (step.review !== 'approved') {
      doc.waiting = { for: 'review', stepId: step.id, sentence: asSentence(`Approve "${step.sentence.replace(/[.?!]$/, '')}" in the plan before Line runs it`) };
      return 'wait';
    }
    if (step.run === 'needs-you') return 'wait';
    const c = doc.cursor;
    // The person approved this exact step in the review, and is driving now: their approval carries to the plan step.
    const reviewedByPerson = step.approvedBy === 'ui';
    if (!c.pending) {
      if (o.snapshot && doc.undo === undefined) {
        // Before the first write: save the folder as it is, so a refused later step can undo the whole import.
        const ran = doc.steps.some((x) => x.run !== 'todo' || x.planStepIds.length);
        if (!ran) {
          try { await o.snapshot(root, folder); doc.undo = 'saved'; } catch (e) { doc.undo = 'none'; record(doc, 'line', 'state', `could not save ${folder} for an undo: ${lower(asSentence(/** @type {any} */ (e)?.sentence ?? /** @type {any} */ (e)?.message ?? 'unknown'))}`); }
        } else doc.undo = 'none';
      }
      const r = await addPlanStep(doc, step, { tool: step.tool, args: { ...step.args }, why: step.sentence }, by, reviewedByPerson || answered);
      if (!r.ok) { askAboutStep(doc, step, null, r.sentence); return 'wait'; }
      step.run = 'running';
      doc.cursor = { pending: r.stepId, origin: r.stepId, phase: 'step' };
      return 'more';
    }
    const plan = await svc.view();
    const ps = plan.steps.find((s) => s.id === c.pending);
    if (!ps) { doc.cursor = { pending: null, origin: null, phase: null }; step.run = 'todo'; return 'more'; }
    if (ps.state === 'waiting') {
      doc.waiting = { for: 'approval', stepId: step.id, planStepId: ps.id, sentence: asSentence(`Approve plan step ${ps.n} to go on: ${lower(ps.why)}`) };
      return 'wait';
    }
    if (ps.state === 'running') { doc.waiting = null; return 'wait'; }
    if (ps.state === 'ready') {
      const r = await svc.runNext(by === 'ui' ? 'ui' : 'agent', ps.id);
      if (!r.ok) { askAboutStep(doc, step, null, r.sentence); return 'wait'; }
      return 'more';
    }
    if (ps.state === 'done' || ps.state === 'skipped') {
      if (c.phase === 'fix') {
        const r = await addPlanStep(doc, step, { tool: step.tool, args: { retry: { of: c.origin } } }, by, answered || reviewedByPerson);
        if (!r.ok) {
          if (r.code === 'STOPPED') { // cp1 will not retry a step that stopped improving: leave it, then run the step afresh.
            const l = await addPlanStep(doc, step, { tool: 'line.leaveAsIs', args: { stepId: c.origin } }, by, true);
            if (!l.ok) { askAboutStep(doc, step, null, l.sentence); return 'wait'; }
            doc.cursor = { pending: l.stepId, origin: c.origin, phase: 'refresh' };
            return 'more';
          }
          askAboutStep(doc, step, null, r.sentence); return 'wait';
        }
        doc.cursor = { pending: r.stepId, origin: r.stepId, phase: 'retry' };
        return 'more';
      }
      if (c.phase === 'refresh') { doc.cursor = { pending: null, origin: null, phase: null }; step.run = 'todo'; return 'more'; }
      if (c.phase === 'leave') {
        // Every plan step of this import step that still needs the person is left too (the step and a refused fix).
        const still = plan.steps.find((s) => step.planStepIds.includes(s.id) && (s.state === 'needs-you' || s.state === 'needs-fix'));
        if (still) {
          const l = await addPlanStep(doc, step, { tool: 'line.leaveAsIs', args: { stepId: still.id } }, by, true);
          if (!l.ok) { askAboutStep(doc, step, null, l.sentence); return 'wait'; }
          doc.cursor = { pending: l.stepId, origin: still.id, phase: 'leave' };
          return 'more';
        }
        step.run = 'left'; step.outcome = `Left as it is: ${lower(asSentence(step.sentence))}`;
      }
      else { step.run = 'done'; step.outcome = asSentence(ps.sentence); }
      doc.cursor = { pending: null, origin: null, phase: null };
      // The step landed: the loop checks it before anything else moves.
      if (step.run === 'done' && looping(doc)) {
        o.logic.stepLanded?.(step.tool, step.args);
        const st = await checkStep(doc, step, by);
        if (st.status === 'stopped') return 'wait';
      }
      return 'more';
    }
    if (ps.state === 'needs-fix' || ps.state === 'needs-you') {
      if (c.phase === 'fix') { askAboutStep(doc, step, null, `the fix Line tried was refused too: ${lower(ps.sentence)}`); doc.cursor = { ...c, origin: c.origin }; return 'wait'; }
      const result = ps.result ?? {};
      const fixes = (result.options ?? []).filter((x) => x.id === 'fix' && x.step);
      if (result.stopped) { askAboutStep(doc, step, ps, `trying again did not pass more checks than before. ${ps.sentence}`); doc.cursor = { ...c, origin: ps.id }; return 'wait'; }
      if (step.rounds >= MAX_ROUNDS) { askAboutStep(doc, step, ps, `${MAX_ROUNDS} rounds of fixes did not finish it. ${ps.sentence}`); doc.cursor = { ...c, origin: ps.id }; return 'wait'; }
      if (!fixes.length) { askAboutStep(doc, step, ps, ps.sentence); doc.cursor = { ...c, origin: ps.id }; return 'wait'; }
      // The refusal and its typed fixes go back into the decision; jev (or the static order) picks one.
      const ids = [...fixes].sort((a, b) => Number(b.recommended === true) - Number(a.recommended === true)).map((x) => x.fixId);
      const d = await decideWith(o.reason, `fix:${ps.id}`, `${ps.sentence} Which fix should Line try?`, ids);
      doc.decisions.push({ id: `fix:${ps.id}`, question: asSentence(`Which fix for ${step.args.name ?? step.id}?`), options: ids, picked: d.picked, answer: asSentence(fixes.find((x) => x.fixId === d.picked).sentence), by: d.by, reason: d.reason });
      record(doc, 'agent', 'decide', `picked the fix "${fixes.find((x) => x.fixId === d.picked).sentence.replace(/[.?!]$/, '')}" for ${step.args.name ?? step.id} (${d.by})`, step.id);
      const fix = fixes.find((x) => x.fixId === d.picked);
      const r = await addPlanStep(doc, step, { tool: fix.step.tool, args: { ...fix.step.args, fixOf: ps.id }, why: asSentence(`Fix for ${step.args.name ?? step.id}: ${lower(fix.sentence)}`) }, by, answered);
      if (!r.ok) { askAboutStep(doc, step, ps, r.sentence); return 'wait'; }
      step.rounds += 1;
      doc.cursor = { pending: r.stepId, origin: ps.id, phase: 'fix' };
      return 'more';
    }
    askAboutStep(doc, step, ps, ps.sentence || 'the plan step failed');
    doc.cursor = { ...c, origin: ps.id };
    return 'wait';
  }

  /** A typed put-back fix (the extract step of a lost unit's block) is running: once it lands, check the step again. */
  async function putBackOnce(doc, by) {
    const c = doc.cursor;
    const step = stepOf(doc, c.stepId);
    const plan = await svc.view();
    const ps = plan.steps.find((s) => s.id === c.pending);
    if (!ps || !step) { doc.cursor = { pending: null, origin: null, phase: null }; return 'more'; }
    if (ps.state === 'waiting') { doc.waiting = { for: 'approval', stepId: step.id, planStepId: ps.id, sentence: asSentence(`Approve plan step ${ps.n} to go on: ${lower(ps.why)}`) }; return 'wait'; }
    if (ps.state === 'running') { doc.waiting = null; return 'wait'; }
    if (ps.state === 'ready') {
      const r = await svc.runNext(by === 'ui' ? 'ui' : 'agent', ps.id);
      if (!r.ok) { doc.cursor = { pending: null, origin: null, phase: null }; return askAgain(doc, step, r.sentence); }
      return 'more';
    }
    doc.cursor = { pending: null, origin: null, phase: null };
    if (ps.state === 'done') {
      record(doc, 'line', 'loop', `the put-back step landed: ${lower(asSentence(ps.sentence))}`, step.id);
      const st = await checkStep(doc, step, by);
      return st.status === 'ok' ? 'more' : 'wait';
    }
    return askAgain(doc, step, `the put-back step was refused: ${lower(asSentence(ps.sentence || 'the plan step failed'))}`);
  }

  /** Ask the loop's question about a step again, with the reason the last try did not finish it. */
  async function askAgain(doc, step, why) {
    const st = await checkStep(doc, step, 'line');
    if (st.status === 'ok') return 'more';
    doc.waiting = { ...doc.waiting, sentence: asSentence(`${doc.waiting.sentence.replace(/[.?!]$/, '')}; ${why}`) };
    return 'wait';
  }

  /** Put the folder back as it was before the import (o.rollback), mark what landed as undone and end the import. */
  async function undoImport(doc, by, step) {
    const r = await o.rollback(root, folder);
    if (!r.ok) return r;
    doc.waiting = null;
    for (const x of doc.steps.filter((y) => y.run !== 'todo')) { x.run = 'undone'; x.outcome = `Undone: ${lower(asSentence(x.sentence))}`; }
    doc.undo = 'undone';
    doc.cursor = { pending: null, origin: null, phase: null };
    if (doc.logic) doc.logic.pending = null;
    record(doc, by, 'undo', `undid the import: ${lower(asSentence(r.sentence))}`, step?.id);
    go(doc, by, 'UNDONE');
    return r;
  }

  /** Run the process until it needs someone, is paused, or is done. */
  async function run(doc, by, answered = false) {
    if (doc.waiting?.for === 'answer') return; // one question at a time: nothing moves until it is answered
    doc.waiting = null;
    for (let guard = 0; guard < 500 && !doc.paused; guard += 1) {
      if (doc.state === 'scan') {
        const scan = importOps.scan(root, folder);
        doc.baseline = o.baseline ? await o.baseline(root, folder) : [];
        doc.found = scan.found.map((f) => ({ file: f.file, name: f.name, kind: f.kind, target: f.proposal.target, ...(f.proposal.feature ? { feature: f.proposal.feature } : {}) }));
        doc.questions = scan.questions;
        record(doc, 'agent', 'state', `read ${folder}: ${scan.found.length} item${scan.found.length === 1 ? '' : 's'}, ${scan.questions.length} open question${scan.questions.length === 1 ? '' : 's'}`);
        go(doc, by, 'SCANNED');
      } else if (doc.state === 'map') {
        doc.logic ??= newLogic(null);
        await mapStage(doc);
        go(doc, by, 'MAPPED');
      } else if (doc.state === 'characterize') {
        if (!await characterizeStage(doc)) return;
        go(doc, by, 'CHARACTERIZED');
      } else if (doc.state === 'classify') {
        for (const q of doc.questions ?? []) {
          if (doc.answers[q.id]) continue;
          const ids = [q.recommended, ...q.options.map((x) => x.id).filter((x) => x !== q.recommended)];
          const d = await decideWith(o.reason, q.id, q.sentence, ids);
          doc.answers[q.id] = d.picked;
          doc.decisions.push({ id: q.id, question: asSentence(q.sentence), options: ids, picked: d.picked, answer: asSentence(q.options.find((x) => x.id === d.picked)?.sentence ?? d.picked), by: d.by, reason: d.reason });
          record(doc, 'agent', 'decide', `decided "${q.sentence.replace(/[.?!]$/, '')}": ${lower(q.options.find((x) => x.id === d.picked)?.sentence ?? d.picked)}`);
        }
        delete doc.questions;
        await fitStage(doc);
        go(doc, by, 'CLASSIFIED');
      } else if (doc.state === 'plan') {
        const route = doc.logic?.route ?? null;
        const plan = importOps.plan(root, folder, doc.answers, route ? { route } : undefined);
        // A route-seeded import also lands the FitProposal's blocks: its extract steps run after Import's own moves.
        const fitted = route && looping(doc) ? fitPlanSteps(await o.logic.load('fit'), plan.steps) : [];
        doc.steps = [...plan.steps, ...fitted].map((s) => ({ id: s.id, tool: s.tool, args: s.args, sentence: s.sentence, review: 'proposed', run: 'todo', planStepIds: [], rounds: 0, outcome: null, approvedBy: null }));
        record(doc, 'agent', 'state', `wrote the plan: ${lower(plan.summary)}${fitted.length ? ` Then ${fitted.length} step${fitted.length === 1 ? '' : 's'} fit the logic into its blocks.` : ''}`);
        go(doc, by, 'PLANNED');
      } else if (doc.state === 'review') {
        const open = doc.steps.filter((s) => s.review === 'proposed');
        if (open.length || !doc.steps.length) {
          doc.waiting = { for: 'review', sentence: doc.steps.length ? `Review the plan: approve its ${open.length} step${open.length === 1 ? '' : 's'}, or edit, skip or reorder them first.` : `There is nothing in ${folder} for Line to bring in.` };
          return;
        }
        go(doc, by, 'REVIEWED');
      } else if (doc.state === 'execute') {
        if (await executeOnce(doc, by, answered) === 'wait') return;
        answered = false;
      } else if (doc.state === 'verify') {
        const base = o.verify ? await o.verify(root, folder, doc.baseline ?? []) : { ok: true, checks: [{ id: 'validate', state: 'skipped', sentence: 'No checks are set up for this import.' }] };
        // Line Import v2: the loop's checks once more, now with unit coverage (every unit has a block and a test, or a waiver).
        let logicFailing = [];
        let extra = [];
        if (looping(doc)) {
          const m = await measure(o.logic, { root, folder, logic: doc.logic });
          const lc = loopChecks(m, doc.logic, { at: 'verify', folder });
          const st = loopState({ step: { id: 'verify', tool: 'verify', sentence: 'Check everything', args: { folder } }, n: doc.steps.length + 1, at: now(), before: doc.logic.loop.at(-1)?.mapAfter ?? doc.logic.map, m, checks: lc, logic: doc.logic });
          doc.logic.last = { kept: m.diff.kept.length + m.diff.moved.length, missing: st.diff.missing.filter((u) => !u.waived), coverage: st.coverage, tests: st.tests };
          logicFailing = lc.filter((c) => c.state === 'fail');
          doc.logic.pending = logicFailing.length ? { at: 'verify', checks: logicFailing } : null;
          extra = lc.map((c) => ({ id: c.id, state: c.state, sentence: c.sentence, ...(c.detail ? { detail: c.detail } : {}) }));
        }
        const checks = [...base.checks, ...extra];
        const v = { ok: !checks.some((c) => c.state === 'fail'), checks };
        doc.verify = v;
        record(doc, 'line', 'verify', v.ok ? 'checked the folder: every check passed (or says why it could not run)' : `checked the folder: some checks fail: ${v.checks.filter((c) => c.state === 'fail').map((c) => c.id).join(', ')}`);
        if (!v.ok) {
          const first = v.checks.find((c) => c.state === 'fail');
          // Lost or untested logic is never finished "anyway": it is put back, tested, or waived by the owner.
          const question = logicFailing.length
            ? (() => { const q = loopQuestion('verify', logicFailing, 'The import landed, but some checks fail. What now?'); return { ...q, options: q.options.map((x) => (x.id === 'recheck' ? { ...x, id: 'verify-again' } : x)), recommended: 'verify-again' }; })()
            : { id: 'verify', sentence: 'The import landed, but some checks fail. What now?', options: [{ id: 'verify-again', sentence: 'Check again (after you fixed something).' }, { id: 'finish', sentence: 'Finish the import anyway; the problems stay listed.' }], recommended: 'verify-again' };
          doc.waiting = { for: 'answer', sentence: asSentence(`The checks found problems: ${lower(first.sentence)}`), question };
          return;
        }
        go(doc, by, 'VERIFIED');
      } else return;
    }
  }

  const withDoc = (fn) => serial(async () => {
    const doc = load();
    if (!doc) return refusal('NOT_STARTED', `The import of ${folder} has not started; start it first`);
    return fn(doc);
  });

  return {
    folder,
    /** The process as it stands (no file is written). */
    view: () => serial(async () => view(load())),

    /** Start (scan, map, characterize, classify, plan) and stop at the review. An import already started is shown as it
     * is. `opts.route` seeds the logic map with a route's closure (the folder is still where the import writes). */
    start: (by = 'ui', opts = {}) => serial(async () => {
      const had = load();
      if (had) return view(had, 'This import has already started; here it is');
      if (o.checkFolder) o.checkFolder();
      const route = typeof opts?.route === 'string' && opts.route.trim() ? opts.route.trim() : null;
      if (route && !o.logic) return refusal('NO_LOGIC', 'A route needs the logic map, which is not set up for this import; start it with the folder alone');
      const doc = newDoc(folder, route);
      record(doc, by, 'start', `started the import of ${folder}`);
      await run(doc, by);
      save(doc);
      return view(doc);
    }),

    pause: (by = 'ui') => withDoc(async (doc) => {
      if (doc.paused) return view(doc, 'It is already paused');
      doc.paused = true;
      record(doc, by, 'pause', `paused at ${doc.state}`);
      save(doc);
      return view(doc);
    }),

    /** Carry on: unpause and run until the process needs someone again. */
    resume: (by = 'ui') => withDoc(async (doc) => {
      if (doc.paused) { doc.paused = false; record(doc, by, 'resume', `resumed at ${doc.state}`); }
      if (doc.waiting?.for === 'answer') return view(doc, 'Answer the question first');
      await run(doc, by);
      save(doc);
      return view(doc);
    }),

    /** Edit, skip, unskip, move or approve plan steps (before they run). */
    editStep: (by, edit) => withDoc(async (doc) => {
      if (!['review', 'execute'].includes(doc.state)) return refusal('BAD_STATE', `The plan can be changed during review and while it runs; this import is at ${doc.state}`);
      const action = edit?.action;
      if (action === 'approve-all') {
        const open = doc.steps.filter((s) => s.review === 'proposed');
        if (!open.length) return refusal('NOTHING_TO_APPROVE', 'Every step is already approved or skipped');
        for (const s of open) { s.review = 'approved'; s.approvedBy = by === 'ui' ? 'ui' : 'agent'; }
        record(doc, by, 'approve-all', `approved ${open.length} step${open.length === 1 ? '' : 's'}`);
        if (!doc.paused && doc.waiting?.for !== 'answer') await run(doc, by);
        save(doc);
        return view(doc);
      }
      const step = stepOf(doc, edit?.stepId);
      if (!step) return refusal('UNKNOWN_STEP', `There is no step ${edit?.stepId ?? ''} in this import plan`);
      const frozen = step.run !== 'todo';
      if (action === 'approve') {
        if (step.review === 'approved') return refusal('ALREADY', 'This step is already approved');
        if (step.review === 'skipped') return refusal('SKIPPED', 'This step is skipped; bring it back first');
        step.review = 'approved'; step.approvedBy = by === 'ui' ? 'ui' : 'agent';
        record(doc, by, 'approve', `approved "${step.sentence.replace(/[.?!]$/, '')}"`, step.id);
      } else if (action === 'skip' || action === 'unskip') {
        if (frozen) return refusal('ALREADY_RAN', 'This step has already started, so it cannot be skipped now');
        if (action === 'skip' && step.tool === 'line.import.mark') return refusal('NEEDED', 'The first step marks the folder as Line, and every other step needs it, so it cannot be skipped');
        step.review = action === 'skip' ? 'skipped' : 'proposed';
        step.approvedBy = null;
        keepSkippedInPlace(doc);
        record(doc, by, action, `${action === 'skip' ? 'skipped' : 'brought back'} "${step.sentence.replace(/[.?!]$/, '')}"`, step.id);
      } else if (action === 'edit') {
        if (frozen) return refusal('ALREADY_RAN', 'This step has already started, so it cannot be changed now');
        try { checkEdit(step.tool, edit.args); } catch (e) { return refusal(/** @type {any} */ (e).code, /** @type {any} */ (e).sentence); }
        const before = step.sentence;
        step.args = { ...step.args, ...edit.args, folder: doc.folder };
        step.sentence = stepSentence(step.tool, step.args);
        step.review = 'proposed'; step.approvedBy = null;
        record(doc, by, 'edit', `changed "${before.replace(/[.?!]$/, '')}" to "${step.sentence.replace(/[.?!]$/, '')}"; it needs approval again`, step.id);
      } else if (action === 'move') {
        const from = doc.steps.indexOf(step);
        const to = Number(edit.to);
        const firstOpen = doc.steps.findIndex((s) => s.run === 'todo' && s.tool !== 'line.import.mark');
        if (frozen || !Number.isInteger(to) || to < 0 || to >= doc.steps.length) return refusal('BAD_MOVE', 'Only a step that has not run can move, to a place in the plan');
        if (step.tool === 'line.import.mark' || to < firstOpen || firstOpen < 0) return refusal('BAD_MOVE', 'A step can only move among the steps that have not run, after the first step that marks the folder');
        doc.steps.splice(from, 1);
        doc.steps.splice(to, 0, step);
        record(doc, by, 'move', `moved "${step.sentence.replace(/[.?!]$/, '')}" from place ${from + 1} to ${to + 1}`, step.id);
      } else return refusal('BAD_ACTION', 'The action is one of edit, skip, unskip, move, approve or approve-all');
      if (doc.state === 'execute' && step.review !== 'approved' && current(doc)?.id === step.id) doc.waiting = null;
      if (!doc.paused && doc.waiting?.for !== 'answer' && doc.waiting?.for !== 'approval') await run(doc, by);
      save(doc);
      return view(doc);
    }),

    /** Answer the one question the process asked. */
    answer: (by, questionId, optionId) => withDoc(async (doc) => {
      const q = doc.waiting?.for === 'answer' ? doc.waiting.question : null;
      if (!q || q.id !== questionId) return refusal('NO_QUESTION', 'There is no such question open right now');
      if (!q.options.some((x) => x.id === optionId)) return refusal('BAD_OPTION', `Pick one of the options: ${q.options.map((x) => x.id).join(', ')}`);
      // Only a person waives: an agent's waiver is refused and changes nothing.
      if (optionId === 'waive' && by !== 'ui') return refusal('OWNER_ONLY', 'Only a person can waive a logic unit; an agent never can. Ask the owner to decide in Cockpit');
      record(doc, by, 'answer', `answered "${q.sentence.replace(/[.?!]$/, '')}": ${lower(q.options.find((x) => x.id === optionId).sentence)}`, doc.waiting.stepId);
      if (q.id === 'characterize') {
        if (optionId === 'waive') {
          const failed = new Set((doc.logic.pending?.failures ?? []).map((f) => f.file));
          const dropped = doc.logic.tests.filter((t) => failed.has(t.file));
          doc.logic.tests = doc.logic.tests.filter((t) => !failed.has(t.file));
          for (const t of dropped) doc.logic.waivers.push({ fingerprint: `test:${t.file}`, by: 'owner', why: asSentence(`The test "${t.title}" failed on the unmodified app, and the owner went on without it`), at: now() });
          record(doc, by, 'waive', `went on without ${dropped.length} failing characterization test${dropped.length === 1 ? '' : 's'}`);
        }
        doc.waiting = null; doc.logic.pending = null;
        await run(doc, by, true);
        save(doc);
        return view(doc);
      }
      if (q.id.startsWith('loop:')) {
        const step = stepOf(doc, doc.waiting.stepId);
        if (optionId === 'undo') {
          const r = await undoImport(doc, by, step);
          if (!r.ok) doc.waiting = { ...doc.waiting, sentence: asSentence(`The undo was refused: ${lower(asSentence(r.sentence))}`) };
          save(doc);
          return view(doc);
        }
        const typed = q.options.find((x) => x.id === optionId && x.step);
        if (typed) {
          // The typed fix: the extract step that puts the lost unit back into its block, as a plan step the person approved here.
          doc.decisions.push({ id: `${q.id}:${optionId}`, question: asSentence(q.sentence), options: q.options.map((x) => x.id), picked: optionId, answer: asSentence(typed.sentence), by: 'person', reason: 'The person picked it.' });
          const r = await addPlanStep(doc, step, { tool: typed.step.tool, args: { ...typed.step.args }, why: asSentence(typed.sentence) }, by, true);
          if (!r.ok) { doc.waiting = { ...doc.waiting, sentence: asSentence(`That fix could not be added: ${lower(asSentence(r.sentence))}`) }; save(doc); return view(doc); }
          doc.waiting = null;
          doc.cursor = { pending: r.stepId, origin: null, phase: 'putback', stepId: step.id };
          await run(doc, by, true);
          save(doc);
          return view(doc);
        }
        if (optionId === 'waive') {
          const w = addWaivers(doc.logic, doc.logic.pending?.checks ?? [], by, now());
          if (w.ok) record(doc, by, 'waive', `waived ${w.count} logic unit${w.count === 1 ? '' : 's'} after "${step.sentence.replace(/[.?!]$/, '')}"`, step.id);
        }
        doc.waiting = null;
        const st = await checkStep(doc, step, by);
        if (st.status === 'ok') await run(doc, by, true);
        save(doc);
        return view(doc);
      }
      if (q.id === 'verify' && optionId === 'waive') {
        const w = addWaivers(doc.logic, doc.logic.pending?.checks ?? [], by, now());
        if (w.ok) record(doc, by, 'waive', `waived ${w.count} logic unit${w.count === 1 ? '' : 's'} at the final check`);
        doc.waiting = null;
        await run(doc, by, true);
        save(doc);
        return view(doc);
      }
      if (q.id === 'verify') {
        if (optionId === 'finish') { doc.waiting = null; go(doc, by, 'FINISHED'); save(doc); return view(doc); }
        doc.waiting = null;
        await run(doc, by, true);
        save(doc);
        return view(doc);
      }
      const step = stepOf(doc, doc.waiting.stepId);
      const blocker = doc.cursor.origin;
      if (optionId === 'undo') {
        const r = await undoImport(doc, by, step);
        if (!r.ok) askAboutStep(doc, step, null, `the undo was refused: ${lower(asSentence(r.sentence))}`);
        save(doc);
        return view(doc);
      }
      doc.waiting = null;
      const plan = await svc.view();
      const bps = plan.steps.find((s) => s.id === blocker);
      if (optionId === 'leave') {
        const needing = plan.steps.find((s) => step.planStepIds.includes(s.id) && (s.state === 'needs-you' || s.state === 'needs-fix'));
        if (needing) {
          const l = await addPlanStep(doc, step, { tool: 'line.leaveAsIs', args: { stepId: needing.id } }, by, true);
          if (!l.ok) { askAboutStep(doc, step, null, l.sentence); save(doc); return view(doc); }
          step.run = 'running';
          doc.cursor = { pending: l.stepId, origin: needing.id, phase: 'leave' };
        } else {
          step.run = 'left'; step.outcome = `Left as it is: ${lower(step.sentence)}`;
          doc.cursor = { pending: null, origin: null, phase: null };
        }
      } else {
        const fix = (bps?.result?.options ?? []).find((x) => x.id === 'fix' && x.step && `fix:${x.fixId}` === optionId);
        if (!fix) { askAboutStep(doc, step, bps, 'that fix no longer applies'); save(doc); return view(doc); }
        doc.decisions.push({ id: `fix:${blocker}:person`, question: asSentence(`Which fix for ${step.args.name ?? step.id}?`), options: [fix.fixId], picked: fix.fixId, answer: asSentence(fix.sentence), by: 'person', reason: 'The person picked it.' });
        const r = await addPlanStep(doc, step, { tool: fix.step.tool, args: { ...fix.step.args, fixOf: blocker } }, by, true);
        if (!r.ok) { askAboutStep(doc, step, bps, r.sentence); save(doc); return view(doc); }
        step.run = 'running';
        step.rounds += 1;
        doc.cursor = { pending: r.stepId, origin: blocker, phase: 'fix' };
      }
      await run(doc, by, true);
      save(doc);
      return view(doc);
    }),
  };
}

/**
 * A skipped move step leaves its file where it is, so the folder it sits in joins the mark step's line.appFolders (with
 * the folders the scan left in place), and LINE-LAYOUT does not report it as a stray file after the import.
 * @param {any} doc The import plan file.
 * @returns {void}
 */
function keepSkippedInPlace(doc) {
  const mark = doc.steps.find((x) => x.tool === 'line.import.mark');
  if (!mark || mark.run !== 'todo') return;
  mark.scanAppFolders ??= [...(mark.args.appFolders ?? [])];
  const skipped = doc.steps.filter((x) => x.review === 'skipped' && typeof x.args?.from === 'string' && x.args.from.includes('/')).map((x) => x.args.from.split('/')[0]);
  const all = [...new Set([...mark.scanAppFolders, ...skipped])].sort();
  if (all.length) mark.args = { ...mark.args, appFolders: all };
  else { const { appFolders: _a, ...rest } = mark.args; mark.args = rest; }
}
