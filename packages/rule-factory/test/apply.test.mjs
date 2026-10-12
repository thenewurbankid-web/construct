// cs2 -- apply: only what the gate passed, several at once only when measured together cleanly, written through
// Construct's writer (checked before it lands) into a checkout's rule files, with the record of applied proposals.
// Runs on a small fake checkout (the two rule files copied), never on this repository's own rule files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { RULE_FILES, FACTORY_FILES } from '../contract.mjs';
import { choose, applyProposals, APPLIED_FILE, CHECKOUT } from '../apply.mjs';

const verb = { id: 'rp-00000000000a', kind: 'verb', target: 'lexicon', change: { everyday: { verbs: { add: ['attach'] }, grammar: ['attach'] } }, evidence: ['x'], test: { kind: 'train-cases', caseIds: ['tc-1'] }, sentence: 'Read "attach" as asking to add something (from 1 miss).' };
const rank = { id: 'rp-00000000000b', kind: 'fix-rank', target: 'fix-ranking', change: { rule: 'LINE-LAYOUT', prefer: 'LINE-LAYOUT/stray-to-feature', over: 'LINE-LAYOUT/stray-to-library' }, evidence: ['y'], test: { kind: 'fix-items', items: [{ id: 'y', options: ['a'], chosen: 'a', correct: 'a', heldOut: false }] }, sentence: 'For LINE-LAYOUT, rank it first (from 1 miss).' };
const s = { train: { n: 1, recall: 1, precision: 1, preferred: 1 }, drafter: { n: 1, recall: 1, precision: 1, preferred: 1 } };
const report = (passed, together = null) => ({ at: 't', baseline: s, results: [], together, passed, sentence: 'x.' });

function fakeCheckout() {
  const dir = makeTempDir('line-rf-checkout-');
  for (const f of [...Object.values(RULE_FILES), APPLIED_FILE]) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(CHECKOUT, f), path.join(dir, f));
  }
  return dir;
}

test('choose: nothing without a gate report, only proposals that passed, several only when measured together cleanly', () => {
  assert.match(choose([verb], null).sentence, /run `construct line rules gate` first/);
  assert.match(choose([verb], report([])).sentence, /No proposal passed the gate/);
  assert.match(choose([verb, rank], report([verb.id]), [rank.id]).sentence, /did not pass the gate/);
  assert.equal(choose([verb, rank], report([verb.id])).ok, true);
  assert.match(choose([verb, rank], report([verb.id, rank.id])).sentence, /one at a time with --id/);
  assert.equal(choose([verb, rank], report([verb.id, rank.id], { ids: [verb.id, rank.id], with: s, regressions: [], ok: true })).ok, true);
  assert.equal(choose([verb, rank], report([verb.id, rank.id]), [rank.id]).ok, true, 'one at a time is always allowed');
});

test('apply: the lexicon and the fix ranking change through the writer, in their own format, and the proposal is recorded with its test', () => {
  const dir = fakeCheckout();
  const before = fs.readFileSync(path.join(dir, RULE_FILES.lexicon), 'utf8');
  const r = applyProposals([verb, rank], { checkout: dir, at: '2026-10-12T00:00:00Z' });
  assert.equal(r.committed, true, r.sentence);
  assert.deepEqual(r.files, [RULE_FILES.lexicon, RULE_FILES['fix-ranking'], APPLIED_FILE]);
  const lex = JSON.parse(fs.readFileSync(path.join(dir, RULE_FILES.lexicon), 'utf8'));
  assert.ok(lex.everyday.verbs.add.includes('attach') && lex.everyday.grammar.includes('attach'));
  const text = fs.readFileSync(path.join(dir, RULE_FILES.lexicon), 'utf8');
  assert.equal(text, `${JSON.stringify(lex, null, 1)}\n`, 'the lexicon keeps its one-space format');
  assert.notEqual(text, before);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, RULE_FILES['fix-ranking']), 'utf8')).rules, [rank.change]);
  const applied = JSON.parse(fs.readFileSync(path.join(dir, APPLIED_FILE), 'utf8')).proposals;
  assert.deepEqual(applied.map((p) => [p.id, p.appliedBy, p.test.kind]), [[verb.id, 'person', 'train-cases'], [rank.id, 'person', 'fix-items']]);
  assert.match(r.sentence, /^Applied 2 proposals to .*lexicon\.json and .*fix-ranking\.json; run the tests before you commit\.$/);
  const again = applyProposals([verb], { checkout: dir });
  assert.equal(again.committed, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, APPLIED_FILE), 'utf8')).proposals.length, 2, 'applying twice records once');
});

test('apply: a change that breaks the lexicon\'s contract lands nothing, and says why', () => {
  const dir = fakeCheckout();
  const before = fs.readFileSync(path.join(dir, RULE_FILES.lexicon), 'utf8');
  const bad = { ...verb, id: 'rp-00000000000c', change: { entries: [{ word: 'kiosk', synonyms: [], role: 'not-a-role', object: 'component' }] } };
  const r = applyProposals([bad], { checkout: dir });
  assert.equal(r.committed, false);
  assert.match(r.sentence, /^Nothing was applied: lexicon role "not-a-role"/);
  assert.equal(fs.readFileSync(path.join(dir, RULE_FILES.lexicon), 'utf8'), before);
});

test('CLI: `construct line rules` gate and apply say what to run first; propose without jev or the drafter writes its files', () => {
  const project = makeTempDir('line-rf-cli-');
  fs.cpSync(path.join(CHECKOUT, 'examples/line-sample'), project, { recursive: true });
  const run = (...a) => spawnSync(process.execPath, [path.join(CHECKOUT, 'packages/cli/construct.mjs'), 'line', 'rules', ...a, '--dir', project], { encoding: 'utf8' });
  assert.match(run('gate').stdout, /There are no proposals yet; run `construct line rules propose` first\./);
  const apply = run('apply');
  assert.equal(apply.status, 1);
  assert.match(apply.stdout, /There is no gate report yet/);
  const p = run('propose', '--no-jev', '--no-drafter');
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /^Collected \d+ decisions?, \d+ miss(es)? by static code:$/m);
  assert.match(p.stdout, /^There were no misses with closed options to label\.$/m);
  assert.ok(fs.existsSync(path.join(project, FACTORY_FILES.proposals)) && fs.existsSync(path.join(project, FACTORY_FILES.labelling)));
  assert.match(run('nope').stderr + run('nope').stdout, /"nope" is not a rules command/);
});
