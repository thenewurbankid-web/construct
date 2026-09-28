// #576 (R3) -- English to a machine-spec.v1 draft: splitRequirement (deterministic) and
// draftMachineSpec (one bounded retry, fed the previous attempt and its concrete violations, #496).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { splitRequirement, buildDraftPrompt, draftMachineSpec, traceChoiceFromDraft } from '../packages/core/research/specFromRequirement.mjs';
import { PROVIDERS } from '../packages/core/llm.mjs';
import { buildTrace } from '../packages/core/decision-trace.mjs';
import { readTraces } from '../packages/core/decision-trace-store.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages/core/research/examples/machine-spec.v1.example.json'), 'utf8'));
const BIN = path.join(REPO_ROOT, 'packages', 'cli', 'construct.mjs');
const run = (args, opts) => spawnSync('node', [BIN, ...args], { encoding: 'utf8', cwd: REPO_ROOT, ...opts });

async function withFakeClaude(replies, fn) {
  const original = PROVIDERS.claude;
  const queue = Array.isArray(replies) ? [...replies] : [replies];
  const prompts = [];
  PROVIDERS.claude = (prompt) => {
    prompts.push(prompt);
    return queue.length > 1 ? queue.shift() : queue[0];
  };
  try {
    return await fn(prompts);
  } finally {
    PROVIDERS.claude = original;
  }
}

test('splitRequirement assigns s1, s2, ... in reading order and drops blank lines', () => {
  const req = splitRequirement('First sentence.\n\n  Second sentence.  \n\nThird.');
  assert.deepEqual(req, [
    { id: 's1', text: 'First sentence.' },
    { id: 's2', text: 'Second sentence.' },
    { id: 's3', text: 'Third.' },
  ]);
});

test('buildDraftPrompt carries the schema, the worked example, the requirement, and a retry carries the previous attempt and why it failed', () => {
  const req = [{ id: 's1', text: 'A visitor signs in.' }];
  const first = buildDraftPrompt(req, { feature: 'auth' });
  assert.match(first, /machine-spec\.v1\.schema\.json/);
  assert.match(first, /sign-in with retry/);
  assert.match(first, /A visitor signs in\./);
  assert.match(first, /Set "feature" to "auth"/);
  assert.doesNotMatch(first, /previous attempt/);

  const retry = buildDraftPrompt(req, { feature: 'auth', previous: { raw: '{"bad": true}', report: '❌ SPEC-001 ...' } });
  assert.match(retry, /your previous attempt \(rejected\)/);
  assert.match(retry, /\{"bad": true\}/);
  assert.match(retry, /SPEC-001/);
});

test('draftMachineSpec accepts a first-try spec that passes validateMachineSpec, without a second call', async () => {
  await withFakeClaude(JSON.stringify(EXAMPLE), async (prompts) => {
    const result = await draftMachineSpec('claude', EXAMPLE.requirement, { feature: 'auth' });
    assert.equal(result.status, 'accepted');
    assert.equal(result.attempts, 1);
    assert.deepEqual(result.spec, EXAMPLE);
    assert.equal(prompts.length, 1);
  });
});

test('draftMachineSpec strips a code fence and accepts', async () => {
  await withFakeClaude('```json\n' + JSON.stringify(EXAMPLE) + '\n```', async () => {
    const result = await draftMachineSpec('claude', EXAMPLE.requirement);
    assert.equal(result.status, 'accepted');
  });
});

test('draftMachineSpec retries once with the violations fed back, and accepts the corrected reply', async () => {
  const broken = { ...EXAMPLE, states: EXAMPLE.states.filter((s) => s.id !== 'idle') }; // drops the initial state -> SPEC-00x
  await withFakeClaude([JSON.stringify(broken), JSON.stringify(EXAMPLE)], async (prompts) => {
    const result = await draftMachineSpec('claude', EXAMPLE.requirement, { feature: 'auth' });
    assert.equal(result.status, 'accepted');
    assert.equal(result.attempts, 2);
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /your previous attempt \(rejected\)/);
    assert.match(prompts[1], /"idle"/); // the broken attempt's own JSON, fed back verbatim
  });
});

test('draftMachineSpec rejects after the retry budget with the violations, never a third attempt', async () => {
  const broken = { ...EXAMPLE, states: [] };
  await withFakeClaude(JSON.stringify(broken), async (prompts) => {
    const result = await draftMachineSpec('claude', EXAMPLE.requirement);
    assert.equal(result.status, 'rejected');
    assert.equal(result.attempts, 2);
    assert.equal(prompts.length, 2);
    assert.ok(result.violations.length > 0);
  });
});

test('draftMachineSpec surfaces a non-JSON reply as a rejection, not a thrown error, after the retry budget', async () => {
  await withFakeClaude('sure, here is your spec: (just kidding)', async () => {
    const result = await draftMachineSpec('claude', EXAMPLE.requirement);
    assert.equal(result.status, 'rejected');
    assert.match(result.report, /did not parse as JSON/);
  });
});

test('draftMachineSpec reports a provider throw as failed, never retried', async () => {
  const original = PROVIDERS.claude;
  PROVIDERS.claude = () => { throw new Error('claude CLI not found'); };
  try {
    const result = await draftMachineSpec('claude', EXAMPLE.requirement);
    assert.equal(result.status, 'failed');
    assert.equal(result.attempts, 1);
    assert.match(result.reason, /claude CLI not found/);
  } finally {
    PROVIDERS.claude = original;
  }
});

test('traceChoiceFromDraft is a closed accept/reject chooser that builds into a valid decision-trace', () => {
  const req = [{ id: 's1', text: 'A visitor signs in.' }];
  const accepted = traceChoiceFromDraft(req, { feature: 'auth' }, { status: 'accepted', attempts: 1 });
  assert.equal(accepted.chosen, 'accepted');
  assert.equal(accepted.by, 'llm');
  assert.equal(accepted.chooser.id, 'research.spec.draft');
  const built = buildTrace({ ...accepted, provider: { name: 'claude', version: '1' } }, { at: '2026-09-24T10:00:00.000Z' });
  assert.equal(built.ok, true, JSON.stringify(built.errors));

  const rejected = traceChoiceFromDraft(req, {}, { status: 'rejected', attempts: 2 });
  assert.equal(rejected.chosen, 'rejected');
  assert.equal(buildTrace({ ...rejected, provider: { name: 'claude', version: '1' } }, { at: '2026-09-24T10:00:00.000Z' }).ok, true);
});

test('research spec draft records a decision-trace for an accepted draft', async () => {
  const { researchSpecDraft } = await import('../packages/core/cli.mjs');
  const dir = makeTempDir('spec-draft-');
  const stateDir = makeTempDir('spec-draft-state-');
  const reqFile = path.join(dir, 'req.txt');
  fs.writeFileSync(reqFile, EXAMPLE.requirement.map((r) => r.text).join('\n') + '\n');
  const originalStateDir = process.env.CONSTRUCT_STATE_DIR;
  process.env.CONSTRUCT_STATE_DIR = stateDir;
  try {
    await withFakeClaude(JSON.stringify(EXAMPLE), async () => {
      await researchSpecDraft([reqFile, '--llm', 'claude', '--dir', dir]);
    });
  } finally {
    if (originalStateDir === undefined) delete process.env.CONSTRUCT_STATE_DIR;
    else process.env.CONSTRUCT_STATE_DIR = originalStateDir;
  }
  const read = readTraces(dir, { stateDir });
  assert.equal(read.decisions.length, 1);
  assert.equal(read.decisions[0].chooser.id, 'research.spec.draft');
  assert.equal(read.decisions[0].chosen, 'accepted');
  assert.equal(read.decisions[0].by, 'llm');
  assert.equal(read.decisions[0].provider.name, 'claude');
});

test('CLI: construct research spec draft requires --llm', () => {
  const dir = makeTempDir('spec-draft-');
  const reqFile = path.join(dir, 'req.txt');
  fs.writeFileSync(reqFile, 'A visitor signs in.\n');
  const r = run(['research', 'spec', 'draft', reqFile]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--llm/);
});

test('CLI: construct research spec draft --llm <unknown provider> fails with a clear error and writes nothing', () => {
  const dir = makeTempDir('spec-draft-');
  const reqFile = path.join(dir, 'req.txt');
  const outFile = path.join(dir, 'draft.machine-spec.json');
  fs.writeFileSync(reqFile, EXAMPLE.requirement.map((r) => r.text).join('\n') + '\n');
  const r = run(['research', 'spec', 'draft', reqFile, '--llm', 'not-a-real-provider', '--out', outFile]);
  assert.equal(r.status, 2);
  assert.match(r.stdout + r.stderr, /Unknown --llm provider "not-a-real-provider"/);
  assert.equal(fs.existsSync(outFile), false);
});
