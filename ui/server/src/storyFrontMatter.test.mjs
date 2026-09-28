import test from 'node:test';
import assert from 'node:assert/strict';
import { readStoryFile, mergeStorySource, mergeStoryValues, StoryFrontMatterError } from './storyFrontMatter.mjs';

const STORY = `---
sources:
  - url: https://acme.atlassian.net/browse/STORE-142
    parse:
      title:
        xpath: "//h1[@data-testid='issue.title']"
      description: div.description
---
<!-- construct:tool-begin fetchedAt=2026-09-20T12:02:00Z -->
# Refund a delivered order
<!-- construct:tool-end -->

## Acceptance notes
Written by hand, never touched by this module.
`;

test('readStoryFile parses the sources front matter and preserves the body verbatim', () => {
  const { frontMatter, body, hadFrontMatter } = readStoryFile(STORY);
  assert.equal(hadFrontMatter, true);
  assert.equal(frontMatter.sources.length, 1);
  assert.equal(frontMatter.sources[0].url, 'https://acme.atlassian.net/browse/STORE-142');
  assert.ok(body.includes('Written by hand, never touched by this module.'));
});

test('readStoryFile on a file with no front matter returns the whole text as body', () => {
  const { frontMatter, body, hadFrontMatter } = readStoryFile('# Direct content\nNo link here.\n');
  assert.deepEqual(frontMatter, {});
  assert.equal(hadFrontMatter, false);
  assert.equal(body, '# Direct content\nNo link here.\n');
});

test('mergeStorySource appends a new selector field to an existing source, and never touches the body', () => {
  const { after, changed } = mergeStorySource(STORY, { url: 'https://acme.atlassian.net/browse/STORE-142', parse: { title: { xpath: "//h1[@data-testid='issue.title']" }, description: 'div.description', acceptance: 'ul.acceptance > li' } });
  assert.equal(changed, true);
  const { frontMatter, body } = readStoryFile(after);
  assert.deepEqual(frontMatter.sources[0].parse.acceptance, 'ul.acceptance > li');
  assert.ok(body.includes('Written by hand, never touched by this module.'));
  assert.ok(body.includes('construct:tool-begin'));
});

test('mergeStorySource on a brand-new url appends a second source entry, keeping the first', () => {
  const { after } = mergeStorySource(STORY, { url: 'https://acme.atlassian.net/browse/STORE-77', parse: { title: 'h1.title' } });
  const { frontMatter } = readStoryFile(after);
  assert.equal(frontMatter.sources.length, 2);
  assert.equal(frontMatter.sources[0].url, 'https://acme.atlassian.net/browse/STORE-142');
  assert.equal(frontMatter.sources[1].url, 'https://acme.atlassian.net/browse/STORE-77');
});

test('mergeStorySource is a no-op (changed:false) when proposing exactly what is already there', () => {
  const once = mergeStorySource(STORY, { url: 'https://acme.atlassian.net/browse/STORE-142', parse: { title: { xpath: "//h1[@data-testid='issue.title']" }, description: 'div.description' } });
  const twice = mergeStorySource(once.after, { url: 'https://acme.atlassian.net/browse/STORE-142', parse: { title: { xpath: "//h1[@data-testid='issue.title']" }, description: 'div.description' } });
  assert.equal(twice.changed, false);
});

test('mergeStorySource rejects a missing url or parse', () => {
  assert.throws(() => mergeStorySource(STORY, { url: '', parse: { a: 'b' } }), StoryFrontMatterError);
  assert.throws(() => mergeStorySource(STORY, { url: 'https://x', parse: null }), StoryFrontMatterError);
});

test('readStoryFile refuses front matter that is not a mapping', () => {
  assert.throws(() => readStoryFile('---\n- just\n- a list\n---\nbody\n'), StoryFrontMatterError);
});

test('mergeStoryValues attaches verified extraction values to the matching source entry, keeping its parse', () => {
  const { after, changed } = mergeStoryValues(STORY, { url: 'https://acme.atlassian.net/browse/STORE-142', values: { title: 'Refund a delivered order' } });
  assert.equal(changed, true);
  const { frontMatter, body } = readStoryFile(after);
  assert.deepEqual(frontMatter.sources[0].values, { title: 'Refund a delivered order' });
  assert.deepEqual(frontMatter.sources[0].parse.description, 'div.description');
  assert.ok(body.includes('Written by hand, never touched by this module.'));
});

test('mergeStoryValues refuses a url with no existing source entry', () => {
  assert.throws(() => mergeStoryValues(STORY, { url: 'https://example.com/not-added-yet', values: { title: 'x' } }), StoryFrontMatterError);
});

test('mergeStoryValues rejects a missing url or values', () => {
  assert.throws(() => mergeStoryValues(STORY, { url: '', values: { a: 'b' } }), StoryFrontMatterError);
  assert.throws(() => mergeStoryValues(STORY, { url: 'https://x', values: null }), StoryFrontMatterError);
});
