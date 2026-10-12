// "What Line knows", How smart is it: numbers on the person's own project, from local records only (nothing leaves the
// machine). Each number has a trend (earlier snapshots, kept in Line's state), one "how to improve it" sentence and the
// items behind it (a click opens them on the Map or the Plan). With no data a number says so in one sentence.
//
// Where each number comes from:
//   coverage.tested    graph units whose item has a test file (<Name>.test.* / <Name>.spec.* anywhere in the project)
//   coverage.runtime   G2's runtimeCoverage over the recorded runs in <state>/runtime/records (when there are any)
//   health.*           the graph (cross-feature uses, feature items with no BASED_ON, unresolved-import findings, two
//                      items with the same name)
//   ai.*, fixes.typed  im3's memory records (<state>/memory/<step>.jsonl): what the person did with each proposal
//   ai.staticShare     the decision traces (core decision-trace-store), static vs model-decided; its details list
//                      every AI step's `on` and `win` (the same stepOn/stepWin GET /api/line/ai-profiles serves)
//   memory.effect      a replay of the person's own picks: memory's preferred option vs the static proposal
import fs from 'node:fs';
import path from 'node:path';
import { writeLineState } from '../../transactionalWriter.mjs';
import { lineStateDir } from '../workspace.mjs';
import { METRIC_IDS } from './contract.mjs';
import { listStepProfiles, stepOn, stepWin } from '../../../core/ai-profiles.mjs';

/** @typedef {import('./contract.mjs').Metric} Metric */
/** @typedef {import('./contract.mjs').MetricId} MetricId */
/** @typedef {import('./contract.mjs').SmartView} SmartView */
/** @typedef {import('../graph/contract.mjs').LineGraph} LineGraph */
/** @typedef {import('../memory/contract.mjs').MemoryRecord} MemoryRecord */
/** @typedef {{at: string, values: Record<string, number|null>}} SmartSnapshot */
/**
 * What the numbers are computed from (readSmartInputs reads them from disk; tests pass fixtures).
 * @typedef {{graph: LineGraph, testedItems: string[], runtime: {reached: string[]} | null, memory: MemoryRecord[] | null,
 *   decisions: {static: number, ai: number} | null, history: SmartSnapshot[], aiSteps?: {step: string, on: boolean, win: string}[] | null}} SmartInputs
 */

const round = (x) => Math.round(x * 1000) / 1000;
const share = (a, b) => (b ? round(a / b) : null);
const pct = (x) => `${Math.round(x * 100)}%`;
const ACCEPT = new Set(['picked', 'approved', 'fix-picked', 'agreed']);
const REFUSE = new Set(['refused', 'skipped', 'disagreed']);
/** How many earlier consistent picks memory needs before it prefers an option (im3's MIN_CONSISTENT). */
const MIN_CONSISTENT = 3;
const TREND = 6;

/** What happened to one proposal: accepted as it was, edited, or refused. */
const verdict = (/** @type {MemoryRecord} */ r) => (REFUSE.has(r.kind) ? 'refused' : ACCEPT.has(r.kind) && r.chosen === r.proposed ? 'accepted' : 'edited');

/**
 * Replay the person's picks of the drafter in time order: without memory Line is right when the static proposal is
 * what they chose; with memory, when the option the earlier records of the same intent preferred (at least
 * MIN_CONSISTENT times) is what they chose, else the static proposal.
 * @param {MemoryRecord[]} records
 * @returns {{with: number|null, without: number|null, cases: number}}
 */
export function memoryReplay(records) {
  const picks = records.filter((r) => r.step === 'drafter.route' && r.chosen !== null).sort((a, b) => a.at.localeCompare(b.at));
  let withMem = 0;
  let without = 0;
  picks.forEach((r, i) => {
    const counts = new Map();
    for (const p of picks.slice(0, i)) if (p.intent === r.intent && p.chosen) counts.set(p.chosen, (counts.get(p.chosen) ?? 0) + 1);
    const best = [...counts.entries()].filter(([o, c]) => c >= MIN_CONSISTENT && r.options.includes(o)).sort((a, b) => b[1] - a[1])[0];
    const guess = best ? best[0] : r.proposed;
    if (guess === r.chosen) withMem += 1;
    if (r.proposed === r.chosen) without += 1;
  });
  return { with: share(withMem, picks.length), without: share(without, picks.length), cases: picks.length };
}

const IMPROVE = /** @type {Record<MetricId, string>} */ ({
  'coverage.tested': 'Add a behaviour test for the logic units listed here, starting with the handlers.',
  'coverage.runtime': 'Run the tests with Line\'s runtime recorder so it sees which units really ran.',
  'health.crossFeature': 'Move what two features share into the library (Change: Move to the library).',
  'health.noBase': 'Base each feature item on one library item (Change: Re-base).',
  'health.unresolved': 'Fix or remove the imports Line cannot follow.',
  'health.duplicates': 'Keep one of the items with the same name, or rename one.',
  'ai.accepted': 'Teach Line the cases you edit most in Train Line.',
  'ai.edited': 'Save the answer you edited to as a training case in Train Line.',
  'ai.refused': 'Read each refusal; its typed fix is what Line tries next time.',
  'ai.staticShare': 'Turn decisions a model keeps making the same way into rules in Train Line.',
  'ai.preferred': 'Pick the route you prefer when the drafter offers several; Line remembers it.',
  'fixes.typed': 'Apply the recommended fix first, and edit only when it is wrong.',
  'memory.effect': 'Keep memory on, and forget only the records that are wrong.',
});
const LABEL = /** @type {Record<MetricId, string>} */ ({
  'coverage.tested': 'Logic units with a test',
  'coverage.runtime': 'Logic units that ran in a test',
  'health.crossFeature': 'Cross-feature uses',
  'health.noBase': 'Feature items with no base',
  'health.unresolved': 'Unresolved imports',
  'health.duplicates': 'Items with the same name',
  'ai.accepted': 'Proposals you accepted as they were',
  'ai.edited': 'Proposals you changed',
  'ai.refused': 'Proposals refused',
  'ai.staticShare': 'Decided by rules, not a model',
  'ai.preferred': 'Drafter picked the route you preferred',
  'fixes.typed': 'Refusals fixed by a typed fix, no edit by you',
  'memory.effect': 'Right with memory',
});

const base = (/** @type {string} */ f) => f.split('/').pop() ?? f;

/**
 * A readable name for each graph id behind a number (#856): a logic unit is "<kind> in <function>, <File>:<line>" (where
 * it sits from the node, else from its first PART_OF edge, since a real unit node carries no file of its own); any other
 * node is its label; an id the graph does not know is the id without its kind (the hash for a unit).
 * @param {LineGraph} g
 * @returns {(id: string) => string}
 */
export function itemLabeler(g) {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  /** @type {Map<string, {file: string, line: number}>} */
  const where = new Map();
  const located = g.edges
    .filter((y) => y.type === 'PART_OF' && y.from.startsWith('unit:') && 'file' in y.evidence)
    .map((y) => ({ from: y.from, at: /** @type {{file: string, line: number}} */ (/** @type {unknown} */ (y.evidence)) }))
    .sort((a, b) => `${a.at.file}`.localeCompare(`${b.at.file}`));
  for (const e of located) {
    if (!where.has(e.from)) where.set(e.from, e.at);
  }
  return (id) => {
    const n = byId.get(id);
    if (!n || !n.label) return id.replace(/^[a-z]+:/i, '');
    if (n.kind !== 'unit') return n.label;
    const at = n.file ? { file: n.file, line: n.line } : where.get(id);
    return at ? `${n.label}, ${base(at.file)}${at.line ? `:${at.line}` : ''}` : n.label;
  };
}

/**
 * The numbers from their inputs (pure).
 * @param {SmartInputs} x
 * @returns {SmartView & {metrics: (Metric & {empty?: string})[]}}
 */
export function computeSmart(x) {
  const g = x.graph;
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const labelOf = itemLabeler(g);
  const units = g.nodes.filter((n) => n.kind === 'unit').map((n) => n.id).sort();
  const itemOfUnit = new Map(g.edges.filter((e) => e.type === 'PART_OF' && e.from.startsWith('unit:')).map((e) => [e.from, e.to]));
  const tested = new Set(x.testedItems);
  const untested = units.filter((u) => !tested.has(itemOfUnit.get(u) ?? ''));
  /** @type {Record<string, Metric & {empty?: string}>} */
  const m = {};
  const put = (/** @type {MetricId} */ id, /** @type {Partial<Metric> & {empty?: string}} */ o) => {
    m[id] = { id, group: /** @type {any} */ (id.split('.')[0]), label: LABEL[id], value: null, trend: [], improve: IMPROVE[id], items: [], open: id.startsWith('ai.') || id === 'fixes.typed' || id === 'memory.effect' ? 'plan' : 'map', details: [], ...o };
  };
  // Logic coverage.
  if (units.length) put('coverage.tested', { value: share(units.length - untested.length, units.length), count: units.length, items: untested, details: [`${units.length - untested.length} of ${units.length} logic units sit in an item with a test file`] });
  else put('coverage.tested', { empty: 'Line found no logic units in this project yet.' });
  if (units.length && x.runtime) {
    const ran = new Set(x.runtime.reached);
    const notRan = units.filter((u) => !ran.has(u));
    put('coverage.runtime', { value: share(units.length - notRan.length, units.length), count: units.length, items: notRan, details: [`runtimeCoverage: ${units.length - notRan.length} of ${units.length} logic units ran in a test`] });
  } else put('coverage.runtime', { empty: units.length ? 'No test run with Line\'s runtime recorder was recorded yet.' : 'Line found no logic units in this project yet.' });
  // Graph health (counts).
  const feat = (id) => { const a = byId.get(id)?.attrs?.feature; return typeof a === 'string' ? a : null; };
  const cross = [...new Set(g.edges.filter((e) => ['IMPORTS', 'RENDERS', 'CALLS', 'USES_HOOK'].includes(e.type) && feat(e.from) && feat(e.to) && feat(e.from) !== feat(e.to)).map((e) => e.from))].sort();
  put('health.crossFeature', { count: cross.length, items: cross, details: cross.map((id) => `${id} uses another feature's item`) });
  const based = new Set(g.edges.filter((e) => e.type === 'BASED_ON').map((e) => e.from));
  const noBase = g.nodes.filter((n) => n.kind === 'item' && n.attrs?.area === 'feature' && !based.has(n.id)).map((n) => n.id).sort();
  put('health.noBase', { count: noBase.length, items: noBase });
  const unresolved = g.nodes.filter((n) => n.kind === 'finding' && /RESOLV|UNRESOLVED|IMPORT-0/.test(String(n.attrs?.rule ?? ''))).map((n) => n.id).sort();
  put('health.unresolved', { count: unresolved.length, items: unresolved, details: ['from validate\'s findings'] });
  const names = new Map();
  for (const n of g.nodes.filter((y) => y.kind === 'item')) names.set(n.label, [...(names.get(n.label) ?? []), n.id]);
  const dups = [...names.values()].filter((ids) => ids.length > 1);
  put('health.duplicates', { count: dups.length, items: dups.flat().sort(), details: dups.map((ids) => ids.join(' and ')) });
  // AI accuracy, from memory.
  const mem = x.memory ?? [];
  if (mem.length) {
    const v = mem.map(verdict);
    const steps = [...new Set(mem.map((r) => r.step))].sort();
    const per = steps.map((s) => { const rs = mem.filter((r) => r.step === s); return `${s}: ${rs.filter((r) => verdict(r) === 'accepted').length} of ${rs.length} accepted`; });
    for (const [id, k] of /** @type {[MetricId, string][]} */ ([['ai.accepted', 'accepted'], ['ai.edited', 'edited'], ['ai.refused', 'refused']])) {
      put(id, { value: share(v.filter((y) => y === k).length, v.length), count: v.length, items: mem.filter((r) => verdict(r) === k).map((r) => r.id), details: per });
    }
  } else for (const id of /** @type {MetricId[]} */ (['ai.accepted', 'ai.edited', 'ai.refused'])) put(id, { empty: 'Line has no record of what you did with its proposals yet.' });
  // The profile is the only switch: list which AI steps are on (with their measured win) and how many ship off.
  const stepsOn = (x.aiSteps ?? []).filter((p) => p.on);
  const stepLines = x.aiSteps ? [...stepsOn.map((p) => `${p.step} is on: ${p.win}`), `${x.aiSteps.length - stepsOn.length} of ${x.aiSteps.length} AI steps are off, so static code answers them`] : [];
  if (x.decisions && x.decisions.static + x.decisions.ai) put('ai.staticShare', { value: share(x.decisions.static, x.decisions.static + x.decisions.ai), count: x.decisions.static + x.decisions.ai, details: [`${x.decisions.static} decided by rules, ${x.decisions.ai} by a model`, ...stepLines] });
  else put('ai.staticShare', { empty: 'No decisions were recorded for this project yet.', details: stepLines });
  const drafts = mem.filter((r) => r.step === 'drafter.route');
  if (drafts.length) put('ai.preferred', { value: share(drafts.filter((r) => r.chosen === r.proposed).length, drafts.length), count: drafts.length, items: drafts.filter((r) => r.chosen !== r.proposed).map((r) => r.id), details: [`${drafts.filter((r) => r.chosen === r.proposed).length} of ${drafts.length} of your picks`] });
  else put('ai.preferred', { empty: 'You have not picked a drafted route in this project yet.' });
  const fixes = mem.filter((r) => r.step === 'plan.fix');
  const clean = fixes.filter((r) => r.kind === 'fix-picked' && r.chosen === r.proposed);
  if (fixes.length) put('fixes.typed', { value: share(clean.length, fixes.length), count: fixes.length, items: fixes.filter((r) => !clean.includes(r)).map((r) => r.id), details: [`${clean.length} of ${fixes.length} refusals`] });
  else put('fixes.typed', { empty: 'No refusal has been fixed in this project yet.' });
  const replay = memoryReplay(mem);
  if (replay.cases && replay.with !== null && replay.without !== null) put('memory.effect', { value: replay.with, count: replay.cases, details: [`with memory ${pct(replay.with)}, without ${pct(replay.without)}, over ${replay.cases} of your picks`] });
  else put('memory.effect', { empty: 'Line has no memory of your picks yet, so there is nothing to compare.' });
  // Trends: earlier snapshots, then now (a share for a share, a count for a count).
  const now = (/** @type {Metric} */ y) => (y.value !== null ? y.value : y.count ?? null);
  const metrics = METRIC_IDS.map((id) => {
    const y = m[id];
    const before = x.history.map((h) => h.values[id]).filter((z) => z !== undefined && z !== null).slice(-(TREND - 1));
    const cur = now(y);
    const mapIds = y.open === 'map' ? y.items.filter((i) => byId.has(i) || /^(item|unit|feature):/.test(i)) : [];
    const itemLabels = mapIds.length ? { itemLabels: Object.fromEntries(mapIds.map((i) => [i, labelOf(i)])) } : {};
    return { ...y, trend: cur === null ? before : [...before, cur], ...itemLabels };
  });
  return { ok: true, local: true, metrics, sentence: 'These numbers come only from records on this computer; nothing leaves it.' };
}

const jsonl = (file) => { try { return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)); } catch { return []; } };

/** Every file under `dir` (skipping node_modules and dot folders), root-relative. */
function walk(root, dir = '', out = []) {
  let entries;
  try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) walk(root, rel, out); else out.push(rel);
  }
  return out;
}

/**
 * Read the local records the numbers come from. Anything missing is null or empty; nothing is fetched.
 * @param {string} root
 * @param {LineGraph} graph
 * @returns {SmartInputs}
 */
export function readSmartInputs(root, graph) {
  const state = path.join(root, lineStateDir(root));
  const tests = new Set(walk(root).map((f) => f.split('/').pop()?.match(/^(.+)\.(test|spec)\.[cm]?[jt]sx?$/)?.[1]).filter(Boolean));
  const testedItems = graph.nodes.filter((n) => n.kind === 'item' && tests.has(n.label)).map((n) => n.id);
  // G2: units reached, from recorded runs (runtime edges on unit nodes), when there are any.
  const runtimeEdges = graph.edges.filter((e) => e.layer === 'runtime');
  const runtimeDir = path.join(state, 'runtime', 'records');
  const recorded = fs.existsSync(runtimeDir) || runtimeEdges.length > 0;
  const reached = [...new Set(runtimeEdges.flatMap((e) => [e.from, e.to]).filter((id) => id.startsWith('unit:')))];
  const memDir = path.join(state, 'memory');
  let memory = [];
  try { memory = fs.readdirSync(memDir).filter((f) => f.endsWith('.jsonl')).sort().flatMap((f) => jsonl(path.join(memDir, f))); } catch { /* no memory yet */ }
  let aiSteps = null;
  try { aiSteps = listStepProfiles().map((p) => ({ step: p.step, on: stepOn(p), win: stepWin(p) })); } catch { /* no profiles: the steps go unlisted */ }
  return { graph, testedItems, runtime: recorded ? { reached } : null, memory, decisions: null, history: jsonl(path.join(state, 'knows', 'smart.jsonl')), aiSteps };
}

/**
 * The numbers for a project, and one snapshot kept (Line's own state, through the writer) for the next trend.
 * @param {string} root
 * @param {LineGraph} graph
 * @returns {SmartView}
 */
export function smartView(root, graph) {
  const inputs = readSmartInputs(root, graph);
  const view = computeSmart(inputs);
  /** @type {Record<string, number|null>} */
  const values = Object.fromEntries(view.metrics.map((y) => [y.id, y.value !== null ? y.value : y.count ?? null]));
  const last = inputs.history.at(-1);
  if (!last || JSON.stringify(last.values) !== JSON.stringify(values) || Date.now() - Date.parse(last.at) > 3_600_000) {
    try { writeLineState(root, `${lineStateDir(root)}/knows/smart.jsonl`, `${JSON.stringify({ at: new Date().toISOString(), values })}\n`, { append: true }); } catch { /* a snapshot that cannot be kept never stops the read */ }
  }
  return view;
}
