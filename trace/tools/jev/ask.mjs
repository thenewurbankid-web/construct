#!/usr/bin/env node
// #892: ask Line a request and see its plan as a Trace path, static and jev side by side.
//   node trace/tools/jev/ask.mjs "<request>" [--project <dir>] [--json] [--no-jev] [--jev-url <url>] [--no-verify] [--all-parts]
// Runs the real drafter (packages/engine/line/drafter/index.mjs draft: normalize -> classify -> enumerate -> verify ->
// rank), asks jev the same closed labels in shadow (classifyJev), reads the target page's binding (pageBinding.mjs) and
// prints the Trace path (tracePath.mjs) with each decision's static pick, jev's pick + confidence and FORK flags.
// Every ask is appended to data/ask-log.jsonl ({request, labels, path, shadow}); `intent-label.mjs from-last` turns the
// latest one into a gold label. jev's labels are used only when construct.intent is switched on with a measured win.
// #904: it also runs the beam planner (askBeam.mjs -> trace/src/beam planBeamDir) on the Trace example the request is
// about: --json carries runs (open/closed + reason), recommended, steps OR the one closed question, the arms' readings
// and the events; with BEAM_EVENTS_FILE set the events stream there as they happen. --no-beam skips it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { draft, boundRoute } from '../../../packages/engine/line/drafter/index.mjs';
import { closedLabels, forksOf } from '../../../packages/engine/line/drafter/classifyJev.mjs';
import { shadowRecord, appendShadow, intentSwitch, pickLabels } from '../../../packages/engine/line/drafter/shadow.mjs';
import { readPageBinding } from '../../../packages/engine/line/pageBinding.mjs';
import { readLineProject } from '../../../packages/engine/line/model.mjs';
import { factsSummary } from '../../../packages/engine/line/facts.mjs';
import { CATALOG, REPO, HERE, DEFAULT_PROJECT } from './intentGold.mjs';
import { staticPagePath, shadowPath, renderAsk } from './tracePath.mjs';
import { beamAsk, renderBeam } from './askBeam.mjs';

// JEV_ASK_LOG moves the log; "0" turns it off (tests and the eval's subprocess runs keep the owner's log clean).
export const ASK_LOG = process.env.JEV_ASK_LOG === '0' ? null : process.env.JEV_ASK_LOG || path.join(HERE, 'data', 'ask-log.jsonl');

/**
 * The feature pages a request points at: the target page, else the pages of the target's feature (at most 2).
 * @param {any} d a draft @param {any} summary factsSummary
 * @returns {string[]} page files (project-relative)
 */
export function pagesOf(d, summary) {
  const t = d.labels.target ? d.bindings[d.labels.target] : null;
  const pagesOfFeature = (f) => (summary.features.find((x) => x.name === f)?.items ?? []).filter((i) => i.kind === 'pages').map((i) => i.file).filter(Boolean);
  if (t && typeof t === 'object' && t.kind === 'pages' && t.file?.startsWith('features/')) return [t.file];
  if (t && typeof t === 'object' && t.feature) return pagesOfFeature(t.feature).slice(0, 2);
  if (typeof t === 'string') return pagesOfFeature(t).slice(0, 2);
  const fromSteps = (d.routes[0]?.steps ?? []).flatMap((s) => Object.values(s.args ?? {})).filter((v) => typeof v === 'string' && /^features\/.+\/pages\//.test(v));
  return [...new Set(fromSteps)].slice(0, 2);
}

/**
 * Ask: draft + jev shadow + Trace path. Never throws for jev; throws only when the project cannot be read.
 * @param {string} request
 * @param {{project?: string, jev?: boolean, choose?: any, baseUrl?: string, verify?: boolean, allParts?: boolean, log?: string|null, timeoutMs?: number, beam?: boolean, example?: string|null, eventsFile?: string|null, armOpts?: any}} [o]
 */
export async function ask(request, o = {}) {
  const project = o.project ?? DEFAULT_PROJECT;
  const root = path.isAbsolute(project) ? project : path.join(REPO, project);
  const d = draft(root, request, { verify: o.verify ?? true, shadow: false });
  const summary = factsSummary(root, readLineProject(root));
  const stateDir = summary.layout.state || 'line';
  const sw = intentSwitch(root, stateDir);
  const ctx = { normalized: { text: d.request, tokens: d.tokens }, slots: d.slots, catalog: CATALOG, labels: d.labels };
  const jopt = { choose: o.choose, baseUrl: o.baseUrl, timeoutMs: o.timeoutMs, gate: sw.gate };
  const { record, jevLabels } = o.jev === false ? { record: null, jevLabels: null } : await shadowRecord(ctx, jopt);
  const st = closedLabels(d.labels, d.slots, d.bindings);
  const jv = closedLabels(jevLabels, d.slots, d.bindings);
  const used = pickLabels(d.labels, jevLabels, sw).used;
  // The project's own shadow log gets the slot-form record when its shadow switch is on (as draft() would).
  const projectLog = record && sw.shadow ? appendShadow(root, { ...record, used }, stateDir) : null;
  const rec = d.routes.find((r) => r.id === d.recommended) ?? null;
  const bound = rec ? boundRoute(d, rec.id) : null;
  const files = pagesOf(d, summary);
  const pathPages = [];
  for (const f of files) {
    try { pathPages.push(staticPagePath(readPageBinding(root, f), { all: o.allParts })); } catch (err) { pathPages.push({ page: path.basename(f, '.tsx'), file: f, via: 'static', note: /** @type {Error} */ (err).message, parts: [] }); }
  }
  const shadow = o.jev === false ? [] : await shadowPath(pathPages, jopt);
  const armCtx = { request: String(request), normalized: ctx.normalized, slots: d.slots, bindings: d.bindings, catalog: CATALOG, labels: d.labels };
  const b = o.beam === false ? null : await beamAsk({ request: String(request), root, stateDir, ctx: armCtx, example: o.example, eventsFile: o.eventsFile === undefined ? process.env.BEAM_EVENTS_FILE || null : o.eventsFile, armOpts: o.armOpts });
  const result = {
    v: 1,
    at: new Date().toISOString(),
    request: String(request),
    project,
    normalized: d.request,
    gate: sw.gate,
    switch: { shadow: sw.shadow, on: sw.on, used },
    labels: { static: st, jev: jv, jevConfidence: jevLabels?.confidences ?? null, forks: forksOf(st, jv, jevLabels?.confidences, sw.gate) },
    plan: { recommended: d.recommended, defer: d.defer?.to ? `${d.defer.to}: ${d.defer.sentence}` : d.defer?.sentence ?? null, route: bound && rec ? { id: rec.id, status: rec.status, label: bound.label, steps: bound.steps } : null, others: Math.max(0, d.routes.length - (rec ? 1 : 0)) },
    path: pathPages,
    pathNote: files.length ? null : 'The request names no feature page, so there is no page part to route.',
    shadow,
    // The beam (#904): every run with its state, the recommended one, the plan steps OR the one closed question.
    example: b?.example ?? null,
    outcome: b?.outcome ?? null,
    beamNote: b?.note ?? (b ? null : 'beam skipped (--no-beam)'),
    runs: b?.runs ?? [],
    recommended: b?.recommended ?? null,
    steps: b?.steps ?? null,
    question: b?.question ?? null,
    arms: b?.arms ?? null,
    events: b?.events ?? null,
    eventsFile: b && o.eventsFile !== null ? (o.eventsFile ?? process.env.BEAM_EVENTS_FILE) || null : null,
    ms: b?.ms ?? null,
    logged: null,
    projectLog,
  };
  const log = o.log === undefined ? ASK_LOG : o.log;
  if (log) {
    fs.mkdirSync(path.dirname(log), { recursive: true });
    // The log keeps the beam's summary, not its event stream (events.jsonl holds that).
    fs.appendFileSync(log, `${JSON.stringify({ ...result, events: undefined, runs: result.runs.map(({ id, state, reason }) => ({ id, state, reason })) })}\n`);
    result.logged = path.relative(process.cwd(), log) || log;
  }
  return result;
}

/** The latest ask in the log, or null. @param {string} [file] */
export function lastAsk(file = ASK_LOG) {
  try { const ls = fs.readFileSync(file, 'utf8').trim().split('\n'); return JSON.parse(ls[ls.length - 1]); } catch { return null; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const valued = new Set(['--project', '--jev-url', '--example']);
  const request = argv.filter((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1])).join(' ');
  if (!request) {
    console.log('Usage: node trace/tools/jev/ask.mjs "<request>" [--project examples/line-sample] [--json] [--no-jev] [--no-verify] [--no-beam] [--example trace/examples/<x>]');
  } else {
    try {
      const r = await ask(request, { project: arg('--project'), jev: !argv.includes('--no-jev'), baseUrl: arg('--jev-url'), verify: !argv.includes('--no-verify'), allParts: argv.includes('--all-parts'), beam: !argv.includes('--no-beam'), example: arg('--example') ? path.resolve(/** @type {string} */ (arg('--example'))) : undefined });
      console.log(argv.includes('--json') ? JSON.stringify(r, null, 1) : [renderAsk(r), ...renderBeam(r.outcome ? { ...r, note: r.beamNote } : null)].join('\n'));
    } catch (err) {
      console.log(`ask could not read the request: ${/** @type {Error} */ (err).message}`);
      process.exitCode = 1;
    }
  }
}
