#!/usr/bin/env node
// #921 path-first proof: the path arm's only write path. Trace's path (path-points.mjs) is installed once into a seeded
// project; then a builder fills ONE stub body at a time (signature and imports locked) and each fill answers pass or the
// first failing example (packages/engine/line/path: static path check, purity, tsc, isolated dry run, examples, visual
// diff). Every call is recorded in calls.jsonl, like plan-cli.
//
//   path-cli.mjs install            write the contracts copy, the stubs, the wiring and line/path/path.json
//   path-cli.mjs status             the open stubs, bottom-up, each with its locked signature, context and examples
//   path-cli.mjs fill <stubId> --body '<body>' (or --body-file <f>)   fill one stub
//   path-cli.mjs check <point>      the whole path of CAT-2 or CART-1, end to end (edges, tsc, every stub, e2e render)
//   path-cli.mjs read <path>        one project file
//   path-cli.mjs report [turns.jsonl]   the measurement: fills per stub, first-try rate, model calls per point, which
//                                   layer caught what and its time, each point's end-to-end dry run, and the model's
//                                   passing bodies against the reference (fastCheckLayer / z3Layer)
//
// Project and log: --project <dir> (or BENCH_PROJECT), --log <file> (or BENCH_LOG), --builder <id> (or BENCH_BUILDER).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installPath, REFERENCE } from './path-points.mjs';
import { fill, openStubs, stubCard, fillLog } from '../../../packages/engine/line/path/fill.mjs';
import { checkPath, readPath, unitOf, PATH_FILE } from '../../../packages/engine/line/path/check.mjs';
import { stubParts } from '../../../packages/engine/line/path/stubs.mjs';
import { fastCheckLayer } from '../../../packages/engine/line/logicVerify/fastCheckLayer.mjs';
import { z3Layer } from '../../../packages/engine/line/logicVerify/z3Prove.mjs';

export const POINTS = Object.freeze(['CAT-2', 'CART-1']);

/** The path arm's system prompt: how to fill, then every open stub's card, bottom-up. */
export function pathPrompt(root) {
  const open = openStubs(root);
  return [
    'You fill typed stubs in a Next.js + React 18 + TypeScript shop, ONE function body at a time. Trace already built the path: the types, the wiring (pages, the cart provider, the layout, the routes) and a stub per missing function. Only the stub bodies are missing.',
    'Use the `fill` tool with {stubId, body}: body is ONLY the function body (the statements between its braces, or the block with its braces). The signature and the imports are locked: do not resend the signature, do not add imports; use only what the file already imports and plain TypeScript/JSX.',
    'Each fill runs the stub check (no placeholder left, every input used, a value returned), tsc, and the stub\'s examples, and answers pass or the FIRST failing example (input, expected, got) or the tsc error at its line. Fix exactly that and fill again.',
    'Fill the stubs in the order below (bottom-up). After a pass, go to the next stub. `check_path` runs one point end to end. Call `finish` when every stub passes or you cannot make more progress.',
    '', `## Open stubs, bottom-up (${open.length})`, '', ...open.map((u) => `${stubCard(root, u)}\n`),
  ].join('\n');
}

export function createPathCli({ project, log, builder }) {
  const root = path.resolve(project);
  const record = (e) => { if (log) { fs.mkdirSync(path.dirname(log), { recursive: true }); fs.appendFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), builder, ...e })}\n`); } };
  const commands = {
    install() {
      const r = installPath(root);
      return { ok: true, files: r.files.length, stubs: r.path.units.filter((u) => u.kind === 'stub').length, sentence: `Installed the path: ${r.path.units.filter((u) => u.kind === 'stub').length} stubs, ${r.path.units.filter((u) => u.kind === 'wiring').length} wired units, ${r.path.edges.length} edges, ${r.files.length} files.` };
    },
    status() {
      const open = openStubs(root);
      return { ok: true, open: open.map((u) => u.id), sentence: open.length ? `${open.length} open stubs, bottom-up:\n\n${open.map((u) => stubCard(root, u)).join('\n\n')}` : 'Every stub passes.' };
    },
    // what the model reads: pass or not, the next stub and one sentence with the first failure (fills.jsonl keeps the rest)
    async fill(id, o) {
      const r = await fill({ root, stubId: String(id ?? ''), body: String(o?.body ?? '') });
      return { ok: r.ok, ...(r.code ? { code: r.code } : {}), stubId: r.stubId, ...(r.ok ? { pass: r.pass, next: r.next } : {}), sentence: r.sentence };
    },
    async check(point) { const r = await checkPath(root, String(point ?? '')); return { ok: true, point: r.point, green: r.green, ...(r.failure ? { failure: r.failure } : {}), sentence: r.green ? `${point}: the whole path dry-runs green end to end.` : `${point}: not green. ${r.failure?.stub ? `Stub ${r.failure.stub}: ` : ''}${r.failure?.layer}: ${r.failure?.sentence ?? `${r.failure?.example ?? ''} expected ${r.failure?.expected ?? ''}, got ${r.failure?.got ?? ''}`}` }; },
    read(rel) {
      const f = path.resolve(root, String(rel ?? ''));
      if (!f.startsWith(root) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return { ok: false, code: 'NO_FILE', sentence: `There is no file ${rel} in the project.` };
      return { ok: true, path: rel, content: fs.readFileSync(f, 'utf8').slice(0, 64 * 1024), sentence: `${rel}.` };
    },
    async report(turnsFile) { return report(root, typeof turnsFile === 'string' ? turnsFile : path.join(path.dirname(root), 'logs', 'turns.jsonl')); },
  };
  return {
    root,
    async run(cmd, rest = [], o = {}) {
      const f = commands[cmd];
      if (!f) return { ok: false, code: 'UNKNOWN_COMMAND', sentence: `There is no path-cli command ${cmd}.` };
      const t0 = Date.now();
      const out = await f(...rest, o);
      record({ cmd, args: rest, ...(o.body ? { bodyChars: String(o.body).length } : {}), ok: out.ok, code: out.code ?? null, pass: out.pass ?? null, ms: Date.now() - t0 });
      return out;
    },
  };
}

/**
 * The measurement, from fills.jsonl (+ the agent's turns.jsonl for model calls per point).
 * @param {string} root
 * @param {string} [turnsFile]
 */
export async function report(root, turnsFile) {
  const p = readPath(root);
  const fills = fillLog(root);
  const stubs = p.units.filter((u) => u.kind === 'stub');
  const per = stubs.map((u) => {
    const mine = fills.filter((f) => f.stubId === u.id);
    const firstPass = mine.findIndex((f) => f.pass);
    return { id: u.id, point: u.point, fills: mine.length, passedAt: firstPass < 0 ? null : firstPass + 1, firstTry: firstPass === 0, failedBy: mine.filter((f) => !f.pass).map((f) => f.refused ?? f.failure?.layer ?? '?'), visual: mine.find((f) => f.visual)?.visual?.outcome ?? null };
  });
  const caught = {}; const ms = {};
  for (const f of fills) {
    const k = f.refused ? `refused:${f.refused}` : f.pass ? null : f.failure?.layer;
    if (k) caught[k] = (caught[k] ?? 0) + 1;
    for (const [l, v] of Object.entries(f.ms ?? {})) (ms[l] ??= []).push(v);
  }
  const avgMs = Object.fromEntries(Object.entries(ms).map(([l, v]) => [l, Math.round(v.reduce((a, b) => a + b, 0) / v.length)]));
  // model calls per point: each turn counts for the point of the stub it filled, or (no fill) of the next stub it fills
  const calls = Object.fromEntries(POINTS.map((pt) => [pt, 0]));
  if (turnsFile && fs.existsSync(turnsFile)) {
    let pending = 0;
    for (const t of fs.readFileSync(turnsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.kind === 'turn')) {
      const filled = (t.calls ?? []).filter((c) => c.name === 'fill').map((c) => { try { return JSON.parse(c.args).stubId; } catch { return /"stubId":"([^"]+)"/.exec(c.args)?.[1]; } }).find(Boolean);
      const pt = filled ? unitOf(p, filled)?.point : null;
      if (pt) { calls[pt] += 1 + pending; pending = 0; } else pending += 1;
    }
    calls.unattributed = pending;
  }
  const paths = {};
  for (const pt of POINTS) { const r = await checkPath(root, pt); paths[pt] = { green: r.green, ...(r.failure ? { failure: r.failure } : {}), ms: r.ms }; }
  // c) the model's passing bodies against the reference: equivalence beyond the examples (pure domain stubs only)
  const vsReference = {};
  for (const u of stubs.filter((x) => x.layer === 'domain')) {
    const source = fs.readFileSync(path.join(root, u.file), 'utf8');
    const parts = stubParts(source, u.fn);
    if (!parts || !REFERENCE[u.id]) continue;
    const refSource = source.slice(0, parts.bodyStart) + REFERENCE[u.id] + source.slice(parts.bodyEnd);
    const t0 = performance.now();
    const fc = fastCheckLayer({ beforeSource: refSource, afterSource: source, fn: u.fn, file: u.file });
    const z3 = await z3Layer({ beforeSource: refSource, afterSource: source, fn: u.fn, file: u.file }).catch((e) => ({ outcome: 'skipped', reason: String(e.message) }));
    vsReference[u.id] = { fastCheck: fc.outcome + (fc.reason ? ` (${fc.reason})` : ''), z3: z3.outcome + (z3.reason ? ` (${z3.reason})` : ''), ms: Math.round(performance.now() - t0) };
  }
  const passed = per.filter((s) => s.passedAt);
  return { ok: true, stubs: per, firstTryRate: `${per.filter((s) => s.firstTry).length}/${per.length}`, passed: `${passed.length}/${per.length}`, fills: fills.length, modelCallsPerPoint: calls, caughtBy: caught, avgMsPerLayer: avgMs, paths, vsReference,
    sentence: `${passed.length}/${per.length} stubs pass; first try ${per.filter((s) => s.firstTry).length}/${per.length}; ${POINTS.map((pt) => `${pt} ${paths[pt].green ? 'green' : 'not green'}`).join(', ')}.` };
}

function argv(a) {
  const o = { project: process.env.BENCH_PROJECT, log: process.env.BENCH_LOG, builder: process.env.BENCH_BUILDER ?? '' };
  const rest = [];
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === '--project') o.project = a[++i]; else if (a[i] === '--log') o.log = a[++i]; else if (a[i] === '--builder') o.builder = a[++i];
    else if (a[i] === '--body') o.body = a[++i]; else if (a[i] === '--body-file') o.body = fs.readFileSync(a[++i], 'utf8'); else rest.push(a[i]);
  }
  return { o, rest };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { o, rest } = argv(process.argv.slice(2));
  if (!o.project) { console.log(JSON.stringify({ ok: false, sentence: 'Set --project or BENCH_PROJECT.' })); process.exit(2); }
  if (rest[0] !== 'install' && !fs.existsSync(path.join(o.project, PATH_FILE))) { console.log(JSON.stringify({ ok: false, code: 'NO_PATH', sentence: 'The project has no path yet: run path-cli install first.' })); process.exit(1); }
  const cli = createPathCli({ project: o.project, log: o.log ?? path.join(path.dirname(path.resolve(o.project)), 'logs', 'calls.jsonl'), builder: o.builder });
  const out = await cli.run(rest[0], rest.slice(1), { body: o.body });
  console.log(JSON.stringify(out, null, 1));
  process.exit(out.ok ? 0 : 1);
}
