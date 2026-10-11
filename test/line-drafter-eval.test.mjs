// The drafter's eval harness (packages/engine/line/drafter/eval.mjs) on its corpus: ground truth on examples/line-sample
// (dev) and on a held-out whole project (examples/line-heldout-clinic), reported per split and per family.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runEval, formatReport, DEFAULT_CORPUS, REPO_ROOT, resolveSelector, lexicalize, stepsMatch } from '../packages/engine/line/drafter/eval.mjs';
import { factsSummary } from '../packages/engine/line/facts.mjs';
import { splitWords, FUNCTION_WORDS } from '../packages/engine/line/drafter/domainMap.mjs';
import { assertNoIdentifiers } from '../packages/engine/line/drafter/contract.mjs';

const corpus = JSON.parse(fs.readFileSync(DEFAULT_CORPUS, 'utf8'));

test('eval corpus: ~40 dev cases plus a held-out whole project; requests and fills hold slots and structure, never project names', () => {
  const dev = corpus.cases.filter((c) => corpus.projects[c.project].split === 'dev');
  const held = corpus.cases.filter((c) => corpus.projects[c.project].split === 'heldout');
  assert.ok(dev.length >= 40, `${dev.length} dev cases`);
  assert.ok(held.length >= 10, `${held.length} held-out project cases`);
  assert.ok(corpus.cases.filter((c) => c.heldOut).length >= 12, 'held-out paraphrases');
  for (const p of Object.values(corpus.projects)) {
    const s = factsSummary(path.resolve(REPO_ROOT, /** @type {any} */ (p).dir));
    const names = [...s.features.map((f) => f.name), ...s.features.flatMap((f) => f.items.map((i) => i.name)), ...s.library.map((l) => l.name)];
    const words = [...new Set([...names, ...names.flatMap(splitWords)])].filter((w) => !FUNCTION_WORDS.has(w));
    assertNoIdentifiers(corpus.cases.map((c) => [c.request, c.fill]), words);
  }
});

test('eval harness: selectors resolve by structure, requests lexicalize, steps match with wildcards', () => {
  const s = factsSummary(path.resolve(REPO_ROOT, 'examples/line-sample'));
  assert.equal(resolveSelector('feature#1', s), 'orders');
  assert.equal(resolveSelector('library:components#0', s).id, 'components/Badge');
  assert.equal(resolveSelector('item:feature#0/pages#0', s).file, 'features/billing/pages/InvoicesPage.tsx');
  assert.equal(resolveSelector('prop:item:feature#1/pages#0#0', s).name, 'onMore');
  assert.equal(resolveSelector('finding:LINE-DIR', s).fix1, 'LINE-DIR/promote');
  assert.equal(lexicalize('set the <prop:A1> of the <page:P1~words> to <value:V1>', { A1: { name: 'title' }, P1: { name: 'InvoicesPage' }, V1: 'Alpha' }), 'set the title of the invoices page to "Alpha"');
  assert.equal(stepsMatch([{ tool: 'line.baseOn', args: { libraryId: 'a', feature: 'b', name: '*' } }], [{ tool: 'line.baseOn', args: { libraryId: 'a', feature: 'b', name: 'Anything' } }]), true);
  assert.equal(stepsMatch([{ tool: 'line.baseOn', args: { libraryId: 'a', feature: 'b', name: '*' } }], [{ tool: 'line.baseOn', args: { libraryId: 'a', feature: 'c', name: 'X' } }]), false);
});

test('eval: the corpus scores at or above its recorded floor, with no structure-hash miss, and reports splits and families', () => {
  const rep = runEval(corpus);
  const table = formatReport(rep);
  assert.match(table, /split: heldout/);
  assert.match(table, /held-out paraphrases/);
  for (const fam of ['base-on', 'via-library', 'promote', 'set-prop', 'set-fragment', 'fix', 'set-base', 'feature-flow', 'new-feature', 'unknown']) assert.ok(rep.byFamily[fam], fam);
  // Floors recorded 2026-10-11 (docs/line/review.md "System 1 drafter"); raise them as the drafter improves, never lower.
  assert.ok(rep.bySplit.dev.recall >= 0.83, `dev recall ${rep.bySplit.dev.recall}`);
  assert.ok(rep.bySplit.heldout.recall >= 0.9, `held-out project recall ${rep.bySplit.heldout.recall}`);
  assert.ok(rep.overall.precision >= 0.95, `precision ${rep.overall.precision}`);
  assert.ok(rep.overall.preferredOk >= 0.85, `preferred ${rep.overall.preferredOk}`);
  assert.ok(rep.overall.labels >= 0.85, `labels ${rep.overall.labels}`);
  assert.ok(rep.overall.safeDefer >= 0.85, `deferred when wrong ${rep.overall.safeDefer}`);
  assert.equal(rep.overall.hashMiss, 0);
});
