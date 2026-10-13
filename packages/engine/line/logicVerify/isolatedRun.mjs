// Line logic verification, spec D (step 4): the isolated effect runner. One unit before and after a step runs in a
// child-process sandbox (isolatedChild.cjs) under the recording fakes (fakes.mjs interfaces), on the same generated
// inputs, and the two records are compared: output shape (and value, for a primitive), thrown error, effects
// (fakes.mjs EffectRecord), state transitions and sentinels. Deterministic, no network, no LLM.
//
//   isolatedPair({beforeRoot, afterRoot, before, after}) -> the `isolated` LayerResult
//     same-behaviour  every case recorded the same on both sides
//     changed         the first case whose records differ, its input (shapes) and the recorded difference
//     cant-tell       a side tried an effect the fakes do not back (reported, never executed: NotFakedError at the
//                     access), the run hit the time limit (the child is killed), or a side could not be loaded
//
// The sandbox: a fresh temp dir under os.tmpdir() (construct-lv-isolated-*) as cwd, HOME and TMPDIR, removed after; node's
// permission model (reads limited to the child script, recorder.cjs and that dir; no fs writes, child processes or
// workers); code generation from strings off; an empty environment; a fresh vm context per run whose only effectful
// globals are the fakes; SIGKILL at the time limit.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ts } from '@construct/ast/lazy';
import { parseToAst } from '@construct/ast/parse';
import { findFunction } from './z3Translate.mjs';
import { locateUnitDifference } from './canonical.mjs';
import { FAKE_ENV, sentinel, assertUnitRun } from './fakes.mjs';
import { instrumentUnit, branchCoverage, coverageLevel } from './instrument.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHILD = fs.realpathSync(path.join(HERE, 'isolatedChild.cjs'));
const RECORDER = fs.realpathSync(path.resolve(HERE, '../graph/runtime/recorder.cjs'));
/** The default time limit for one pair (both sides, every case). */
export const ISOLATED_TIMEOUT_MS = 5000;
/** At most this many input cases per unit. */
export const MAX_CASES = 12;
// Branch coverage (#883) comes from instrumenting the unit's source here, before it is sent (instrument.mjs), never from
// V8 coverage: that needs --allow-inspector, or --allow-fs-write for NODE_V8_COVERAGE, on the sandboxed child (owner
// decision 2026-10-12: the sandbox stays tight; the child's flags are asserted by a test).
const HOOK_NAME = /^use[A-Z0-9]/;
const HANDLER_NAME = /^(?:handle|on)[A-Z]/;
/** React event type names to the generated event's type. */
const EVENT_TYPES = { ChangeEvent: 'change', MouseEvent: 'click', PointerEvent: 'click', KeyboardEvent: 'keydown', FormEvent: 'submit', SubmitEvent: 'submit', FocusEvent: 'blur', DragEvent: 'drop', WheelEvent: 'wheel', TouchEvent: 'touchstart', ClipboardEvent: 'paste' };
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const IDENT = /^[A-Za-z_$][\w$]*$/;

/**
 * Strip types, compile to CommonJS, and expose the unit (exported or not) as `__lineUnit`; the unit's file is
 * instrumented for branch coverage (instrument.mjs), and `blocks` is how many blocks it counts (0: not instrumented).
 * @returns {{code: string, blocks: number}}
 */
function compile(source, fn) {
  const cov = fn ? instrumentUnit(fn) : null;
  const out = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
    ...(cov ? { transformers: { before: [cov.transformer] } } : {}),
  }).outputText;
  return { code: fn ? `${out}\n;exports.__lineUnit = typeof ${fn} === 'function' ? ${fn} : (exports.${fn} ?? exports.default);` : out, blocks: cov?.blocks() ?? 0 };
}

/** The relative imports of a file, resolved inside `root`; a specifier that does not resolve is left out (refused). */
function resolveRelative(root, file, source, missing = []) {
  const out = {};
  for (const m of source.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1]));
    if (base.startsWith('..')) continue;
    const hit = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => `${base}/index${e}`)].find((f) => fs.existsSync(path.join(root, f)) && fs.statSync(path.join(root, f)).isFile());
    if (hit) out[m[1]] = hit;
    else missing.push(m[1]);
  }
  return out;
}

/**
 * One side as the child takes it: compiled modules (the unit's file and its relative imports), the resolution table,
 * per file the relative imports that resolve to no file (the child makes them recording spies), and how many blocks the
 * unit's instrumentation counts.
 */
function sideRequest(root, file, fn) {
  const modules = {};
  const resolved = {};
  const missing = {};
  let blocks = 0;
  const todo = [file];
  while (todo.length) {
    const f = /** @type {string} */ (todo.pop());
    if (f in modules) continue;
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const compiled = compile(src, f === file ? fn : null);
    modules[f] = compiled.code;
    if (f === file) blocks = compiled.blocks;
    resolved[f] = resolveRelative(root, f, src, (missing[f] = []));
    todo.push(...Object.values(resolved[f]));
  }
  return { entry: file, fn, modules, resolved, missing, blocks };
}

/**
 * The input cases: one argument vector per case, deterministic. Each parameter cycles through its typed example (an
 * object built from an inline type literal), its mined literals (minedSeeds' byParam) and then a fixed pool: a sentinel
 * string, 0, 1, -1, a large number, '', true, false, null and an object carrying sentinels, offset by the parameter's
 * index so parameters do not move in lockstep.
 * @param {Array<string|{name: string, example?: unknown, event?: string}>} params a handler's event parameter carries
 *   `event` (the generated event's type) and gets four generated events instead of the usual pool
 * @param {{byParam?: Record<string, unknown[]>}} [seeds]
 * @returns {unknown[][]}
 */
export function isolatedCases(params, seeds = {}) {
  if (!params.length) return [[]];
  const pools = params.map((p, i) => (typeof p === 'object' && p.event ? [0, 1, 2, 3].map((variant) => ({ __lineEvent: p.event, variant })) : [
    ...(typeof p === 'object' && p.example !== undefined ? [p.example] : []),
    ...(seeds.byParam?.[typeof p === 'string' ? p : p.name] ?? []),
    sentinel(FAKE_ENV.seed, i), 0, 1, -1, 1_000_000, '', true, false, null, { id: sentinel(FAKE_ENV.seed, 100 + i), name: sentinel(FAKE_ENV.seed, 200 + i) },
  ]));
  const n = Math.min(MAX_CASES, Math.max(...pools.map((p) => p.length)));
  return Array.from({ length: n }, (_, k) => pools.map((pool, j) => pool[(k + j) % pool.length]));
}

/**
 * Run the child under the sandbox, kill it at the time limit, and remove the temp dir.
 * @returns {Promise<{timedOut: boolean, code: number|null, stdout: string, stderr: string}>}
 */
async function runChild(request, timeoutMs) {
  // real paths: the permission model compares them after symlinks resolve (macOS's /var is /private/var)
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'construct-lv-isolated-')));
  try {
    fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify(request));
    const child = spawn(process.execPath, [
      '--permission', `--allow-fs-read=${CHILD}`, `--allow-fs-read=${RECORDER}`, `--allow-fs-read=${dir}`,
      '--disallow-code-generation-from-strings', '--max-old-space-size=256', CHILD,
    ], { cwd: dir, env: { HOME: dir, TMPDIR: dir, TZ: FAKE_ENV.timeZone, LANG: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const code = await new Promise((resolve) => child.on('close', (c) => resolve(c)));
    clearTimeout(timer);
    return { timedOut, code, stdout, stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A parameter's name and, when its annotation is an inline type literal, an example object: each string member a fresh
 * sentinel, each number 1, each boolean true (`order: {id: string; total: number}` -> {id: sentinel 0, total: 1}).
 */
function paramOf(p, nextSentinel) {
  const id = p.type === 'AssignmentPattern' ? p.left : p;
  const name = id.type === 'Identifier' ? id.name : '';
  const lit = id.typeAnnotation?.typeAnnotation;
  if (lit?.type !== 'TSTypeLiteral') return { name };
  const example = {};
  for (const m of lit.members) {
    if (m.type !== 'TSPropertySignature' || m.key.type !== 'Identifier') continue;
    const t = m.typeAnnotation?.typeAnnotation?.type;
    if (t === 'TSStringKeyword') example[m.key.name] = nextSentinel();
    else if (t === 'TSNumberKeyword') example[m.key.name] = 1;
    else if (t === 'TSBooleanKeyword') example[m.key.name] = true;
  }
  return { name, example };
}

/** The React event type a parameter's annotation names (`e: React.ChangeEvent<HTMLInputElement>` -> change), else null. */
function eventTypeOf(p) {
  const id = p?.type === 'AssignmentPattern' ? p.left : p;
  const t = id?.typeAnnotation?.typeAnnotation;
  if (t?.type !== 'TSTypeReference') return null;
  const name = t.typeName.type === 'TSQualifiedName' ? t.typeName.right.name : t.typeName.name;
  if (!/Event$/.test(String(name))) return null;
  return EVENT_TYPES[name] ?? 'event';
}

/**
 * How the runner calls a unit (contract.mjs RUN_AS): a hook (`useX`) under the headless hook harness; a handler (named
 * handleX / onX, or whose first parameter is typed as an event) with a generated event as its first argument; else
 * directly.
 * @param {string} name the unit's function name
 * @param {{params: any[]}} node the unit's function node (its first parameter's type annotation can make it a handler)
 * @returns {import('./contract.mjs').RunAs}
 */
export function runAsOf(name, node) {
  if (HOOK_NAME.test(name)) return 'hook';
  if (node.params.length && (HANDLER_NAME.test(name) || eventTypeOf(node.params[0]))) return 'handler';
  return 'function';
}

/** What a run is compared on (seq numbers are positional, so they are left out). */
const comparable = (r) => ({
  output: r.run.output, value: r.value ?? null, thrown: r.run.thrown, sentinels: r.run.sentinels,
  effects: r.run.effects.map(({ seq, ...e }) => e), transitions: r.run.transitions.map(({ seq, ...t }) => t),
});
const effectText = (e) => (e ? `${e.op}${e.method ? ` ${e.method}` : ''}${e.key ? ` ${e.key}` : ''}${e.args.length ? `(${e.args.join(', ')})` : ''}` : 'nothing');

/** One plain-English sentence for the first recorded difference between two comparable runs. */
function describeDifference(b, a) {
  if (b.thrown !== a.thrown) return `before ${b.thrown ? `threw ${b.thrown}` : 'did not throw'}, after ${a.thrown ? `threw ${a.thrown}` : 'did not throw'}`;
  if (b.output !== a.output) return `the output was ${b.output} before and ${a.output} after`;
  if (JSON.stringify(b.value) !== JSON.stringify(a.value)) return `the output value was ${JSON.stringify(b.value)} before and ${JSON.stringify(a.value)} after`;
  for (let i = 0; i < Math.max(b.effects.length, a.effects.length); i++) {
    if (JSON.stringify(b.effects[i]) !== JSON.stringify(a.effects[i])) return `effect ${i + 1} was ${effectText(b.effects[i])} before and ${effectText(a.effects[i])} after`;
  }
  if (JSON.stringify(b.transitions) !== JSON.stringify(a.transitions)) return 'the state transitions differ';
  return `the sentinels in the output and effects differ (${b.sentinels.join(', ') || 'none'} before, ${a.sentinels.join(', ') || 'none'} after)`;
}

/**
 * The isolated effect runner's LayerResult for one unit pair.
 * @param {object} args
 * @param {string} args.beforeRoot
 * @param {string} args.afterRoot
 * @param {{file: string, fn: string}} args.before
 * @param {{file: string, fn: string}} args.after
 * @param {{byParam?: Record<string, unknown[]>}} [args.seeds]
 * @param {number} [args.timeoutMs]
 * @returns {Promise<import('./contract.mjs').LayerResult>}
 */
export async function isolatedPair({ beforeRoot, afterRoot, before, after, seeds, timeoutMs = ISOLATED_TIMEOUT_MS }) {
  const t0 = performance.now();
  /** @type {{runAs?: import('./contract.mjs').RunAs, coverage?: import('./contract.mjs').BranchCoverage}} */
  const extra = {};
  const done = (r) => ({ layer: /** @type {const} */ ('isolated'), ...r, ...extra, ms: Math.round(performance.now() - t0) });
  if (!IDENT.test(before.fn) || !IDENT.test(after.fn)) return done({ outcome: 'skipped', reason: 'the unit has no plain function name' });
  const beforeSource = fs.readFileSync(path.join(beforeRoot, before.file), 'utf8');
  const afterSource = fs.readFileSync(path.join(afterRoot, after.file), 'utf8');
  let bNode;
  let aNode;
  try {
    bNode = findFunction(parseToAst(beforeSource), before.fn);
    aNode = findFunction(parseToAst(afterSource), after.fn);
  } catch (e) {
    return done({ outcome: 'skipped', reason: `parse error: ${/** @type {Error} */ (e).message}` });
  }
  if (!bNode || !aNode) return done({ outcome: 'skipped', reason: `${after.fn} is not a top-level function on both sides` });
  let n = 0;
  const runAs = runAsOf(after.fn, aNode);
  const params = aNode.params.map((p, k) => (runAs === 'handler' && k === 0 ? { name: 'event', event: eventTypeOf(p) ?? 'event' } : paramOf(p, () => sentinel(FAKE_ENV.seed, n++))));
  const cases = isolatedCases(params, seeds);
  const request = {
    env: FAKE_ENV, cases,
    before: { ...sideRequest(beforeRoot, before.file, before.fn), runAs }, after: { ...sideRequest(afterRoot, after.file, after.fn), runAs },
  };
  const child = await runChild(request, timeoutMs);
  if (child.timedOut) return done({ outcome: 'cant-tell', reason: `the run was killed at the ${timeoutMs} ms time limit` });
  const line = child.stdout.trim().split('\n').pop();
  if (child.code !== 0) return done({ outcome: 'cant-tell', reason: `the sandbox exited with code ${child.code}: ${child.stderr.trim().split('\n')[0] ?? ''}` });
  if (!line) return done({ outcome: 'cant-tell', reason: 'the unit never settled (a promise that does not resolve)' });
  const runs = JSON.parse(line);
  extra.runAs = runAs;
  const covBefore = branchCoverage(runs.before.map((r) => r.cov), request.before.blocks);
  const covAfter = branchCoverage(runs.after.map((r) => r.cov), request.after.blocks);
  extra.coverage = { before: covBefore, after: covAfter, level: coverageLevel(covBefore, covAfter) };
  // low coverage is said in the reason, never hidden: a "same" over code that did not run is weak
  const low = extra.coverage.level === 'low' ? `low branch coverage (before ${covBefore?.covered} of ${covBefore?.total} blocks ran, after ${covAfter?.covered} of ${covAfter?.total})` : null;
  const notFaked = new Set();
  for (let i = 0; i < cases.length; i++) {
    const [rb, ra] = [runs.before[i], runs.after[i]];
    assertUnitRun(rb.run);
    assertUnitRun(ra.run);
    for (const r of [rb, ra]) r.notFaked.forEach((n) => notFaked.add(n));
    if (rb.notFaked.length || ra.notFaked.length) continue;
    const [cb, ca] = [comparable(rb), comparable(ra)];
    if (JSON.stringify(cb) === JSON.stringify(ca)) continue;
    const location = locateUnitDifference({ source: beforeSource, file: before.file, fn: before.fn }, { source: afterSource, file: after.file, fn: after.fn })
      ?? { astPath: after.fn, file: after.file, line: aNode.loc.start.line, column: aNode.loc.start.column + 1 };
    return done({ outcome: 'changed', input: cases[i], location, reason: describeDifference(cb, ca) });
  }
  if (notFaked.size) return done({ outcome: 'cant-tell', reason: `not faked, so not executed: ${[...notFaked].sort().join(', ')}${low ? `; ${low}` : ''}` });
  return done({ outcome: 'same-behaviour', ...(low ? { reason: low } : {}) });
}

/**
 * #921 (path-first proof): one unit run on GIVEN cases (no before/after pair) in the same sandbox and fakes, so a
 * filled stub's examples execute with its effects recorded. The child always runs two sides; both are this unit, and
 * the second side's records are returned, one per case: {value (primitives only), thrown (the error name), effects,
 * notFaked}. A time limit, a sandbox exit or a load failure is `{error}`.
 * @param {{root: string, unit: {file: string, fn: string}, cases: unknown[][], runAs?: import('./contract.mjs').RunAs, timeoutMs?: number}} args
 * @returns {Promise<{runs?: {value: unknown, thrown: string|null, effects: object[], notFaked: string[]}[], error?: string, ms: number}>}
 */
export async function isolatedRun({ root, unit, cases, runAs = 'function', timeoutMs = ISOLATED_TIMEOUT_MS }) {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const side = { ...sideRequest(root, unit.file, unit.fn), runAs };
  const child = await runChild({ env: FAKE_ENV, cases, before: side, after: side }, timeoutMs);
  if (child.timedOut) return { error: `the run was killed at the ${timeoutMs} ms time limit`, ms: ms() };
  const line = child.stdout.trim().split('\n').pop();
  if (child.code !== 0 || !line) return { error: `the sandbox exited with code ${child.code}: ${child.stderr.trim().split('\n')[0] ?? ''}`, ms: ms() };
  const runs = JSON.parse(line).after.map((r) => ({ value: r.value ?? null, thrown: r.run.thrown, effects: r.run.effects.map(({ seq, ...e }) => e), notFaked: r.notFaked }));
  return { runs, ms: ms() };
}
