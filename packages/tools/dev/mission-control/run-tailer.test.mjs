// Mission Control's run tailer over a run whose logs/ holds directories (turn-input/, turn-output/ since #913):
// the call rows still load, no reader tails a directory, and a failing reader is reported once and isolated (#922).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTailer, rawLogNames, fileTail } from './run-tailer.mjs';

const fixtureLogs = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/runs/fixture-qwen/logs');

/** A temp run: the fixture's calls/turns, a raw agent.out, and the #913 turn-input/ and turn-output/ dirs. */
function makeRun() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-mc-tailer-'));
  const logs = path.join(dir, 'logs');
  fs.mkdirSync(path.join(logs, 'turn-input'), { recursive: true });
  fs.mkdirSync(path.join(logs, 'turn-output'));
  fs.writeFileSync(path.join(logs, 'turn-input', '1.json'), '{"messages":[]}');
  fs.writeFileSync(path.join(logs, 'turn-output', '1.json'), '{"content":"x"}');
  for (const f of ['calls.jsonl', 'turns.jsonl']) fs.copyFileSync(path.join(fixtureLogs, f), path.join(logs, f));
  fs.writeFileSync(path.join(logs, 'agent.out'), 'hello\nworld\n');
  fs.writeFileSync(path.join(logs, 'system-prompt.txt'), 'prompt\n');
  return { dir, logs };
}

test('rawLogNames lists plain text logs only, never the turn-input/turn-output directories', () => {
  const { dir, logs } = makeRun();
  try {
    assert.deepEqual(rawLogNames(logs).sort(), ['agent.out', 'system-prompt.txt']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a fileTail pointed at a directory reads as absent instead of throwing EISDIR', () => {
  const { dir, logs } = makeRun();
  try {
    assert.equal(fileTail(path.join(logs, 'turn-input'), 'raw').read(), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a run with turn-input/ and turn-output/ dirs loads its call rows and raw console lines, with no reader error', () => {
  const { dir } = makeRun();
  const errors = [];
  const t = runTailer(dir, { onError: (m) => errors.push(m) });
  try {
    const delta = t.poll();
    assert.deepEqual(errors, []);
    assert.equal(t.state.rows.length, 14);
    assert.equal(delta.upserts.length, 14);
    assert.deepEqual(delta.console.map((l) => `${l.file}:${l.line}`).filter((s) => s.startsWith('agent.out')), ['agent.out:hello', 'agent.out:world']);
    assert.equal(t.poll(), null);
    assert.ok(t.summary().timeline);
  } finally { t.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a reader that throws is reported once and does not stop the call rows from loading', { skip: process.getuid?.() === 0 && 'root ignores file modes' }, () => {
  const { dir, logs } = makeRun();
  const bad = path.join(logs, 'agent.out');
  fs.chmodSync(bad, 0o000);
  const errors = [];
  const t = runTailer(dir, { onError: (m) => errors.push(m) });
  try {
    t.poll();
    assert.equal(t.state.rows.length, 14);
    fs.appendFileSync(path.join(logs, 'system-prompt.txt'), 'more\n');
    const d2 = t.poll();
    assert.deepEqual(d2.console.map((l) => l.line), ['more']);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^agent\.out: EACCES/);
    fs.chmodSync(bad, 0o644);
    const d3 = t.poll();
    assert.deepEqual(d3.console.map((l) => l.line), ['hello', 'world']);
    assert.equal(errors.length, 1);
  } finally { t.close(); fs.chmodSync(bad, 0o644); fs.rmSync(dir, { recursive: true, force: true }); }
});
