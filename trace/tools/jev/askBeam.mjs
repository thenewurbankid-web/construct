// #904 (part of #900): ask's beam half. A request -> the Trace example it is about -> the NLP arms' readings (static by
// default; a shadow arm only when its switch or LINE_ARMS_SHADOW is on) -> planBeamDir (trace/src/beam) -> runs,
// recommended run, the plan steps OR the one closed question, streamed to $BEAM_EVENTS_FILE as it happens.
// Deterministic apart from the local arm sidecar (only when an arm's switch is on); never calls a remote model.
import fs from 'node:fs';
import path from 'node:path';
import { planBeamDir } from '../../src/beam/index.mjs';
import { readCandidates, mergeReadings } from '../../src/beam/arms.mjs';
import { armsSwitch } from '../../../packages/engine/line/drafter/shadow.mjs';
import { REPO } from './intentGold.mjs';

export const EXAMPLES = path.join(REPO, 'trace', 'examples');

/** The eval's arm names (trace/eval/beam/metrics.mjs) for arms.mjs's arms. */
export const ARM_NAMES = Object.freeze({ static: 'static', lr: 'sklearn', nb: 'sklearn', spacy: 'spacy', jev: 'jev', nli: 'zero-shot' });

const words = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((w) => (w.length > 3 ? w.replace(/(ies)$/, 'y').replace(/s$/, '') : w));

/**
 * The Trace example a request is about: every part of a feature name in the request (most parts wins), else the
 * route's last segment; ties go to the first name in order. Null when nothing matches.
 * @param {string} request @param {string} [examplesDir]
 * @returns {string|null} the example's folder
 */
export function exampleFor(request, examplesDir = EXAMPLES) {
  const said = new Set(words(request));
  let best = null;
  let bestScore = 0;
  let names = [];
  try { names = fs.readdirSync(examplesDir).sort(); } catch { return null; }
  for (const name of names) {
    let spec;
    try { spec = JSON.parse(fs.readFileSync(path.join(examplesDir, name, 'feature.json'), 'utf8')); } catch { continue; }
    const parts = words(spec.feature ?? name);
    const route = words(String(spec.route ?? '').split('/').filter(Boolean).pop() ?? '');
    const score = parts.length && parts.every((p) => said.has(p)) ? 100 + parts.length : route.length && route.every((p) => said.has(p)) ? 10 : 0;
    if (score > bestScore) { best = path.join(examplesDir, name); bestScore = score; }
  }
  return best;
}

/** A Reading as run labels (normalizePlannerOutput's shape). @param {any} r */
export const readingLabels = (r) => ({ intent: r.intent, object: r.object, target: { kind: 'slot', name: r.target ?? '' }, layers: [...r.layers] });

/**
 * A run's Trace path: its fork choices (FORK marks), then one node per file it writes and per placeholder ref.
 * @param {{forks: any[], steps?: any[]}} run
 */
export function runPath(run) {
  const nodes = run.forks.map((f) => (f.point === 'reading'
    ? { layer: 'reading', label: f.label, decision: null, fork: true }
    : { layer: 'page-part', label: `${f.point}: ${f.label}`, decision: f.point.startsWith('ref:') ? 'api' : 'dynamic', fork: true }));
  for (const s of run.steps ?? []) {
    const layer = String(s.args.layer).toLowerCase();
    nodes.push({ layer, label: s.args.file, decision: 'create', fork: false });
    for (const [fn, ref] of Object.entries(s.args.refs ?? {})) nodes.push({ layer, label: fn, decision: ref, fork: false });
  }
  return nodes;
}

/**
 * The arms' readings in the eval's names: static always; sklearn (lr + nb), spacy, jev, zero-shot (nli) when they ran.
 * @param {Record<string, any>} byArm readCandidates().byArm
 */
export function armsOut(byArm) {
  /** @type {Record<string, any[][]>} */
  const by = {};
  for (const [arm, res] of Object.entries(byArm)) if (res?.readings?.length) (by[ARM_NAMES[arm] ?? arm] ??= []).push(res.readings);
  return Object.fromEntries(Object.entries(by).map(([name, lists]) => [name, lists.length === 1 ? lists[0] : mergeReadings(lists).sort((a, b) => b.confidence - a.confidence)]));
}

/**
 * Run the beam for one drafted request.
 * @param {object} o
 * @param {string} o.request
 * @param {string} o.root           the Line project (arm switches)
 * @param {string} o.stateDir
 * @param {any} o.ctx               ArmContext (arms.mjs)
 * @param {string|null} [o.example] the Trace example folder (default: exampleFor(request))
 * @param {string|null} [o.eventsFile] default $BEAM_EVENTS_FILE
 * @param {any} [o.armOpts]         readCandidates options (post, baseUrl, timeoutMs)
 */
export async function beamAsk({ request, root, stateDir, ctx, example, eventsFile = process.env.BEAM_EVENTS_FILE || null, armOpts = {} }) {
  const sw = armsSwitch(root, stateDir);
  const cand = await readCandidates(ctx, { ...armOpts, arms: ['static', ...sw.shadow], on: sw.on });
  const arms = armsOut(cand.byArm);
  const dir = example === undefined ? exampleFor(request) : example;
  if (!dir) return { example: null, outcome: 'none', note: 'The request names no Trace example (trace/examples/<feature>), so the beam has no page to fit.', runs: [], recommended: null, steps: null, question: null, events: [], ms: 0, arms, shadowArms: sw.shadow, onArms: sw.on };

  const t0 = Date.now();
  /** @type {any[]} */
  const events = [];
  if (eventsFile) { fs.mkdirSync(path.dirname(eventsFile), { recursive: true }); fs.writeFileSync(eventsFile, ''); }
  const onEvent = (e) => {
    const line = { ...e, at: Date.now(), ...(e.t === 'done' ? { ms: Date.now() - t0 } : {}) };
    events.push(line);
    if (eventsFile) fs.appendFileSync(eventsFile, `${JSON.stringify(line)}\n`);
  };
  const r = planBeamDir(dir, { readings: cand.readings, events: onEvent });
  const runs = Object.entries(r.runs).map(([id, x]) => ({
    id,
    state: x.closed ? 'closed' : 'open',
    reason: x.closed?.reason ?? null,
    detail: x.closed?.detail ?? null,
    labels: readingLabels(x.reading),
    forks: x.forks,
    path: runPath(x),
    ...(x.steps ? { steps: x.steps } : {}),
  }));
  return {
    example: path.relative(REPO, dir),
    outcome: r.outcome,
    note: null,
    runs,
    recommended: r.outcome === 'plan' ? r.plan?.run ?? null : r.question?.recommended ?? null,
    steps: r.plan?.steps ?? null,
    question: r.question,
    events,
    ms: Date.now() - t0,
    arms,
    shadowArms: sw.shadow,
    onArms: sw.on,
  };
}

/** The beam part of the human-readable ask. @param {any} b */
export function renderBeam(b) {
  if (!b) return [];
  const out = ['', `Beam (${b.example ?? 'no Trace example'}): ${b.outcome}${b.ms ? ` in ${b.ms} ms` : ''}${b.eventsFile ? `; events -> ${b.eventsFile}` : ''}`];
  if (b.note) out.push(`  ${b.note}`);
  out.push(`  arms: ${Object.entries(b.arms ?? {}).map(([a, rs]) => `${a} ${rs[0]?.intent ?? '-'}`).join(', ') || 'none'}`);
  const open = b.runs.filter((r) => r.state === 'open');
  const closed = b.runs.filter((r) => r.state === 'closed');
  const by = closed.reduce((m, r) => ({ ...m, [r.reason]: (m[r.reason] ?? 0) + 1 }), /** @type {Record<string, number>} */ ({}));
  out.push(`  runs: ${b.runs.length} opened, ${open.length} open, ${closed.length} closed (${Object.entries(by).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'})`);
  for (const r of open) {
    const forks = r.path.filter((n) => n.fork).map((n) => n.label);
    out.push(`  ${r.id === b.recommended ? '*' : ' '} ${r.id} ${r.labels.intent}${forks.length ? `  FORK ${forks.join('; ')}` : ''}`);
  }
  if (b.question) {
    out.push(`  Question: ${b.question.sentence}`);
    b.question.options.forEach((o, i) => out.push(`    ${i + 1}. [${o.id}] ${o.sentence} (${o.effect})`));
  } else if (b.steps) b.steps.forEach((s, i) => out.push(`    ${i + 1}. ${s.tool} ${s.args.file} - ${s.sentence}`));
  return out;
}
