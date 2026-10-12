// cs2 -- rule proposals from labelled misses: data plus their own test case, grouped, never applied here; the overlay
// they make is merged by the drafter's own mergeLexicon and the fix ranking's own rerankFixes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRuleProposal } from '../contract.mjs';
import { proposeRules, overlayOf, roleFor, heldOutItem } from '../propose.mjs';
import { MOCK_LABEL_ITEMS } from '../mock.mjs';
import { LEXICON, mergeLexicon, assertLexicon } from '@line/construct-engine/line/drafter/lexicon';
import { OBJECTS } from '@line/construct-engine/line/drafter/contract';
import { rerankFixes, assertFixRanking, fixFamily } from '@line/construct-engine/line/fix-ranking';
import { readStaticOverlay, STATIC_OVERLAY } from '@line/construct-engine/line/static-overlay';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

const word = (w, correct, caseId = 'tc-1', intent = 'add.component') => ({ ...MOCK_LABEL_ITEMS[0], id: `drafter:${caseId}:${w}`, missId: `drafter:${caseId}`, correct, labelledBy: 'jev', about: { word: w, caseId, intent }, options: ['verb:add', 'verb:remove', 'verb:promote', 'verb:update', 'verb:fix', 'grammar', `catalog:${intent.split('.')[1]}`, 'handler:log', 'none'] });

test('proposals: one per distinct change, its misses as evidence and their Train cases as its own test; none fits and unlabelled make none', () => {
  const { proposals, skipped } = proposeRules([
    word('attach', 'verb:add', 'tc-1'), word('attach', 'verb:add', 'tc-2'), word('nicely', 'grammar', 'tc-1'),
    word('ping', 'handler:log', 'tc-4', 'update.handler'), word('kiosk', 'catalog:component', 'tc-5'),
    word('blah', 'none', 'tc-6'), { ...word('meh', null, 'tc-7'), labelledBy: null },
    word('needs', 'verb:add', 'tc-8'),
  ], { lexicon: LEXICON });
  for (const p of proposals) assertRuleProposal(p);
  const byKind = Object.fromEntries(proposals.map((p) => [p.kind, p]));
  assert.deepEqual(Object.keys(byKind).sort(), ['catalog', 'grammar', 'handler', 'verb']);
  assert.deepEqual(byKind.verb.change, { everyday: { verbs: { add: ['attach'] }, grammar: ['attach'] } });
  assert.deepEqual(byKind.verb.test, { kind: 'train-cases', caseIds: ['tc-1', 'tc-2'] });
  assert.equal(byKind.verb.sentence, 'Read "attach" as asking to add something (from 2 misses).');
  assert.equal(proposals[0].id, byKind.verb.id, 'the best-supported proposal comes first');
  assert.deepEqual(byKind.catalog.change.entries, [{ word: 'kiosk', synonyms: [], role: roleFor(LEXICON, 'component'), object: 'component' }]);
  assert.deepEqual(skipped.map((s) => [s.reason, s.count]).sort(), [['already-there', 1], ['none-fits', 1], ['unlabelled', 1]]);
  assert.equal(proposeRules([word('attach', 'verb:add', 'tc-9')], { lexicon: LEXICON }).proposals[0].id, byKind.verb.id, 'the same change has the same id');
});

test('proposals: a person\'s fix choice becomes a fix-rank rule for that Line rule; the overlay re-ranks exactly that family first', () => {
  const { proposals } = proposeRules([MOCK_LABEL_ITEMS[1]], { lexicon: LEXICON });
  assert.equal(proposals.length, 1);
  const p = proposals[0];
  assert.deepEqual(p.change, { rule: 'LINE-LAYOUT', prefer: 'LINE-LAYOUT/stray-to-feature', over: 'LINE-LAYOUT/stray-to-library' });
  assert.equal(p.test.kind, 'fix-items');
  assert.equal(typeof heldOutItem('x'), 'boolean');
  assertFixRanking([p.change]);
  const fixes = [{ id: 'LINE-LAYOUT/stray-to-library:components', rank: 1 }, { id: 'LINE-LAYOUT/stray-to-feature:orders:components', rank: 2 }];
  const re = rerankFixes('LINE-LAYOUT', fixes, overlayOf([p]).fixRanking);
  assert.deepEqual(re.map((f) => [f.id, f.rank]), [['LINE-LAYOUT/stray-to-feature:orders:components', 1], ['LINE-LAYOUT/stray-to-library:components', 2]]);
  assert.equal(rerankFixes('LINE-DIR', fixes, [p.change]), fixes, 'another rule\'s fixes are untouched');
  assert.equal(fixFamily('LINE-LAYOUT/stray-to-feature:orders:components'), 'LINE-LAYOUT/stray-to-feature');
  assert.throws(() => assertFixRanking([{ rule: 'LINE-LAYOUT', prefer: 'LINE-DIR/promote', over: 'LINE-LAYOUT/x' }]), /prefers one fix family/);
});

test('overlay: the drafter\'s mergeLexicon adds the proposals without duplicates and the result is still a valid lexicon', () => {
  const { proposals } = proposeRules([word('attach', 'verb:add'), word('kiosk', 'catalog:component', 'tc-5')], { lexicon: LEXICON });
  const merged = mergeLexicon(LEXICON, overlayOf(proposals).lexicon);
  assertLexicon(merged, Object.keys(OBJECTS));
  assert.ok(merged.everyday.verbs.add.includes('attach') && merged.everyday.grammar.includes('attach'));
  assert.ok(merged.entries.some((e) => e.word === 'kiosk'));
  assert.equal(merged.entries.length, LEXICON.entries.length + 1);
  const twice = mergeLexicon(merged, overlayOf(proposals).lexicon);
  assert.deepEqual(twice, merged, 'merging the same proposals twice changes nothing');
  assert.ok(!LEXICON.everyday.verbs.add.includes('attach'), 'the shipped lexicon is not changed');
});

test('overlay seam: unset is null (every process but the gate\'s worker); a named file is read; an unreadable one stops with a sentence', () => {
  assert.equal(STATIC_OVERLAY, null);
  assert.equal(readStaticOverlay({}), null);
  const f = path.join(makeTempDir('line-rf-ov-'), 'o.json');
  fs.writeFileSync(f, JSON.stringify({ fixRanking: [] }));
  assert.deepEqual(readStaticOverlay({ LINE_STATIC_OVERLAY: f }), { fixRanking: [] });
  fs.writeFileSync(f, '[1]');
  assert.throws(() => readStaticOverlay({ LINE_STATIC_OVERLAY: f }), /could not be read \(it is not a JSON object\), so the rules it proposes cannot be measured\./);
});
