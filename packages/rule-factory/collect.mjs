// cs2 -- the miss collector: plan feedback (line/plans/*.json), validate findings, decision traces (decision-trace.v1),
// the reason ledger (@mx/reason's file ledger) and the drafter's misses on Train Line's train split, as typed
// MissRecords (contract.mjs), and the share of decisions static code made per step. Pure functions plus readers; no model.
//
// How a plan step counts (only finished write steps; open or skipped steps decided nothing yet):
//   done, every check passed            static decided it (a hit; decidedBy "model" when jev or Qwen added the step)
//   done, but needed the person         a miss: decidedBy "person" once they chose (Try again / Leave as it is), else "none"
//   failed                              a miss, decidedBy "none"
//   a fix step (args.fixOf)             a fix choice: a hit when it is the fix static code ranked first, else a miss
// How a validate finding counts: a typed fix ranked first means static code can decide it; no typed fix is a miss.
import fs from 'node:fs';
import path from 'node:path';
import { NONE_FITS } from './contract.mjs';

const PEOPLE = new Set(['user', 'ui', 'chat']);
const MODELS = new Set(['jev', 'qwen']);
/** The plan store's addedBy as a Decider. */
const deciderOf = (by) => (PEOPLE.has(by) ? 'person' : MODELS.has(by) ? 'model' : by === 'agent' ? 'agent' : 'static');
const stripPlan = (args) => { const { expect: _e, retry: _r, fixOf: _f, ...rest } = args ?? {}; return rest; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** The Line rule a refused step's fixes are for ("LINE-DIR/promote" -> "LINE-DIR"), or undefined. */
const firstRule = (step) => (step?.result?.options ?? []).map((o) => /^(LINE-[A-Z]+)\//.exec(String(o.fixId ?? ''))?.[1]).find(Boolean);

/** Who resolved a step that needed the person: a later retry of it or a "leave as it is". */
const resolverOf = (plan, step) => plan.steps.find((s) => s.n > step.n && ((s.args?.retry && s.args.retry.of === step.id) || (s.tool === 'line.leaveAsIs' && s.args?.stepId === step.id))) ?? null;

/**
 * The misses (and hits) in one plan session file.
 * @param {any} doc A plan session as the plan store writes it ({session, plans}).
 * @param {string} file Its path relative to the project root.
 * @returns {import('./contract.mjs').MissRecord[]}
 */
export function missesFromPlanDoc(doc, file) {
  /** @type {import('./contract.mjs').MissRecord[]} */
  const out = [];
  for (const plan of doc?.plans ?? []) {
    for (const s of plan.steps ?? []) {
      if (s.kind !== 'write' || s.tool === 'line.leaveAsIs') continue;
      const ref = { file, planId: plan.id, stepId: s.id };
      const base = { id: `plan:${plan.id}:${s.id}`, source: /** @type {const} */ ('plan'), ref, label: null };
      if (s.args?.fixOf) {
        const target = plan.steps.find((t) => t.id === s.args.fixOf);
        const options = (target?.result?.options ?? []).filter((o) => o.id === 'fix' && o.step);
        const first = options.find((o) => o.recommended) ?? null;
        const chosen = options.find((o) => o.step.tool === s.tool && same(stripPlan(o.step.args), stripPlan(s.args))) ?? null;
        const hit = Boolean(first && chosen && first.fixId === chosen.fixId);
        const ids = options.map((o) => o.fixId).filter((x) => typeof x === 'string' && x);
        out.push({
          ...base, id: `${base.id}:fix`, step: `${target?.tool ?? s.tool} fix choice`, decidedBy: hit ? 'static' : deciderOf(s.addedBy),
          miss: !hit, staticChoice: first?.fixId ?? null, finalChoice: chosen?.fixId ?? s.tool,
          options: [...new Set(ids)], kind: hit ? null : chosen ? 'picked' : 'absent', correct: hit ? first.fixId : chosen?.fixId ?? null,
          context: { rule: firstRule(target) },
          sentence: hit ? `Step ${s.n} applied the fix static code ranked first.` : `Step ${s.n} applied a fix static code did not rank first.`,
        });
      }
      if (s.status === 'failed') {
        out.push({ ...base, step: s.tool, decidedBy: 'none', miss: true, staticChoice: null, finalChoice: null, sentence: `Step ${s.n} failed.` });
      } else if (s.status === 'done') {
        const r = s.result ?? {};
        if (r.needsYou) {
          const by = resolverOf(plan, s);
          out.push({
            ...base, step: s.tool, decidedBy: by ? 'person' : 'none', miss: true, staticChoice: null,
            finalChoice: by ? (by.tool === 'line.leaveAsIs' ? 'leave' : 'retry') : null,
            sentence: by ? `Step ${s.n} needed the person, who chose to ${by.tool === 'line.leaveAsIs' ? 'leave it as it is' : 'try it again'}.` : `Step ${s.n} needs the person and is still open.`,
          });
        } else if (MODELS.has(s.addedBy)) {
          out.push({ ...base, step: s.tool, decidedBy: 'model', miss: true, staticChoice: null, finalChoice: 'pass', sentence: `Step ${s.n} passed, but a model chose it, not static code.` });
        } else {
          out.push({ ...base, step: s.tool, decidedBy: 'static', miss: false, staticChoice: 'pass', finalChoice: 'pass', sentence: `Step ${s.n} passed its checks.` });
        }
      }
    }
  }
  return out;
}

/**
 * The misses in validate's findings (LineFinding[], with typed fixes from fixes.mjs).
 * @param {{rule: string, file: string, line: number, key?: string, fixes?: {id: string, rank?: number, step?: unknown}[]}[]} findings
 * @returns {import('./contract.mjs').MissRecord[]}
 */
export function missesFromFindings(findings) {
  return findings.map((f) => {
    const first = (f.fixes ?? []).find((x) => x.rank === 1 && x.step) ?? null;
    const ref = { file: f.file, rule: f.rule, line: f.line };
    const id = `validate:${f.key ?? `${f.rule}|${f.file}|${f.line}`}`;
    return first
      ? { id, source: /** @type {const} */ ('validate'), step: `validate ${f.rule}`, decidedBy: /** @type {const} */ ('static'), miss: false, staticChoice: first.id, finalChoice: null, sentence: 'Static code has a typed fix for this finding.', ref, label: null }
      : { id, source: /** @type {const} */ ('validate'), step: `validate ${f.rule}`, decidedBy: /** @type {const} */ ('none'), miss: true, staticChoice: null, finalChoice: null, sentence: 'Static code has no typed fix for this finding.', ref, label: null };
  });
}

/**
 * The share of decisions static code made, per step (sorted by step), plus the total as step "all".
 * @param {import('./contract.mjs').MissRecord[]} records
 * @returns {import('./contract.mjs').StaticShare[]}
 */
export function staticShare(records) {
  const groups = new Map();
  for (const r of records) groups.set(r.step, [...(groups.get(r.step) ?? []), r]);
  const row = (step, rs) => {
    const byStatic = rs.filter((r) => !r.miss).length;
    const share = rs.length ? byStatic / rs.length : 0;
    return { step, total: rs.length, byStatic, share, sentence: `Static code decided ${byStatic} of ${rs.length} (${Math.round(share * 100)}%).` };
  };
  return [...[...groups.keys()].sort().map((k) => row(k, groups.get(k))), row('all', records)];
}

/**
 * Every plan session of a project (line/plans/*.json; writes.jsonl and temp files are skipped).
 * @param {string} root
 * @returns {import('./contract.mjs').MissRecord[]}
 */
export function readPlanMisses(root) {
  const dir = path.join(root, 'line', 'plans');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { return []; }
  return files.flatMap((f) => {
    try { return missesFromPlanDoc(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), `line/plans/${f}`); } catch { return []; }
  });
}

// ---------------------------------------------------------------------------------------------
// Decision traces (decision-trace.v1, packages/core/decision-trace.mjs): one record per chooser decision, with what a
// provider suggested and the outcomes recorded later. A suggestion from the rules provider (or none named) is static
// code's choice; it is a hit when it is what was chosen and no outcome says the decision went wrong.

const STATIC_PROVIDERS = new Set(['rules', 'static']);
const TRACE_DECIDER = { person: 'person', llm: 'agent', 'decision-model': 'model' };
const badOutcome = (o) => Boolean(o && (o.reverted === true || o.planValidated === false || o.testsPassed === false));

/**
 * The misses (and hits) in decision traces, outcomes already merged (readTraces does that).
 * @param {any[]} decisions DecisionTrace records.
 * @param {string} [file] Where they were read from, for the ref.
 * @returns {import('./contract.mjs').MissRecord[]}
 */
export function missesFromTraces(decisions, file = 'decisions.jsonl') {
  return (decisions ?? []).filter((d) => d && d.kind !== 'outcome' && typeof d.id === 'string').map((d) => {
    const fromStatic = !d.provider || STATIC_PROVIDERS.has(d.provider.name);
    const staticChoice = fromStatic && d.suggestion?.option ? d.suggestion.option : null;
    const final = typeof d.chosen === 'string' ? d.chosen : null;
    const wrong = badOutcome(d.outcome);
    const hit = staticChoice !== null && staticChoice === final && !wrong;
    const exit = final === 'exit';
    const overridden = staticChoice !== null && staticChoice !== final;
    const kind = hit ? null : exit ? 'absent' : overridden || wrong ? 'picked' : null;
    const correct = hit ? final : exit ? NONE_FITS : overridden ? final : null;
    const sentence = hit ? 'Static code suggested what was chosen.'
      : exit ? 'None of the options fitted, so the chooser was left.'
        : staticChoice === null ? 'Static code made no suggestion for this choice.'
          : overridden ? 'Something other than static code\'s suggestion was chosen.' : 'Static code\'s suggestion was chosen, but it went wrong afterwards.';
    return {
      id: `trace:${d.id}`, source: /** @type {const} */ ('decision-trace'), step: String(d.chooser?.id ?? 'chooser'),
      decidedBy: /** @type {import('./contract.mjs').Decider} */ (hit ? 'static' : TRACE_DECIDER[d.by] ?? 'none'), miss: !hit, staticChoice, finalChoice: final,
      sentence, ref: { file, chooser: d.chooser?.id }, label: null,
      options: [...(d.options ?? [])], kind, correct, context: { question: String(d.chooser?.question ?? 'Which option fits?') },
    };
  });
}

/**
 * Every decision trace of a project (the per-user state directory; nothing in the project tree). Never throws.
 * @param {string} root
 * @param {{stateDir?: string, env?: Record<string, string|undefined>}} [o]
 * @returns {Promise<{records: import('./contract.mjs').MissRecord[], note: string|null}>}
 */
export async function readTraceMisses(root, o = {}) {
  try {
    const { readTraces } = await import('@line/construct-core/decision-trace-store');
    const r = readTraces(root, o);
    return { records: missesFromTraces(r.decisions, 'decisions.jsonl'), note: r.error ? `Decision traces could not be read (${r.error}).` : null };
  } catch (e) {
    return { records: [], note: `Decision traces could not be read (${String(/** @type {any} */ (e)?.message ?? e).split('\n')[0]}).` };
  }
}

// ---------------------------------------------------------------------------------------------
// The reason ledger (@mx/reason ledger.ts, LedgerEntry): one entry per decision on the ladder, with the options, who
// decided (ladder.step static | jev | qwen), the answers given later and the outcome. Static code decided it when the
// ladder's static rung did; it was right unless the ladder recorded a miss, the person changed or undid it, the static
// verify failed, or a later answer set another value.

const answerValue = (a) => (typeof a?.call?.args?.value === 'string' ? a.call.args.value : null);

/** Who decided a ledger entry that static code did not get right. */
function ledgerDecider(e, last, picked) {
  if (last?.who === 'person') return 'person';
  if (last?.who === 'agent') return 'agent';
  if (picked === null) return 'none';
  return 'model';
}

/**
 * The misses (and hits) in reason-ledger entries.
 * @param {any[]} entries LedgerEntry records.
 * @param {string} [file] Where they were read from.
 * @returns {import('./contract.mjs').MissRecord[]}
 */
export function missesFromLedger(entries, file = 'reasoning') {
  return (entries ?? []).filter((e) => e && typeof e.decisionId === 'string').map((e) => {
    const options = [...new Set((e.options ?? []).filter((x) => typeof x === 'string' && x))];
    const picked = typeof e.picked === 'string' ? e.picked : null;
    const last = [...(e.answers ?? [])].reverse().find((a) => answerValue(a) !== null) ?? null;
    const final = answerValue(last) ?? picked;
    const byStatic = e.ladder ? e.ladder.step === 'static' : (e.by === 'single' || e.by === 'order') && e.pickedOrigin !== 'model';
    const changed = e.outcome?.user === 'changed' || e.outcome?.user === 'undone' || final !== picked;
    const wrong = Boolean(e.ladder?.miss) || changed || e.outcome?.verify === 'fail';
    const hit = byStatic && !wrong && picked !== null;
    const expected = e.ladder?.miss?.expected?.[0] ?? (final !== picked ? final : null);
    const kind = wrong ? e.ladder?.miss?.type ?? (expected !== null && options.includes(expected) ? 'picked' : 'absent') : null;
    let correct = null;
    if (hit) correct = picked;
    else if (wrong && expected !== null) correct = options.includes(expected) ? expected : NONE_FITS;
    else if (wrong && kind === 'absent') correct = NONE_FITS;
    const sentence = hit ? 'The static rung decided it and nothing said it was wrong.'
      : wrong ? (kind === 'absent' ? 'The right value was not among the options.' : 'Another option was right.')
        : 'A model decided it, not static code.';
    return {
      id: `ledger:${e.requestId ?? 'request'}:${e.decisionId}`, source: /** @type {const} */ ('reason-ledger'), step: String(e.stepId || e.pairId || 'reason'),
      decidedBy: /** @type {import('./contract.mjs').Decider} */ (hit ? 'static' : ledgerDecider(e, last, picked)), miss: !hit, staticChoice: byStatic ? picked : null, finalChoice: final,
      sentence, ref: { file, pairId: e.pairId, requestId: e.requestId }, label: null,
      options, kind, correct, context: { question: `Which value fits ${String(e.key ?? e.questionId ?? 'this decision')}?` },
    };
  });
}

/**
 * Every reason ledger under `dir` (`<dir>/<pairId>/<requestId>.json`, as @mx/reason's createFileLedgerStore writes
 * them). An unreadable file is skipped and counted. Never throws.
 * @param {string} dir
 * @returns {{records: import('./contract.mjs').MissRecord[], skipped: number}}
 */
export function readLedgerMisses(dir) {
  /** @type {import('./contract.mjs').MissRecord[]} */
  const records = [];
  let skipped = 0;
  let pairs = [];
  try { pairs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch { return { records, skipped }; }
  for (const pair of pairs) {
    for (const f of fs.readdirSync(path.join(dir, pair)).filter((x) => x.endsWith('.json')).sort()) {
      try {
        const doc = JSON.parse(fs.readFileSync(path.join(dir, pair, f), 'utf8'));
        records.push(...missesFromLedger((doc.entries ?? []).map((e) => ({ requestId: doc.requestId, ...e })), `${pair}/${f}`));
      } catch { skipped += 1; }
    }
  }
  return { records, skipped };
}

// ---------------------------------------------------------------------------------------------
// The drafter on Train Line's train split (drafter-misses.mjs drafts it): a case is a hit when the drafter's
// recommendation is the gold preferred route. A miss keeps the request (slots only), the gold intent and the words the
// drafter could not read (its questions), which jev labels.

/**
 * @param {{caseId: string, request: string, intent: string, drafted: string|null, preferred: boolean, words: string[]}[]} results
 * @returns {import('./contract.mjs').MissRecord[]}
 */
export function missesFromDrafts(results) {
  return (results ?? []).map((r) => ({
    id: `drafter:${r.caseId}`, source: /** @type {const} */ ('drafter'), step: `drafter ${r.intent}`,
    decidedBy: /** @type {import('./contract.mjs').Decider} */ (r.preferred ? 'static' : 'none'), miss: !r.preferred, staticChoice: r.drafted, finalChoice: r.intent,
    sentence: r.preferred ? 'The drafter recommended the preferred route.' : r.words.length ? `The drafter did not read ${r.words.map((w) => `"${w}"`).join(', ')}.` : 'The drafter missed the preferred route.',
    ref: { file: 'line/train/cases.jsonl', caseId: r.caseId }, label: null,
    options: [], kind: r.preferred ? null : r.drafted === r.intent ? 'picked' : 'absent', correct: r.preferred ? r.drafted : null,
    context: { request: r.request, words: [...r.words], intent: r.intent },
  }));
}
