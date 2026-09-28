// #545 -- one test per migrated rule in packages/core/rules/: its violates.* fixture must fire
// its own id and nothing else, its passes.* fixture must fire nothing, and both must agree with
// the old hard-coded branch (architecture-enforcer.mjs's detectLayerViolations) it was migrated
// from -- the byte-for-byte parity the ticket asks for, at the single-rule grain (the golden
// snapshot in test/validate.characterization.* checks the same parity at the whole-`validate`
// grain).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES } from '../packages/core/rules/index.mjs';
import { detectLayerViolations } from '../packages/core/architecture-enforcer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.join(__dirname, '..', 'packages', 'core', 'rules', 'fixtures');

function fixtureFile(ruleId, name) {
  const dir = path.join(FIXTURES_ROOT, ruleId);
  const match = fs.readdirSync(dir).find((f) => f.startsWith(name));
  return path.join(dir, match);
}

for (const rule of RULES) {
  test(`${rule.id} violates.* fires only ${rule.id}, passes.* fires nothing`, () => {
    const violatesSource = fs.readFileSync(fixtureFile(rule.id, 'violates'), 'utf8');
    const passesSource = fs.readFileSync(fixtureFile(rule.id, 'passes'), 'utf8');

    const violatesHits = rule.detect({ source: violatesSource, layer: rule.layers[0], config: {} });
    assert.equal(violatesHits.length, 1, `${rule.id} violates.* should fire exactly once`);

    const passesHits = rule.detect({ source: passesSource, layer: rule.layers[0], config: {} });
    assert.deepEqual(passesHits, [], `${rule.id} passes.* should not fire`);
  });

  test(`${rule.id} matches the old detectLayerViolations branch on both fixtures`, () => {
    const violatesSource = fs.readFileSync(fixtureFile(rule.id, 'violates'), 'utf8');
    const passesSource = fs.readFileSync(fixtureFile(rule.id, 'passes'), 'utf8');

    const oldViolates = detectLayerViolations(rule.layers[0], violatesSource).filter((v) => v.rule === rule.id);
    const oldPasses = detectLayerViolations(rule.layers[0], passesSource).filter((v) => v.rule === rule.id);

    assert.equal(oldViolates.length, rule.detect({ source: violatesSource, layer: rule.layers[0], config: {} }).length);
    assert.equal(oldPasses.length, rule.detect({ source: passesSource, layer: rule.layers[0], config: {} }).length);
  });
}
