// #541 -- the parity CONTRACT for every core verb the Cockpit can switch between its in-process `engine` and the
// real `construct` binary (`cli`), beyond validate (test/executionModeParity.test.mjs): the SAME throwaway project
// goes through both modes and the whole `--format json` document is compared as a string, nothing normalized.
// Each verb also has a "the CLI's own stdout" check, so the executor cannot rebuild what it claims the CLI printed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

// #648: the doctor document has a `now` part (free memory and disk at this second), which two runs cannot share; everything else is stable.
const withoutNow = (json) => {
  const { now, ...rest } = JSON.parse(json);
  assert.deepEqual(Object.keys(now), ['freeMemoryMb', 'freeDiskMb', 'warnings']);
  return rest;
};

// #660: the doctor document also carries the free disk figure inside `tier.reason` ("Cockpit use needs 2 GB of free disk (this
// machine has 1.8 GB)") and, near a threshold, in `tier.id` itself. Tests write to a tmpfs /tmp of a few GB, so that figure moves
// between two reads (and between parallel test files). The fix holds the disk still instead of hiding `tier` from the comparison:
// every doctor run of the parity test (in-process and child processes) sees the same fake `statfs` answer, the children through a
// tiny wrapper around the real CLI (`bin`), so everything below `now` is compared unmasked.
const FIXED_FREE_DISK_MB = 1500; // under the Cockpit tier's 2 GB, so the figure IS part of `tier.reason`: a leak would show
const fakeStatfs = () => ({ bavail: FIXED_FREE_DISK_MB, bsize: 1048576 });
/** Runs `fn(wrapperBin)` with the disk held still: in this process (`fs.statfsSync`), and for the CLI children (pass `wrapperBin` as `bin`, or read it from CONSTRUCT_CLI_BIN, set here). */
const withDiskHeldStill = async (fn) => {
  const wrapper = path.join(makeTempDir('construct-verbs-disk-'), 'construct-fixed-disk.mjs');
  fs.writeFileSync(wrapper, [
    "import fs from 'node:fs';",
    `fs.statfsSync = () => ({ bavail: ${FIXED_FREE_DISK_MB}, bsize: 1048576 });`,
    `await import(${JSON.stringify(pathToFileURL(CLI).href)});`,
    '',
  ].join('\n'));
  const realStatfs = fs.statfsSync;
  const realBin = process.env.CONSTRUCT_CLI_BIN;
  fs.statfsSync = fakeStatfs;
  process.env.CONSTRUCT_CLI_BIN = wrapper;
  try {
    return await fn(wrapper);
  } finally {
    fs.statfsSync = realStatfs;
    if (realBin === undefined) delete process.env.CONSTRUCT_CLI_BIN; else process.env.CONSTRUCT_CLI_BIN = realBin;
  }
};

test('doctor parity: engine and cli output are identical (apart from the free memory and disk right now), for a project and for a folder with no architecture.yml', () => withDiskHeldStill(async (wrapper) => {
  for (const dir of [project('architecture-valid-react-spa'), makeTempDir('construct-verbs-empty-')]) {
    const engine = await runDoctor(dir, { mode: 'engine' });
    const cli = await runDoctor(dir, { mode: 'cli', bin: wrapper });
    assert.equal(JSON.parse(engine.report).now.freeDiskMb, FIXED_FREE_DISK_MB, 'the fake disk figure must reach the report, or the comparison is vacuous');
    assert.equal(JSON.parse(cli.report).now.freeDiskMb, FIXED_FREE_DISK_MB);
    assert.deepEqual(withoutNow(cli.report), withoutNow(engine.report));
    assert.equal(cli.doc.architectureYml, fs.existsSync(path.join(dir, 'architecture.yml')));
    const own = spawnSync(process.execPath, [wrapper, 'doctor', '--dir', dir, '--format', 'json'], { encoding: 'utf8' });
    assert.deepEqual(withoutNow(own.stdout), withoutNow(engine.report));
  }
}));

test('doctor: the text form is rendered from the same document, so the text CLI and the JSON CLI cannot disagree', () => withDiskHeldStill(async (wrapper) => {
  const dir = project('architecture-valid-react-spa');
  const stable = (lines) => lines.filter((l) => !l.startsWith('  Right now:'));
  const text = spawnSync(process.execPath, [wrapper, 'doctor', '--dir', dir], { encoding: 'utf8' }).stdout.replace(/\n$/, '').split('\n');
  const { doc } = await runDoctor(dir, { mode: 'cli', bin: wrapper });
  assert.deepEqual(stable(renderDoctorText(doc)), stable(text));
}));

// ---- the /api/research route logic ----------------------------------------------------------------------------

test('handleResearch: cli mode answers with the same output lines and attribution as the in-process path, plus mode', () => withDiskHeldStill(async () => { // #660: the tier line names the free disk
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
    const stable = (o) => (Array.isArray(o) ? o.filter((l) => !String(l).startsWith('  Right now:')) : o); // #648: free memory and disk differ between two runs
    assert.deepEqual(stable(c.body.output), stable(e.body.output));
    assert.deepEqual(c.body.attribution, e.body.attribution);
  }
}));

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
