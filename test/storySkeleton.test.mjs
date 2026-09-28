// #387 -- the structure-only skeleton a login-only page is reduced to before "AI proposes a pattern" ever sees it
// (design docs/design/ia-five-screens.md 9.6, last bullet).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSkeleton, MAX_SKELETON_BYTES, MAX_TEXT_LEN } from '../packages/engine/storySkeleton.mjs';

test('id, class and data-testid are shown; every other attribute value is not', () => {
  const html = '<div id="root" class="a b"><a href="https://secret.example/login?token=abc" data-testid="link">Go</a></div>';
  const r = buildSkeleton(html);
  assert.equal(r.ok, true);
  assert.match(r.text, /div#root\.a\.b/);
  assert.match(r.text, /a\[data-testid=link\] "Go"/);
  assert.ok(!r.text.includes('href'));
  assert.ok(!r.text.includes('secret.example'));
  assert.ok(!r.text.includes('token=abc'));
});

test('text is truncated to 40 characters', () => {
  const long = 'x'.repeat(80);
  const r = buildSkeleton(`<p>${long}</p>`);
  assert.equal(r.ok, true);
  const match = /"([^"]*)"/.exec(r.text);
  assert.ok(match, 'expected a quoted text segment');
  assert.equal(match[1].length, MAX_TEXT_LEN + 1); // +1 for the truncation ellipsis
  assert.ok(match[1].endsWith('…'));
});

test('short text is shown whole, with no ellipsis', () => {
  const r = buildSkeleton('<p>Hi</p>');
  assert.match(r.text, /p "Hi"/);
  assert.ok(!r.text.includes('…'));
});

test('scripts and styles contribute nothing: no tag line, no text, no attribute', () => {
  const r = buildSkeleton('<div>keep</div><script data-testid="evil">doBadThing()</script><style>.x{color:red}</style>');
  assert.ok(!r.text.includes('script'));
  assert.ok(!r.text.includes('style'));
  assert.ok(!r.text.includes('doBadThing'));
  assert.ok(!r.text.includes('evil'));
});

test('form values never appear', () => {
  const r = buildSkeleton('<form><input type="text" name="password" value="hunter2"></form>');
  assert.ok(!r.text.includes('hunter2'));
  assert.ok(!r.text.includes('password'));
});

test('nested structure is indented by depth', () => {
  const r = buildSkeleton('<div id="a"><div id="b"><span id="c">x</span></div></div>');
  const lines = r.text.split('\n').filter((l) => l.trim());
  const byId = (id) => lines.find((l) => l.includes(`#${id}`));
  assert.ok(byId('b').startsWith('  '));
  assert.ok(byId('c').startsWith('    '));
});

test('output is capped at 32 KB by default, and says so when it truncates', () => {
  const many = Array.from({ length: 5000 }, (_, i) => `<div id="row-${i}" class="row">Row number ${i} of many</div>`).join('');
  const r = buildSkeleton(`<div>${many}</div>`, { maxBytes: 2000 });
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true);
  assert.ok(r.bytes <= 2000 + 200); // the "truncated at N bytes" trailer itself is small and expected
  assert.match(r.text, /truncated at 2000 bytes/);
});

test('a document under the cap is not marked truncated', () => {
  const r = buildSkeleton('<div id="x">small</div>');
  assert.equal(r.truncated, false);
});

test('default budgets are exported and sane', () => {
  assert.equal(MAX_SKELETON_BYTES, 32 * 1024);
  assert.equal(MAX_TEXT_LEN, 40);
});

test('rejects non-string input with a code, never throws', () => {
  const r = buildSkeleton(123);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BAD_HTML');
});

test('malformed HTML still produces a skeleton (linkedom recovers the tree)', () => {
  const r = buildSkeleton('<div><p>Unclosed<div>Also unclosed');
  assert.equal(r.ok, true);
  assert.ok(r.text.length > 0);
});
