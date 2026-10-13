// #921 path-first proof: the deterministic verdict for one stub and for one point's whole path. No AI judge.
//   a) static (AST, no execution): the stub check (stubs.mjs), the path's call edges (each consumer imports and uses the
//      unit it points at), purity per domain/service stub (logicVerify purity.mjs classifyUnit), then tsc.
//   b) dry run: a logic stub's examples run in logicVerify's isolated sandbox under the recording fakes (isolatedRun.mjs);
//      contract mocks answer from fixtures; a UI stub's (and a point's end-to-end) render examples run in a jsdom child
//      (domChild.mjs) with @testing-library/dom queries. The first failing example comes back with input, expected, got.
//   c) for a pure stub that already passed once, fastCheckLayer and z3Layer compare the new body with the last passing
//      one (information only: they need a "before"; a fresh stub has none).
// The path lives in <project>/line/path/path.json (bench/ecommerce/driver/path-points.mjs writes it).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseToAst, walkAst } from '@construct/ast';
import { stubProblems } from './stubs.mjs';
import { classifyUnit } from '../logicVerify/purity.mjs';
import { isolatedRun } from '../logicVerify/isolatedRun.mjs';
import { fastCheckLayer } from '../logicVerify/fastCheckLayer.mjs';
import { z3Layer } from '../logicVerify/z3Prove.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_MODULES = path.resolve(HERE, '../../../../node_modules');
export const PATH_FILE = 'line/path/path.json';
export const FILLS_FILE = 'line/path/fills.jsonl';
/** Bottom-up rank per layer: contract and domain first, the page last. */
export const LAYER_RANK = Object.freeze({ contract: 0, domain: 1, service: 2, hook: 3, provider: 3, component: 4, page: 5, layout: 6, harness: 7 });
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];

/** @param {string} root */
export const readPath = (root) => JSON.parse(fs.readFileSync(path.join(root, PATH_FILE), 'utf8'));
export const unitOf = (p, id) => p.units.find((u) => u.id === id) ?? null;

/** The stubs in bottom-up order: a unit after every unit it depends on, then by layer rank, then path order. */
export function bottomUp(p, ids = null) {
  const stubs = p.units.filter((u) => u.kind === 'stub' && (!ids || ids.includes(u.id)));
  const out = []; const seen = new Set();
  const visit = (u) => {
    if (seen.has(u.id)) return;
    seen.add(u.id);
    for (const d of u.deps ?? []) { const du = stubs.find((s) => s.id === d); if (du) visit(du); }
    out.push(u);
  };
  [...stubs].sort((a, b) => (LAYER_RANK[a.layer] ?? 9) - (LAYER_RANK[b.layer] ?? 9)).forEach(visit);
  return out;
}

const clip = (s, n = 400) => { const t = typeof s === 'string' ? s : JSON.stringify(s); return t === undefined ? 'undefined' : t.length > n ? `${t.slice(0, n)}…` : t; };
const timer = () => { const t0 = performance.now(); return () => Math.round(performance.now() - t0); };

/** Resolve a relative import of `fromFile` to a project-relative file, or null. */
function resolveImport(root, fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  return [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => `${base}/index${e}`)].find((f) => fs.existsSync(path.join(root, f)) && fs.statSync(path.join(root, f)).isFile()) ?? null;
}

/**
 * a) The path's call edges: each `from` unit's file imports the `to` unit's export from its file and uses it.
 * @returns {{from: string, to: string, code: 'NO_UNIT'|'NO_IMPORT'|'UNUSED', sentence: string}[]}
 */
export function edgeProblems(root, p, ids = null) {
  const out = [];
  for (const e of p.edges ?? []) {
    if (ids && !ids.includes(e.from) && !ids.includes(e.to)) continue;
    const from = unitOf(p, e.from); const to = unitOf(p, e.to);
    if (!from || !to) { out.push({ ...e, code: 'NO_UNIT', sentence: `The edge ${e.from} -> ${e.to} names a unit the path does not have.` }); continue; }
    let ast;
    try { ast = parseToAst(fs.readFileSync(path.join(root, from.file), 'utf8')); } catch (err) { out.push({ ...e, code: 'NO_IMPORT', sentence: `${from.file} does not parse: ${String(err.message).split('\n')[0]}` }); continue; }
    let local = null;
    for (const st of ast.body) {
      if (st.type !== 'ImportDeclaration' || resolveImport(root, from.file, String(st.source.value)) !== to.file) continue;
      for (const s of st.specifiers) if (s.type === 'ImportSpecifier' && (s.imported.name ?? s.imported.value) === to.export) local = s.local.name;
    }
    if (!local) { out.push({ ...e, code: 'NO_IMPORT', sentence: `${from.file} (${e.from}) does not import ${to.export} from ${to.file} (${e.to}).` }); continue; }
    let used = false;
    walkAst(ast, {
      enter(n, parent, key) {
        if (n.type === 'ImportDeclaration') { this.skip(); return; }
        if (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) return;
        if ((n.type === 'Identifier' || n.type === 'JSXIdentifier') && n.name === local) used = true;
      },
    });
    if (!used) out.push({ ...e, code: 'UNUSED', sentence: `${from.file} imports ${to.export} but never calls or renders it.` });
  }
  return out;
}

/** The project's TypeScript (its own node_modules first, then the repo's). */
const tscBin = (root) => [path.join(root, 'node_modules/typescript/bin/tsc'), path.join(REPO_MODULES, 'typescript/bin/tsc')].find((f) => fs.existsSync(f));

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stdout = ''; let stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    const t = opts.timeoutMs ? setTimeout(() => c.kill('SIGKILL'), opts.timeoutMs) : null;
    c.on('close', (code) => { if (t) clearTimeout(t); resolve({ code, stdout, stderr }); });
  });
}

/**
 * tsc --noEmit over the project: every error as {file, line, col, code, message}.
 * @param {string} root
 */
export async function tscErrors(root) {
  const bin = tscBin(root);
  if (!bin) return [{ file: '', line: 0, col: 0, code: 'NO_TSC', message: 'TypeScript is not installed in the project or the repo.' }];
  const r = await run(process.execPath, [bin, '--noEmit', '--pretty', 'false', '--incremental', 'false', '-p', path.join(root, 'tsconfig.json')], { cwd: root, timeoutMs: 120_000 });
  const out = [];
  for (const line of r.stdout.split('\n')) {
    const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line.trim());
    if (m) out.push({ file: path.relative(root, path.resolve(root, m[1])).split(path.sep).join('/'), line: Number(m[2]), col: Number(m[3]), code: m[4], message: m[5] });
  }
  if (!out.length && r.code !== 0 && r.code !== null && /error/.test(r.stdout + r.stderr)) out.push({ file: '', line: 0, col: 0, code: 'TSC', message: (r.stdout + r.stderr).trim().split('\n')[0] });
  return out;
}

/** The adapter the isolated sandbox runs: it revives contract mocks, calls the unit, returns JSON of {out, calls}. */
function adapterSource(rel, exportName) {
  return `import { ${exportName} as __unit } from '${rel}';
export function __pathDry(caseJson: string): string {
  const input = JSON.parse(caseJson);
  const calls: unknown[] = [];
  const revive = (v: any): any => {
    if (Array.isArray(v)) return v.map(revive);
    if (v && typeof v === 'object') {
      if (v.$mock) {
        const o: any = {};
        for (const m of Object.keys(v.$mock)) {
          const spec = v.$mock[m] ?? {};
          o[m] = (...args: any[]) => { calls.push([m, ...args]); return spec.byArg && String(args[0]) in spec.byArg ? spec.byArg[String(args[0])] : (spec.returns ?? null); };
        }
        return o;
      }
      const o: any = {};
      for (const k of Object.keys(v)) o[k] = revive(v[k]);
      return o;
    }
    return v;
  };
  try {
    const out = (__unit as any)(revive(input));
    return JSON.stringify({ out: out === undefined ? null : out, calls });
  } catch (e: any) {
    return JSON.stringify({ thrown: String(e && e.message ? e.message : e), calls });
  }
}
`;
}

const IGNORED_EFFECTS = new Set(['console']);
const projectId = (out) => (Array.isArray(out) ? out.map((x) => (x && typeof x === 'object' ? x.id : x)) : out);

/**
 * b) A logic stub's examples, run in the isolated sandbox under the recording fakes. First failing example or null.
 * @returns {Promise<{failure: object|null, ms: number}>}
 */
export async function logicExamples(root, unit) {
  const t = timer();
  const dir = path.join(root, 'line/path/.dry');
  fs.mkdirSync(dir, { recursive: true });
  const adapter = path.posix.join('line/path/.dry', `${unit.id.replace(/[^\w]+/g, '_')}.ts`);
  let rel = path.posix.relative(path.posix.dirname(adapter), unit.file).replace(/\.(tsx?|jsx?)$/, '');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  fs.writeFileSync(path.join(root, adapter), adapterSource(rel, unit.export));
  let r;
  try {
    r = await isolatedRun({ root, unit: { file: adapter, fn: '__pathDry' }, cases: unit.examples.map((ex) => [JSON.stringify(ex.input)]) });
  } finally {
    fs.rmSync(path.join(root, adapter), { force: true });
    try { fs.rmdirSync(dir); } catch { /* not empty */ }
  }
  if (r.error) return { failure: { layer: 'dry-run', sentence: `The sandbox could not run the stub: ${r.error}` }, ms: t() };
  for (let i = 0; i < unit.examples.length; i += 1) {
    const ex = unit.examples[i]; const runI = r.runs[i];
    const js = (v) => clip(JSON.stringify(v) ?? 'undefined');
    const base = { layer: 'examples', example: ex.id, input: ex.show?.input ?? js(ex.input), expected: ex.show?.expect ?? js(ex.expect) };
    if (runI.notFaked.length) return { failure: { ...base, layer: 'dry-run', got: `it reached ${runI.notFaked.join(', ')}, which a stub may not use (not faked, so not executed)` }, ms: t() };
    const effects = runI.effects.filter((e) => !IGNORED_EFFECTS.has(e.effect));
    if ((unit.layer === 'domain' || unit.layer === 'service') && effects.length) return { failure: { ...base, layer: 'dry-run', got: `it had an effect: ${effects.map((e) => `${e.op}${e.key ? ` ${e.key}` : ''}`).join(', ')}; a ${unit.layer} stub may only use its inputs${unit.layer === 'service' ? ' (its contract)' : ''}` }, ms: t() };
    let res;
    try { res = JSON.parse(String(runI.value)); } catch { return { failure: { ...base, layer: 'dry-run', got: `no result (the sandbox recorded ${runI.thrown ?? 'nothing'})` }, ms: t() }; }
    if (res.thrown !== undefined) return { failure: { ...base, got: `it threw: ${res.thrown}` }, ms: t() };
    const got = ex.compare === 'ids' ? projectId(res.out) : res.out;
    if (JSON.stringify(got) !== JSON.stringify(ex.expect)) return { failure: { ...base, got: js(got) }, ms: t() };
    if (ex.calls && JSON.stringify(res.calls) !== JSON.stringify(ex.calls)) return { failure: { ...base, expected: `calls ${clip(ex.calls)}`, got: `calls ${clip(res.calls)}` }, ms: t() };
  }
  return { failure: null, ms: t() };
}

let shimDir = null;
function shims() {
  if (shimDir) return shimDir;
  shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-path-shims-'));
  fs.writeFileSync(path.join(shimDir, 'link.js'), "import * as React from 'react';\nexport default function Link({ href, children, prefetch, replace, scroll, ...rest }) { return React.createElement('a', { href: typeof href === 'string' ? href : String(href?.pathname ?? ''), ...rest }, children); }\n");
  fs.writeFileSync(path.join(shimDir, 'navigation.js'), "const router = { push() {}, replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {} };\nexport const useRouter = () => router;\nexport const usePathname = () => '/';\nexport const useSearchParams = () => new URLSearchParams();\nexport const useParams = () => ({});\nexport const notFound = () => { throw new Error('notFound'); };\nexport const redirect = () => { throw new Error('redirect'); };\n");
  process.on('exit', () => { try { fs.rmSync(shimDir, { recursive: true, force: true }); } catch { /* gone */ } });
  return shimDir;
}

/**
 * b) Render examples for one UI module export, in the jsdom child. First failing example (with its step) or null.
 * @param {string} root
 * @param {{file: string, export: string, examples: object[], id?: string}} unit
 * @returns {Promise<{failure: object|null, ms: number}>}
 */
/**
 * Bundle one module (esbuild, React from the project's node_modules first, next/link and next/navigation as recording-free
 * shims) and run the jsdom child on `request`. {out} or {error}.
 */
async function inDom(root, file, request) {
  const esbuild = await import('esbuild');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-path-dom-'));
  try {
    const outfile = path.join(tmp, 'bundle.mjs');
    const s = shims();
    try {
      await esbuild.build({
        stdin: { contents: `export * as M from ${JSON.stringify(path.join(root, file))};\nexport * as React from 'react';\nexport * as ReactDOMClient from 'react-dom/client';\nexport * as TestUtils from 'react-dom/test-utils';\n`, resolveDir: root, loader: 'ts' },
        bundle: true, format: 'esm', platform: 'browser', outfile, jsx: 'automatic', loader: { '.json': 'json' }, logLevel: 'silent',
        define: { 'process.env.NODE_ENV': '"development"' }, alias: { 'next/link': path.join(s, 'link.js'), 'next/navigation': path.join(s, 'navigation.js') },
        nodePaths: [path.join(root, 'node_modules'), REPO_MODULES],
      });
    } catch (e) {
      const m = e?.errors?.[0];
      return { error: `The unit does not bundle: ${m ? `${m.location?.file ?? ''}:${m.location?.line ?? ''} ${m.text}` : String(e.message).split('\n')[0]}` };
    }
    const req = path.join(tmp, 'request.json');
    fs.writeFileSync(req, JSON.stringify({ bundle: outfile, ...request }));
    const r = await run(process.execPath, [path.join(HERE, 'domChild.mjs'), req], { cwd: tmp, timeoutMs: 30_000 });
    const line = r.stdout.trim().split('\n').pop();
    if (!line) return { error: `The render child gave no result: ${r.stderr.trim().split('\n').slice(0, 2).join(' ')}` };
    return { out: JSON.parse(line) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * The visual snapshot of a point's page (its `visual` spec): per state (cumulative steps), the role/name nodes.
 * @returns {Promise<{snapshots?: {label: string, nodes: {role: string, name: string, value?: string}[], error?: string, stepError?: string}[], error?: string, ms: number}>}
 */
export async function pageSnapshot(root, visual) {
  const t = timer();
  const r = await inDom(root, visual.file, { mode: 'snapshot', export: visual.export, props: visual.props ?? {}, states: visual.states });
  return r.error ? { error: r.error, ms: t() } : { snapshots: r.out.snapshots, ms: t() };
}

const key = (n) => `${n.role}|${n.name}`;
const countOf = (nodes, role, nameRe) => nodes.filter((n) => n.role === role && (!nameRe || new RegExp(nameRe, 'i').test(n.name))).length;

/**
 * The DOM snapshot diff and whether it holds the EXPECTED change ("expected change happened"; other changes never fail).
 * expect: {appears: {state, role, name}} (absent before, present after) | {count: {state, role, nameRe?, to}} (after has
 * `to`, before had a different count).
 * @returns {{ok: boolean, added: string[], removed: string[], missing: string[]}}
 */
export function visualDiff(before, after, expect) {
  const added = []; const removed = []; const missing = [];
  after.forEach((a, i) => {
    const b = before?.[i]?.nodes ?? [];
    const bk = b.map(key); const ak = a.nodes.map(key);
    ak.filter((k) => !bk.includes(k)).forEach((k) => added.push(`${a.label}: + ${k}`));
    bk.filter((k) => !ak.includes(k)).forEach((k) => removed.push(`${a.label}: - ${k}`));
  });
  for (const e of expect) {
    if (e.appears) {
      const { state, role, name } = e.appears;
      const had = (before?.[state]?.nodes ?? []).some((n) => n.role === role && n.name === name);
      const has = (after[state]?.nodes ?? []).some((n) => n.role === role && n.name === name);
      if (had || !has) missing.push(`in "${after[state]?.label}": a ${role} "${name}" ${had ? 'was already there before' : 'does not appear'}`);
    }
    if (e.count) {
      const { state, role, nameRe, to } = e.count;
      const was = countOf(before?.[state]?.nodes ?? [], role, nameRe); const now = countOf(after[state]?.nodes ?? [], role, nameRe);
      if (now !== to || was === to) missing.push(`in "${after[state]?.label}": ${to} ${role}s${nameRe ? ` like /${nameRe}/` : ''} (before ${was}, after ${now})`);
    }
  }
  return { ok: missing.length === 0, added, removed, missing };
}

export async function domExamples(root, unit) {
  const t = timer();
  {
    const r = await inDom(root, unit.file, { export: unit.export, examples: unit.examples });
    if (r.error) return { failure: { layer: 'dry-run', sentence: r.error }, ms: t() };
    const out = r.out;
    const bad = out.results.find((x) => !x.ok);
    if (!bad) return { failure: null, ms: t() };
    const ex = unit.examples.find((x) => x.id === bad.id);
    return { failure: { layer: 'examples', example: bad.id, input: ex?.show?.input ?? clip(ex?.props ?? {}), step: bad.step, did: bad.did, expected: bad.expected, got: bad.got }, ms: t() };
  }
}

/**
 * The verdict for one stub: pass, or the first failure (layer static | purity | tsc | dry-run | examples), with the
 * time each layer took. `prevSource` (the stub file when it last passed) turns on layer c.
 * @param {string} root
 * @param {object} p the path
 * @param {string} id
 * @param {{prevSource?: string|null, tsc?: boolean}} [opts]
 */
export async function checkStub(root, p, id, { prevSource = null } = {}) {
  const unit = unitOf(p, id);
  const ms = {};
  const done = (failure, extra = {}) => ({ id, pass: !failure, ...(failure ? { failure } : {}), ms, ...extra });
  if (!unit || unit.kind !== 'stub') return done({ layer: 'static', sentence: `There is no stub ${id}.` });
  const source = fs.readFileSync(path.join(root, unit.file), 'utf8');
  let t = timer();
  const probs = stubProblems(source, unit.fn);
  const edges = edgeProblems(root, p, [id]);
  ms.static = t();
  if (probs.length) return done({ layer: 'static', code: probs[0].code, sentence: probs[0].sentence, ...(probs[0].line ? { line: probs[0].line } : {}) });
  if (edges.length) return done({ layer: 'static', code: `EDGE_${edges[0].code}`, sentence: edges[0].sentence });
  if (unit.layer === 'domain' || unit.layer === 'service') {
    t = timer();
    const c = await classifyUnit({ root, file: unit.file, fn: unit.fn });
    ms.purity = t();
    if (c.purity !== 'pure') return done({ layer: 'purity', sentence: `A ${unit.layer} stub must be pure; this body has ${c.effectChain.map((l) => `${l.effect}${l.via?.length ? ` via ${l.via.join(' -> ')}` : ''}`).join(', ')}.` });
  }
  t = timer();
  const errs = await tscErrors(root);
  ms.tsc = t();
  const mine = errs.find((e) => e.file === unit.file);
  const consumers = new Set((p.edges ?? []).filter((e) => e.to === id).map((e) => unitOf(p, e.from)?.file).filter(Boolean));
  const theirs = errs.find((e) => consumers.has(e.file));
  if (mine) {
    const text = source.split('\n')[mine.line - 1]?.trim() ?? '';
    return done({ layer: 'tsc', sentence: `${mine.file}:${mine.line}:${mine.col} ${mine.code} ${mine.message}`, line: mine.line, code: text });
  }
  if (theirs) return done({ layer: 'tsc', sentence: `The wiring at ${theirs.file}:${theirs.line} no longer type-checks against this stub: ${theirs.code} ${theirs.message}` });
  const ran = unit.check === 'dom' ? await domExamples(root, unit) : await logicExamples(root, unit);
  ms.run = ran.ms;
  if (ran.failure) return done(ran.failure);
  let extra = {};
  if (prevSource && prevSource !== source && (unit.layer === 'domain')) {
    t = timer();
    const fc = fastCheckLayer({ beforeSource: prevSource, afterSource: source, fn: unit.fn, file: unit.file });
    const z3 = await z3Layer({ beforeSource: prevSource, afterSource: source, fn: unit.fn, file: unit.file }).catch((e) => ({ outcome: 'skipped', reason: String(e.message) }));
    ms.c = t();
    extra = { c: { fastCheck: { outcome: fc.outcome, ...(fc.reason ? { reason: fc.reason } : {}) }, z3: { outcome: z3.outcome, ...(z3.reason ? { reason: z3.reason } : {}) } } };
  }
  return done(null, extra);
}

/**
 * The whole path of one point, end to end: every edge (a), tsc, each stub's verdict without tsc again, then the point's
 * end-to-end render examples through the real filled units (b). Green, or the first failing edge, stub or example.
 * @param {string} root
 * @param {string} point
 */
export async function checkPath(root, point) {
  const p = readPath(root);
  const pt = p.points[point];
  if (!pt) return { point, green: false, failure: { layer: 'static', sentence: `The path has no point ${point}.` } };
  const ids = p.units.filter((u) => u.point === point || (pt.units ?? []).includes(u.id)).map((u) => u.id);
  const ms = {};
  let t = timer();
  const edges = edgeProblems(root, p, ids);
  ms.edges = t();
  if (edges.length) return { point, green: false, failure: { layer: 'static', code: `EDGE_${edges[0].code}`, sentence: edges[0].sentence }, ms };
  t = timer();
  const errs = await tscErrors(root);
  ms.tsc = t();
  const files = new Set(ids.map((id) => unitOf(p, id)?.file));
  const e = errs.find((x) => files.has(x.file));
  if (e) return { point, green: false, failure: { layer: 'tsc', sentence: `${e.file}:${e.line} ${e.code} ${e.message}` }, ms };
  const stubs = [];
  for (const u of bottomUp(p, ids)) {
    const source = fs.readFileSync(path.join(root, u.file), 'utf8');
    const probs = stubProblems(source, u.fn);
    if (probs.length) { stubs.push({ id: u.id, pass: false, failure: { layer: 'static', code: probs[0].code, sentence: probs[0].sentence } }); continue; }
    const r = u.check === 'dom' ? await domExamples(root, u) : await logicExamples(root, u);
    stubs.push({ id: u.id, pass: !r.failure, ...(r.failure ? { failure: r.failure } : {}), ms: r.ms });
  }
  const firstStub = stubs.find((s) => !s.pass);
  t = timer();
  const e2e = pt.e2e ? await domExamples(root, { file: pt.e2e.file, export: pt.e2e.export, examples: pt.e2e.examples }) : { failure: null, ms: 0 };
  ms.e2e = t();
  const failure = firstStub ? { stub: firstStub.id, ...firstStub.failure } : e2e.failure ? { ...e2e.failure, layer: 'e2e' } : null;
  return { point, green: !failure, stubs, e2e: e2e.failure ? { pass: false, failure: e2e.failure } : { pass: true }, ...(failure ? { failure } : {}), ms };
}
