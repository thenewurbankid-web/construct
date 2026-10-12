#!/usr/bin/env node
// Bench metrics: one results/<builder>.json per run, and RESULTS.md generated from all of them.
//
//   node bench/ecommerce/metrics.mjs collect --builder <id> --arm line|plain|ui --run <run-dir> [--model <id>]
//        [--usage <file.json>] [--wall-ms <n>] [--turns <n>] [--human <n>] [--no-tsc]
//   node bench/ecommerce/metrics.mjs report
//   node bench/ecommerce/metrics.mjs acceptance <report.json> [acceptance.log]   (run-acceptance.sh's summary)
//
// <run-dir> is what driver/new-run.sh made: <run>/project (the built project, a git repo whose first commit is the
// starter) and <run>/logs (calls.jsonl from the CLI, turns.jsonl from qwen-agent, acceptance.json from
// run-acceptance.sh, ui-actions.jsonl or a usage file for the browser builder).
//
// Sources, per field:
//   wall time, turns   turns.jsonl start/end (qwen-agent) | --wall-ms/--turns or the usage file (Claude builders) |
//                      first..last call in calls.jsonl
//   tokens             results/<builder>.tokens.jsonl (per turn: in, out, cacheRead, cacheWrite), else the usage file
//                      (the orchestrator's per-agent totals); cost from PRICES (USD per million tokens, list prices)
//   plan               <project>/line/plans/ses-cockpit.json (steps added, landed, refused with their rules, fixes)
//                      plus refusals at add time from calls.jsonl or Line's trace (<project>/line/traces/*.jsonl)
//   validate           Construct's validate on the project (Line arm: its profile; plain arm: the Line profile run as a
//                      measurement only, "rules a plain build would break")
//   tsc                npx tsc --noEmit in the project (needs its node_modules)
//   acceptance         logs/acceptance.json (Playwright JSON report); total is the number of acceptance tests; no test
//                      ran (the webServer's next build failed) is "did not run: build failed", passed null, never 0/total
//   LOC, duplicates    code files the build added or changed (git diff against the starter commit)
//   library reuse      Line view: the share of feature items (not logic kinds) that are based on a library item
//   interventions      --human (default 0) plus project files changed outside any landed plan step (Line arm)
//   Line's own models  drafter / jev / Qwen use recorded in <project>/line (separate from the builder's tokens)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(here, 'results');

/** USD per million tokens. Source: Anthropic list prices as cached in the claude-api skill on 2026-10-06; cache read
 * and write are the published multipliers (read 0.1x input, 5-minute write 1.25x input) unless a price is listed. */
export const PRICES = Object.freeze({
  date: '2026-10-06',
  source: 'Anthropic first-party API list prices (claude-api skill model table, cached 2026-10-06); cache read = 0.1x input, cache write (5 min) = 1.25x input unless listed',
  models: {
    'claude-haiku-5-5': { in: 0.10, out: 0.50, cacheRead: 0.01, cacheWrite: 0.125, note: 'prompts up to 100K tokens ($0.50/$2.50 beyond)' },
    'claude-haiku-4-5': { in: 1.00, out: 5.00, cacheRead: 0.10, cacheWrite: 1.25 },
    'claude-sonnet-5-5': { in: 2.00, out: 10.00, cacheRead: 0.20, cacheWrite: 2.50 },
    'claude-sonnet-5': { in: 2.00, out: 10.00, cacheRead: 0.20, cacheWrite: 2.50 },
    'claude-sonnet-4-6': { in: 3.00, out: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
    'claude-opus-5-5': { in: 4.00, out: 20.00, cacheRead: 0.20, cacheWrite: 5.00 },
    'qwen2.5-coder:7b': { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, note: 'local (Ollama): $0; local wall time is the cost' },
  },
});

const readJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const CODE = /\.(tsx?|jsx?|mjs|cjs)$/;
const IGNORE = /(^|\/)(node_modules|\.next|line|\.git)(\/|$)|next-env\.d\.ts$|tsbuildinfo$/;

function flags(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) o[k] = true; else { o[k] = v; i += 1; } }
    else o._.push(argv[i]);
  }
  return o;
}

/** Files the build changed against the starter commit (added or modified), from the run project's own git. */
function changedFiles(project) {
  try {
    const first = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim().split('\n')[0];
    const tracked = execFileSync('git', ['diff', '--name-only', first], { cwd: project, encoding: 'utf8' }).split('\n').filter(Boolean);
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: project, encoding: 'utf8' }).split('\n').filter(Boolean);
    return [...new Set([...tracked, ...untracked])].filter((f) => !IGNORE.test(f) && fs.existsSync(path.join(project, f)));
  } catch { return []; }
}

const loc = (project, files) => files.filter((f) => CODE.test(f)).reduce((n, f) => n + fs.readFileSync(path.join(project, f), 'utf8').split('\n').filter((l) => l.trim() && !/^\s*(\/\/|\*|\/\*)/.test(l)).length, 0);

/** Near-identical component files (token Jaccard >= 0.9 over files of 8+ code lines), counted as pairs. */
function duplicates(project, files) {
  const comps = files.filter((f) => /\.(tsx|jsx)$/.test(f)).map((f) => {
    const src = fs.readFileSync(path.join(project, f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    return { f, lines: src.split('\n').filter((l) => l.trim()).length, toks: new Set(src.match(/[A-Za-z_$][\w$]*|[{}()<>=/]/g) ?? []) };
  }).filter((c) => c.lines >= 8);
  const pairs = [];
  for (let i = 0; i < comps.length; i += 1) for (let j = i + 1; j < comps.length; j += 1) {
    const a = comps[i].toks; const b = comps[j].toks;
    let inter = 0; for (const t of a) if (b.has(t)) inter += 1;
    const jac = inter / (a.size + b.size - inter || 1);
    if (jac >= 0.9) pairs.push([comps[i].f, comps[j].f, Number(jac.toFixed(2))]);
  }
  return { pairs: pairs.length, examples: pairs.slice(0, 5) };
}

/** The plan as it ended: steps added, landed, refused (by rule), fixes applied. */
export function planStats(project, calls) {
  const doc = readJson(path.join(project, 'line', 'plans', 'ses-cockpit.json'));
  const steps = (doc?.plans ?? []).flatMap((p) => p.steps ?? []);
  const isLanded = (s) => s.status === 'done' && s.result?.needsYou !== true && (s.result?.apply ? s.result.apply.ok === true : true);
  const changes = steps.filter((s) => s.tool !== 'line.leaveAsIs' && s.tool !== 'line.project');
  const refusedRun = changes.filter((s) => s.status === 'done' && s.result?.needsYou === true);
  const byRule = {};
  const bump = (r) => { byRule[r] = (byRule[r] ?? 0) + 1; };
  for (const s of refusedRun) {
    const rules = [...new Set((s.result?.apply?.findings ?? []).filter((f) => f.severity === 'error').map((f) => f.rule))];
    if (rules.length) rules.forEach(bump); else bump(s.result?.apply?.code ?? 'CHECK_FAILED');
  }
  // Refusals at add time never join the plan: from the CLI log, else from Line's trace (Cockpit's UI path).
  let refusedAdd = calls.filter((c) => c.kind === 'call' && c.cmd === 'add' && c.result && !c.result.ok);
  if (!calls.length) {
    const traces = fs.existsSync(path.join(project, 'line', 'traces')) ? fs.readdirSync(path.join(project, 'line', 'traces')).filter((f) => f.endsWith('.jsonl')) : [];
    refusedAdd = traces.flatMap((f) => readJsonl(path.join(project, 'line', 'traces', f))).filter((e) => e.kind === 'refusal' && e.tool !== '(plan)').map((e) => ({ result: { code: e.code } }));
  }
  for (const c of refusedAdd) bump(`add:${c.result.code ?? 'REFUSED'}`);
  const fixes = changes.filter((s) => (s.args?.fixOf || s.tool === 'line.fix' || s.tool === 'line.amend') && isLanded(s)).length;
  const landedFiles = new Set(changes.filter(isLanded).flatMap((s) => s.result?.apply?.files ?? []));
  // R1 (#880): fixes the builder picked by their id (add --fix f1, plan_add {"fix": ...}): sent, joined the plan, landed.
  const byId = calls.filter((c) => c.kind === 'call' && c.cmd === 'add' && c.args?.fix);
  const joined = byId.filter((c) => c.result?.ok && c.result.stepId);
  const fixesById = { sent: byId.length, added: joined.length, landed: joined.filter((c) => changes.some((s) => s.id === c.result.stepId && isLanded(s))).length };
  return {
    added: changes.length, landed: changes.filter(isLanded).length, refusedAtRun: refusedRun.length, refusedAtAdd: refusedAdd.length,
    refusedByRule: byRule, fixesApplied: fixes, fixesById, leftAsIs: steps.filter((s) => s.tool === 'line.leaveAsIs').length,
    approvals: { auto: calls.filter((c) => c.kind === 'approval' && c.approvedBy === 'auto').length },
    byTool: changes.filter(isLanded).reduce((m, s) => ({ ...m, [s.tool]: (m[s.tool] ?? 0) + 1 }), {}),
    landedFiles: [...landedFiles],
  };
}

async function validateCounts(project, arm) {
  if (arm === 'plain') {
    const { validateLine } = await import('../../packages/core/profiles/line/index.mjs');
    const v = validateLine(project).violations;
    const byRule = v.reduce((m, x) => ({ ...m, [x.rule]: (m[x.rule] ?? 0) + 1 }), {});
    return { profile: 'line (measurement only)', errors: v.filter((x) => x.severity === 'error').length, warnings: v.filter((x) => x.severity !== 'error').length, byRule };
  }
  const { aggregateValidation } = await import('../../packages/core/registry.mjs');
  const { enforcersForRoot } = await import('../../packages/core/profiles/index.mjs');
  const v = aggregateValidation(project, enforcersForRoot(project)).violations;
  const byRule = v.reduce((m, x) => ({ ...m, [x.rule]: (m[x.rule] ?? 0) + 1 }), {});
  return { profile: 'line', errors: v.filter((x) => x.severity === 'error').length, warnings: v.filter((x) => x.severity === 'warning').length, byRule };
}

function tscErrors(project) {
  if (!fs.existsSync(path.join(project, 'node_modules', 'typescript'))) return { errors: null, note: 'no node_modules' };
  const r = spawnSync('npx', ['tsc', '--noEmit', '-p', '.'], { cwd: project, encoding: 'utf8', timeout: 300_000 });
  return { errors: ((r.stdout ?? '') + (r.stderr ?? '')).match(/error TS\d+/g)?.length ?? 0 };
}

/** The number of acceptance tests (test( calls in acceptance/*.spec.ts). */
export function acceptanceTotal() {
  const dir = path.join(here, 'acceptance');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.spec.ts')).reduce((n, f) => n + (fs.readFileSync(path.join(dir, f), 'utf8').match(/^test\(/gm)?.length ?? 0), 0);
}

/**
 * A Playwright JSON report as the bench counts it. A report with no test that ran (Playwright's webServer, which runs
 * `next build && next start`, never started, so no test ran) is "did not run", never 0 of the total: `passed` is null
 * and `status` says why, so a build failure is not read as 22 failed tests.
 * @param {any} r The report (null when there is none).
 * @param {number} total The number of acceptance tests.
 * @param {string} [log] run-acceptance.sh's console output (acceptance.log), when kept: it tells a build failure apart.
 * @returns {{passed: number|null, total: number, ran: boolean, status: string, passedIds: string[]}}
 */
export function acceptanceOf(r, total, log = '') {
  if (!r) return { passed: null, total, ran: false, status: 'did not run: no report', passedIds: [] };
  const specs = []; const walk = (s) => { for (const x of s.suites ?? []) walk(x); for (const sp of s.specs ?? []) specs.push(sp); };
  walk(r);
  const ran = specs.some((sp) => (sp.tests ?? []).some((t) => (t.results ?? []).length > 0));
  if (!ran) {
    const said = (r.errors ?? []).map((e) => String(e.message ?? '')).join('\n');
    const server = /webServer was not able to start/.test(said);
    const buildError = /Failed to compile|Build error|Type error:/i.test(log);
    const why = server && (buildError || !log) ? 'build failed' : server ? 'the web server did not start' : said ? said.split('\n')[0].replace(/^Error:\s*/, '') : 'no test ran';
    return { passed: null, total, ran: false, status: `did not run: ${why}`, passedIds: [] };
  }
  const passed = specs.filter((sp) => sp.ok);
  return { passed: passed.length, total, ran: true, status: `${passed.length}/${total}`, passedIds: passed.map((sp) => sp.title.split(':')[0]) };
}

/** Acceptance as a table cell: "passed/total", or why it did not run (older results carry only ran: false). */
export const acceptanceText = (a) => (a?.ran === false ? a.status ?? 'did not run' : `${a?.passed ?? 0}/${a?.total ?? 0}`);

function acceptance(logs) {
  let log = '';
  try { log = fs.readFileSync(path.join(logs, 'acceptance.log'), 'utf8'); } catch { /* not kept */ }
  return acceptanceOf(readJson(path.join(logs, 'acceptance.json')), acceptanceTotal(), log);
}

function tokens(builder, usage, model) {
  const turns = readJsonl(path.join(RESULTS, `${builder}.tokens.jsonl`));
  const sum = (k) => turns.reduce((n, t) => n + (Number(t[k]) || 0), 0);
  const t = turns.length
    ? { input: sum('in'), output: sum('out'), cacheRead: sum('cacheRead'), cacheWrite: sum('cacheWrite'), source: turns[0].source ?? 'per-turn log' }
    : usage ? { input: usage.input_tokens ?? null, output: usage.output_tokens ?? null, cacheRead: usage.cache_read_input_tokens ?? null, cacheWrite: usage.cache_creation_input_tokens ?? null, total: usage.total_tokens ?? null, source: usage.source ?? 'orchestrator usage totals' }
      : { input: null, output: null, cacheRead: null, cacheWrite: null, source: 'none recorded' };
  const total = t.total ?? (t.input === null ? null : t.input + t.output + t.cacheRead + t.cacheWrite);
  const p = PRICES.models[model];
  const cost = p && t.input !== null ? (t.input * p.in + t.output * p.out + t.cacheRead * p.cacheRead + t.cacheWrite * p.cacheWrite) / 1e6 : null;
  return { ...t, total, costUsd: cost === null ? null : Number(cost.toFixed(4)), priceDate: PRICES.date };
}

/** Line's own model use during the build (drafter, jev, Qwen inside Construct), never mixed with the builder's. */
function lineModelUse(project) {
  const dir = path.join(project, 'line');
  const files = [];
  const walk = (d) => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.jsonl')) files.push(p); } } catch { /* none */ } };
  walk(dir);
  let calls = 0; let tokensIn = 0; let tokensOut = 0;
  for (const f of files) for (const e of readJsonl(f)) {
    const ai = e.model || e.source === 'ai' || e.by === 'jev' || e.by === 'qwen' || e.chooser === 'qwen' || e.chooser === 'jev';
    if (!ai) continue;
    calls += 1; tokensIn += Number(e.tokensIn ?? e.prompt_eval_count ?? 0); tokensOut += Number(e.tokensOut ?? e.eval_count ?? 0);
  }
  return { calls, tokensIn, tokensOut, note: calls ? 'from line/**.jsonl entries naming a model' : 'no model call recorded in line/ (drafter off: LINE_DRAFTER unset; no jev or Qwen step ran inside Construct)' };
}

async function collect(o) {
  const run = path.resolve(o.run); const project = path.join(run, 'project'); const logs = path.join(run, 'logs');
  const arm = o.arm ?? 'line'; const builder = o.builder; const model = o.model ?? null;
  if (!builder || !fs.existsSync(project)) throw new Error('collect needs --builder and --run <dir with project/>');
  const calls = readJsonl(path.join(logs, 'calls.jsonl'));
  const turnsLog = readJsonl(path.join(logs, 'turns.jsonl'));
  const usage = o.usage ? readJson(o.usage) : null;
  const start = turnsLog.find((e) => e.kind === 'start'); const end = turnsLog.find((e) => e.kind === 'end');
  const callTimes = calls.map((c) => Date.parse(c.at)).filter(Number.isFinite);
  const wallMs = Number(o['wall-ms'] ?? usage?.wallMs ?? end?.wallMs ?? (callTimes.length ? Math.max(...callTimes) - Math.min(...callTimes) : 0)) || null;
  const turns = Number(o.turns ?? usage?.turns ?? end?.turns ?? turnsLog.filter((e) => e.kind === 'turn').length) || null;
  const changed = changedFiles(project);
  const plan = arm === 'plain' ? null : planStats(project, calls);
  const lineState = (f) => f.startsWith('line/');
  const direct = plan ? changed.filter((f) => !lineState(f) && !plan.landedFiles.includes(f)) : [];
  let reuse = null;
  if (arm !== 'plain') {
    const { readLineProject } = await import('../../packages/engine/line/model.mjs');
    const p = readLineProject(project);
    const items = p.features.flatMap((f) => f.items).filter((i) => !['usecases', 'services', 'domains'].includes(i.kind));
    reuse = { featureItems: items.length, basedOnLibrary: items.filter((i) => i.base?.libraryId).length, share: items.length ? Number((items.filter((i) => i.base?.libraryId).length / items.length).toFixed(2)) : null };
  }
  const acc = acceptance(logs);
  const tok = tokens(builder, usage, model);
  const result = {
    builder, arm, model, at: new Date().toISOString(),
    wallMs, turns, tokens: tok,
    tokensPerLandedStep: tok.total !== null && plan?.landed ? Math.round(tok.total / plan.landed) : null,
    tokensPerPassedTest: tok.total !== null && acc.passed ? Math.round(tok.total / acc.passed) : null,
    plan: plan ? { ...plan, landedFiles: undefined } : null,
    validate: await validateCounts(project, arm),
    tsc: o['no-tsc'] ? { errors: null, note: 'skipped' } : tscErrors(project),
    acceptance: acc,
    loc: loc(project, changed), filesChanged: changed.length,
    duplicates: duplicates(project, changed),
    libraryReuse: reuse,
    humanInterventions: Number(o.human ?? 0) + direct.length, directWrites: direct,
    lineModelUse: arm === 'plain' ? null : lineModelUse(project),
    contention: o.contention ?? null,
  };
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, `${builder}.json`), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, file: `results/${builder}.json`, acceptance: acceptanceText(acc), landed: plan?.landed ?? null }));
}

const fmt = (n, d = 0) => (n === null || n === undefined ? '–' : typeof n === 'number' ? n.toLocaleString('en-US', { maximumFractionDigits: d }) : String(n));
const mins = (ms) => (ms ? `${(ms / 60000).toFixed(1)} min` : '–');
const usd = (n) => (n === null || n === undefined ? '–' : `$${n.toFixed(2)}`);

/** RESULTS.md from every results/*.json: one table per concern, arms side by side per model, deltas, notes. */
function report() {
  const all = fs.existsSync(RESULTS) ? fs.readdirSync(RESULTS).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(RESULTS, f))).filter(Boolean) : [];
  const rows = all.sort((a, b) => a.builder.localeCompare(b.builder));
  const L = [];
  L.push('# E-commerce bench: results', '', `Generated by \`node bench/ecommerce/metrics.mjs report\` from \`results/*.json\` on ${new Date().toISOString().slice(0, 10)}. Do not edit by hand.`, '');
  if (!rows.length) L.push('No results yet. Each run writes `results/<builder>.json` with `metrics.mjs collect`.', '');
  L.push('## Tokens (headline)', '', '| Builder | Model | Input | Output | Cache read | Cache write | Total | Per landed step | Per passed test | Est. cost | Wall time |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of rows) L.push(`| ${r.builder} | ${r.model ?? '–'} | ${fmt(r.tokens.input)} | ${fmt(r.tokens.output)} | ${fmt(r.tokens.cacheRead)} | ${fmt(r.tokens.cacheWrite)} | ${fmt(r.tokens.total)} | ${fmt(r.tokensPerLandedStep)} | ${fmt(r.tokensPerPassedTest)} | ${usd(r.tokens.costUsd)} | ${mins(r.wallMs)} |`);
  L.push('', 'Line\'s own model use during each build (drafter, jev, Qwen inside Construct), kept apart from the builder\'s tokens:', '', '| Builder | Calls | Tokens in | Tokens out | Note |', '| --- | ---: | ---: | ---: | --- |');
  for (const r of rows.filter((x) => x.lineModelUse)) L.push(`| ${r.builder} | ${r.lineModelUse.calls} | ${r.lineModelUse.tokensIn} | ${r.lineModelUse.tokensOut} | ${r.lineModelUse.note} |`);
  L.push('', '## Outcome', '', '| Builder | Arm | Acceptance | Turns | Steps added | Landed | Refused (add / run) | Fixes (by id: sent / landed) | Validate errors / warnings | tsc errors | LOC | Duplicate pairs | Library reuse | Human interventions |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of rows) {
    const p = r.plan;
    L.push(`| ${r.builder} | ${r.arm} | ${acceptanceText(r.acceptance)} | ${fmt(r.turns)} | ${p ? p.added : 'n/a'} | ${p ? p.landed : 'n/a'} | ${p ? `${p.refusedAtAdd} / ${p.refusedAtRun}` : 'n/a'} | ${p ? `${p.fixesApplied} (${p.fixesById ? `${p.fixesById.sent} / ${p.fixesById.landed}` : 'n/a'})` : 'n/a'} | ${r.validate.errors} / ${r.validate.warnings} | ${fmt(r.tsc.errors)} | ${r.loc} | ${r.duplicates.pairs} | ${r.libraryReuse?.share ?? 'n/a'} | ${r.humanInterventions} |`);
  }
  const refusals = rows.filter((r) => r.plan && Object.keys(r.plan.refusedByRule).length);
  if (refusals.length) {
    L.push('', 'Refusals by rule (add-time codes are prefixed `add:`):', '');
    for (const r of refusals) L.push(`- ${r.builder}: ${Object.entries(r.plan.refusedByRule).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  // Arms side by side per model: <model>-plain against <model>.
  const pairs = rows.filter((r) => r.arm === 'plain').map((pl) => [rows.find((x) => x.builder === pl.builder.replace(/-plain$/, '')), pl]).filter(([l]) => l);
  L.push('', '## With Line and without, per model', '', '| Model | Acceptance (Line / plain / Δ) | Tokens total (Line / plain / Δ) | Wall time (Line / plain) | tsc errors (Line / plain) | Line rules broken (Line / plain) | Duplicate pairs (Line / plain) |', '| --- | --- | --- | --- | --- | --- | --- |');
  if (!pairs.length) L.push('| – | no paired runs yet | | | | | |');
  for (const [l, p] of pairs) {
    const d = (a, b) => (a === null || b === null || a === undefined || b === undefined ? '–' : `${a - b >= 0 ? '+' : ''}${fmt(a - b)}`);
    const ap = (a) => (a.ran === false ? null : a.passed);
    L.push(`| ${l.builder} | ${ap(l.acceptance) ?? acceptanceText(l.acceptance)} / ${ap(p.acceptance) ?? acceptanceText(p.acceptance)} / ${d(ap(l.acceptance), ap(p.acceptance))} | ${fmt(l.tokens.total)} / ${fmt(p.tokens.total)} / ${d(l.tokens.total, p.tokens.total)} | ${mins(l.wallMs)} / ${mins(p.wallMs)} | ${fmt(l.tsc.errors)} / ${fmt(p.tsc.errors)} | ${l.validate.errors} / ${p.validate.errors} | ${l.duplicates.pairs} / ${p.duplicates.pairs} |`);
  }
  L.push('', '## Prices used', '', `${PRICES.source}. Date: ${PRICES.date}.`, '', '| Model | Input $/M | Output $/M | Cache read $/M | Cache write $/M | Note |', '| --- | ---: | ---: | ---: | ---: | --- |');
  for (const [m, p] of Object.entries(PRICES.models)) L.push(`| ${m} | ${p.in} | ${p.out} | ${p.cacheRead} | ${p.cacheWrite} | ${p.note ?? ''} |`);
  L.push('', '## Notes', '',
    '- claude-ui builds through Cockpit\'s UI only; it has no plain-arm twin, because Cockpit is Line.',
    '- The two Qwen runs share one local model (Ollama on this machine): they run one after the other, never at the same time; a run that overlapped another local model load records it under `contention` in its JSON.',
    '- "Line rules broken" on the plain arm is `validate --profile line` run on the plain build as a measurement only; the plain builder never saw those rules.',
    '- Duplicate pairs: component files the build added or changed whose token sets overlap 90% or more (8+ code lines).',
    '- Human interventions must be 0. For the Line arm it also counts every project file changed outside a landed plan step (a direct write).',
    '- Acceptance totals count Playwright tests; CHK-4 and CHK-5 share one test.',
  );
  for (const r of rows.filter((x) => x.contention)) L.push(`- ${r.builder}: ${r.contention}`);
  fs.writeFileSync(path.join(here, 'RESULTS.md'), `${L.join('\n')}\n`);
  console.log(JSON.stringify({ ok: true, file: 'RESULTS.md', builders: rows.length }));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = flags(process.argv.slice(2));
  if (o._[0] === 'collect') await collect(o);
  else if (o._[0] === 'report') report();
  else if (o._[0] === 'acceptance') {
    // run-acceptance.sh's summary line: node metrics.mjs acceptance <report.json> [acceptance.log]
    let log = ''; try { log = o._[2] ? fs.readFileSync(o._[2], 'utf8') : ''; } catch { /* none */ }
    const a = acceptanceOf(readJson(o._[1] ?? ''), acceptanceTotal(), log);
    console.log(JSON.stringify({ ran: a.ran, status: a.status, passed: a.passed, total: a.total }));
  }
  else { console.error('usage: metrics.mjs collect --builder <id> --arm line|plain|ui --run <dir> [...] | report | acceptance <report.json> [acceptance.log]'); process.exit(2); }
}
