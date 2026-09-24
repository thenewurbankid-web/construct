// #541 -- the parity CONTRACT for every core verb the Cockpit can switch between its in-process `engine` and the
// real `construct` binary (`cli`), beyond validate (test/executionModeParity.test.mjs): the SAME throwaway project
// goes through both modes and the whole `--format json` document is compared as a string, nothing normalized.
// Each verb also has a "the CLI's own stdout" check, so the executor cannot rebuild what it claims the CLI printed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { runSummarize, runDoctor, summarizeHasJsonContract } from '../ui/server/src/coreVerbs.mjs';
import { handleResearch, NO_JSON_CONTRACT_NOTE } from '../ui/server/src/researchApi.mjs';
import { runCapturing } from '../ui/server/src/commandRunner.mjs';
import { research, renderDoctorText } from '../packages/core/cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, '..', 'fixtures');
const CLI = path.join(here, '..', 'packages', 'cli', 'construct.mjs');

/** A throwaway COPY of a fixture (see executionModeParity.test.mjs: never validate a fixture in place). */
const project = (rel, prefix = 'construct-verbs-') => {
  const dir = makeTempDir(prefix);
  fs.cpSync(path.join(FIXTURES, rel), dir, { recursive: true });
  return dir;
};
const direct = (dir, ...argv) => spawnSync(process.execPath, [CLI, ...argv, '--dir', dir], { encoding: 'utf8' });
/** Set `project.execution.mode` in a project's architecture.yml (replacing the whole file: these tests need only it). */
const setMode = (dir, mode) => fs.writeFileSync(path.join(dir, 'architecture.yml'), `project:\n  framework: react-spa\n  execution:\n    mode: ${mode}\n`);

// ---- summarize ------------------------------------------------------------------------------------------

for (const fixture of ['architecture-valid-react-spa', 'architecture-valid', 'frozen-presentation/project-bad']) {
  test(`summarize parity: ${fixture} -- engine and cli output are byte-identical`, async () => {
    const dir = project(fixture);
    const engine = await runSummarize(dir, { mode: 'engine' });
    const cli = await runSummarize(dir, { mode: 'cli' });
    assert.equal(engine.mode, 'engine');
    assert.equal(cli.mode, 'cli');
    assert.ok(engine.doc.length > 0, 'the fixture must have features, or the comparison is vacuous');
    assert.equal(cli.report, engine.report);
    assert.equal(cli.exitCode, engine.exitCode);
    assert.equal(direct(dir, 'summarize', '--format', 'json').stdout, `${engine.report}\n`);
  });
}

test('summarize parity holds for a single --feature too', async () => {
  const dir = project('architecture-valid-react-spa');
  const name = (await runSummarize(dir, { mode: 'cli' })).doc[0].feature;
  const engine = await runSummarize(dir, { mode: 'engine', feature: name });
  const cli = await runSummarize(dir, { mode: 'cli', feature: name });
  assert.equal(cli.report, engine.report);
  assert.equal(cli.doc.length, 1);
  assert.equal(cli.doc[0].feature, name);
});

test('summarizeHasJsonContract: only the default JSON view is served by the CLI', () => {
  assert.equal(summarizeHasJsonContract({}), true);
  assert.equal(summarizeHasJsonContract({ format: 'json' }), true);
  for (const format of ['md', 'compact', 'prose']) assert.equal(summarizeHasJsonContract({ format }), false);
  assert.equal(summarizeHasJsonContract({ since: 'HEAD~1' }), false);
});

// ---- doctor (research doctor) -------------------------------------------------------------------------------

test('doctor parity: engine and cli output are byte-identical, for a project and for a folder with no architecture.yml', async () => {
  for (const dir of [project('architecture-valid-react-spa'), makeTempDir('construct-verbs-empty-')]) {
    const engine = await runDoctor(dir, { mode: 'engine' });
    const cli = await runDoctor(dir, { mode: 'cli' });
    assert.equal(cli.report, engine.report);
    assert.equal(cli.doc.architectureYml, fs.existsSync(path.join(dir, 'architecture.yml')));
    assert.equal(direct(dir, 'doctor', '--format', 'json').stdout, `${engine.report}\n`);
  }
});

test('doctor: the text form is rendered from the same document, so the text CLI and the JSON CLI cannot disagree', async () => {
  const dir = project('architecture-valid-react-spa');
  const text = direct(dir, 'doctor').stdout.replace(/\n$/, '').split('\n');
  const { doc } = await runDoctor(dir, { mode: 'cli' });
  assert.deepEqual(renderDoctorText(doc), text);
});

// ---- the /api/research route logic ----------------------------------------------------------------------------

test('handleResearch: cli mode answers with the same output lines and attribution as the in-process path, plus mode', async () => {
  const dir = project('architecture-valid-react-spa');
  const inProcess = (args) => runCapturing(() => research([...args, '--dir', dir]));
  const ask = (body) => handleResearch({ body, projectDir: dir, findRoot: () => dir, inProcess });
  for (const body of [{ action: 'summarize' }, { action: 'doctor' }]) {
    setMode(dir, 'engine');
    const e = await ask(body);
    setMode(dir, 'cli');
    const c = await handleResearch({ body, projectDir: dir, findRoot: () => dir, inProcess: () => { throw new Error('cli mode must not run in-process'); } });
    assert.equal(e.status, 200);
    assert.equal(c.status, 200);
    assert.equal(e.body.mode, 'engine');
    assert.equal(c.body.mode, 'cli');
    assert.ok(e.body.output.length > 0);
    assert.deepEqual(c.body.output, e.body.output);
    assert.deepEqual(c.body.attribution, e.body.attribution);
  }
});

test('handleResearch (cli mode): views without a JSON contract stay in-process and say so; unknown actions and modes are 400s', async () => {
  const dir = project('architecture-valid-react-spa');
  setMode(dir, 'cli');
  let asked;
  const ctx = { projectDir: dir, findRoot: () => dir, inProcess: async (args) => { asked = args; return { ok: true, output: ['x'], attribution: null, durationSeconds: 0, httpStatus: 200 }; } };
  const md = await handleResearch({ ...ctx, body: { action: 'summarize', format: 'md' } });
  assert.deepEqual(asked, ['summarize', '--format', 'md']);
  assert.equal(md.body.mode, 'engine');
  assert.equal(md.body.note, NO_JSON_CONTRACT_NOTE);
  assert.equal((await handleResearch({ ...ctx, body: { action: 'nope' } })).status, 400);
  setMode(dir, 'bogus');
  const bad = await handleResearch({ ...ctx, body: { action: 'doctor' } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Unknown project\.execution\.mode 'bogus'/);
});

test('handleResearch (cli mode): a CLI that cannot run is a 502 with its own message, never an empty result', async () => {
  const dir = project('architecture-valid-react-spa');
  setMode(dir, 'cli');
  const bad = path.join(makeTempDir('construct-verbs-bin-'), 'bad.mjs');
  fs.writeFileSync(bad, 'console.error("boom"); process.exit(3);');
  const r = await handleResearch({ body: { action: 'summarize' }, projectDir: dir, findRoot: () => dir, inProcess: () => { throw new Error('no'); }, cli: { bin: bad, timeoutMs: 3000 } });
  assert.equal(r.status, 502);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /boom/);
});
