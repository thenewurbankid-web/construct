// #383 (slice 15) -- story.md format and its mechanical block.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  STORY_GLOB,
  parseStory,
  assignAcceptanceIds,
  writeStorySnapshot,
  compareStory,
  summaryDriftHash,
  readStoryTags,
  storyTemplate,
  computeSourceHash,
  ensureStoryNonLayer,
} from '../packages/core/story.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const SAMPLE = `---
sources:
  - url: https://acme.atlassian.net/browse/STORE-142
    parse: { title: { xpath: "//h1" }, description: 'div.description', acceptance: 'ul.acceptance > li', status: { css: 'span.status' } }
---
<!-- construct:tool-begin fetchedAt=2026-09-20T12:02:00Z sourceHash=abc123 blockHash=WILL_BE_REPLACED -->
# Refund a delivered order
- S1 Refund button shows only on delivered orders
<!-- construct:tool-end -->

## Acceptance notes
Some hand-written notes.
`;

/** Build a self-consistent sample (correct blockHash) so tests exercise the happy path deliberately. */
function sampleWithValidHash() {
  const written = writeStorySnapshot('', {
    fetchedAt: '2026-09-20T12:02:00Z',
    title: 'Refund a delivered order',
    acceptanceTexts: ['Refund button shows only on delivered orders'],
  });
  return written.text;
}

// ---- parseStory -------------------------------------------------------------

test('parseStory reads front matter sources, the tool block and the user text', () => {
  const valid = sampleWithValidHash();
  const parsed = parseStory(`${valid}\n## Acceptance notes\nSome hand-written notes.\n`);
  assert.equal(parsed.sources.length, 0); // sampleWithValidHash has no sources; covered separately below
  assert.equal(parsed.tool.title, 'Refund a delivered order');
  assert.deepEqual(parsed.tool.acceptance, [{ id: 'S1', text: 'Refund button shows only on delivered orders' }]);
  assert.equal(parsed.tool.handEdited, false);
  assert.match(parsed.userText, /Some hand-written notes\./);
});

test('parseStory reads the sources front matter (url + parse selectors)', () => {
  const withHash = SAMPLE.replace('blockHash=WILL_BE_REPLACED', 'blockHash=deadbeef');
  const parsed = parseStory(withHash);
  assert.equal(parsed.sources.length, 1);
  assert.equal(parsed.sources[0].url, 'https://acme.atlassian.net/browse/STORE-142');
  assert.equal(parsed.sources[0].parse.acceptance, 'ul.acceptance > li');
});

test('parseStory returns tool: null for a file with no tool block yet (mode b / a fresh file)', () => {
  const parsed = parseStory('---\nsources: []\n---\n## Just some notes\n');
  assert.equal(parsed.tool, null);
  assert.match(parsed.userText, /Just some notes/);
});

test('parseStory never throws on malformed front matter; it degrades to no sources', () => {
  const parsed = parseStory('---\n: not: valid: yaml: [\n---\nSome text\n');
  assert.deepEqual(parsed.sources, []);
});

// ---- hand-edit detection (blockHash) ----------------------------------------

test('parseStory detects a hand-edited tool block via blockHash mismatch', () => {
  const withHash = SAMPLE.replace('blockHash=WILL_BE_REPLACED', 'blockHash=deadbeef');
  const parsed = parseStory(withHash);
  assert.equal(parsed.tool.handEdited, true);
});

test('parseStory does not flag a block whose hash matches what was actually written', () => {
  const parsed = parseStory(sampleWithValidHash());
  assert.equal(parsed.tool.handEdited, false);
});

// ---- writeStorySnapshot: writer only ever rewrites the tool block -----------

test('writeStorySnapshot on an empty file creates front matter, tool block and no user text', () => {
  const result = writeStorySnapshot('', { fetchedAt: '2026-09-20T12:00:00Z', title: 'Refund', acceptanceTexts: ['Shows when delivered'] });
  assert.equal(result.conflict, false);
  assert.equal(result.changed, true);
  assert.deepEqual(result.acceptance, [{ id: 'S1', text: 'Shows when delivered' }]);
  const reparsed = parseStory(result.text);
  assert.equal(reparsed.tool.title, 'Refund');
  assert.equal(reparsed.tool.handEdited, false);
});

test('writeStorySnapshot preserves front matter and user text byte-for-byte, rewriting only the tool block', () => {
  const first = writeStorySnapshot('---\nsources:\n  - url: https://example.com/T-1\n---\n', {
    fetchedAt: '2026-09-20T12:00:00Z', title: 'Refund', acceptanceTexts: ['Shows when delivered'],
  });
  const withUserText = `${first.text}\n## Acceptance notes\nMy own review comments.\n`;

  const second = writeStorySnapshot(withUserText, {
    fetchedAt: '2026-09-20T13:00:00Z', title: 'Refund (updated)', acceptanceTexts: ['Shows when delivered', 'Second field'],
  });

  assert.equal(second.changed, true);
  assert.match(second.text, /sources:\n {2}- url: https:\/\/example\.com\/T-1/);
  assert.match(second.text, /My own review comments\./);
  const reparsed = parseStory(second.text);
  assert.equal(reparsed.tool.title, 'Refund (updated)');
});

test('writeStorySnapshot leaves the file untouched when the picked fields did not change (rewritten only if it changed)', () => {
  const first = writeStorySnapshot('', { fetchedAt: '2026-09-20T12:00:00Z', title: 'Refund', acceptanceTexts: ['Shows when delivered'] });
  const second = writeStorySnapshot(first.text, { fetchedAt: '2026-09-21T09:00:00Z', title: 'Refund', acceptanceTexts: ['Shows when delivered'] });
  assert.equal(second.changed, false);
  assert.equal(second.text, first.text); // fetchedAt alone does not force a rewrite
});

test('writeStorySnapshot refuses (conflict) over a hand-edited tool block and writes nothing', () => {
  const withHash = SAMPLE.replace('blockHash=WILL_BE_REPLACED', 'blockHash=deadbeef');
  const result = writeStorySnapshot(withHash, { fetchedAt: '2026-09-21T09:00:00Z', title: 'New title', acceptanceTexts: ['New item'] });
  assert.deepEqual(result, { conflict: true });
});

// ---- assignAcceptanceIds: ids stable, never renumbered -----------------------

test('assignAcceptanceIds keeps ids for unchanged text and assigns fresh ids for new text', () => {
  const prior = [{ id: 'S1', text: 'a' }, { id: 'S2', text: 'b' }];
  const next = assignAcceptanceIds(prior, ['a', 'b', 'c']);
  assert.deepEqual(next, [{ id: 'S1', text: 'a' }, { id: 'S2', text: 'b' }, { id: 'S3', text: 'c' }]);
});

test('assignAcceptanceIds never reuses a retired id when an item is removed then a new one is added', () => {
  const prior = [{ id: 'S1', text: 'a' }, { id: 'S2', text: 'b' }];
  const next = assignAcceptanceIds(prior, ['a', 'c']); // "b" dropped
  assert.deepEqual(next, [{ id: 'S1', text: 'a' }, { id: 'S3', text: 'c' }]); // not S2
});

test('assignAcceptanceIds keeps an id stable even when its item moves to a different position', () => {
  const prior = [{ id: 'S1', text: 'a' }, { id: 'S2', text: 'b' }];
  const next = assignAcceptanceIds(prior, ['b', 'a']);
  assert.deepEqual(next, [{ id: 'S2', text: 'b' }, { id: 'S1', text: 'a' }]);
});

test('assignAcceptanceIds gives repeated identical text distinct ids in order, never stealing one id twice', () => {
  const prior = [{ id: 'S1', text: 'dup' }];
  const next = assignAcceptanceIds(prior, ['dup', 'dup']);
  assert.deepEqual(next, [{ id: 'S1', text: 'dup' }, { id: 'S2', text: 'dup' }]);
});

test('writeStorySnapshot end-to-end: ids survive across two refreshes with reordering and a drop', () => {
  const v1 = writeStorySnapshot('', { fetchedAt: 't1', title: 'T', acceptanceTexts: ['a', 'b', 'c'] });
  assert.deepEqual(v1.acceptance.map((x) => x.id), ['S1', 'S2', 'S3']);

  const v2 = writeStorySnapshot(v1.text, { fetchedAt: 't2', title: 'T', acceptanceTexts: ['c', 'a', 'd'] }); // "b" dropped, "d" added, reordered
  assert.equal(v2.changed, true);
  assert.deepEqual(v2.acceptance, [{ id: 'S3', text: 'c' }, { id: 'S1', text: 'a' }, { id: 'S4', text: 'd' }]);
});

// ---- compareStory: three lists, no model -------------------------------------

test('compareStory splits into missing, undocumented and matched', () => {
  const acceptance = [{ id: 'S1' }, { id: 'S2' }];
  const result = compareStory(acceptance, ['S1', 'S3']);
  assert.deepEqual(result, { missing: ['S2'], undocumented: ['S3'], matched: ['S1'] });
});

test('compareStory with nothing referenced puts every acceptance id in missing', () => {
  const result = compareStory([{ id: 'S1' }, { id: 'S2' }], []);
  assert.deepEqual(result, { missing: ['S1', 'S2'], undocumented: [], matched: [] });
});

test('compareStory with everything matched leaves missing and undocumented empty', () => {
  const result = compareStory([{ id: 'S1' }], ['S1']);
  assert.deepEqual(result, { missing: [], undocumented: [], matched: ['S1'] });
});

test('summaryDriftHash is stable for the same summary and changes when the summary changes', () => {
  const a = compareStory([{ id: 'S1' }], ['S1']);
  const b = compareStory([{ id: 'S1' }], ['S1']);
  const c = compareStory([{ id: 'S1' }, { id: 'S2' }], ['S1']);
  assert.equal(summaryDriftHash(a), summaryDriftHash(b));
  assert.notEqual(summaryDriftHash(a), summaryDriftHash(c));
});

// ---- readStoryTags ------------------------------------------------------------

test('readStoryTags reads a single tag with multiple ids', () => {
  assert.deepEqual(readStoryTags('// @story S1, S3\nit("works", () => {});'), ['S1', 'S3']);
});

test('readStoryTags reads multiple tags across a file and deduplicates', () => {
  const src = '// @story S1\nit("a", () => {});\n\n// @story S1, S2\nit("b", () => {});\n';
  assert.deepEqual(readStoryTags(src), ['S1', 'S2']);
});

test('readStoryTags returns [] when there are no tags', () => {
  assert.deepEqual(readStoryTags('it("no tags here", () => {});'), []);
});

// ---- storyTemplate -------------------------------------------------------------

test('storyTemplate produces a file "Add a story" can write as a normal diff', () => {
  const text = storyTemplate('cart');
  const parsed = parseStory(text);
  assert.equal(parsed.tool.title, 'cart');
  assert.deepEqual(parsed.tool.acceptance, []);
  assert.equal(parsed.tool.handEdited, false);
  assert.match(parsed.userText, /## Acceptance notes/);
});

// ---- computeSourceHash ----------------------------------------------------------

test('computeSourceHash is order- and field-sensitive but ignores nothing else', () => {
  const a = computeSourceHash({ title: 'T', acceptance: ['x', 'y'] });
  const b = computeSourceHash({ title: 'T', acceptance: ['y', 'x'] });
  const c = computeSourceHash({ title: 'T', acceptance: ['x', 'y'] });
  assert.notEqual(a, b);
  assert.equal(a, c);
});

// ---- ensureStoryNonLayer (#348 precedent) ---------------------------------------

test('ensureStoryNonLayer declares the glob once and is idempotent', () => {
  const dir = makeTempDir('construct-story-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\n');
  const first = ensureStoryNonLayer(dir);
  assert.equal(first, true);
  const text = fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8');
  assert.match(text, new RegExp(`nonLayer:\\n {2}- ${STORY_GLOB.replace(/\*/g, '\\*')}`));

  const second = ensureStoryNonLayer(dir);
  assert.equal(second, false); // already covered, nothing rewritten
});

test('ensureStoryNonLayer refuses when nonLayer: exists but does not cover story.md, and writes nothing', () => {
  const dir = makeTempDir('construct-story-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'version: 1\nnonLayer:\n  - features/*/tests/**\n');
  const before = fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8');
  assert.throws(() => ensureStoryNonLayer(dir), /nonLayer:/);
  const after = fs.readFileSync(path.join(dir, 'architecture.yml'), 'utf8');
  assert.equal(after, before);
});

test('ensureStoryNonLayer throws a usage error when there is no architecture.yml', () => {
  const dir = makeTempDir('construct-story-');
  assert.throws(() => ensureStoryNonLayer(dir), /architecture\.yml/);
});
