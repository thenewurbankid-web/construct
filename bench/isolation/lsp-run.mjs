#!/usr/bin/env node
// #943 -- Line LSP isolation run: the LSP's calls measured as harness setups on the same 12 tasks (and the K3 / quick
// tasks for the rules and Smith layers). One run through heavy.sh writes results/lsp-r1.{jsonl,md} (r1.jsonl's row
// format, plus an `lsp` field) and appends gate-passing fills to results/triples.jsonl.
//
//   ATOMIC_CODEMOD_SOURCE_DIR=~/Repositories/atomic-codemod SMITH_SOURCE_DIR=~/Repositories/smith \
//     <og-final-1012>/packages/tools/dev/heavy.sh node bench/isolation/lsp-run.mjs
//   node bench/isolation/lsp-run.mjs --only latency,smith       # the model-free parts
//
// Setups (baseline in brackets): L-fix [B] B plus fixes() after the reply is applied; L-enum [L-enum-free] the 1.5b
// picks from completionsAt's enum at r1's failure points; L-brief [H] briefBuilder with quickInfo types; L-gather
// [read files] qwen3:4b with definition/references as its only tools; L-rules [L-rules-free] K3 with the nextSteps
// enum; L-smith [hand labels] smithDiagnostics on the 4 quick tasks x (reference + 2 mutants); L-gate [H] H with
// atomicGate as the sampler's third filter; L-norm [L-gate] a gate-failing fill normalized by atomic-codemod plug().
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as config from './config.mjs';
import * as run from './run.mjs';
import * as L from '../../packages/engine/lsp/index.mjs';
import { clearHostCache } from '../../packages/engine/lsp/host.mjs';
import { atomicGate } from '../../packages/engine/lsp/gate.mjs';
import * as S from '../../packages/engine/lsp/smith.mjs';
import { nextSteps, ruleDiagnostics } from '../../packages/engine/lsp/rules.mjs';
import { createLineLsp } from '../../packages/engine/lsp/server.mjs';
import { buildBriefs } from './blocks/briefBuilder.mjs';
import { spliceFunction } from './blocks/spliceApplier.mjs';
import { ts, parse, declName } from './lib/edit.mjs';
import { CASES as K3, materialize, buildFacts, SYSTEM as K3_SYSTEM, userPrompt as k3Prompt, schemaFor as k3Schema } from './chain/quick/k3.mjs';
import { TASKS as QUICK } from './chain/quick/tasks.mjs';
import { planSentence } from './chain/quick/lib/smith.mjs';
import { makeTriple, appendTriples } from './lsp/triples.mjs';

const RUN = 'lsp-r1';
run.setRunName(RUN);
const HERE = run.HERE;
const RESULTS = run.RESULTS;
const NM = path.resolve(HERE, '..', '..', 'node_modules');
const LO = { extraRoots: [NM] };
const args = process.argv.slice(2);
const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? new Set(args[i + 1].split(',')) : null; })();
const want = (k) => !only || only.has(k);
const taskIds = (() => { const i = args.indexOf('--tasks'); return i >= 0 ? new Set(args[i + 1].split(',')) : null; })();
const TASKS = run.tasks.filter((t) => !taskIds || taskIds.has(t.id));
const tok = config.approxTokens;
const rows = [];
const notes = {};
const triples = [];
const finals = new Map(); // `${arm}|${task}` -> { body, fns: [{name, sampleIdx}] }

// ------------------------------------------------------------------ Ollama (single-turn, `format` when given)
const DRY = args.includes('--dry'); // wiring check: every model call answers empty, nothing reaches Ollama
async function ollama({ model, system, user, messages, format, options = {}, tools, think }) {
  if (model === 'fable') throw new Error('model "fable" is not allowed');
  if (DRY) return { message: { role: 'assistant', content: '' }, content: '', json: null, tokensIn: 0, tokensOut: 0, ms: 0 };
  const t0 = Date.now();
  const res = await fetch(`${config.ollama.url}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(config.ollama.timeoutMs),
    body: JSON.stringify({ model, stream: false, keep_alive: config.ollama.keepAlive, format, tools, ...(think === undefined ? {} : { think }),
      options: { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 512, ...options },
      messages: messages ?? [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const j = await res.json();
  let json = null;
  if (format) { try { json = JSON.parse(j.message?.content ?? ''); } catch { json = null; } }
  return { message: j.message ?? {}, content: j.message?.content ?? '', json, tokensIn: j.prompt_eval_count ?? 0, tokensOut: j.eval_count ?? 0, ms: Date.now() - t0 };
}
async function embed(input) {
  if (DRY) return input.map(() => [1, 0]);
  const res = await fetch(`${config.ollama.url}/api/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'nomic-embed-text', input, keep_alive: '10m' }) });
  if (!res.ok) throw new Error(`embed ${res.status}`);
  return (await res.json()).embeddings;
}
const row = (arm, task, r) => ({ run: RUN, arm, armLabel: LABELS[arm], task, pass: false, failClass: null, detail: null, attempts: 1, tokensIn: 0, tokensOut: 0,
  tokensByRole: { driver: { in: 0, out: 0 }, coder: { in: 0, out: 0 } }, modelMs: 0, wallMs: 0, calls: 0, tscErrors: null, checkFailures: null, ...r });
const LABELS = {
  B: '7b driver -> 1.5b (r1 B, rerun)', 'L-fix': 'B + LSP fixes() after the reply',
  'L-enum-free': '1.5b free text at r1 failure points', 'L-enum': '1.5b picks from the completionsAt enum',
  H: 'blocks: briefBuilder -> 1.5b best-of-5 (rerun)', 'L-brief': 'H with quickInfo/signatureAt types in the brief',
  'L-gate': 'H + atomicGate as the third filter', 'L-norm': 'L-gate + atomic-codemod plug() on a gate-failing fill',
  'L-gather-files': 'context by reading files (B driver input)', 'L-gather-det': 'definition + quickInfo per context export, no model', 'L-gather': 'qwen3:4b gatherer, definition/references only',
  'L-rules-free': 'K3: 1.5b, free schema (steps x targets x reasons)', 'L-rules': 'K3: 1.5b picks from the nextSteps enum', 'L-rules-det': 'K3: nextSteps alone, no model',
  'L-smith-exact': 'smithDiagnostics, exact template match', 'L-smith-embed': 'smithDiagnostics + nomic-embed-text fallback',
};
const wsOf = (arm, task) => path.join(HERE, '.work', RUN, arm, task.id);

// ------------------------------------------------------------------ latency (no model)
const lat = {};
const time = (k, fn) => { const t0 = performance.now(); const r = fn(); const ms = performance.now() - t0; (lat[k] ??= []).push(ms); return r; };
async function latency() {
  const task = TASKS.find((t) => t.id === 't07-picks-page-list') ?? TASKS[0];
  const ws = wsOf('latency', task);
  run.makeWorkspace(ws, task);
  const bad = fs.readFileSync(path.join(RESULTS, 'r1-raw/B/t07-picks-page-list/attempt-1.tsx'), 'utf8');
  const calls = {
    diagnostics: () => L.diagnostics(ws, task.target, LO),
    fixes: () => L.fixes(ws, task.target, { ...LO, text: bad }),
    completionsAt: () => L.completionsAt(ws, task.target, '/*H*/', { ...LO, text: `${fs.readFileSync(path.join(ws, task.target), 'utf8')}\nconst z = listPi/*H*/` }),
    quickInfo: () => L.quickInfo(ws, 'features/picks/store/picksStore.ts', 'listPicks', LO),
    signatureAt: () => L.signatureAt(ws, 'features/picks/store/picksStore.ts', { symbol: 'removePick' }, LO),
    definition: () => L.definition(ws, task.target, 'ListPage', LO),
    references: () => L.references(ws, 'features/picks/store/picksStore.ts', 'listPicks', LO),
  };
  const out = {};
  for (const [k, fn] of Object.entries(calls)) {
    clearHostCache();
    const t0 = performance.now(); const r = fn(); const cold = performance.now() - t0;
    const w = []; for (let i = 0; i < 5; i++) { const t1 = performance.now(); fn(); w.push(performance.now() - t1); }
    out[k] = { cold: Math.round(cold), warm: Math.round(median(w)), ok: r.ok !== false, outTokens: tok(JSON.stringify(r)) };
  }
  // rules + Smith + the dynamic index, on the K3 snapshot (a Line project)
  const root = materialize(K3[6]);
  try {
    let t0 = performance.now(); ruleDiagnostics(root, 'features/browse/domains/sortByTitle.ts'); const rc = performance.now() - t0;
    t0 = performance.now(); ruleDiagnostics(root, 'features/browse/domains/sortByTitle.ts'); const rw = performance.now() - t0;
    out.ruleDiagnostics = { cold: Math.round(rc), warm: Math.round(rw), ok: true };
    t0 = performance.now(); const n1 = nextSteps(root, { need: 'browse/domains/pageOf', from: 'browse' }); const nc = performance.now() - t0;
    t0 = performance.now(); nextSteps(root, { need: 'browse/domains/pageOf', from: 'browse' }); const nw = performance.now() - t0;
    out.nextSteps = { cold: Math.round(nc), warm: Math.round(nw), ok: n1.ok };
    if (S.smithReady()) {
      t0 = performance.now(); const srv = await createLineLsp(root, { extraRoots: [NM] }); const build = performance.now() - t0;
      const rel = 'features/browse/domains/pageOf.ts';
      fs.writeFileSync(path.join(root, rel), 'export function pageOf(items: string[], page: number): string[] {\n  return items.slice(page * 6, page * 6 + 6);\n}\n');
      const u = await srv.update([rel]);
      const sym = srv.symbol('browse/domains/pageOf');
      out.index = { build: Math.round(build), incremental: u.ms, functions: srv.size.functions, newInAllLayers: !!(sym.ts && sym.smith?.length && Array.isArray(sym.rules)) };
      t0 = performance.now(); srv.smithReferences('browse/domains/pageOf'); out.smithReferences = { cold: 0, warm: Math.round(performance.now() - t0), ok: true };
      t0 = performance.now(); srv.smithDefinition(sym.smith[0]); out.smithDefinition = { cold: 0, warm: Math.round(performance.now() - t0), ok: true };
      t0 = performance.now(); S.smithCompletions({ kind: 'function', names: ['items', 'page'], intent: 'one page of the list' }); out.smithCompletions = { cold: 0, warm: Math.round(performance.now() - t0), ok: true };
      t0 = performance.now(); await srv.smithDiagnostics({ 'browse/domains/pageOf': ['It returns items slice page * 6 and page * 6 + 6.'] }); out.smithDiagnostics = { cold: 0, warm: Math.round(performance.now() - t0), ok: true };
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      t0 = performance.now(); await atomicGate({ rel, source: src, fn: 'pageOf' }); const gc = performance.now() - t0;
      t0 = performance.now(); await atomicGate({ rel, source: src, fn: 'pageOf' }); out.atomicGate = { cold: Math.round(gc), warm: Math.round(performance.now() - t0), ok: true };
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  notes.latency = out;
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };

// ------------------------------------------------------------------ L-fix: B, then fixes() on the applied reply
function addArms() {
  Object.assign(config.arms, {
    'L-fix': { ...config.arms.B, label: LABELS['L-fix'], strategy: 'drivenFix', key: 'L-fix' },
    H5: { ...config.arms.H, key: 'H', strategy: 'lspBlocks' },
    'L-brief': { ...config.arms.H, label: LABELS['L-brief'], key: 'L-brief', strategy: 'lspBlocks', lspBrief: true },
    'L-gate': { ...config.arms.H, label: LABELS['L-gate'], key: 'L-gate', strategy: 'lspBlocks', gate: true },
    'L-norm': { ...config.arms.H, label: LABELS['L-norm'], key: 'L-norm', strategy: 'lspBlocks', gate: true, norm: true },
  });
  run.strategies.drivenFix = async (arm, ctx) => {
    const task = ctx.material.task;
    const base = await run.strategies.driven(arm, ctx);
    const baseRow = { pass: base.pass, failClass: base.failClass, detail: base.detail ?? null, tscErrors: base.tsc?.errors?.slice(0, 8) ?? null, checkFailures: base.check?.failures ?? null };
    if (!base.parsed?.ok) return { ...base, lsp: { base: baseRow, applied: [], fixMs: 0 } };
    const ws = wsOf('L-fix', task);
    const t0 = performance.now();
    const f = L.fixes(ws, task.target, { ...LO, text: base.parsed.body });
    const fixMs = performance.now() - t0;
    if (base.pass || !f.ok || !f.edits.length) {
      finals.set(`B|${task.id}`, base.pass ? { body: base.parsed.body, sampleIdx: 0 } : null);
      finals.set(`L-fix|${task.id}`, base.pass ? { body: base.parsed.body, sampleIdx: 0 } : null);
      return { ...base, lsp: { base: baseRow, applied: f.applied ?? [], unfixed: f.unfixed?.length ?? null, fixMs: Math.round(fixMs) } };
    }
    const fixed = L.applyFixEdits(base.parsed.body, f.edits);
    const ev = ctx.evaluate({ ok: true, body: fixed }, 'fixed');
    finals.set(`B|${task.id}`, null);
    finals.set(`L-fix|${task.id}`, ev.pass ? { body: fixed, sampleIdx: 0 } : null);
    return { ...ev, lsp: { base: baseRow, applied: f.applied, unfixed: f.unfixed.length, fixMs: Math.round(fixMs) } };
  };

  // H / L-brief / L-gate / L-norm: the blocks strategy, with the LSP brief and the gate plugged in through ctx
  run.strategies.lspBlocks = async (arm, ctx) => {
    const task = ctx.material.task;
    const ws = wsOf(arm.key === 'H' ? 'H5' : arm.key, task);
    const lspInfo = { briefMs: 0, gate: [], norm: [] };
    if (arm.lspBrief) ctx.buildBriefs = (a) => { const t0 = performance.now(); const b = lspBriefs(a, ws); lspInfo.briefMs += performance.now() - t0; return b; };
    if (arm.gate) {
      ctx.gate = async (body, fn) => {
        const g = await atomicGate({ rel: task.target, source: body, fn });
        const rec = { fn, pass: g.pass, failed: g.failed, exempt: g.exempt, ms: g.ms };
        if (!g.pass && arm.norm) rec.norm = await normalize(body, fn, task, ctx);
        lspInfo.gate.push(rec);
        return { pass: g.pass || (arm.norm && rec.norm?.landable), failed: g.failed, smith: g.smith };
      };
    }
    const ev = await run.strategies.blocks(arm, ctx);
    const picked = (ev.gateLog ?? []).filter((x) => x.prePass && (!x.gate || x.gate.pass));
    finals.set(`${arm.key}|${task.id}`, ev.pass ? { body: ev.finalBody, sampleIdx: picked.at(-1)?.i ?? 0 } : null);
    return { ...ev, lsp: { ...lspInfo, briefMs: Math.round(lspInfo.briefMs) } };
  };
}

// L-brief: briefBuilder's brief with its TYPES IN SCOPE section built from quickInfo (each context export's exact type)
function lspBriefs(a, ws) {
  const out = buildBriefs(a);
  const { task } = a;
  const lines = [];
  const local = parse(a.file, task.target).statements.filter((s) => ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s)).map((s) => s.getText());
  lines.push(...local, ...out.prelude.filter((l) => l.startsWith('type ')));
  for (const p of task.context.filter((x) => /\.tsx?$/.test(x))) {
    const names = parse(a.read(p), p).statements.filter((s) => s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).map(declName).filter(Boolean);
    const qs = names.map((n) => L.quickInfo(ws, p, n, LO)).filter((q) => q.ok).map((q) => q.type.replace(/^\(alias\) /, ''));
    if (qs.length) lines.push(`// ${p}\n${qs.join('\n')}`);
  }
  const types = lines.join('\n\n');
  for (const b of out.briefs) {
    b.brief = b.brief.replace(/TYPES IN SCOPE:\n[\s\S]*?\n\nHOW \(/, `TYPES IN SCOPE:\n${types}\n\nHOW (`);
    b.approxTokens = config.approxTokens(b.brief);
  }
  return out;
}

// L-norm: atomic-codemod's plug() on the function, spliced back, then gate + tsc + check again
let plugMod;
async function normalize(body, fn, task, ctx) {
  try {
    plugMod ??= createRequire(import.meta.url)(path.join(process.env.ATOMIC_CODEMOD_SOURCE_DIR?.replace(/^~/, process.env.HOME) ?? '', 'plug.js'));
    const sf = parse(body, task.target);
    const st = sf.statements.find((s) => declName(s) === fn);
    if (!st) return { ok: false, why: 'function not found' };
    const plugged = plugMod.plug(st.getText(sf));
    const code = typeof plugged === 'string' ? plugged : plugged?.code ?? String(plugged);
    if (code.trim() === st.getText(sf).trim()) return { ok: true, changed: false, landable: false };
    const sp = spliceFunction(body, `\`\`\`tsx\n${code}\n\`\`\``, fn, task.target);
    if (!sp.ok) return { ok: false, why: sp.detail };
    const g = await atomicGate({ rel: task.target, source: sp.body, fn });
    const ev = ctx.evaluate({ ok: true, body: sp.body }, `norm-${fn}`);
    return { ok: true, changed: true, gatePass: g.pass, failed: g.failed, tsc: ev.tsc?.ok === true, check: ev.check?.ok === true, landable: g.pass && ev.pass };
  } catch (e) { return { ok: false, why: String(e?.message ?? e).slice(0, 120) }; }
}

async function armRuns() {
  addArms();
  const plan = [['L-fix', want('fix')], ['H5', want('blocks')], ['L-brief', want('blocks')], ['L-gate', want('gate')], ['L-norm', want('gate') && S.smithReady()]];
  for (const [arm, on] of plan) {
    if (!on) continue;
    for (const task of TASKS) {
      const r = await run.runArm(arm, task);
      if (arm === 'L-fix') {
        rows.push({ ...r, arm: 'B', armLabel: LABELS.B, ...r.lsp.base, lsp: undefined });
        rows.push({ ...r, armLabel: LABELS['L-fix'] });
      } else rows.push({ ...r, arm: arm === 'H5' ? 'H' : arm, armLabel: LABELS[arm === 'H5' ? 'H' : arm] });
      console.log(`${RUN} ${arm} ${task.id}: ${r.pass ? 'pass' : `FAIL ${r.failClass}`} ${r.tokensIn}/${r.tokensOut} tok`);
    }
  }
}

// ------------------------------------------------------------------ L-enum: r1's failure points, free text vs enum
function failurePoints() {
  const r1 = fs.readFileSync(path.join(RESULTS, 'r1.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const pts = []; const seen = new Set();
  for (const r of r1.filter((x) => x.failClass === 'tsc')) {
    const task = run.tasks.find((t) => t.id === r.task);
    const att = path.join(RESULTS, 'r1-raw', r.arm, r.task, `attempt-${r.attempts}.${task.target.split('.').pop()}`);
    if (!fs.existsSync(att)) continue;
    const text = fs.readFileSync(att, 'utf8');
    const ws = wsOf('enum', task);
    run.makeWorkspace(ws, task);
    const sf = parse(text, task.target);
    const d = L.diagnostics(ws, task.target, { ...LO, text });
    for (const line of d.lines ?? []) {
      const m = /:(\d+):(\d+) TS(\d+) (.*)$/.exec(line);
      if (!m) continue;
      const [ln, col, code, msg] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4]];
      const pos = text.split('\n').slice(0, ln - 1).reduce((a, l) => a + l.length + 1, 0) + col - 1;
      let p = null;
      if (code === 2307) {
        const q = text[pos]; const end = text.indexOf(q, pos + 1);
        p = { kind: 'path', wrong: text.slice(pos + 1, end), text: `${text.slice(0, pos + 1)}/*HOLE*/${text.slice(end)}` };
      } else if (code === 2305 || code === 2724) {
        const w = /[\w$]+/.exec(text.slice(pos))[0];
        p = { kind: 'name', wrong: w, text: `${text.slice(0, pos)}/*HOLE*/${text.slice(pos + w.length)}` };
      } else if (code === 2339 || code === 2551) {
        const w = /[\w$]+/.exec(text.slice(pos))[0];
        p = { kind: 'member', wrong: w, text: `${text.slice(0, pos)}/*HOLE*/${text.slice(pos + w.length)}` };
      } else if (code === 2304) {
        const w = /[\w$]+/.exec(text.slice(pos))[0];
        const firstImport = sf.statements.find((s) => ts.isImportDeclaration(s))?.getStart(sf) ?? 0;
        p = { kind: 'import-source', wrong: w, name: w, orig: text, text: `${text.slice(0, firstImport)}import { ${w} } from '/*HOLE*/';\n${text.slice(firstImport)}` };
      }
      if (!p) continue;
      p.orig ??= text;
      const key = `${r.task}|${code}|${p.wrong}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pts.push({ ...p, code, msg, task, arm: r.arm, id: `${r.task}:${r.arm}:${code}:${p.wrong}` });
    }
  }
  return pts;
}

function enumFor(p, ws) {
  if (p.kind === 'import-source') {
    const probe = `${p.orig}\n;${p.name}`;
    const c = L.completionsAt(ws, p.task.target, probe.length, { ...LO, text: probe });
    const sources = [...new Set((c.items ?? []).filter((i) => i.name === p.name && i.from).map((i) => i.from))];
    if (sources.length) return { names: sources, ms: c.ms };
    const m = L.completionsAt(ws, p.task.target, '/*HOLE*/', { ...LO, text: p.text });
    return { names: (m.items ?? []).map((i) => i.name), ms: m.ms };
  }
  const c = L.completionsAt(ws, p.task.target, '/*HOLE*/', { ...LO, text: p.text });
  return { names: (c.items ?? []).map((i) => i.name), ms: c.ms };
}
const QUESTION = { path: 'the import path (module specifier) that belongs in <HOLE>', name: 'the exported name to import in <HOLE>', member: 'the property name that belongs in <HOLE>', 'import-source': 'the import path (module specifier) that belongs in <HOLE>' };
const errLines = (ws, p, text) => L.diagnostics(ws, p.task.target, { ...LO, text }).lines ?? [];
/** The fill is right when the file has fewer errors than before and no resolution error names the answer. */
const scoreFill = (p, ws, answer) => {
  const a = String(answer ?? '').trim().replace(/^[`'"]+|[`'"]+$/g, '').split('\n')[0];
  if (!a) return false;
  const before = errLines(ws, p, p.orig).length;
  const after = errLines(ws, p, p.text.replace('/*HOLE*/', a));
  return after.length < before && !after.some((l) => /TS(2307|2305|2724|2339|2551|2552) /.test(l) && l.includes(a));
};
async function enumRuns() {
  const pts = failurePoints();
  notes.enumPoints = pts.length;
  for (const p of pts) {
    const ws = wsOf('enum', p.task);
    run.makeWorkspace(ws, p.task);
    const e = enumFor(p, ws);
    const shown = p.text.split('\n').slice(0, 60).join('\n').replace('/*HOLE*/', '<HOLE>');
    const system = 'You are a TypeScript and React developer. You fill one hole in a file.';
    const user = `File ${p.task.target}:\n\`\`\`tsx\n${shown}\n\`\`\`\n\nWhat is ${QUESTION[p.kind]}? Reply with only that text.`;
    const free = await ollama({ model: config.models.coder, system, user });
    const freeAns = free.content.trim().replace(/^```\w*\n?|```$/g, '').trim();
    rows.push(row('L-enum-free', p.task.id, { pass: scoreFill(p, ws, freeAns), failClass: null, detail: `${p.id} -> ${freeAns.slice(0, 60)}`, tokensIn: free.tokensIn, tokensOut: free.tokensOut, tokensByRole: { driver: { in: 0, out: 0 }, coder: { in: free.tokensIn, out: free.tokensOut } }, modelMs: free.ms, wallMs: free.ms, calls: 1, lsp: { point: p.id, kind: p.kind } }));
    if (!e.names.length) { rows.push(row('L-enum', p.task.id, { pass: false, failClass: 'no-enum', detail: p.id, lsp: { point: p.id, kind: p.kind, enumSize: 0 } })); continue; }
    const r = await ollama({ model: config.models.coder, system, user: `${user}\nChoose one of: ${e.names.join(', ')}`, format: L.completionSchema(e.names) });
    const ans = r.json?.name ?? '';
    rows.push(row('L-enum', p.task.id, { pass: scoreFill(p, ws, ans), failClass: null, detail: `${p.id} -> ${ans}`, tokensIn: r.tokensIn, tokensOut: r.tokensOut, tokensByRole: { driver: { in: 0, out: 0 }, coder: { in: r.tokensIn, out: r.tokensOut } }, modelMs: r.ms, wallMs: r.ms + e.ms, calls: 1, lsp: { point: p.id, kind: p.kind, enumSize: e.names.length, enumMs: e.ms, enumHasRight: e.names.some((n) => scoreFill(p, ws, n)) } }));
    console.log(`${RUN} L-enum ${p.id}: free=${rows.at(-2).pass} enum=${rows.at(-1).pass} (${e.names.length})`);
  }
  for (const r of rows.filter((x) => x.arm.startsWith('L-enum'))) r.failClass = r.pass ? null : r.failClass ?? 'wrong';
}

// ------------------------------------------------------------------ L-gather: definition/references vs reading files
async function gatherRuns() {
  const tools = [
    ['definition', 'Where a symbol is declared: file, line and that one line.', { symbol: { type: 'string' } }],
    ['references', 'Where a symbol is used: file, line and that one line each.', { symbol: { type: 'string' } }],
    ['done', 'Finish with the facts the junior needs (names, types, import paths).', { notes: { type: 'string' } }],
  ].map(([name, description, properties]) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required: Object.keys(properties) } } }));
  for (const task of TASKS) {
    const ws = wsOf('gather', task);
    run.makeWorkspace(ws, task);
    const start = run.readWs(ws, task.target);
    const filesTok = task.context.reduce((a, p) => a + tok(run.readWs(ws, p)), 0);
    const ref = path.join(task.dir, 'reference', task.target);
    const needed = fs.existsSync(ref) ? parse(fs.readFileSync(ref, 'utf8'), task.target).statements.filter((s) => ts.isImportDeclaration(s) && /^\./.test(s.moduleSpecifier.text) && !/\.json$/.test(s.moduleSpecifier.text))
      .flatMap((s) => s.importClause?.namedBindings?.elements?.map((e) => e.name.text) ?? []) : [];
    const ctxText = task.context.map((p) => run.readWs(ws, p)).join('\n');
    const covered = (txt) => needed.filter((n) => new RegExp(`\\b${n}\\b`).test(txt)).length;
    rows.push(row('L-gather-files', task.id, { pass: covered(ctxText) === needed.length, detail: `covers ${covered(ctxText)}/${needed.length}`, lsp: { contextTokens: filesTok, needed: needed.length, covered: covered(ctxText) } }));
    const messages = [
      { role: 'system', content: '/no_think\nYou gather facts for a junior coder before it edits one file. Use only the tools, one call per turn: definition and references of the symbols the task needs (the components, store functions and types it must use), then done with short notes. At most 5 lookups.' },
      { role: 'user', content: `Task: ${task.goal}\n\nSpec: ${task.spec}\n\nFile ${task.target}:\n\`\`\`tsx\n${start}\n\`\`\`\n\nContext files you may look into by symbol: ${task.context.join(', ')}` },
    ];
    let gathered = ''; let ti = 0; let to = 0; let ms = 0; let calls = 0; let lookups = 0; let toolMs = 0;
    for (let turn = 0; turn < 7; turn++) {
      const r = await ollama({ model: config.models.toolDriver, messages, tools, think: false, options: { ...config.sampling.qwen3, num_predict: 2048 } }); // qwen3:4b still thinks in content with think:false; 512 cut it off before the tool call
      ti += r.tokensIn; to += r.tokensOut; ms += r.ms; calls++;
      messages.push(r.message);
      const tc = r.message.tool_calls ?? [];
      if (!tc.length) break;
      let done = false;
      for (const c of tc) {
        const name = c.function?.name; const a = c.function?.arguments ?? {};
        if (name === 'done') { gathered += `\n${a.notes ?? ''}`; done = true; break; }
        const t0 = performance.now();
        const res = name === 'definition' ? L.definition(ws, task.target, String(a.symbol ?? ''), LO) : name === 'references' ? L.references(ws, task.target, String(a.symbol ?? ''), LO) : { ok: false, reason: 'unknown tool' };
        toolMs += performance.now() - t0; lookups++;
        const txt = res.ok ? (res.locations ?? []).map((l) => `${l.file}:${l.line} ${l.text}`).join('\n') || 'no locations' : res.reason;
        gathered += `\n${txt}`;
        messages.push({ role: 'tool', tool_name: name, content: txt });
      }
      if (done) break;
    }
    rows.push(row('L-gather', task.id, { pass: covered(gathered) === needed.length, detail: `covers ${covered(gathered)}/${needed.length}`, tokensIn: ti, tokensOut: to, tokensByRole: { driver: { in: ti, out: to }, coder: { in: 0, out: 0 } }, modelMs: ms, wallMs: ms, calls,
      lsp: { contextTokens: tok(gathered), filesTokens: filesTok, needed: needed.length, covered: covered(gathered), lookups, toolMs: Math.round(toolMs) } }));
    console.log(`${RUN} L-gather ${task.id}: ${tok(gathered)} vs ${filesTok} tok, covers ${covered(gathered)}/${needed.length}`);
  }
}

// L-gather-det: the same two tools driven by a block instead of a model -- every export of every context file gets
// one definition() (its declaration line) and one quickInfo() (its exact type); no file is read whole.
async function gatherDetRuns() {
  for (const task of TASKS) {
    const ws = wsOf('gather', task);
    run.makeWorkspace(ws, task);
    const ref = path.join(task.dir, 'reference', task.target);
    const needed = fs.existsSync(ref) ? parse(fs.readFileSync(ref, 'utf8'), task.target).statements.filter((s) => ts.isImportDeclaration(s) && /^\./.test(s.moduleSpecifier.text) && !/\.json$/.test(s.moduleSpecifier.text))
      .flatMap((s) => s.importClause?.namedBindings?.elements?.map((e) => e.name.text) ?? []) : [];
    const filesTok = task.context.reduce((a, p) => a + tok(run.readWs(ws, p)), 0);
    const t0 = performance.now();
    let gathered = ''; let lookups = 0;
    for (const p of task.context.filter((x) => /\.tsx?$/.test(x))) {
      const names = parse(run.readWs(ws, p), p).statements.filter((s) => s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).map(declName).filter(Boolean);
      for (const n of names) {
        const d = L.definition(ws, p, n, LO); const q = L.quickInfo(ws, p, n, LO); lookups += 2;
        gathered += `\n${(d.locations ?? []).map((l) => `${l.file}:${l.line}`).join(' ')} ${q.ok ? q.type : n}`;
      }
    }
    const ms = performance.now() - t0;
    const covered = needed.filter((n) => new RegExp(`\\b${n}\\b`).test(gathered)).length;
    rows.push(row('L-gather-det', task.id, { pass: covered === needed.length, detail: `covers ${covered}/${needed.length}`, wallMs: Math.round(ms), lsp: { contextTokens: tok(gathered), filesTokens: filesTok, needed: needed.length, covered, lookups } }));
  }
}

// ------------------------------------------------------------------ L-rules: K3 with the nextSteps enum
async function rulesRuns() {
  for (const c of K3) {
    const root = materialize(c);
    try {
      const f = buildFacts(root, c);
      const t0 = performance.now();
      const n = nextSteps(root, { need: c.need, from: c.from });
      const nms = performance.now() - t0;
      const det = n.options[0] ?? {};
      const right = (x) => x && x.step === c.expect.step && x.target === c.expect.target;
      rows.push(row('L-rules-det', c.id, { pass: right(det), detail: `${det.step} ${det.target}`, wallMs: Math.round(nms), lsp: { options: n.options.length } }));
      const free = await ollama({ model: config.models.coder, system: K3_SYSTEM, user: k3Prompt(f.facts), format: k3Schema(f.candidates), options: { seed: 7, num_ctx: 4096 } });
      rows.push(row('L-rules-free', c.id, { pass: right(free.json), detail: JSON.stringify(free.json), tokensIn: free.tokensIn, tokensOut: free.tokensOut, tokensByRole: { driver: { in: 0, out: 0 }, coder: { in: free.tokensIn, out: free.tokensOut } }, modelMs: free.ms, wallMs: free.ms, calls: 1 }));
      const keys = n.schema.properties.option.enum;
      const r = await ollama({ model: config.models.coder, system: K3_SYSTEM, user: `${k3Prompt(f.facts)}\nAllowed Trace steps here (from Line's facts): ${keys.join('; ')}`, format: n.schema, options: { seed: 7, num_ctx: 4096 } });
      const pick = n.options[keys.indexOf(r.json?.option)];
      rows.push(row('L-rules', c.id, { pass: right(pick), detail: r.json?.option ?? null, tokensIn: r.tokensIn, tokensOut: r.tokensOut, tokensByRole: { driver: { in: 0, out: 0 }, coder: { in: r.tokensIn, out: r.tokensOut } }, modelMs: r.ms, wallMs: r.ms + Math.round(nms), calls: 1, lsp: { enumSize: keys.length } }));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
}

// ------------------------------------------------------------------ L-smith: smithDiagnostics vs hand-labelled gaps
// Hand labels (read from tasks.mjs): which functions of each code differ in behaviour from the plan.
export const SMITH_LABELS = Object.freeze({
  availability: [[], ['formatAvailability'], ['formatAvailability']],
  'picks-store': [[], ['addPick'], ['removePick']],
  paging: [[], ['pageOf'], ['pageOf', 'pageCount']],
  'sort-title': [[], ['sortByTitle'], ['sortByTitle']],
});
async function smithRuns(withEmbed) {
  if (!S.smithReady()) { notes.smith = 'atomic-codemod not linked'; return; }
  for (const t of QUICK) {
    const codes = [t.reference, ...t.mutants];
    for (const [k, code] of codes.entries()) {
      const idx = await S.smithIndexFile(`features/quick/domains/${t.id}.ts`, `${t.prelude ?? ''}${code}`);
      const proposal = Object.fromEntries(Object.entries(t.plan).map(([fn, lines]) => [fn, lines.map(planSentence)]));
      const label = SMITH_LABELS[t.id][k];
      for (const mode of withEmbed ? ['exact', 'embed'] : ['exact']) {
        const t0 = performance.now();
        const d = await S.smithDiagnostics(proposal, idx, mode === 'embed' ? { embed, threshold: 0.9 } : {});
        const ms = performance.now() - t0;
        const predicted = [...new Set([...d.missing, ...d.extra].map((x) => x.id.split(/[#/]/).pop()))].sort();
        const exact = JSON.stringify(predicted) === JSON.stringify([...label].sort());
        const tp = predicted.filter((x) => label.includes(x)).length;
        rows.push(row(`L-smith-${mode}`, `${t.id}#${k === 0 ? 'ref' : `m${k}`}`, { pass: exact, detail: `predicted [${predicted}] label [${label}]`, wallMs: Math.round(ms), calls: mode === 'embed' ? 1 : 0, lsp: { tp, fp: predicted.length - tp, fn: label.length - tp, fuzzy: d.fuzzy.length } }));
      }
    }
  }
}

// ------------------------------------------------------------------ triples: every fill that passed every gate
async function collectTriples() {
  if (!S.smithReady()) return;
  for (const [key, f] of finals) {
    if (!f) continue;
    const [setup, taskId] = key.split('|');
    const task = run.tasks.find((t) => t.id === taskId);
    const startPath = path.join(task.dir, 'start', task.target);
    const startFns = new Set(fs.existsSync(startPath) ? parse(fs.readFileSync(startPath, 'utf8'), task.target).statements.map(declName).filter(Boolean) : []);
    const tws = wsOf('triples', task);
    run.makeWorkspace(tws, task, f.body);
    const sf = parse(f.body, task.target);
    const fns = sf.statements.filter((s) => ts.isFunctionDeclaration(s) && s.body).map(declName).filter(Boolean);
    const imports = sf.statements.filter((s) => ts.isImportDeclaration(s)).map((s) => `add_import ${s.importClause?.getText(sf) ?? ''} from ${s.moduleSpecifier.getText(sf)}`.replace(/\s+/g, ' '));
    const rules = ruleDiagnostics(tws, task.target);
    for (const fn of fns) {
      const g = await atomicGate({ rel: task.target, source: f.body, fn });
      (notes.tripleGate ??= {})[setup] ??= { pass: 0, fail: 0, reasons: {} };
      const tg = notes.tripleGate[setup];
      if (!g.pass) { tg.fail++; for (const r of g.failed) tg.reasons[r] = (tg.reasons[r] ?? 0) + 1; continue; }
      tg.pass++;
      if (!g.smith.length && g.exempt) continue; // a template has no Smith sentences: not a Line-language triple
      const st = sf.statements.find((s) => declName(s) === fn);
      triples.push(makeTriple({
        task: task.id, setup, trace_node: `${task.target}#${fn}`, line_steps: [startFns.has(fn) ? 'complete_stub' : 'create'], scope_ops: imports,
        rule_ids: rules.ok ? rules.rules : [], smith: g.smith, code: st.getText(sf), stable_id: S.stableIdOf(task.target, fn),
        model: config.models.coder, sample_idx: f.sampleIdx ?? 0, gates: { tsc: true, check: true, atomic: true },
      }));
    }
  }
}

// ------------------------------------------------------------------ report
function report() {
  fs.mkdirSync(RESULTS, { recursive: true });
  // --merge: rerun some setups and keep every other row (and the notes) from the previous run
  const notesFile = path.join(RESULTS, `${RUN}.notes.json`);
  if (args.includes('--merge') && fs.existsSync(path.join(RESULTS, `${RUN}.jsonl`))) {
    const fresh = new Set(rows.map((r) => r.arm));
    const old = fs.readFileSync(path.join(RESULTS, `${RUN}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => !fresh.has(r.arm));
    rows.unshift(...old);
    const prev = fs.existsSync(notesFile) ? JSON.parse(fs.readFileSync(notesFile, 'utf8')) : {};
    for (const [k, v] of Object.entries(prev)) notes[k] ??= v;
  }
  fs.writeFileSync(notesFile, JSON.stringify(notes, null, 1) + '\n');
  fs.writeFileSync(path.join(RESULTS, `${RUN}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const appended = appendTriples(path.join(RESULTS, 'triples.jsonl'), triples);
  const allTriples = (fs.existsSync(path.join(RESULTS, 'triples.jsonl')) ? fs.readFileSync(path.join(RESULTS, 'triples.jsonl'), 'utf8') : '').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const by = (a) => rows.filter((r) => r.arm === a);
  const sum = (rs, k) => rs.reduce((x, r) => x + (r[k] ?? 0), 0);
  const line = (a, base) => {
    const rs = by(a); if (!rs.length) return null;
    const b = base ? by(base) : [];
    const p = rs.filter((r) => r.pass).length;
    const tokens = sum(rs, 'tokensIn') + sum(rs, 'tokensOut');
    const bt = sum(b, 'tokensIn') + sum(b, 'tokensOut');
    const extra = a.startsWith('L-gather') && a !== 'L-gather-files' ? `context ${sum(rs.map((r) => ({ v: r.lsp.contextTokens })), 'v')} vs files ${sum(rs.map((r) => ({ v: r.lsp.filesTokens })), 'v')} tok` : a.startsWith('L-brief') || a === 'H' ? `brief ${rs.reduce((x, r) => x + (r.briefTokens ?? []).reduce((y, z) => y + z, 0), 0)} tok` : '';
    const fails = (xs) => { const f = {}; for (const r of xs) if (!r.pass && r.failClass) f[r.failClass] = (f[r.failClass] ?? 0) + 1; const s = Object.entries(f).map(([k, v]) => `${k} ${v}`).join(", "); return s ? ` fails: ${s}` : ""; };
    return `| ${a} | ${LABELS[a] ?? ''} | ${p}/${rs.length} | ${base ? `${p - b.filter((r) => r.pass).length >= 0 ? '+' : ''}${p - b.filter((r) => r.pass).length} vs ${base}` : '-'} | ${tokens}${base ? ` (${tokens - bt >= 0 ? '+' : ''}${tokens - bt})` : ''} | ${sum(rs, 'calls')} | ${(sum(rs, 'wallMs') / 1000).toFixed(1)} s | ${extra}${fails(rs)} |`;
  };
  const gateRs = by('L-gate');
  const gateRecs = gateRs.flatMap((r) => r.lsp?.gate ?? []);
  const reasons = {}; for (const g of gateRecs.filter((x) => !x.pass)) for (const f of g.failed) reasons[f] = (reasons[f] ?? 0) + 1;
  const normRecs = by('L-norm').flatMap((r) => r.lsp?.gate ?? []).filter((g) => g.norm);
  const drawn = (a) => sum(by(a), 'attempts');
  const md = [
    `# Line LSP isolation ${RUN}`, '',
    `${new Date().toISOString().slice(0, 10)}. #943 (part of #941). Coder ${config.models.coder}, driver ${config.models.driver}, gatherer ${config.models.toolDriver}. Rows: \`${RUN}.jsonl\` (r1.jsonl's row format plus \`lsp\`). Command: see lsp-run.mjs header.`, '',
    '| Setup | | pass | delta | tokens (in+out) | model calls | wall | notes |', '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...[['B'], ['L-fix', 'B'], ['L-enum-free'], ['L-enum', 'L-enum-free'], ['H'], ['L-brief', 'H'], ['L-gate', 'H'], ['L-norm', 'L-gate'], ['L-gather-files'], ['L-gather', 'L-gather-files'], ['L-gather-det', 'L-gather-files'], ['L-rules-free'], ['L-rules', 'L-rules-free'], ['L-rules-det', 'L-rules-free'], ['L-smith-exact'], ['L-smith-embed', 'L-smith-exact']].map(([a, b]) => line(a, b)).filter(Boolean),
    '', '## L-gate', '',
    `Samples the judge passed (tsc, and the task check on a task's last function): ${gateRecs.length}; the gate rejected ${gateRecs.filter((g) => !g.pass).length} (${gateRecs.length ? Math.round(100 * gateRecs.filter((g) => !g.pass).length / gateRecs.length) : 0}%). Reasons (a sample can fail several): ${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}. Template-exempt: ${gateRecs.filter((g) => g.exempt).length}.`,
    `Samples drawn: H ${drawn('H')}, L-gate ${drawn('L-gate')} (+${drawn('L-gate') - drawn('H')}); wall H ${(sum(by('H'), 'wallMs') / 1000).toFixed(0)} s, L-gate ${(sum(gateRs, 'wallMs') / 1000).toFixed(0)} s; gate time ${Math.round(gateRecs.reduce((a, g) => a + g.ms, 0))} ms over ${gateRecs.length} calls.`,
    `L-norm: ${normRecs.length} gate-failing fills normalized by plug(); changed ${normRecs.filter((g) => g.norm.changed).length}, gate pass after ${normRecs.filter((g) => g.norm.gatePass).length}, still tsc-clean ${normRecs.filter((g) => g.norm.tsc).length}, landable ${normRecs.filter((g) => g.norm.landable).length}.`,
    '', '## Gate on every passing fill (triples)', '',
    ...Object.entries(notes.tripleGate ?? {}).map(([k, v]) => `- ${k}: ${v.pass} function(s) pass, ${v.fail} fail (${Object.entries(v.reasons).map(([a, b]) => `${a} ${b}`).join(', ') || '-'}); triples in triples.jsonl ${allTriples.filter((t) => t.setup === k).length}`),
    `- appended to results/triples.jsonl this run: ${appended}`,
    '', '## Call latency (ms; cold = first call on a fresh service, warm = median of 5)', '',
    '| call | cold | warm | output tokens |', '| --- | --- | --- | --- |',
    ...Object.entries(notes.latency ?? {}).filter(([k]) => k !== 'index').map(([k, v]) => `| ${k} | ${v.cold} | ${v.warm} | ${v.outTokens ?? '-'} |`),
    notes.latency?.index ? `\nDynamic index (K3 snapshot): full build ${notes.latency.index.build} ms (${notes.latency.index.functions} functions), incremental update after adding one function ${notes.latency.index.incremental} ms, new function in all three layers: ${notes.latency.index.newInAllLayers}.` : '',
    '', `L-enum points: ${notes.enumPoints ?? 0} from r1 (tsc failures of arms A-D: TS2307 path, TS2305/2724 name, TS2339/2551 member, TS2304 import source).`, '',
  ].join('\n');
  fs.writeFileSync(path.join(RESULTS, `${RUN}.md`), md);
  console.log(md);
}

// ------------------------------------------------------------------ main
if (want('latency')) await latency();
if (want('smith')) await smithRuns(!only || only.has('embed'));
if (want('rules')) await rulesRuns();
if (want('enum')) await enumRuns();
if (want('gather')) await gatherRuns();
if (want('gather') || want('gatherdet')) await gatherDetRuns();
await armRuns();
await collectTriples();
report();
