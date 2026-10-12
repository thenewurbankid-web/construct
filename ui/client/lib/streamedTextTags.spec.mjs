import test from 'node:test';
import assert from 'node:assert/strict';
import { STREAM_TAGS, sanitizeStream } from './streamedTextTags.ts';

const ALL = Object.keys(STREAM_TAGS);

test('whitelisted tags the screen provides stay elements, with only their own attributes', () => {
  assert.equal(sanitizeStream('Here: <ProjectCard name="shop"/> One click opens it.', ['ProjectCard']), 'Here: <projectcard name="shop"></projectcard> One click opens it.');
  assert.equal(sanitizeStream('<TraceLink control="open-project.create" />', ALL), '<tracelink control="open-project.create"></tracelink>');
  // A whitelisted tag the screen does not provide, or with an attribute it does not take, is text.
  assert.equal(sanitizeStream('<ProjectCard name="shop"/>', ['OptionChips']), '&lt;ProjectCard name="shop"/>');
  assert.equal(sanitizeStream('<ProjectCard name="shop" onclick="x()"/>', ALL), '&lt;ProjectCard name="shop" onclick="x()"/>');
});

test('any other tag, raw HTML or script renders as text', () => {
  for (const bad of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<Unknown a="b"/>', '<iframe src="https://evil.example"></iframe>', '<ProjectCard name="a"><script>x</script></ProjectCard>', '<a href="javascript:alert(1)">x</a>']) {
    const out = sanitizeStream(bad, ALL);
    assert.doesNotMatch(out, /<(?!projectcard )/i, bad);
    assert.ok(out.includes('&lt;'), bad);
  }
  assert.equal(sanitizeStream('a < b and 2 > 1', ALL), 'a &lt; b and 2 > 1');
});
