// cs2: `construct line rules apply` is a person's step. A run with no interactive terminal (an agent's shell, a pipe)
// is refused before anything is written, even when a proposal passed the gate; a gate refusal still reads as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACTORY_FILES } from '../contract.mjs';
import { APPLIED_FILE, CHECKOUT } from '../apply.mjs';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../cli/construct.mjs');
const SAMPLE = path.join(CHECKOUT, 'examples/line-sample');
const hash = (f) => { try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(CHECKOUT, f))).digest('hex'); } catch { return null; } };
const RULE_FILES = [APPLIED_FILE, 'packages/engine/line/drafter/lexicon.json', 'packages/engine/line/fix-ranking.json'];

function project(gate) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'construct-rules-apply-')));
  fs.cpSync(SAMPLE, root, { recursive: true });
  fs.mkdirSync(path.join(root, path.dirname(FACTORY_FILES.proposals)), { recursive: true });
  fs.writeFileSync(path.join(root, FACTORY_FILES.proposals), JSON.stringify({ proposals: [{ id: 'rp-test', kind: 'lexicon', sentence: 'A planted proposal.' }] }));
  fs.writeFileSync(path.join(root, FACTORY_FILES.gate), JSON.stringify(gate));
  return root;
}
const run = (root) => spawnSync(process.execPath, [CLI, 'line', 'rules', 'apply', '--dir', root], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input: 'y\n' });

test('a passed proposal is not applied from a run with no terminal, even answering y on a pipe', () => {
  const root = project({ passed: ['rp-test'], results: [] });
  try {
    const before = RULE_FILES.map(hash);
    const r = run(root);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stdout, /Applying rules is a person's step: run `construct line rules apply` in a terminal/);
    assert.match(r.stdout, /Nothing was applied\./);
    assert.deepEqual(RULE_FILES.map(hash), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a gate refusal reads as before with no terminal', () => {
  const root = project({ passed: [], results: [] });
  try {
    const r = run(root);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stdout, /No proposal passed the gate, so there is nothing to apply\./);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
