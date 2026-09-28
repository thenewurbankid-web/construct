// #387 -- the stripped page text a public page's "AI proposes the pattern once" call sends (design
// docs/design/ia-five-screens.md 9.6): scripts, styles and every attribute removed, 64 KB cap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStrippedText, MAX_STRIPPED_BYTES } from '../packages/engine/storyStrippedText.mjs';

test('scripts and styles are removed entirely, their text never appears', () => {
  const r = buildStrippedText('<script>evil()</script><style>.x{color:red}</style><h1>Title</h1>');
  assert.equal(r.ok, true);
  assert.equal(r.text, 'Title');
});

test('attributes never appear, including href and form values', () => {
  const r = buildStrippedText('<a href="https://secret.example/token=abc">Link</a><input value="hunter2">');
  assert.ok(!r.text.includes('secret.example'));
  assert.ok(!r.text.includes('token=abc'));
  assert.ok(!r.text.includes('hunter2'));
  assert.equal(r.text, 'Link');
});

test('whitespace is collapsed across tags', () => {
  const r = buildStrippedText('<div>\n  <p>One</p>\n  <p>Two</p>\n</div>');
  assert.equal(r.text, 'One Two');
});

test('capped at 64 KB by default, marked truncated when cut', () => {
  const big = 'word '.repeat(20000); // ~100KB
  const r = buildStrippedText(`<p>${big}</p>`);
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true);
  assert.ok(r.bytes <= MAX_STRIPPED_BYTES + 100);
  assert.match(r.text, /truncated at \d+ bytes/);
});

test('a document under the cap is not marked truncated', () => {
  const r = buildStrippedText('<p>short</p>');
  assert.equal(r.truncated, false);
});

test('a custom maxBytes is honoured', () => {
  const r = buildStrippedText('<p>hello world</p>', { maxBytes: 5 });
  assert.equal(r.truncated, true);
  assert.ok(r.text.startsWith('hello'.slice(0, 5)) || r.text.length < 20);
});

test('rejects non-string input with a code, never throws', () => {
  const r = buildStrippedText(null);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BAD_HTML');
});

test('malformed HTML still produces text (linkedom recovers the tree)', () => {
  const r = buildStrippedText('<div><p>Unclosed<div>Also unclosed with text');
  assert.equal(r.ok, true);
  assert.ok(r.text.includes('Unclosed'));
});
