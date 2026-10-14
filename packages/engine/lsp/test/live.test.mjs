// #950 -- the live Line LSP index: persistent hash index (warm start, pin invalidation, atomic writes), scoped default
// and lazy widening, the background indexer (pauses on heavy.sh's lock), the fs.watch watcher. Smith is a counting
// stub (no atomic-codemod needed) and the rules layer is off where it is not under test, so this runs anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createLineLsp } from '../server.mjs';
import { openStore, atomicWrite, INDEX_DIR } from '../store/index.mjs';
import { scopeMode } from '../scope.mjs';
import { startBackgroundIndexer } from '../indexer.mjs';
import { exportsOf } from '../outline.mjs';
import { clearHostCache } from '../host.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STORE_MOD = path.join(HERE, '..', 'store', 'index.mjs');
const sleep = (t) => new Promise((r) => setTimeout(r, t));
async function until(fn, ms = 8000, step = 50) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await sleep(step); } }

const STUB = `// a Smith stand-in: one sentence per exported function, "EXACT " in canonical style
export async function smithIndexFile(rel, text, { canonical = false } = {}) {
  const m = /^features\\/([^/]+)\\/([^/]+)\\//.exec(rel);
  const id = (n) => (m ? m[1] + '/' + m[2] + '/' + n : rel + '#' + n);
  return [...text.matchAll(/export function (\\w+)/g)].map((x) => ({ id: id(x[1]), file: rel, name: x[1], sentences: [(canonical ? 'EXACT ' : '') + 'it does ' + x[1]], title: x[1] + ' works in 1 step', empty: null }));
}
`;

/** A small Line project: browse (the focus), other (another feature with an index), library/. */
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-lsp-live-'));
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  w('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'esnext', moduleResolution: 'bundler', strict: true, noEmit: true, lib: ['es2020'] } }));
  w('features/other/domains/helperB.ts', 'export function helperB(n: number): number {\n  return n * 2;\n}\n');
  w('features/other/domains/deepC.ts', 'export function deepC(s: string): string {\n  return s.trim();\n}\n');
  w('features/other/index.ts', "export { helperB } from './domains/helperB';\n");
  w('library/fmt.ts', 'export function fmt(n: number): string {\n  return String(n);\n}\n');
  w('features/browse/domains/sortByTitle.ts', "import { fmt } from '../../../library/fmt';\nexport function sortByTitle(xs: string[]): string[] {\n  return [...xs].sort().map((x) => x + fmt(1));\n}\n");
  w('features/browse/domains/count.ts', 'export function count(xs: string[]): number {\n  return xs.length;\n}\n');
  w('smith-stub.mjs', STUB);
  // browse is the most recently edited feature: the default focus
  const t = Date.now() / 1000;
  for (const f of ['features/other/domains/helperB.ts', 'features/other/domains/deepC.ts', 'features/other/index.ts']) fs.utimesSync(path.join(root, f), t - 100, t - 100);
  return { root, w, stub: path.join(root, 'smith-stub.mjs') };
}
const counting = async (stubPath) => {
  const { smithIndexFile } = await import(stubPath);
  const c = { calls: 0 };
  c.fn = async (rel, text, o) => { c.calls++; return smithIndexFile(rel, text, o); };
  return c;
};
const base = (p, x = {}) => ({ rules: false, smithPin: 'stub-1', rulesVersion: 'off', ...x });

test('warm start: every unchanged file comes from the stored index, zero Smith calls', async () => {
  const p = project();
  try {
    const c1 = await counting(p.stub);
    const a = await createLineLsp(p.root, base(p, { smithIndex: c1.fn }));
    assert.equal(a.cold.hits, 0);
    assert.ok(a.cold.misses >= 3, `misses ${a.cold.misses}`);
    assert.ok(c1.calls > 0);
    assert.ok(fs.existsSync(path.join(p.root, INDEX_DIR, '.gitignore')), 'the index folder ignores itself');
    clearHostCache();
    const c2 = await counting(p.stub);
    const b = await createLineLsp(p.root, base(p, { smithIndex: c2.fn }));
    assert.equal(c2.calls, 0, 'no Smith call for an unchanged file');
    assert.equal(b.stats.smithCalls, 0);
    assert.equal(b.cold.misses, 0);
    assert.equal(b.cold.hits, a.cold.misses);
    const sym = b.symbol('browse/domains/count');
    assert.deepEqual(sym.smith, ['it does count']);
    assert.deepEqual(sym.exact, ['EXACT it does count'], 'the exact style is stored too');
    // one file changes: only it is recomputed
    p.w('features/browse/domains/count.ts', 'export function count(xs: string[]): number {\n  return xs.length + 0;\n}\n');
    clearHostCache();
    const c3 = await counting(p.stub);
    const d = await createLineLsp(p.root, base(p, { smithIndex: c3.fn }));
    assert.equal(d.cold.misses, 1);
    assert.equal(c3.calls, 2, 'plain + exact for the one changed file');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

test('a Smith pin (or rules version) change invalidates the stored entries; prune drops them after N days', async () => {
  const p = project();
  try {
    const a = await createLineLsp(p.root, base(p, { smithIndex: (await counting(p.stub)).fn }));
    const n = a.cold.misses;
    clearHostCache();
    const c = await counting(p.stub);
    const b = await createLineLsp(p.root, base(p, { smithIndex: c.fn, smithPin: 'stub-2' }));
    assert.equal(b.cold.hits, 0, 'nothing reused under a new pin');
    assert.equal(b.cold.misses, n);
    assert.ok(c.calls > 0);
    clearHostCache();
    const r = await createLineLsp(p.root, base(p, { smithIndex: (await counting(p.stub)).fn, smithPin: 'stub-2', rulesVersion: 'line#2' }));
    assert.equal(r.cold.hits, 0, 'a rules version change is a miss too');
    // prune: entries of the old pins match no live (file, hash) under the current pin; kept until they are N days old
    const store = openStore(p.root, { pin: { smith: 'stub-2', rules: 'line#2' } });
    const live = new Map(Object.entries({}));
    for (const f of ['features/browse/domains/count.ts', 'features/browse/domains/sortByTitle.ts', 'library/fmt.ts', 'features/other/index.ts']) {
      const { hashOf } = await import('../host.mjs');
      live.set(f, hashOf(fs.readFileSync(path.join(p.root, f), 'utf8')));
    }
    assert.equal(store.prune({ live, days: 30 }).removed, 0, 'young entries stay');
    const later = openStore(p.root, { pin: { smith: 'stub-2', rules: 'line#2' }, now: () => Date.now() + 31 * 86400000 });
    const pr = later.prune({ live, days: 30 });
    assert.equal(pr.removed, n * 2, 'both old pins\' entries go');
    assert.equal(pr.kept, n, 'the live entries stay');
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

test('scoped by default: the focus feature + other features\' index + library; widens lazily', async () => {
  const p = project();
  try {
    const lsp = await createLineLsp(p.root, base(p, { smithModule: p.stub }));
    assert.equal(lsp.scope.mode, 'scoped');
    assert.equal(lsp.scope.focus, 'browse');
    assert.ok(lsp.inScope('features/other/index.ts'));
    assert.ok(lsp.inScope('library/fmt.ts'));
    assert.equal(lsp.inScope('features/other/domains/helperB.ts'), false);
    assert.equal(lsp.inScope('features/other/domains/deepC.ts'), false);
    // a cross-scope definition: deepC is in no scope file, so its exporter is found and the scope widens to it
    const d = lsp.definition('features/browse/domains/count.ts', 'deepC');
    assert.equal(d.ok, true);
    assert.deepEqual(d.widened, ['features/other/domains/deepC.ts']);
    assert.equal(d.locations[0].file, 'features/other/domains/deepC.ts');
    await lsp.idle();
    assert.deepEqual(lsp.symbol('other/domains/deepC').smith, ['it does deepC'], 'the widened file is indexed in Smith');
    // add_to_scope, seen in the code: a landed edit imports helperB's file directly
    p.w('features/browse/domains/count.ts', "import { helperB } from '../../other/domains/helperB';\nexport function count(xs: string[]): number {\n  return helperB(xs.length);\n}\n");
    const u = await lsp.update(['features/browse/domains/count.ts']);
    assert.deepEqual(u.touched, ['features/browse/domains/count.ts']);
    assert.deepEqual(u.widened, ['features/other/domains/helperB.ts']);
    // create_module in another feature: that folder joins the scope, its new files too
    const m = lsp.applied({ step: 'create_module', target: 'module:other/services' });
    assert.deepEqual(m.added, []);
    p.w('features/other/services/load.ts', 'export function load(): string[] {\n  return [];\n}\n');
    const u2 = await lsp.update(['features/other/services/load.ts']);
    assert.deepEqual(u2.touched, ['features/other/services/load.ts']);
    assert.ok(lsp.inScope('features/other/services/load.ts'));
    // a file outside the scope that changes is only re-versioned for TS, not indexed
    p.w('features/elsewhere/domains/z.ts', 'export function z(): number {\n  return 1;\n}\n');
    const u3 = await lsp.update(['features/elsewhere/domains/z.ts']);
    assert.deepEqual(u3.touched, []);
    // the flag: lsp.scope = full, from the project's profile
    fs.mkdirSync(path.join(p.root, 'line'), { recursive: true });
    fs.writeFileSync(path.join(p.root, 'line', 'lsp-profile.json'), JSON.stringify({ v: 1, 'lsp.scope': 'full' }));
    assert.equal(scopeMode(p.root, undefined, {}), 'full');
    assert.equal(scopeMode(p.root, undefined, { LINE_LSP_SCOPE: 'scoped' }), 'scoped');
    assert.equal(scopeMode(p.root, 'scoped', {}), 'scoped');
    clearHostCache();
    const full = await createLineLsp(p.root, base(p, { smithModule: p.stub }));
    assert.equal(full.scope.mode, 'full');
    assert.ok(full.inScope('features/other/domains/helperB.ts'));
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

test('background indexer: a nice-19 child fills the store outward from the scope and pauses while another job holds the heavy lock', async () => {
  const p = project();
  const lock = path.join(p.root, 'heavy.lock');
  fs.mkdirSync(`${lock}.d`);
  fs.writeFileSync(`${lock}.d/pid`, String(process.pid)); // a live holder that is not this run's own heavy.sh
  try {
    const msgs = [];
    const scopeFiles = ['features/browse/domains/count.ts', 'features/browse/domains/sortByTitle.ts'];
    const env = { ...process.env, CONSTRUCT_HEAVY_HELD: '' };
    const bg = startBackgroundIndexer({ root: p.root, scope: scopeFiles, pin: { smith: 'stub-1', rules: 'off' }, smithModule: p.stub, rules: false, tick: 2, pauseMs: 10, minFreeMb: 0, lock, env, onMessage: (m) => msgs.push(m) });
    assert.ok(await until(() => msgs.some((m) => m.type === 'paused' && m.why === 'lock')), 'paused on the lock');
    assert.ok(bg.status.nice >= 19, `nice ${bg.status.nice}`);
    await sleep(400);
    assert.equal(bg.status.done, 0, 'nothing indexed while the lock is held');
    fs.rmSync(`${lock}.d`, { recursive: true, force: true });
    const st = await Promise.race([bg.done, new Promise((r) => setTimeout(r, 15000, null).unref())]);
    assert.ok(st, 'the indexer finished');
    assert.equal(st.state, 'done');
    assert.ok(msgs.some((m) => m.type === 'resumed'));
    const indexed = msgs.filter((m) => m.type === 'indexed').flatMap((m) => m.files.map((f) => f.rel));
    assert.equal(indexed[0], 'library/fmt.ts', 'outward: what the scope imports comes first');
    assert.ok(indexed.includes('features/other/domains/deepC.ts'));
    assert.ok(!indexed.some((f) => scopeFiles.includes(f)), 'the scope itself is the foreground\'s');
    // the foreground's warm start now finds the outside files stored
    clearHostCache();
    const c = await counting(p.stub);
    const lsp = await createLineLsp(p.root, base(p, { smithIndex: c.fn, scope: { files: ['features/other/domains/deepC.ts'] } }));
    assert.equal(lsp.cold.hits, 1);
    assert.equal(c.calls, 0);
  } finally { fs.rmSync(p.root, { recursive: true, force: true }); }
});

test('watcher: an outside edit is picked up (debounced) and re-indexes only that file', async () => {
  const p = project();
  let lsp;
  try {
    lsp = await createLineLsp(p.root, base(p, { smithModule: p.stub, watch: true, debounceMs: 50 }));
    await sleep(200); // let FSEvents settle
    p.w('features/browse/domains/count.ts', 'export function count(xs: string[]): number {\n  return xs.length;\n}\nexport function countTwice(xs: string[]): number {\n  return xs.length * 2;\n}\n');
    const sym = await until(() => { const s = lsp.symbol('browse/domains/countTwice'); return s.file ? s : null; });
    assert.ok(sym, 'the new function shows up without an update() call');
    assert.deepEqual(sym.smith, ['it does countTwice']);
    assert.ok(lsp.stats.updates >= 1);
  } finally { lsp?.close(); fs.rmSync(p.root, { recursive: true, force: true }); }
});

test('atomic write: a writer killed mid-write never leaves a torn entry; prune sweeps its temp files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-lsp-store-'));
  try {
    const pin = { smith: 's', rules: 'r' };
    const store = openStore(dir, { pin, dir: path.join(dir, 'idx') });
    store.put('a.ts', '0123456789abcdef', { smith: [], payload: 'old' });
    const script = `import { openStore } from ${JSON.stringify(STORE_MOD)};
      const s = openStore(${JSON.stringify(dir)}, { pin: ${JSON.stringify(pin)}, dir: ${JSON.stringify(path.join(dir, 'idx'))} });
      const big = 'x'.repeat(4 << 20);
      process.send?.('go');
      for (let i = 0; ; i++) s.put('a.ts', '0123456789abcdef', { smith: [], payload: big + i });`;
    const scriptFile = path.join(dir, 'writer.mjs');
    fs.writeFileSync(scriptFile, script);
    const child = spawn(process.execPath, [scriptFile], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    await new Promise((r) => child.once('message', r));
    await sleep(150);
    child.kill('SIGKILL');
    await new Promise((r) => child.once('exit', r));
    const rec = store.get('a.ts', '0123456789abcdef');
    assert.ok(rec, 'the entry still parses');
    assert.ok(rec.payload === 'old' || rec.payload.startsWith('xxxx'), 'old or a whole new version, never torn');
    const shard = path.dirname(store.pathOf('a.ts', '0123456789abcdef'));
    const tmpBefore = fs.readdirSync(shard).filter((n) => n.endsWith('.tmp')).length;
    const pr = store.prune({ live: new Map([['a.ts', '0123456789abcdef']]) });
    assert.equal(pr.tmp, tmpBefore, 'the dead writer\'s temp files are swept');
    assert.equal(fs.readdirSync(shard).filter((n) => n.endsWith('.tmp')).length, 0);
    assert.equal(pr.kept, 1);
    // atomicWrite itself: the target is replaced in one step
    const f = path.join(dir, 'one.json');
    atomicWrite(f, '{"a":1}');
    atomicWrite(f, '{"a":2}');
    assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { a: 2 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('outline: exported signatures, one line each', () => {
  const ex = exportsOf('x.ts', "export function f(a: number): string {\n  return '';\n}\nexport const g = (s: string): number => 1;\nexport interface I { a: number }\nexport type T = string;\nexport { f as h } from './y';\n");
  assert.deepEqual(ex.map((e) => [e.name, e.kind]), [['f', 'function'], ['g', 'function'], ['I', 'interface'], ['T', 'type'], ['h', 'reexport']]);
  assert.equal(ex[0].signature, 'function f(a: number): string');
});
