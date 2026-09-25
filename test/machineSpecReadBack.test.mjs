// #672 (R4, part of #576) -- `construct research spec <file> --read-back`: an accepted machine-spec
// read back as plain English per requirement sentence, in the workflow narrator's words.
//
// Pinned here: the worked example's output, text and JSON, byte for byte (golden files under
// fixtures/machine-spec-readback/, regenerate by re-running the CLI when the wording is meant to
// change); that no sentence and no item is dropped; that a sentence out of scope is listed as such;
// the sentence ids are the spec's own; and the CLI's exit codes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readBackMachineSpec, renderReadBack, READ_BACK_SCHEMA } from '../packages/core/research/readBack.mjs';
import { EXIT_CODES } from '../packages/core/diagnostics.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE_REL = 'packages/core/research/examples/machine-spec.v1.example.json';
const GOLDEN = path.join(REPO_ROOT, 'fixtures', 'machine-spec-readback');
const BIN = path.join(REPO_ROOT, 'packages', 'cli', 'construct.mjs');
const example = () => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, EXAMPLE_REL), 'utf8'));
const run = (args) => spawnSync('node', [BIN, ...args], { encoding: 'utf8', cwd: REPO_ROOT });
const golden = (name) => fs.readFileSync(path.join(GOLDEN, name), 'utf8');

test('the worked example reads back exactly as pinned (text and json), through the CLI', () => {
  const text = run(['research', 'spec', EXAMPLE_REL, '--read-back']);
  assert.equal(text.status, EXIT_CODES.OK, text.stderr);
  assert.ok(text.stdout.startsWith(golden('example.txt')), 'text read-back differs from fixtures/machine-spec-readback/example.txt');
  assert.match(text.stdout, /\[tool: produced the read-only report above\] \[llm: 0 calls\]/);

  const json = run(['research', 'spec', EXAMPLE_REL, '--read-back', '--format', 'json']);
  assert.equal(json.status, EXIT_CODES.OK, json.stderr);
  assert.equal(json.stdout, golden('example.json'), 'json read-back differs from fixtures/machine-spec-readback/example.json (pure JSON: no attribution line)');
});

test('the library and the CLI agree; the shape is fixed and ids are the spec\'s own', () => {
  const spec = example();
  const rb = readBackMachineSpec(spec);
  assert.equal(rb.schema, READ_BACK_SCHEMA);
  assert.deepEqual(Object.keys(rb), ['schema', 'name', 'feature', 'summary', 'sentences', 'types', 'counts']);
  assert.deepEqual(rb.sentences.map((s) => s.id), spec.requirement.map((r) => r.id));
  for (const s of rb.sentences) assert.deepEqual(Object.keys(s), ['id', 'text', 'status', 'reason', 'states', 'events', 'transitions', 'functions']);
  assert.equal(`${renderReadBack(rb, { format: 'json' })}\n`, golden('example.json'));
  assert.deepEqual(rb.counts, { sentences: 6, covered: 5, outOfScope: 1, uncovered: 0, types: 1 });
});

test('nothing is dropped: every item shows under each sentence it claims, every sentence is present', () => {
  const spec = example();
  const rb = readBackMachineSpec(spec);
  const idOfKind = { states: (s) => s.id, events: (e) => e.id, transitions: (t) => t.id, functions: (f) => f.name };
  for (const [kind, idOf] of Object.entries(idOfKind)) {
    for (const item of spec[kind]) {
      const where = rb.sentences.filter((s) => s[kind].some((x) => x.id === idOf(item))).map((s) => s.id);
      assert.deepEqual(where, spec.requirement.map((r) => r.id).filter((id) => item.req.includes(id)), `${kind} ${idOf(item)}`);
    }
  }
  assert.deepEqual(rb.types.map((t) => t.id), ['Session']);
});

test('a sentence marked out of scope is listed as such, with its reason and no items', () => {
  const rb = readBackMachineSpec(example());
  const s6 = rb.sentences.find((s) => s.id === 's6');
  assert.equal(s6.status, 'out-of-scope');
  assert.match(s6.reason, /performance budget/);
  assert.deepEqual([s6.states, s6.events, s6.transitions, s6.functions], [[], [], [], []]);
  assert.match(renderReadBack(rb), /s6: The sign-in page must load in under two seconds\.\n {2}Out of scope: A performance budget/);
});

test('a guarded transition and its unguarded fallback read as the narrator words them', () => {
  const rb = readBackMachineSpec(example());
  const text = (id) => rb.sentences.flatMap((s) => s.transitions).find((t) => t.id === id).text;
  assert.equal(text('t3'), 'In *checking*: When "invalid" happens, the flow moves to *locked out* — only if the "attempts exhausted" condition holds.');
  assert.equal(text('t4'), 'In *checking*: Otherwise, the flow moves to *failed*.');
});

test('a spec nothing was validated for still shows an unclaimed sentence, as uncovered', () => {
  const spec = example();
  spec.outOfScope = [];
  const rb = readBackMachineSpec(spec);
  assert.equal(rb.sentences.find((s) => s.id === 's6').status, 'uncovered');
  assert.equal(rb.counts.uncovered, 1);
  assert.match(renderReadBack(rb), /Not covered by anything, and not marked out of scope\./);
  assert.match(renderReadBack(rb), /1 NOT covered/);
});

test('CLI: a failing spec prints the validation report and reads nothing back; flag conflicts are usage errors', () => {
  const bad = run(['research', 'spec', 'fixtures/machine-spec/unreachable-state.json', '--read-back']);
  assert.equal(bad.status, EXIT_CODES.VIOLATIONS);
  assert.match(bad.stdout, /❌ SPEC-007/);
  assert.doesNotMatch(bad.stdout, /Read-back of/);
  const badJson = run(['research', 'spec', 'fixtures/machine-spec/unreachable-state.json', '--read-back', '--format', 'json']);
  assert.equal(JSON.parse(badJson.stdout).status, 'failed');

  const both = run(['research', 'spec', EXAMPLE_REL, '--read-back', '--generate']);
  assert.equal(both.status, EXIT_CODES.USAGE_ERROR);
  assert.match(both.stderr, /--read-back/);

  assert.equal(run(['research', 'spec', 'fixtures/machine-spec-readback/nope.json', '--read-back']).status, EXIT_CODES.USAGE_ERROR);
});
