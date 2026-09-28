// #384 -- selector validation (design 9.6b): length cap, node-set-only forms, the multiple-match rule. No DOM,
// no network: applying a validated selector to real HTML is a later slice (#387).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCssSelector, validateXPathSelector, validateSelectorDescriptor, validateParseSpec, applyMultiMatchRule,
  MAX_SELECTOR_LENGTH, SelectorError,
} from '../packages/engine/storySelectors.mjs';

test('a plain string is CSS, and {css}/{xpath} are explicit', () => {
  assert.deepEqual(validateSelectorDescriptor('h1'), { kind: 'css', value: 'h1' });
  assert.deepEqual(validateSelectorDescriptor({ css: 'div.description' }), { kind: 'css', value: 'div.description' });
  assert.deepEqual(validateSelectorDescriptor({ xpath: "//h1[@data-testid='issue.title']" }), { kind: 'xpath', value: "//h1[@data-testid='issue.title']" });
});

test('a bad shape (array, number, both css and xpath, unknown key) is rejected', () => {
  for (const bad of [42, null, [], { css: 'h1', xpath: '//h1' }, { foo: 'h1' }, {}]) {
    assert.throws(() => validateSelectorDescriptor(bad), SelectorError);
  }
});

test('the 200-character cap applies to both dialects', () => {
  const long = `h1${'.a'.repeat(150)}`;
  assert.ok(long.length > MAX_SELECTOR_LENGTH);
  assert.throws(() => validateCssSelector(long), (e) => e.code === 'TOO_LONG');
  assert.throws(() => validateXPathSelector(`//${'a/'.repeat(120)}h1`), (e) => e.code === 'TOO_LONG');
});

test('empty selectors are rejected', () => {
  assert.throws(() => validateCssSelector(''), (e) => e.code === 'EMPTY');
  assert.throws(() => validateXPathSelector(''), (e) => e.code === 'EMPTY');
});

test('banned constructs: javascript:, expression(), url(), document(), id(), system-property(), unparsed-text()', () => {
  const hostile = [
    'a[href^="javascript:alert(1)"]',
    'div{background:url(javascript:alert(1))}',
    "//a[contains(@href,'javascript:')]",
    "document('evil.xml')//h1",
    "id('outside')/h1",
    'system-property("xsl:version")',
    'unparsed-text("secret.txt")',
    'a[style*="expression(alert(1))"]',
  ];
  for (const value of hostile) {
    assert.throws(() => validateSelectorDescriptor(value), SelectorError, value);
  }
});

test('characters outside the safe set (backslash, semicolon, braces, backtick) are rejected', () => {
  for (const value of ['h1\\;drop', 'h1{x}', 'h1`x`', 'h1;h2']) {
    assert.throws(() => validateCssSelector(value), (e) => e.code === 'BAD_SYNTAX', value);
  }
});

test('a realistic front-matter parse map validates every field and reports which one failed', () => {
  const spec = validateParseSpec({
    title: { xpath: "//h1[@data-testid='issue.title']" },
    description: 'div.description',
    acceptance: 'ul.acceptance > li',
    status: { css: 'span.status' },
  });
  assert.deepEqual(Object.keys(spec).sort(), ['acceptance', 'description', 'status', 'title']);
  assert.equal(spec.title.kind, 'xpath');
  assert.equal(spec.description.kind, 'css');

  assert.throws(() => validateParseSpec({ title: 'h1[href^="javascript:x"]' }), (e) => /Field "title"/.test(e.message));
});

test('validateParseSpec is a no-op for an absent parse map, and rejects a non-object', () => {
  assert.deepEqual(validateParseSpec(undefined), {});
  assert.deepEqual(validateParseSpec(null), {});
  assert.throws(() => validateParseSpec('h1'), (e) => e.code === 'BAD_SHAPE');
  assert.throws(() => validateParseSpec(['h1']), (e) => e.code === 'BAD_SHAPE');
});

test('multiple-match rule: a list field takes every match, in order', () => {
  assert.deepEqual(applyMultiMatchRule('acceptance', ['S1', 'S2', 'S3']), { ok: true, values: ['S1', 'S2', 'S3'] });
  assert.deepEqual(applyMultiMatchRule('acceptance', []), { ok: true, values: [] });
});

test('multiple-match rule: a single-value field errors on 0 or >1 matches, and passes through exactly 1', () => {
  assert.deepEqual(applyMultiMatchRule('title', []), { ok: false, code: 'NO_MATCH', message: 'That selector did not match: re-pick.' });
  const many = applyMultiMatchRule('title', ['a', 'b', 'c']);
  assert.equal(many.ok, false);
  assert.equal(many.code, 'AMBIGUOUS');
  assert.match(many.message, /matches 3/);
  assert.deepEqual(applyMultiMatchRule('status', ['Open']), { ok: true, values: ['Open'] });
});
