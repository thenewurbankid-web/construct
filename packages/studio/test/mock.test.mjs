// LINE-MODULE: @line/studio's mock (mock.mjs) has the real names and result shapes of bin/cli.mjs and bin/doctor.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as cli from '../bin/cli.mjs';
import * as doctor from '../bin/doctor.mjs';
import * as mock from '../mock.mjs';

const real = { ...cli, ...doctor };

test('every name the mock exports is a real export of the same kind, with the same constant values', () => {
  for (const [name, value] of Object.entries(mock)) {
    assert.ok(name in real, `${name} is not exported by bin/cli.mjs or bin/doctor.mjs`);
    assert.equal(typeof value, typeof real[name], name);
  }
  for (const k of ['DEFAULT_WORKSPACE_DIR', 'DEFAULT_OLLAMA_URL', 'MIN_NODE_MAJOR']) assert.equal(mock[k], real[k], k);
});

test('runDoctor: the mock report has the real result fields and check ids', async () => {
  const pass = async () => true;
  const r = await doctor.runDoctor({ probes: { node: async () => '22.0.0', ffmpeg: pass, ffprobe: pass, chromium: pass, ollama: pass, kokoro: pass, python: pass }, env: {} });
  const m = await mock.runDoctor();
  assert.deepEqual(m.results.map((x) => x.id), r.results.map((x) => x.id));
  assert.deepEqual(Object.keys(m.results[0]).sort(), Object.keys(r.results[0]).sort());
  assert.equal(m.exitCode, r.exitCode);
  assert.equal((await mock.runDoctor({ missing: ['ffmpeg'] })).exitCode, 1);
});

test('main: --version 0, unknown command 2, as the real one; start gives null', async () => {
  const quiet = { out: () => {}, err: () => {} };
  assert.equal(await cli.main(['--version'], quiet), 0);
  assert.equal(await mock.main(['--version'], quiet), 0);
  assert.equal(await cli.main(['frobnicate'], quiet), 2);
  assert.equal(await mock.main(['frobnicate'], quiet), 2);
  assert.equal(await mock.main(['start'], quiet), null);
});
