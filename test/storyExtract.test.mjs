// #439 -- extract/verify attacked with malformed and script-heavy HTML. The DOM never leaves storyExtract.mjs; only
// JSON comes back, and it proves nothing on the page ever runs or is fetched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extract, verify, validateFields, escapeHtml, DEFAULT_MAX_HTML_BYTES, MAX_FIELDS, MAX_SELECTOR_LENGTH,
} from '../packages/engine/storyExtract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'story-extract', name), 'utf8');

const STORY_FIELDS = [
  { name: 'headline', selector: '.headline' },
  { name: 'byline', selector: '.byline' },
  { name: 'sourceUrl', selector: '.source', attr: 'href' },
];

test('static fixture: every field matches, values are trimmed', () => {
  const r = extract(fixture('static.html'), { fields: STORY_FIELDS });
  assert.equal(r.ok, true);
  assert.equal(r.values.headline, 'Cockpit ships a new Processes drawer');
  assert.equal(r.values.byline, 'By Jamie Rivers');
  assert.equal(r.values.sourceUrl, 'https://example.com/original');
  assert.deepEqual(r.misses, []);
});

test('malformed fixture: linkedom recovers the tree, a missing field is reported as a miss, not an error', () => {
  const r = extract(fixture('malformed.html'), {
    fields: [...STORY_FIELDS, { name: 'nope', selector: '.does-not-exist' }],
  });
  assert.equal(r.values.headline, 'Unclosed tags everywhere');
  assert.equal(r.values.byline, 'By Someone');
  assert.deepEqual(r.misses, ['sourceUrl', 'nope']);
  assert.equal(r.ok, false); // misses present, but this is a normal (not a thrown/hard) result
});

test('script-heavy fixture: no script executes and no subresource is fetched', () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (...args) => { calls.push(args); throw new Error('a story extraction must never fetch anything'); };
  delete globalThis.__storyExtractScriptRan;
  try {
    const r = extract(fixture('script-heavy.html'), { fields: STORY_FIELDS });
    assert.equal(r.values.headline, 'Story headline survives the noise');
    assert.equal(r.values.byline, 'By Script Heavy');
    assert.equal(globalThis.__storyExtractScriptRan, undefined, 'an inline <script> or an event handler ran');
    assert.deepEqual(calls, [], 'extract() fetched a subresource (img/iframe/script/link src)');
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.__storyExtractScriptRan;
  }
});

test('extracted values are HTML-escaped before they come back', () => {
  const r = extract('<div class="x">&lt;script&gt; &amp; "quote" \'tick\' <b>bold</b></div>', {
    fields: [{ name: 'x', selector: '.x' }],
  });
  // textContent already decodes entities and drops the <b> tag; extract() re-escapes what is left.
  assert.equal(r.values.x, escapeHtml('<script> & "quote" \'tick\' bold'));
  assert.ok(!r.values.x.includes('<script>'));
});

test('byte budget: HTML over maxBytes is refused before parsing', () => {
  const big = `<div class="x">${'a'.repeat(50)}</div>`;
  const r = extract(big, { fields: [{ name: 'x', selector: '.x' }], maxBytes: 10 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'TOO_LARGE');
  assert.equal(r.values, undefined);
});

test('time budget: an already-expired deadline is refused before any selector runs', () => {
  const r = extract(fixture('static.html'), { fields: STORY_FIELDS, timeoutMs: -1 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'TIMEOUT');
});

test('default budgets are exported and sane', () => {
  assert.ok(DEFAULT_MAX_HTML_BYTES > 0);
  assert.ok(MAX_FIELDS > 0);
  assert.ok(MAX_SELECTOR_LENGTH > 0);
});

test('field validation: empty/oversized/duplicate/xpath fields are all rejected up front', () => {
  assert.equal(validateFields([]).valid, false);
  assert.equal(validateFields(null).valid, false);
  assert.equal(validateFields(Array.from({ length: MAX_FIELDS + 1 }, (_, i) => ({ name: `f${i}`, selector: '.x' }))).valid, false);
  assert.equal(validateFields([{ name: 'a', selector: '.x' }, { name: 'a', selector: '.y' }]).valid, false);
  assert.equal(validateFields([{ name: 'a', selector: 'x'.repeat(MAX_SELECTOR_LENGTH + 1) }]).valid, false);
  assert.equal(validateFields([{ name: 'a', selector: '//div', kind: 'xpath' }]).valid, false); // xpath: not implemented (#439)
  assert.equal(validateFields([{ name: 'a', selector: '.x', kind: 'css' }]).valid, true);
});

test('extract() rejects bad html/fields inputs with a code, never throws', () => {
  assert.equal(extract(123, { fields: STORY_FIELDS }).code, 'BAD_HTML');
  assert.equal(extract('<div></div>', { fields: [] }).code, 'BAD_FIELDS');
  assert.equal(extract('<div></div>', { fields: [{ name: 'x', selector: ':::not-a-selector' }] }).code, 'BAD_SELECTOR');
});

test('verify(): unchanged HTML reports no changes', () => {
  const html = fixture('static.html');
  const first = extract(html, { fields: STORY_FIELDS });
  const r = verify(html, { fields: STORY_FIELDS, values: first.values });
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed, []);
});

test('verify(): a changed field is reported by name, others are not', () => {
  const before = extract(fixture('static.html'), { fields: STORY_FIELDS });
  const after = fixture('static.html').replace('Cockpit ships a new Processes drawer', 'Cockpit ships a rewritten headline');
  const r = verify(after, { fields: STORY_FIELDS, values: before.values });
  assert.equal(r.ok, false);
  assert.deepEqual(r.changed, ['headline']);
  assert.equal(r.values.byline, before.values.byline);
});

test('verify(): a field that starts missing and then matches counts as changed', () => {
  const before = { fields: STORY_FIELDS, values: { headline: 'x', byline: 'y', sourceUrl: undefined } };
  const r = verify(fixture('static.html'), before);
  assert.ok(r.changed.includes('sourceUrl'));
});

test('verify(): rejects a malformed "previous" without touching the network or throwing', () => {
  assert.equal(verify('<div></div>', null).code, 'BAD_PREVIOUS');
  assert.equal(verify('<div></div>', { fields: STORY_FIELDS }).code, 'BAD_PREVIOUS');
  assert.equal(verify('<div></div>', { values: {} }).code, 'BAD_PREVIOUS');
});
