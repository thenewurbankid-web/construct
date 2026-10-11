// Expressions (System 1 groundwork) -- plan records for training data: every finished change step appends one
// PlanRecord (contract.mjs) to `<state>/records/plans.jsonl` through the writer's atomic Line-state path
// (transactionalWriter.mjs writeLineState). A step is a transition between structure states, so a record keeps the
// structure hashes before and after, the structural delta, the intent, the steps (tool + args), each check with its
// expression and outcome, the pre, whether a person approved it and whether it repaired an earlier step.
//
// Logic only (owner rule, 11 Oct): a record never holds a business or domain term. Every project name -- feature,
// item, library item, file, finding key, argument value, and each word of those names in the free-text intent -- is
// replaced by a typed slot ("<feature:F1>", "<item:I2 kind=components>", "<lib:L1 kind=components>", "<name:N1>",
// "<word:W1>", "<code:C1>", "<hash:H1>", "<value:V1>"), and expressions are stored over the slots. The live plan keeps
// the real names; only this file is delexicalized. A record that cannot be written never stops the plan.
import fs from 'node:fs';
import path from 'node:path';
import { assertPlanRecord } from './contract.mjs';
import { writeLineState } from '../transactionalWriter.mjs';
import { lineStateDir } from './workspace.mjs';
import { buildFacts, factsHash } from './facts.mjs';
import { structureOf, structureDelta, readerOf } from './structure.mjs';
import { requestOf } from './planTools.mjs';

/** Words that are Line's own structure, never a domain term (and the words slots are made of). */
const STRUCTURE_WORDS = new Set(['feature', 'features', 'item', 'items', 'library', 'lib', 'components', 'component', 'pages', 'page', 'workflows', 'workflow',
  'fixtures', 'fixture', 'name', 'code', 'hash', 'value', 'word', 'kind', 'spec', 'line', 'file', 'files', 'tsx', 'json', 'the', 'and', 'for', 'with', 'into', 'from']);
/** Arguments whose value is logic (an enum or a structure name), kept as is. */
const LOGIC_ARGS = new Set(['kind']);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * The words of a name: "StatusBadge" -> status, badge; "order-items" -> order, items.
 * @param {string} name
 * @returns {string[]}
 */
export const wordsOf = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).map((w) => w.toLowerCase()).filter((w) => w.length >= 3 && !STRUCTURE_WORDS.has(w) && !/^\d+$/.test(w));

/**
 * A slotter for one record: knows every project name from the facts (and the request's own values), and hands out
 * slots in order of first use.
 * @param {any} project readLineProject's view (before the step)
 * @param {any[]} [extraProjects] other views to learn names from (after the step)
 * @returns {{text: Function, args: Function, expr: Function, learnArgs: Function, slot: Function, slots: () => Record<string, string>}}
 */
export function createSlotter(project, extraProjects = []) {
  /** name -> {type, attrs} */
  const known = new Map();
  const learn = (name, type, attrs = {}) => { if (typeof name === 'string' && name && !known.has(name)) known.set(name, { type, attrs }); };
  for (const p of [project, ...extraProjects]) {
    for (const l of p?.library ?? []) { learn(l.id, 'lib', { kind: l.kind }); learn(l.name, 'lib', { kind: l.kind, key: l.id }); learn(l.file, 'path'); }
    for (const f of p?.features ?? []) {
      learn(f.name, 'feature');
      for (const i of f.items ?? []) { learn(i.id, 'item', { kind: i.kind }); learn(i.name, 'item', { kind: i.kind, key: i.id }); learn(i.file, 'path'); }
    }
  }
  const counters = {}; const slots = {}; const bySubject = new Map();
  const LETTER = { feature: 'F', item: 'I', lib: 'L', name: 'N', word: 'W', code: 'C', hash: 'H', value: 'V' };
  const slotFor = (type, subject, attrs = {}) => {
    const k = `${type}|${subject}`;
    if (bySubject.has(k)) return bySubject.get(k);
    counters[type] = (counters[type] ?? 0) + 1;
    const a = Object.entries(attrs).filter(([key]) => key !== 'key').map(([key, v]) => ` ${key}=${String(v).replace(/[^A-Za-z0-9_-]/g, '-')}`).join('');
    const s = `<${type}:${LETTER[type]}${counters[type]}${a}>`;
    bySubject.set(k, s);
    slots[s] = { feature: 'a feature', item: `a feature item${attrs.kind ? ` (${attrs.kind})` : ''}`, lib: `a library item${attrs.kind ? ` (${attrs.kind})` : ''}`, name: 'a new name from the request', word: 'a word from a project name', code: 'source code', hash: 'a content hash', value: 'a value from the request' }[type];
    return s;
  };
  /** A known name's slot (an item name and its id share one; a library name and its id share one). */
  const nameSlot = (name) => {
    const k = known.get(name);
    if (!k || k.type === 'path') return null;
    return slotFor(k.type, k.attrs.key ?? name, k.attrs);
  };
  // Ids with a slash ("orders/components/OrderRow") match only where they start a value or follow a non-path
  // character; inside a longer path ("features/orders/components/OrderRow.tsx") each name is slotted on its own.
  let patterns = []; let patternSize = -1;
  const names = () => {
    if (patternSize !== known.size) {
      const list = [...known.keys()].filter((n) => known.get(n).type !== 'path').sort((a, b) => b.length - a.length);
      const ids = list.filter((n) => n.includes('/')); const plain = list.filter((n) => !n.includes('/'));
      patterns = [
        ids.length ? new RegExp(`(?<![A-Za-z0-9/])(${ids.map(esc).join('|')})(?![A-Za-z0-9])`, 'g') : null,
        plain.length ? new RegExp(`(?<![A-Za-z0-9])(${plain.map(esc).join('|')})(?![A-Za-z0-9])`, 'g') : null,
      ].filter(Boolean);
      patternSize = known.size;
    }
    return patterns;
  };
  const allWords = () => new Set([...known.keys()].filter((n) => known.get(n).type !== 'path').flatMap(wordsOf));

  /** A string with every project name replaced by its slot; free text also loses each word of those names. */
  function text(s, { free = false } = {}) {
    let out = String(s);
    for (const re of names()) out = out.split(/(<[^>]+>)/).map((part) => (part.startsWith('<') ? part : part.replace(re, (m) => nameSlot(m) ?? m))).join('');
    if (free) {
      const words = allWords();
      out = out.split(/(<[^>]+>)/).map((part) => (part.startsWith('<') ? part : part.replace(/[A-Za-z0-9]+/g, (w) => {
        const lw = w.toLowerCase();
        const stem = words.has(lw) ? lw : words.has(lw.replace(/s$/, '')) ? lw.replace(/s$/, '') : null;
        return stem ? slotFor('word', stem) : w;
      }))).join('');
    }
    return out;
  }
  /** A request's argument values: names slotted, new names become <name:N>, code <code:C>, hashes <hash:H>. */
  function args(a) {
    const out = {};
    for (const [k, v] of Object.entries(a ?? {})) {
      if (typeof v !== 'string' || LOGIC_ARGS.has(k)) { out[k] = v; continue; }
      if (k === 'code') out[k] = slotFor('code', v);
      else if (/hash$/i.test(k)) out[k] = slotFor('hash', v);
      else if (k === 'value') out[k] = slotFor('value', v);
      else {
        const t = text(v);
        if (t !== v || !/[A-Za-z]/.test(v)) out[k] = t;
        else { learn(v, 'name'); out[k] = slotFor('name', v); }
      }
    }
    return out;
  }
  /** An expression with every string (literal or path part) slotted. */
  function expr(e) {
    if (typeof e === 'string') return /^[0-9a-f]{64}$/.test(e) ? slotFor('hash', e) : text(e);
    if (Array.isArray(e)) return e.map(expr);
    if (e && typeof e === 'object') return Object.fromEntries(Object.entries(e).map(([k, v]) => [k, expr(v)]));
    return e;
  }
  /** Learn the request's own new names before slotting anything else, so they never leak through free text. */
  function learnArgs(a) { for (const [k, v] of Object.entries(a ?? {})) if (typeof v === 'string' && !LOGIC_ARGS.has(k) && k !== 'code' && !/hash$/i.test(k) && k !== 'value' && !known.has(v) && /[A-Za-z]/.test(v) && !v.includes('/')) learn(v, 'name'); }
  return { text, args, expr, learnArgs, slot: (type, name, attrs) => (type === 'feature' || type === 'item' || type === 'lib' ? (known.has(name) ? nameSlot(name) : slotFor(type, name, attrs)) : slotFor(type, name, attrs)), slots: () => ({ ...slots }) };
}

/** The structure hashes with feature names slotted. */
const slottedHashes = (s, slotter) => ({ project: s.project, library: s.library, features: Object.fromEntries(Object.entries(s.features).map(([f, h]) => [slotter.slot('feature', f), h.hash])) });

/**
 * The project's plan recorder (one per plan service).
 * @param {string} root
 * @param {{ops?: {readLineProject: (root: string) => any}, now?: () => Date, write?: (line: string) => void}} [o]
 *   `write` replaces the file (tests); by default each record is appended through writeLineState.
 * @returns {{file: string, problem: string|null, snapshot: Function, record: Function}}
 */
export function createPlanRecorder(root, { ops, now = () => new Date(), write } = {}) {
  const stateDir = lineStateDir(root);
  const file = `${stateDir}/records/plans.jsonl`;
  const put = write ?? ((line) => { writeLineState(root, file, line, { append: true, stateDir }); });
  const self = {
    file,
    /** @type {string|null} why the last record could not be written, in one sentence */
    problem: /** @type {string|null} */ (null),
    /** The state before a step runs (read once). */
    snapshot() {
      const facts = buildFacts(root, { ops });
      const project = facts.project();
      return { facts, project, hash: factsHash(facts), structure: structureOf(project, readerOf(root)) };
    },
    /**
     * Append the record of one finished step.
     * @param {{plan: any, step: any, before: any, pre?: {expr: any, ok: boolean}|null, intent?: string}} r
     *   `plan`, `step`: the stored plan and its step (real names); `step.result` its LineStepResult. `intent`: what the
     *   person asked (default: the plan's request or goal).
     */
    record({ plan, step, before, pre = null, intent }) {
      try {
        const after = buildFacts(root, { ops }).project();
        const slotter = createSlotter(before.project, [after]);
        const upto = plan.steps.filter((s) => s.n <= step.n);
        for (const s of upto) slotter.learnArgs(requestOf(s.args));
        const expect = Array.isArray(step.args?.expect) ? step.args.expect : [];
        const results = Array.isArray(step.result?.checks) ? step.result.checks : [];
        const checks = results.map((c) => {
          const e = expect.find((x) => x.id === c.checkId);
          return { id: c.checkId, kind: e?.kind ?? 'unknown', expr: e?.expr !== undefined ? slotter.expr(e.expr) : null, ok: c.ok };
        });
        /** @type {import('./contract.mjs').PlanRecord} */
        const rec = {
          v: 1, at: now().toISOString(),
          intent: slotter.text(intent ?? plan.request ?? plan.goal ?? '', { free: true }),
          facts: before.hash,
          before: slottedHashes(before.structure, slotter),
          after: slottedHashes(structureOf(after, readerOf(root)), slotter),
          delta: structureDelta(before.project, after, (type, name, attrs) => slotter.slot(type, name, attrs)),
          steps: upto.map((s) => ({ tool: s.tool, args: slotter.args(requestOf(s.args)) })),
          step: upto.findIndex((s) => s.id === step.id) + 1,
          checks, passed: checks.filter((c) => c.ok).length,
          pre: pre ? { expr: slotter.expr(pre.expr), ok: pre.ok } : null,
          approved: step.approval === 'given',
          repaired: Boolean(step.args?.retry || step.args?.fixOf),
          slots: {},
        };
        rec.slots = slotter.slots();
        assertPlanRecord(rec);
        put(`${JSON.stringify(rec)}\n`);
        self.problem = null;
        return rec;
      } catch (err) {
        self.problem = `The plan record could not be written, so this step is not in the training data: ${String(/** @type {any} */ (err)?.message ?? err)}`;
        return null;
      }
    },
  };
  return self;
}

/**
 * Every plan record of a project. Lines that do not parse or do not fit the contract are skipped and counted.
 * @param {string} root
 * @returns {{records: import('./contract.mjs').PlanRecord[], skipped: number, file: string}}
 */
export function readPlanRecords(root) {
  const file = `${lineStateDir(root)}/records/plans.jsonl`;
  let text = '';
  try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { return { records: [], skipped: 0, file }; }
  const records = []; let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); assertPlanRecord(r); records.push(r); } catch { skipped += 1; }
  }
  return { records, skipped, file };
}
