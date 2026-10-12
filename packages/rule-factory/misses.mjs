// im1 -- miss reports: every miss classified as ABSENT (the right answer was not among the options Line offered) or
// PICKED (it was offered, but static order, Qwen or jev recommended another), per step, from three sources of the
// right answer (contract.mjs ClassifiedMiss):
//   plan          the person's own choice in plan feedback: a typed fix they applied, a fix they asked for that Line did
//                 not offer, a refused step they edited and tried again
//   train         Train Line's gold routes, scored by its eval (train/service.mjs evaluateCase: gold, offered, chosen)
//   drafter-eval  the drafter eval's gold routes (drafter/eval.mjs scoreCase: gold, offered, chosen)
// missReport() then counts absent and picked per step and lists the most common ABSENT patterns: those are what a new
// static tool (a typed fix, a drafter verb or template, a catalog entry) should cover. Everything is slotted: a request
// shape keeps slot kinds only (`<feature>`, `<component>`), never a project or domain word. No model is called.
import fs from 'node:fs';
import path from 'node:path';
import { assertClassifiedMiss, assertMissReport, domainFree } from './contract.mjs';

/** "Fix the problem in <finding:P1>." -> "fix the problem in <finding>": slot ids dropped, one line, lower case. */
export function requestShape(request) {
  return String(request ?? '').replace(/<([a-z-]+):[A-Za-z]+\d+(?:~words)?(?:\.[a-zA-Z]+)?>/g, '<$1>').replace(/\s+/g, ' ').trim().replace(/[.?!]$/, '').toLowerCase();
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const STEP_WORDS = Object.freeze({ ask: 'asking one question', none: 'no change' });
const stepWords = (s) => STEP_WORDS[s] ?? s;

/**
 * Classify one scored eval case (Train Line or the drafter eval): each gold route Line did not offer is an ABSENT miss;
 * a preferred gold route that was offered but not recommended is a PICKED miss. A case with no miss gives [].
 * @param {'train'|'drafter-eval'} source
 * @param {{id: string, request: string, gold: {sig: string, step: string, outcome: string, preferred: boolean, found: boolean}[], offered: string[], chosen: string|null}} e
 * @returns {import('./contract.mjs').ClassifiedMiss[]}
 */
export function missesFromEvalCase(source, e) {
  if (!Array.isArray(e?.gold)) return [];
  const correctFrom = source === 'train' ? 'train-gold' : 'drafter-eval';
  const shape = requestShape(e.request);
  const out = [];
  const stepOf = (g) => (g.outcome === 'question' ? 'ask' : g.outcome === 'refusal' ? 'refuse' : g.step);
  for (const g of e.gold) {
    const absent = !g.found && !e.offered.includes(g.sig);
    const picked = !absent && g.preferred && e.chosen !== g.sig;
    if (!absent && !picked) continue;
    out.push(assertClassifiedMiss({
      id: `${source}:${e.id}:${g.sig}`,
      source, step: stepOf(g), kind: absent ? 'absent' : 'picked',
      options: [...e.offered], chosen: e.chosen === g.sig ? null : e.chosen, correct: g.sig, correctFrom,
      pattern: `${shape} -> ${g.sig}`,
      sentence: absent
        ? `Line never offered ${g.outcome === 'question' ? 'to ask' : `the ${stepWords(g.sig)} route`} for "${shape}".`
        : `Line offered the ${stepWords(g.sig)} route for "${shape}" but recommended ${e.chosen ? `the ${e.chosen} route` : 'nothing'}.`,
    }));
  }
  return out;
}

const PEOPLE = new Set(['user', 'ui', 'chat']);
const stripPlan = (args) => { const { expect: _e, retry: _r, fixOf: _f, ...rest } = args ?? {}; return rest; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The classified misses in one plan session (line/plans/*.json), where the person's own choice is the right answer:
 *   - a fix step the person applied (args.fixOf): picked when it was among the offered fixes but not the recommended
 *     one; absent when it was not offered at all (the person ran their own step as the fix);
 *   - a step that needed the person and was retried with different arguments (args.retry): absent (none of the fixes
 *     was right; the person's edit was).
 * @param {any} doc @param {string} file
 * @returns {import('./contract.mjs').ClassifiedMiss[]}
 */
export function classifiedFromPlanDoc(doc, file) {
  const out = [];
  for (const plan of doc?.plans ?? []) {
    for (const s of plan.steps ?? []) {
      if (s.kind !== 'write' || !PEOPLE.has(s.addedBy)) continue;
      const of = s.args?.fixOf ?? s.args?.retry?.of ?? null;
      const target = of ? plan.steps.find((t) => t.id === of) : null;
      if (!target) continue;
      const fixes = (target.result?.options ?? []).filter((o) => o.id === 'fix' && o.step);
      const options = fixes.map((o) => String(o.fixId ?? o.step.tool));
      const first = fixes.find((o) => o.recommended) ?? fixes[0] ?? null;
      const rule = target.result?.findings?.[0]?.rule ?? target.result?.rule ?? null;
      const shape = `${target.tool} refused${rule ? ` (${rule})` : ''}`;
      if (s.args?.fixOf) {
        const chosen = fixes.find((o) => o.step.tool === s.tool && same(stripPlan(o.step.args), stripPlan(s.args))) ?? null;
        if (chosen && first && chosen.fixId === first.fixId) continue;
        const correct = chosen ? String(chosen.fixId ?? chosen.step.tool) : `${s.tool} (the person's own step)`;
        out.push(assertClassifiedMiss({
          id: `plan:${plan.id}:${s.id}`, source: 'plan', step: target.tool, kind: chosen ? 'picked' : 'absent',
          options, chosen: first ? String(first.fixId ?? first.step.tool) : null, correct, correctFrom: 'person',
          pattern: `${shape} -> ${correct}`,
          sentence: chosen ? `Step ${s.n}: the person applied a fix Line offered but did not recommend.` : `Step ${s.n}: the person fixed it with a step Line never offered.`,
        }));
      } else if (s.args?.retry && !same(stripPlan(s.args), stripPlan(target.args))) {
        const correct = `${s.tool} (the person's edit)`;
        out.push(assertClassifiedMiss({
          id: `plan:${plan.id}:${s.id}`, source: 'plan', step: target.tool, kind: 'absent',
          options, chosen: first ? String(first.fixId ?? first.step.tool) : null, correct, correctFrom: 'person',
          pattern: `${shape} -> ${correct}`,
          sentence: `Step ${s.n}: the person edited the refused step and tried again; none of Line's fixes was right.`,
        }));
      }
    }
  }
  return out;
}

/**
 * Every plan session of a project, classified.
 * @param {string} root
 * @returns {import('./contract.mjs').ClassifiedMiss[]}
 */
export function readClassifiedPlanMisses(root) {
  const dir = path.join(root, 'line', 'plans');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { return []; }
  return files.flatMap((f) => {
    try { return classifiedFromPlanDoc(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), `line/plans/${f}`); } catch { return []; }
  });
}

/**
 * The miss report: per step, how many misses were absent and how many picked; the most common absent patterns.
 * @param {import('./contract.mjs').ClassifiedMiss[]} misses
 * @param {{top?: number}} [o]
 * @returns {import('./contract.mjs').MissReport}
 */
export function missReport(misses, o = {}) {
  const top = o.top ?? 5;
  const steps = new Map();
  for (const m of misses) {
    const row = steps.get(m.step) ?? { step: m.step, absent: 0, picked: 0, total: 0 };
    row[m.kind] += 1; row.total += 1;
    steps.set(m.step, row);
  }
  const rows = [...steps.values()].sort((a, b) => b.total - a.total || a.step.localeCompare(b.step))
    .map((r) => ({ ...r, sentence: `${r.step === 'ask' ? 'Asking one question' : r.step === 'refuse' ? 'Refusing as asked' : `The ${r.step} step`}: ${plural(r.absent, 'miss', 'misses')} where the right answer was not offered, ${r.picked} where it was offered but not recommended.` }));
  const pats = new Map();
  for (const m of misses.filter((x) => x.kind === 'absent')) {
    const p = pats.get(m.pattern) ?? { pattern: m.pattern, step: m.step, count: 0, sources: new Set(), examples: [] };
    p.count += 1; p.sources.add(m.source);
    if (p.examples.length < 3) p.examples.push(m.id);
    pats.set(m.pattern, p);
  }
  const topAbsent = [...pats.values()].filter((p) => domainFree(p.pattern)).sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern)).slice(0, top)
    .map((p) => ({ pattern: p.pattern, step: p.step, count: p.count, sources: [...p.sources].sort(), examples: p.examples, sentence: `${plural(p.count, 'miss', 'misses')}: "${p.pattern.split(' -> ')[0]}" needed the ${stepWords(p.pattern.split(' -> ')[1])} route, which Line did not offer.` }));
  const absent = misses.filter((m) => m.kind === 'absent').length;
  const picked = misses.length - absent;
  const sentence = misses.length
    ? `${plural(misses.length, 'miss', 'misses')}: ${absent} where the right answer was not among Line's options (a static tool is missing), ${picked} where it was offered but another was recommended.`
    : 'No misses: every right answer was offered and recommended.';
  return assertMissReport({ total: { misses: misses.length, absent, picked }, steps: rows, topAbsent, sentence });
}
