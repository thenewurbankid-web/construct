// #541 -- create, refactor and import in the Cockpit's switchable execution mode. These verbs WRITE files, so the
// parity CONTRACT has two halves: (1) the whole `--format json` document is byte-identical between the in-process
// `engine` call and the real `construct` subprocess (`cli`), and (2) the two runs leave byte-identical project
// trees. Each mode gets its OWN identical copy of a throwaway project (a run changes its copy), so nothing is
// normalized: relative paths in the document are the same string in both.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { runCreate, runRefactor, runImport } from '../ui/server/src/coreVerbs.mjs';
import { handleCreate, handleRefactor, handleImport, LLM_IN_PROCESS_NOTE } from '../ui/server/src/writeVerbsApi.mjs';
import { runCapturing } from '../ui/server/src/commandRunner.mjs';
import { refactor } from '../packages/core/cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, '..', 'fixtures', 'architecture-valid-react-spa');
const CLI = path.join(here, '..', 'packages', 'cli', 'construct.mjs');

const copy = () => {
  const dir = makeTempDir('construct-writes-');
  fs.cpSync(FIXTURE, dir, { recursive: true });
  return dir;
};
/** Every file under a directory as { relative path: content }. */
const tree = (dir, rel = '') => Object.assign({}, ...fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).map((e) => {
  const r = path.join(rel, e.name);
  return e.isDirectory() ? tree(dir, r) : { [r]: fs.readFileSync(path.join(dir, r), 'utf8') };
}));

// a legacy file to import (outside both projects, so its absolute path is the same string in both documents)
const LEGACY = path.join(makeTempDir('construct-writes-legacy-'), 'useLegacy.ts');
fs.writeFileSync(LEGACY, 'export function useLegacy() { return 1; }\n');
const PLAN = path.join(path.dirname(LEGACY), 'plan.json');
fs.writeFileSync(PLAN, JSON.stringify({ feature: 'widget', units: [{ name: 'Legacy', layers: ['domain', 'hook'], from: LEGACY }] }));

/** Run one request in both modes on twin projects; assert the contract; return both results and the twins. */
async function bothModes(run, params, { ok = true } = {}) {
  const [a, b] = [copy(), copy()];
  assert.deepEqual(tree(a), tree(b), 'the twins start identical');
  const engine = await run(a, params, { mode: 'engine' });
  const cli = await run(b, params, { mode: 'cli' });
  assert.equal(engine.mode, 'engine');
  assert.equal(cli.mode, 'cli');
  assert.equal(engine.doc.ok, ok, engine.report);
  assert.equal(cli.report, engine.report);
  assert.equal(cli.exitCode, engine.exitCode);
  assert.deepEqual(tree(b), tree(a), 'both modes leave byte-identical project trees');
  return { engine, cli, a, b };
}

// ---- create ---------------------------------------------------------------------------------------------

const CREATES = [
  ['a feature', { kind: 'feature', name: 'billing' }],
  ['a vertical slice (layer)', { kind: 'layer', name: 'invoice', feature: 'widget', layers: ['domain', 'service'] }],
  ['a single layer file', { kind: 'single', name: 'Total', feature: 'widget', layer: 'domain' }],
];
for (const [label, params] of CREATES) {
  test(`create parity: ${label} -- engine and cli output and the resulting trees are byte-identical`, async () => {
    const { engine, b } = await bothModes(runCreate, params);
    assert.equal(engine.doc.verb, 'create');
    assert.ok(engine.doc.kind === 'feature' ? fs.existsSync(path.join(b, engine.doc.path)) : engine.doc.files.length > 0 && engine.doc.files.every((f) => fs.existsSync(path.join(b, f))), 'what the document names exists');
    assert.match(engine.doc.attribution.llm, /^0 calls/);
    // and it is the CLI's own stdout
    const argv = params.kind === 'feature' ? ['feature', params.name] : params.kind === 'layer' ? ['layer', params.name, '--feature', params.feature, '--layers', params.layers.join(',')] : [params.layer, params.name, '--feature', params.feature];
    const direct = spawnSync(process.execPath, [CLI, 'create', ...argv, '--format', 'json', '--dir', copy()], { encoding: 'utf8' });
    assert.equal(direct.stdout, `${engine.report}\n`);
  });
}

test('create parity: a refused request is the same {ok:false, error} document and exit code in both modes', async () => {
  const { engine } = await bothModes(runCreate, { kind: 'single', name: 'X', feature: 'widget', layer: 'nonsense' }, { ok: false });
  assert.equal(engine.doc.error.code, 'INTERNAL_ERROR');
  assert.equal(engine.exitCode, 3);
});

// ---- refactor -------------------------------------------------------------------------------------------

test('refactor parity: rename -- the relocation document, the rewritten importer and the trees are byte-identical', async () => {
  const { engine, b } = await bothModes(runRefactor, { action: 'rename', name: 'WidgetComponent', newName: 'WidgetPanel', feature: 'widget', layer: 'component' });
  assert.equal(engine.doc.importersUpdated, 1);
  assert.ok(fs.existsSync(path.join(b, engine.doc.to)) && !fs.existsSync(path.join(b, engine.doc.from)));
  assert.match(fs.readFileSync(path.join(b, engine.doc.files[0]), 'utf8'), /WidgetPanel/);
});

test('refactor parity: move (with the re-validation of the moved file)', async () => {
  const { engine } = await bothModes(runRefactor, { action: 'move', name: 'WidgetComponent', feature: 'widget', from: 'component', to: 'page' });
  assert.equal(engine.doc.action, 'move');
  assert.ok(Array.isArray(engine.doc.violations));
});

test('refactor parity: a refused move is the same {ok:false, error} document and exit code in both modes', async () => {
  const { engine } = await bothModes(runRefactor, { action: 'move', name: 'Nope', feature: 'widget', from: 'component', to: 'page' }, { ok: false });
  assert.equal(engine.doc.error.code, 'USAGE_ERROR');
  assert.equal(engine.exitCode, 2);
});

// ---- import ---------------------------------------------------------------------------------------------

test('import parity: a unit (--from) -- document and trees are byte-identical, and the TODO(import) breadcrumb points at the source', async () => {
  const { engine, b } = await bothModes(runImport, { mode: 'unit', name: 'Legacy', feature: 'widget', layers: ['domain', 'hook'], from: LEGACY });
  assert.equal(engine.doc.results[0].files.length, 2);
  assert.match(fs.readFileSync(path.join(b, engine.doc.results[0].files[0]), 'utf8'), /TODO\(import\)/);
});

test('import parity: a plan (--plan)', async () => {
  const { engine } = await bothModes(runImport, { mode: 'plan', planPath: PLAN });
  assert.equal(engine.doc.mode, 'plan');
  assert.equal(engine.doc.feature, 'widget');
});

test('import parity: a source that does not exist is the same refusal in both modes', async () => {
  await bothModes(runImport, { mode: 'unit', name: 'Legacy', feature: 'widget', layers: ['domain'], from: path.join(path.dirname(LEGACY), 'missing.ts') }, { ok: false });
});

test('--format json refuses every flag that implies a model call or an external input (no silent LLM in a contract)', async () => {
  const dir = copy();
  const run = (verb, ...argv) => JSON.parse(spawnSync(process.execPath, [CLI, verb, ...argv, '--format', 'json', '--dir', dir], { encoding: 'utf8' }).stdout);
  assert.equal(run('create', 'layer', 'x', '--feature', 'widget', '--layers', 'domain', '--llm', 'claude').error.code, 'USAGE_ERROR');
  assert.equal(run('import', 'X', '--feature', 'widget', '--layers', 'domain', '--from', LEGACY, '--llm', 'claude').error.code, 'USAGE_ERROR');
  assert.equal(run('create', 'service', 'x', '--feature', 'widget', '--openapi', 'spec.yaml').error.code, 'USAGE_ERROR');
  assert.equal(run('refactor', 'extract-expression', 'a.tsx').error.code, 'USAGE_ERROR');
  assert.deepEqual(tree(dir), tree(copy()), 'and nothing was written');
});

// ---- the route logic ------------------------------------------------------------------------------------

const cliOnlyProject = () => {
  const dir = copy();
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'project:\n  framework: react-spa\n  execution:\n    mode: cli\n');
  return dir;
};
const twinRun = (fn) => (dir) => (args) => runCapturing(() => fn([...args, '--dir', dir]));

test('handleRefactor: cli mode shows the same output lines and attribution as the in-process path, plus mode', async () => {
  const body = { action: 'rename', name: 'WidgetComponent', newName: 'WidgetPanel', feature: 'widget', layer: 'component' };
  const inProc = copy();
  fs.writeFileSync(path.join(inProc, 'architecture.yml'), 'project:\n  framework: react-spa\n');
  const e = await handleRefactor({ body, projectDir: inProc, findRoot: () => inProc, inProcess: twinRun(refactor)(inProc) });
  const viaCli = cliOnlyProject();
  const c = await handleRefactor({ body, projectDir: viaCli, findRoot: () => viaCli, inProcess: () => { throw new Error('cli mode must not run in-process'); } });
  assert.equal(e.status, 200);
  assert.equal(c.status, 200);
  assert.equal(e.body.mode, 'engine');
  assert.equal(c.body.mode, 'cli');
  assert.deepEqual(c.body.output, e.body.output);
  assert.deepEqual(c.body.attribution, e.body.attribution);
  assert.ok(fs.existsSync(path.join(viaCli, 'features/widget/components/WidgetPanel.tsx')), 'the CLI mode really renamed the file');
});

test('handleCreate: cli mode lists what was created; a request that asks for the LLM stays in-process and says so; bad bodies are 400s', async () => {
  const dir = cliOnlyProject();
  const noRun = () => { throw new Error('must not run in-process'); };
  const made = await handleCreate({ body: { kind: 'single', name: 'Total', feature: 'widget', layer: 'domain' }, projectDir: dir, findRoot: () => dir, inProcess: noRun });
  assert.equal(made.status, 200);
  assert.equal(made.body.mode, 'cli');
  assert.deepEqual(made.body.output, ['Created features/widget/domain/Total.tsx']);
  assert.match(made.body.attribution.llm, /^0 calls/);
  let asked;
  const llm = await handleCreate({ body: { kind: 'layer', name: 'x', feature: 'widget', layers: ['domain'], useLlm: true }, projectDir: dir, findRoot: () => dir, inProcess: async (args) => { asked = args; return { ok: true, output: [], attribution: null, durationSeconds: 0, httpStatus: 200 }; }, llmProvider: () => 'ollama' });
  assert.deepEqual(asked, ['layer', 'x', '--feature', 'widget', '--layers', 'domain', '--llm', 'ollama']);
  assert.equal(llm.body.mode, 'engine');
  assert.equal(llm.body.note, LLM_IN_PROCESS_NOTE);
  // "a feature" has nothing fillable, so useLlm does not force it in-process
  const feat = await handleCreate({ body: { kind: 'feature', name: 'shop', useLlm: true }, projectDir: dir, findRoot: () => dir, inProcess: noRun });
  assert.equal(feat.body.mode, 'cli');
  assert.equal((await handleCreate({ body: { kind: 'nope' }, projectDir: dir, findRoot: () => dir, inProcess: noRun })).status, 400);
  assert.equal((await handleCreate({ body: { kind: 'feature' }, projectDir: dir, findRoot: () => dir, inProcess: noRun })).body.error, 'name is required');
  // the verb's own refusal is its message and status, not a 502
  const refused = await handleCreate({ body: { kind: 'single', name: 'X', feature: 'widget', layer: 'nonsense' }, projectDir: dir, findRoot: () => dir, inProcess: noRun });
  assert.equal(refused.status, 500);
  assert.equal(refused.body.ok, false);
  assert.match(refused.body.error, /Unknown layer/);
});

test('handleImport: the subprocess gets the CONTAINED path resolveRead returned, never the client\'s string; a refusal from containment is mapped; llm stays in-process', async () => {
  const dir = cliOnlyProject();
  const seen = [];
  const resolveRead = (v) => { seen.push(v); if (v === '../../etc/passwd') throw Object.assign(new Error('outside the workspace'), { status: 403 }); return LEGACY; };
  const mapError = (e) => ({ status: e.status ?? 400, body: { ok: false, error: e.message } });
  const noRun = () => { throw new Error('must not run in-process'); };
  const ok = await handleImport({ body: { mode: 'unit', name: 'Legacy', feature: 'widget', layers: ['domain'], from: 'some/client/path.ts' }, projectDir: dir, findRoot: () => dir, inProcess: noRun, resolveRead, mapError });
  assert.equal(ok.status, 200);
  assert.deepEqual(seen, ['some/client/path.ts']);
  assert.ok(fs.existsSync(path.join(dir, 'features/widget/domain/Legacy.tsx')), 'the CLI mode really scaffolded the file');
  assert.match(ok.body.output.join('\n'), new RegExp(LEGACY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const denied = await handleImport({ body: { mode: 'unit', name: 'A', feature: 'widget', layers: ['domain'], from: '../../etc/passwd' }, projectDir: dir, findRoot: () => dir, inProcess: noRun, resolveRead, mapError });
  assert.equal(denied.status, 403);
  const missing = await handleImport({ body: { mode: 'unit' }, projectDir: dir, findRoot: () => dir, inProcess: noRun, resolveRead, mapError });
  assert.equal(missing.status, 400);
  let asked;
  const viaLlm = await handleImport({ body: { mode: 'plan', planPath: 'p.json', useLlm: true }, projectDir: dir, findRoot: () => dir, inProcess: async (a) => { asked = a; return { ok: true, output: [], attribution: null, durationSeconds: 0, httpStatus: 200 }; }, resolveRead, mapError, llmProvider: () => 'claude' });
  assert.deepEqual(asked, ['--plan', LEGACY, '--llm', 'claude']);
  assert.equal(viaLlm.body.mode, 'engine');
});

test('cli mode obeys the same per-login queue as the in-process path: two writes to one project never overlap', async () => {
  const dir = cliOnlyProject();
  const scratch = makeTempDir('construct-writes-queue-');
  const log = path.join(scratch, 'log.txt');
  const slow = path.join(scratch, 'slow.mjs');
  fs.writeFileSync(slow, `import fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(log)}, 'start ' + Date.now() + '\\n');\nawait new Promise((r) => setTimeout(r, 300));\nfs.appendFileSync(${JSON.stringify(log)}, 'end ' + Date.now() + '\\n');\nconsole.log(JSON.stringify({ ok: true, verb: 'refactor', action: 'move', from: 'a', to: 'b', importersUpdated: 0, files: [], violations: [], attribution: null }));\n`);
  const ask = () => handleRefactor({ body: { action: 'move', name: 'A', feature: 'f', from: 'a', to: 'b' }, projectDir: dir, findRoot: () => dir, inProcess: () => { throw new Error('no'); }, cli: { bin: slow, timeoutMs: 10_000 } });
  const [r1, r2] = await Promise.all([ask(), ask()]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  const events = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => l.split(' ')[0]);
  assert.deepEqual(events, ['start', 'end', 'start', 'end'], 'the second subprocess started only after the first ended');
});

test('handle* (cli mode): a CLI that cannot run is a 502 with its own message; an unknown project.execution.mode is a 400', async () => {
  const dir = cliOnlyProject();
  const bad = path.join(makeTempDir('construct-writes-bin-'), 'bad.mjs');
  fs.writeFileSync(bad, 'console.error("boom"); process.exit(9);');
  const r = await handleRefactor({ body: { action: 'move', name: 'A', feature: 'f', from: 'a', to: 'b' }, projectDir: dir, findRoot: () => dir, inProcess: () => { throw new Error('no'); }, cli: { bin: bad, timeoutMs: 3000 } });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /boom/);
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'project:\n  execution:\n    mode: bogus\n');
  const m = await handleCreate({ body: { kind: 'feature', name: 'x' }, projectDir: dir, findRoot: () => dir, inProcess: () => { throw new Error('no'); } });
  assert.equal(m.status, 400);
  assert.match(m.body.error, /Unknown project\.execution\.mode 'bogus'/);
});
