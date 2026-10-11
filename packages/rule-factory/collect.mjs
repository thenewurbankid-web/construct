// cs2 (scaffold) -- the miss collector: plan feedback (line/plans/*.json) and validate findings as typed MissRecords
// (contract.mjs), and the share of decisions static code made per step. Pure functions plus one reader; no model.
//
// How a plan step counts (only finished write steps; open or skipped steps decided nothing yet):
//   done, every check passed            static decided it (a hit; decidedBy "model" when jev or Qwen added the step)
//   done, but needed the person         a miss: decidedBy "person" once they chose (Try again / Leave as it is), else "none"
//   failed                              a miss, decidedBy "none"
//   a fix step (args.fixOf)             a fix choice: a hit when it is the fix static code ranked first, else a miss
// How a validate finding counts: a typed fix ranked first means static code can decide it; no typed fix is a miss.
import fs from 'node:fs';
import path from 'node:path';

const PEOPLE = new Set(['user', 'ui', 'chat']);
const MODELS = new Set(['jev', 'qwen']);
/** The plan store's addedBy as a Decider. */
const deciderOf = (by) => (PEOPLE.has(by) ? 'person' : MODELS.has(by) ? 'model' : by === 'agent' ? 'agent' : 'static');
const stripPlan = (args) => { const { expect: _e, retry: _r, fixOf: _f, ...rest } = args ?? {}; return rest; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
        out.push({
          ...base, id: `${base.id}:fix`, step: `${target?.tool ?? s.tool} fix choice`, decidedBy: hit ? 'static' : deciderOf(s.addedBy),
          miss: !hit, staticChoice: first?.fixId ?? null, finalChoice: chosen?.fixId ?? s.tool,
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
