// cu7: a new Line project (packages/engine/line/newProject.mjs) on a real temp folder: the starter files land through
// the writer, the result passes the Line profile with no problem at all, Cockpit's model reads it as Line, and every
// refusal is one sentence that leaves the parent folder exactly as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import path from 'node:path';
import { createLineProject, planNewLineProject } from '../packages/engine/line/newProject.mjs';
import { assertNewLineProjectResult, assertStagedChange, LineOpError } from '../packages/engine/line/contract.mjs';
import { validateLine } from '../packages/core/profiles/line/index.mjs';
import { aggregateValidation } from '../packages/core/registry.mjs';
import { enforcersForRoot } from '../packages/core/profiles/index.mjs';
import { readLineProject } from '../packages/engine/line/model.mjs';
import { readLineFeature } from '../packages/engine/line/feature.mjs';

const tmp = () => fs.realpathSync(makeTempDir('line-new-'));
const listAll = (dir) => fs.readdirSync(dir, { recursive: true }).map(String).sort();
const isSentence = (s) => /^\S.*[.?!]$/s.test(s);

test('new Line project: the starter project lands, validates with zero Line problems and has the Line layout', () => {
  const parent = tmp();
  try {
    const r = createLineProject(parent, { parentDir: parent, name: 'shop', firstFeature: 'catalog' });
    assertNewLineProjectResult(r);
    assert.equal(r.ok, true, r.sentence);
    assert.equal(r.dir, path.join(parent, 'shop'));
    for (const f of ['architecture.yml', 'README.md', 'library/README.md', 'library/components/Button.tsx', 'library/components/TextField.tsx', 'library/components/Card.tsx', 'library/pages/ListPage.tsx', 'library/fixtures/item.json', 'features/catalog/spec.md', 'features/catalog/pages/.gitkeep', 'line/README.md']) {
      assert.ok(fs.existsSync(path.join(r.dir, f)), f);
    }
    assert.match(fs.readFileSync(path.join(r.dir, 'architecture.yml'), 'utf8'), /^preset: line$/m);

    // Both the Line profile alone and what `construct validate` runs for this root (the preset picks the profile).
    assert.deepEqual(validateLine(r.dir).violations, []);
    assert.deepEqual(aggregateValidation(r.dir, enforcersForRoot(r.dir)).violations, []);

    const p = readLineProject(r.dir);
    assert.equal(p.isLine, true);
    assert.deepEqual(p.library.map((l) => `${l.id}:${l.level ?? '-'}`), ['components/Button:atom', 'components/Card:molecule', 'components/TextField:atom', 'fixtures/item:-', 'pages/ListPage:-']);
    assert.deepEqual(p.features.map((f) => [f.name, f.spec, f.items.length]), [['catalog', 'features/catalog/spec.md', 0]]);

    const d = readLineFeature(r.dir, 'catalog');
    assert.equal(d.spec.stories.length, 1);
    assert.equal(d.spec.stories[0].text, 'Story 1');
    assert.deepEqual(d.spec.stories[0].points.map((pt) => pt.covered), [false]);
    assert.deepEqual(d.findings, []);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('new Line project: planning is pure and stays inside the new folder', () => {
  const change = planNewLineProject({ parentDir: '', name: 'shop', firstFeature: 'catalog' });
  assertStagedChange(change);
  assert.equal(change.summary, 'Creates the Line project shop with a starter library and the empty feature catalog.');
});

test('new Line project: a name with path characters is refused in one sentence and nothing is written', () => {
  const parent = tmp();
  try {
    for (const name of ['../evil', 'a/b', '/etc', 'a\\b', '..', '.hidden', 'my shop']) {
      assert.throws(() => createLineProject(parent, { parentDir: parent, name, firstFeature: 'catalog' }), (e) => e instanceof LineOpError && e.code === 'BAD_NAME' && isSentence(e.sentence), name);
    }
    assert.throws(() => createLineProject(parent, { parentDir: parent, name: 'shop', firstFeature: '../x' }), (e) => e instanceof LineOpError && e.code === 'BAD_FEATURE' && isSentence(e.sentence));
    assert.deepEqual(listAll(parent), []);
    assert.equal(fs.existsSync(path.join(path.dirname(parent), 'evil')), false);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('new Line project: an existing folder is refused in one sentence and left untouched', () => {
  const parent = tmp();
  try {
    fs.mkdirSync(path.join(parent, 'shop'));
    fs.writeFileSync(path.join(parent, 'shop', 'keep.txt'), 'mine');
    const before = listAll(parent);
    assert.throws(() => createLineProject(parent, { parentDir: parent, name: 'shop', firstFeature: 'catalog' }), (e) => {
      assert.equal(e.code, 'NAME_TAKEN');
      assert.equal(e.sentence, 'There is already something called "shop" in that folder; choose another name.');
      return true;
    });
    assert.deepEqual(listAll(parent), before);
    assert.equal(fs.readFileSync(path.join(parent, 'shop', 'keep.txt'), 'utf8'), 'mine');
    assert.throws(() => createLineProject(path.join(parent, 'nope'), { parentDir: 'nope', name: 'x', firstFeature: 'a' }), (e) => e.code === 'NO_PARENT' && isSentence(e.sentence));
    assert.deepEqual(listAll(parent), before);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});
