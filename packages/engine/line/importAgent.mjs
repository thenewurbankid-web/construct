// ci2 -- the Import agent: one agent in Import mode, run as a fixed typed process (an xstate machine):
//
//   scan -> classify -> plan -> review -> execute -> verify -> done
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
// Correction loop (owner, 11 Oct): a refused step's sentence and typed fixes go back into the decision (jev picks,
// usually the top fix), the fix runs, the step is tried again; when a round does not pass more checks than the one
// before (cp1's `stopped`), or after MAX_ROUNDS, the process stops and asks the person ONE question.
import fs from 'node:fs';
import path from 'node:path';
import { createMachine, getNextSnapshot } from 'xstate';
import { IMPORT_AGENT_STAGES, IMPORT_EDITABLE, IMPORT_PLAN_FILE, LEVELS, LineOpError, assertImportPlanFile } from './contract.mjs';
import { scanImport, planImport } from './import.mjs';
import { createTransaction } from '../transactionalWriter.mjs';
import { aggregateValidation } from '../../core/registry.mjs';
import { enforcersForRoot } from '../../core/profiles/index.mjs';
import { folderRootOf, folderProblem } from './importTools.mjs';

/** Fix rounds per step before the agent asks the person, even when each round improved. */
export const MAX_ROUNDS = 3;

// ------------------------------------------------------------------------------------------------- the process
/** The fixed process. Events are the only way between states; pause/resume is a flag beside the state. */
export const importMachine = createMachine({
  id: 'line-import',
  initial: 'scan',
  states: {
    scan: { on: { SCANNED: 'classify' } },
    classify: { on: { CLASSIFIED: 'plan' } },
    plan: { on: { PLANNED: 'review' } },
    review: { on: { REVIEWED: 'execute' } },
    execute: { on: { EXECUTED: 'verify', REOPENED: 'review' } },
    verify: { on: { VERIFIED: 'done', FINISHED: 'done' } },
    done: { type: 'final' },
  },
});

/** The next state for `event`, or a LineOpError when the process does not allow it. */
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
 * The default store: read the file; write it through Construct's transactional writer with the folder as root. The
 * writer's check compares the folder's problems for the plan file before and after (the same "only new problems" rule as
 * applyChange, scoped to this one data file, so a folder that is not a Line project yet can still keep its plan).
 */
export function fileStore(root, folder) {
  const folderRoot = () => folderRootOf(root, folder);
  return {
    read() {
      try { return JSON.parse(fs.readFileSync(path.join(folderRoot(), IMPORT_PLAN_FILE), 'utf8')); } catch (e) {
        if (/** @type {any} */ (e)?.code === 'ENOENT') return null;
        throw e;
      }
    },
    write(doc) {
      const fr = folderRoot();
      const key = (v) => `${v.rule}\u0000${v.file}\u0000${v.message}`;
      const txn = createTransaction(fr);
      try {
        txn.writeFile(IMPORT_PLAN_FILE, `${JSON.stringify(doc, null, 2)}\n`);
        const r = txn.commit({
          validate: (shadow) => {
            const files = [IMPORT_PLAN_FILE];
            const before = new Set(aggregateValidation(fr, enforcersForRoot(fr), { files }).violations.map(key));
            const added = aggregateValidation(shadow, enforcersForRoot(shadow), { files }).violations.filter((v) => !before.has(key(v)));
            return { violations: added, ok: !added.some((v) => v.severity === 'error') };
          },
        });
        if (!r.committed) throw new LineOpError(`The import plan could not be saved: ${lower(asSentence(r.violations.find((v) => v.severity === 'error')?.message ?? 'the checks refused it'))}`, 'NOT_SAVED');
      } catch (e) {
        txn.reset();
        if (/** @type {any} */ (e)?.name === 'LineOpError') throw e;
        throw new LineOpError('The import plan could not be saved on disk.', 'NOT_SAVED', String(/** @type {any} */ (e)?.message ?? e));
      }
    },
  };
}

/** The sentence a step says, from its args (used again after an edit). */
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

function newDoc(folder) {
  return { version: 1, folder, state: 'scan', paused: false, waiting: null, found: [], answers: {}, decisions: [], steps: [], cursor: { pending: null, origin: null, phase: null }, verify: null, changes: [] };
}

/** Where the process is, in one sentence. */
function whereSentence(doc) {
  if (!doc) return 'The import has not started; pick a folder and start it.';
  if (doc.paused) return `Paused at "${IMPORT_AGENT_STAGES.find((s) => s.id === doc.state)?.label}"; resume to carry on.`;
  if (doc.waiting) return doc.waiting.sentence;
  if (doc.state === 'done') {
    const left = doc.steps.filter((s) => s.run === 'left').length;
    const done = doc.steps.filter((s) => s.run === 'done').length;
    return `Done: ${done} step${done === 1 ? '' : 's'} landed${left ? `, ${left} left as ${left === 1 ? 'it was' : 'they were'}` : ''}${doc.verify && !doc.verify.ok ? ', and some checks still fail' : ''}.`;
  }
  return `Working: ${lower(IMPORT_AGENT_STAGES.find((s) => s.id === doc.state)?.label ?? doc.state)}.`;
}

/** The view every route answers (contract.mjs ImportAgentView). */
export function agentView(folder, doc, decider) {
  const at = doc ? IMPORT_AGENT_STAGES.findIndex((s) => s.id === doc.state) : -1;
  return {
    ok: /** @type {const} */ (true),
    folder,
    state: doc ? doc.state : 'idle',
    paused: doc ? doc.paused : false,
    waiting: doc ? doc.waiting : null,
    stages: IMPORT_AGENT_STAGES.map((s, i) => ({ id: s.id, label: s.label, status: /** @type {const} */ (doc && (i < at || doc.state === 'done') ? 'done' : i === at ? 'current' : 'todo') })),
    sentence: whereSentence(doc),
    steps: doc ? doc.steps : [],
    decisions: doc ? doc.decisions : [],
    changes: doc ? doc.changes.slice(-100) : [],
    verify: doc ? doc.verify : null,
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
 * @param {{root: string, folder: string,
 *   planService: {view: () => Promise<any>, addStep: (req: any, by: string) => Promise<any>, approve: (id: string, by: string) => Promise<any>, runNext: (by: string, id?: string) => Promise<any>},
 *   reason?: {suggest: (summary: any) => Promise<any>, lastNote?: () => string | null} | null,
 *   verify?: (root: string, folder: string, baseline: string[]) => Promise<{ok: boolean, checks: any[]}>,
 *   baseline?: (root: string, folder: string) => Promise<string[]> | string[],
 *   importOps?: {scan: (root: string, folder: string) => any, plan: (root: string, folder: string, answers: Record<string, string>) => any},
 *   store?: {read: () => any, write: (doc: any) => void}, now?: () => string, decider?: string}} o
 */
export function createImportAgent(o) {
  const { root, folder, planService: svc } = o;
  const bad = folderProblem(folder);
  if (bad) throw new LineOpError(`The import folder ${bad}.`, 'BAD_FOLDER');
  const store = o.store ?? fileStore(root, folder);
  const importOps = o.importOps ?? { scan: scanImport, plan: planImport };
  const now = o.now ?? (() => new Date().toISOString());
  const decider = o.decider ?? (o.reason ? 'Decisions go through @mx/reason; when it is not linked, Line takes the recommended option.' : 'Line takes the recommended option for each decision (no decision module is set up).');
  let queue = Promise.resolve();
  const serial = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

  const record = (doc, by, action, sentence, stepId) => doc.changes.push({ n: doc.changes.length + 1, at: now(), by, action, ...(stepId ? { stepId } : {}), sentence: asSentence(sentence) });
  const go = (doc, by, event) => {
    const from = doc.state;
    doc.state = nextState(doc.state, event);
    record(doc, by === 'ui' || by === 'agent' ? by : 'line', 'state', `Moved from ${from} to ${doc.state}`);
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
      { id: 'leave', sentence: `Leave ${step.args.name ?? 'this item'} as it is and carry on with the next step.` },
    ];
    step.run = 'needs-you';
    doc.waiting = {
      for: 'answer', stepId: step.id, sentence: asSentence(`${step.args.name ?? 'This step'} needs you: ${lower(asSentence(why))}`),
      question: { id: `step:${step.id}`, sentence: `What should Line do with ${step.args.name ?? 'this step'}?`, options, recommended: options[0].id },
    };
  }

  /** Add one cp1 plan step; a person-driven request approves the steps the person asked for. */
  async function addPlanStep(doc, step, req, by, approveAsPerson) {
    const r = await svc.addStep(req, 'agent');
    if (!r.ok) return r;
    step.planStepIds.push(r.stepId);
    record(doc, 'agent', 'add-step', `Added plan step for ${step.args.name ?? step.id}: ${lower(asSentence(r.steps.find((s) => s.id === r.stepId)?.why ?? req.tool))}`, step.id);
    if (approveAsPerson && by === 'ui') {
      const a = await svc.approve(r.stepId, 'ui');
      if (a.ok) record(doc, 'ui', 'approve', `You approved the plan step for ${step.args.name ?? step.id}`, step.id);
    }
    return r;
  }

  /** One move of the execute stage. 'more' to keep going, 'wait' when the person (or a running step) is needed. */
  async function executeOnce(doc, by, answered) {
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
      doc.decisions.push({ id: `fix:${ps.id}`, question: asSentence(`Which fix for ${step.args.name ?? step.id}?`), options: ids, picked: d.picked, by: d.by, reason: d.reason });
      record(doc, 'agent', 'decide', `Picked the fix "${fixes.find((x) => x.fixId === d.picked).sentence.replace(/[.?!]$/, '')}" for ${step.args.name ?? step.id} (${d.by})`, step.id);
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
        record(doc, 'agent', 'state', `Read ${folder}: ${scan.found.length} item${scan.found.length === 1 ? '' : 's'}, ${scan.questions.length} open question${scan.questions.length === 1 ? '' : 's'}`);
        go(doc, by, 'SCANNED');
      } else if (doc.state === 'classify') {
        for (const q of doc.questions ?? []) {
          if (doc.answers[q.id]) continue;
          const ids = [q.recommended, ...q.options.map((x) => x.id).filter((x) => x !== q.recommended)];
          const d = await decideWith(o.reason, q.id, q.sentence, ids);
          doc.answers[q.id] = d.picked;
          doc.decisions.push({ id: q.id, question: asSentence(q.sentence), options: ids, picked: d.picked, by: d.by, reason: d.reason });
          record(doc, 'agent', 'decide', `${q.sentence.replace(/[.?!]$/, '')}: ${lower(q.options.find((x) => x.id === d.picked)?.sentence ?? d.picked)}`);
        }
        delete doc.questions;
        go(doc, by, 'CLASSIFIED');
      } else if (doc.state === 'plan') {
        const plan = importOps.plan(root, folder, doc.answers);
        doc.steps = plan.steps.map((s) => ({ id: s.id, tool: s.tool, args: s.args, sentence: s.sentence, review: 'proposed', run: 'todo', planStepIds: [], rounds: 0, outcome: null, approvedBy: null }));
        record(doc, 'agent', 'state', `Wrote the plan: ${plan.summary}`);
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
        const v = o.verify ? await o.verify(root, folder, doc.baseline ?? []) : { ok: true, checks: [{ id: 'validate', state: 'skipped', sentence: 'No checks are set up for this import.' }] };
        doc.verify = v;
        record(doc, 'line', 'verify', v.ok ? 'Every check passed (or says why it could not run)' : `Some checks fail: ${v.checks.filter((c) => c.state === 'fail').map((c) => c.id).join(', ')}`);
        if (!v.ok) {
          doc.waiting = {
            for: 'answer', sentence: asSentence(`The checks found problems: ${lower(v.checks.find((c) => c.state === 'fail').sentence)}`),
            question: { id: 'verify', sentence: 'The import landed, but some checks fail. What now?', options: [{ id: 'verify-again', sentence: 'Check again (after you fixed something).' }, { id: 'finish', sentence: 'Finish the import anyway; the problems stay listed.' }], recommended: 'verify-again' },
          };
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

    /** Start (scan, classify, plan) and stop at the review. An import already started is shown as it is. */
    start: (by = 'ui') => serial(async () => {
      const had = load();
      if (had) return view(had, 'This import has already started; here it is');
      if (!o.store) folderRootOf(root, folder);
      const doc = newDoc(folder);
      record(doc, by, 'start', `Started the import of ${folder}`);
      await run(doc, by);
      save(doc);
      return view(doc);
    }),

    pause: (by = 'ui') => withDoc(async (doc) => {
      if (doc.paused) return view(doc, 'It is already paused');
      doc.paused = true;
      record(doc, by, 'pause', `Paused at ${doc.state}`);
      save(doc);
      return view(doc);
    }),

    /** Carry on: unpause and run until the process needs someone again. */
    resume: (by = 'ui') => withDoc(async (doc) => {
      if (doc.paused) { doc.paused = false; record(doc, by, 'resume', `Resumed at ${doc.state}`); }
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
        record(doc, by, 'approve-all', `${by === 'ui' ? 'You' : 'Your agent'} approved ${open.length} step${open.length === 1 ? '' : 's'}`);
        if (!doc.paused && doc.waiting?.for !== 'answer') await run(doc, by);
        save(doc);
        return view(doc);
      }
      const step = stepOf(doc, edit?.stepId);
      if (!step) return refusal('UNKNOWN_STEP', `There is no step ${edit?.stepId ?? ''} in this import plan`);
      const frozen = step.run !== 'todo';
      const who = by === 'ui' ? 'You' : 'Your agent';
      if (action === 'approve') {
        if (step.review === 'approved') return refusal('ALREADY', 'This step is already approved');
        if (step.review === 'skipped') return refusal('SKIPPED', 'This step is skipped; bring it back first');
        step.review = 'approved'; step.approvedBy = by === 'ui' ? 'ui' : 'agent';
        record(doc, by, 'approve', `${who} approved: ${lower(step.sentence)}`, step.id);
      } else if (action === 'skip' || action === 'unskip') {
        if (frozen) return refusal('ALREADY_RAN', 'This step has already started, so it cannot be skipped now');
        if (action === 'skip' && step.tool === 'line.import.mark') return refusal('NEEDED', 'The first step marks the folder as Line, and every other step needs it, so it cannot be skipped');
        step.review = action === 'skip' ? 'skipped' : 'proposed';
        step.approvedBy = null;
        record(doc, by, action, `${who} ${action === 'skip' ? 'skipped' : 'brought back'}: ${lower(step.sentence)}`, step.id);
      } else if (action === 'edit') {
        if (frozen) return refusal('ALREADY_RAN', 'This step has already started, so it cannot be changed now');
        try { checkEdit(step.tool, edit.args); } catch (e) { return refusal(/** @type {any} */ (e).code, /** @type {any} */ (e).sentence); }
        const before = step.sentence;
        step.args = { ...step.args, ...edit.args, folder: doc.folder };
        step.sentence = stepSentence(step.tool, step.args);
        step.review = 'proposed'; step.approvedBy = null;
        record(doc, by, 'edit', `${who} changed "${before.replace(/[.?!]$/, '')}" to "${step.sentence.replace(/[.?!]$/, '')}"; it needs approval again`, step.id);
      } else if (action === 'move') {
        const from = doc.steps.indexOf(step);
        const to = Number(edit.to);
        const firstOpen = doc.steps.findIndex((s) => s.run === 'todo' && s.tool !== 'line.import.mark');
        if (frozen || !Number.isInteger(to) || to < 0 || to >= doc.steps.length) return refusal('BAD_MOVE', 'Only a step that has not run can move, to a place in the plan');
        if (step.tool === 'line.import.mark' || to < firstOpen || firstOpen < 0) return refusal('BAD_MOVE', 'A step can only move among the steps that have not run, after the first step that marks the folder');
        doc.steps.splice(from, 1);
        doc.steps.splice(to, 0, step);
        record(doc, by, 'move', `${who} moved "${step.sentence.replace(/[.?!]$/, '')}" from place ${from + 1} to ${to + 1}`, step.id);
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
      record(doc, by, 'answer', `${by === 'ui' ? 'You' : 'Your agent'} answered "${q.sentence.replace(/[.?!]$/, '')}": ${lower(q.options.find((x) => x.id === optionId).sentence)}`, doc.waiting.stepId);
      if (q.id === 'verify') {
        if (optionId === 'finish') { doc.waiting = null; go(doc, by, 'FINISHED'); save(doc); return view(doc); }
        doc.waiting = null;
        await run(doc, by, true);
        save(doc);
        return view(doc);
      }
      const step = stepOf(doc, doc.waiting.stepId);
      const blocker = doc.cursor.origin;
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
        doc.decisions.push({ id: `fix:${blocker}:person`, question: asSentence(`Which fix for ${step.args.name ?? step.id}?`), options: [fix.fixId], picked: fix.fixId, by: 'person', reason: 'The person picked it.' });
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
