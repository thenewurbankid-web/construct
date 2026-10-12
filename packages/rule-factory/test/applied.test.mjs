// cs2 -- every static rule a person applied from the factory is still in its rule file, and a fix-rank rule still puts
// the right fix first on its own fix choices. (A lexicon proposal's Train cases are re-drafted by the gate, not here:
// drafting is too slow for the unit suite.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assertRuleProposal, RULE_FILES } from '../contract.mjs';
import { APPLIED_FILE, CHECKOUT } from '../apply.mjs';
import { mergeLexicon } from '@line/construct-engine/line/drafter/lexicon';
import { rerankFixes, FIX_RANKING } from '@line/construct-engine/line/fix-ranking';

const read = (f) => JSON.parse(fs.readFileSync(path.join(CHECKOUT, f), 'utf8'));

test('applied rules: each is a valid proposal, still in its rule file, and a fix-rank rule still ranks its right fixes first', () => {
  const applied = read(APPLIED_FILE).proposals;
  const lexicon = read(RULE_FILES.lexicon);
  for (const p of applied) {
    assertRuleProposal(p);
    if (p.target === 'lexicon') {
      assert.deepEqual(mergeLexicon(lexicon, p.change), lexicon, `${p.id} is still in the lexicon`);
    } else {
      assert.ok(FIX_RANKING.some((r) => r.rule === p.change.rule && r.prefer === p.change.prefer && r.over === p.change.over), `${p.id} is still in the fix ranking`);
      for (const it of p.test.items) assert.equal(rerankFixes(p.change.rule, it.options.map((id) => ({ id })))[0].id, it.correct, `${p.id}: ${it.id}`);
    }
  }
  assert.ok(Array.isArray(read(RULE_FILES['fix-ranking']).rules));
});
