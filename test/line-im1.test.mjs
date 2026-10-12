// im1 -- miss reports and the static tool for the top absent miss. The miss report (packages/rule-factory/misses.mjs)
// found that every Train Line miss was ABSENT: for a cross-feature problem (LINE-DIR), Train's gold also lists moving
// the item into the library directly, which the drafter never offered (10 of 10 held-out misses, ~30 in a
// leave-one-world-out run over the train split). The drafter now offers that route (template `fix-step`); these tests
// prove the miss case now offers the right answer, that it stays below the typed fix, and the CLI's report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { draft, boundRoute } from '../packages/engine/line/drafter/index.mjs';
import { evaluateCase } from '../packages/engine/line/train/service.mjs';
import { recordsFromTraining, memoOf, INDEX } from '../packages/engine/line/train/records.mjs';
import { CASES } from '../packages/engine/line/train/store.mjs';
import { missesFromEvalCase } from '../packages/rule-factory/misses.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(REPO, 'examples/line-sample');
const CLI = path.join(REPO, 'packages/cli/construct.mjs');
const cases = fs.readFileSync(path.join(REPO, 'line', CASES), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('static tool: a request about one cross-feature problem now also offers moving the item into the library, checked, below the typed fix', () => {
  const d = draft(SAMPLE, 'fix the problem in InvoicesPage', { records: [] });
  const step = d.routes.find((r) => r.template === 'fix-step');
  assert.ok(step, 'the raw move is offered');
  assert.equal(step.status, 'ok', 'Construct accepts it on a copy');
  assert.deepEqual(boundRoute(d, step.id).steps, [{ tool: 'line.promote', args: { featureItemId: 'orders/components/OrderButton' } }]);
  assert.equal(d.recommended, 'fix:R1:1', 'the typed fix stays recommended');
  assert.match(boundRoute(d, step.id).label, /^Move OrderButton into the library directly\.$/);
  // Not for "all problems", and not for a problem that is not a cross-feature use.
  assert.ok(!draft(SAMPLE, 'fix all problems', { records: [] }).routes.some((r) => r.template === 'fix-step'));
  assert.ok(!draft(SAMPLE, 'fix StatusPill', { records: [] }).routes.some((r) => r.template === 'fix-step'));
});

test('the miss case: a held-out Train case that missed the raw move (absent) now finds every gold route, so it is no longer a miss', () => {
  const memo = memoOf(fs.readFileSync(path.join(REPO, 'line', INDEX), 'utf8'));
  const records = recordsFromTraining(cases, { memo });
  for (const id of ['tc-c4efa403e8e1', 'tc-c669608b3851', 'tc-35d04ea63462']) {
    const c = cases.find((x) => x.id === id);
    const e = evaluateCase(c, { records });
    assert.equal(e.recall, 1, `${id} recall`);
    assert.equal(e.preferred, 1, `${id} preferred`);
    assert.ok(e.offered.includes('line.promote'), `${id} offers the move`);
    assert.deepEqual(missesFromEvalCase('train', e), [], `${id} is no longer a miss`);
  }
});

test('CLI: construct line misses --dir prints the miss report from plan feedback, slotted, and --json carries it', () => {
  const dir = makeTempDir('line-im1-');
  try {
    fs.cpSync(SAMPLE, dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'line', 'plans'), { recursive: true });
    const fixes = [
      { id: 'fix', fixId: 'LINE-DIR/promote', recommended: true, step: { tool: 'line.promote', args: { featureItemId: 'orders/components/OrderButton' } } },
      { id: 'fix', fixId: 'LINE-DIR/move', recommended: false, step: { tool: 'line.moveFile', args: { from: 'a.tsx', to: 'b.tsx' } } },
    ];
    fs.writeFileSync(path.join(dir, 'line', 'plans', 'ses-1.json'), JSON.stringify({ session: { id: 'ses-1' }, plans: [{ id: 'p1', steps: [
      { id: 's1', n: 1, kind: 'write', addedBy: 'jev', tool: 'line.setFragment', status: 'done', args: {}, result: { needsYou: true, findings: [{ rule: 'LINE-DIR' }], options: fixes } },
      { id: 's2', n: 2, kind: 'write', addedBy: 'ui', tool: 'line.moveFile', status: 'done', args: { from: 'a.tsx', to: 'b.tsx', fixOf: 's1' } },
    ] }] }));
    const out = spawnSync(process.execPath, [CLI, 'line', 'misses', '--dir', dir], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /Miss report \(plan\): 1 miss: 0 where the right answer was not among Line's options \(a static tool is missing\), 1 where it was offered but another was recommended\./);
    assert.match(out.stdout, /- The line\.setFragment step: 0 misses where the right answer was not offered, 1 where it was offered but not recommended\./);
    assert.doesNotMatch(out.stdout, /OrderButton/);
    const json = JSON.parse(spawnSync(process.execPath, [CLI, 'line', 'misses', '--dir', dir, '--json'], { encoding: 'utf8' }).stdout);
    assert.deepEqual(json.report.total, { misses: 1, absent: 0, picked: 1 });
    assert.deepEqual(json.report.sources, ['plan']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
