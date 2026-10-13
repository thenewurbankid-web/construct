// #943 -- the Line LSP's rules layer (packages/engine/lsp/rules.mjs) on the K3 snapshot (bench/isolation/chain/quick).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CASES, materialize } from '../chain/quick/k3.mjs';
import { ruleDiagnostics, ruleFixes, nextSteps } from '../../../packages/engine/lsp/rules.mjs';

test('nextSteps: Line order from stubProblems + moduleScope gives the expected step on all 8 K3 cases, as a closed enum', () => {
  for (const c of CASES) {
    const root = materialize(c);
    try {
      const n = nextSteps(root, { need: c.need, from: c.from });
      assert.equal(n.ok, true, c.id);
      assert.deepEqual({ step: n.options[0].step, target: n.options[0].target, reason_id: n.options[0].reason_id }, c.expect, c.id);
      assert.deepEqual(n.schema.properties.option.enum, n.options.map((o) => `${o.step} ${o.target}`));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
  assert.equal(nextSteps('/nowhere', { need: 'bad', from: 'x' }).ok, false);
});

test('ruleDiagnostics and ruleFixes: one line per violation with its rule id, and its typed fix', () => {
  const root = materialize(CASES[4]);
  try {
    const rel = 'features/book/domains/formatTitle.ts';
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), "import { addPick } from '../../picks/services/addPick';\nexport function formatTitle(t: string): string {\n  return addPick([], t).join(',');\n}\n");
    const d = ruleDiagnostics(root, rel);
    assert.equal(d.ok, true);
    assert.deepEqual(d.rules, ['LINE-DIR']);
    assert.match(d.lines[0], /^features\/book\/domains\/formatTitle\.ts:1 LINE-DIR /);
    const f = ruleFixes(root, rel);
    assert.equal(f.items[0].rule, 'LINE-DIR');
    assert.equal(f.items[0].fixes[0].tool, 'line.promote');
    assert.equal(ruleDiagnostics(root, 'features/book/pages/BookPage.tsx').count, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
