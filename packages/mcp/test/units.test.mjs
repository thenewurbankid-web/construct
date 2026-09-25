// #649 -- the small pure parts: the token bucket, the command-line parser, the scrubber and the plan path check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokenBucket, DEFAULT_RATE_PER_MINUTE, MAX_RATE_PER_MINUTE, ToolError, ERROR_CODES } from '../src/limits.mjs';
import { createScrubber, planEscapes, assertFeatureName } from '../src/guard.mjs';
import { parseArgs } from '../src/cli.mjs';

test('token bucket: a full bucket, one token per 60/n seconds, never above capacity', () => {
  let t = 0;
  const b = createTokenBucket({ perMinute: 6, now: () => t });
  assert.equal(b.capacity, 6);
  for (let i = 0; i < 6; i += 1) assert.deepEqual(b.take(), { ok: true });
  assert.deepEqual(b.take(), { ok: false, retryAfterSeconds: 10 });
  t += 10_000;
  assert.deepEqual(b.take(), { ok: true });
  assert.equal(b.take().ok, false);
  t += 10 * 60_000;
  for (let i = 0; i < 6; i += 1) assert.equal(b.take().ok, true);
  assert.equal(b.take().ok, false, 'an hour of idleness buys 6 tokens, not 60');
  assert.equal(createTokenBucket().capacity, DEFAULT_RATE_PER_MINUTE);
  assert.equal(createTokenBucket({ perMinute: 0 }).capacity, 1, 'at least one call a minute');
});

test('parseArgs: the startup configuration and its refusals', () => {
  assert.deepEqual(parseArgs([]), {});
  assert.deepEqual(parseArgs(['--root', '/w/app', '--rate-limit', '60', '--max-output', '1000']), { root: '/w/app', ratePerMinute: 60, maxOutputBytes: 1000 });
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['--version']).version, true);
  assert.match(parseArgs(['--root']).error, /directory/);
  assert.match(parseArgs(['--root', '--rate-limit', '5']).error, /directory/);
  assert.match(parseArgs(['--rate-limit', String(MAX_RATE_PER_MINUTE + 1)]).error, /whole number/);
  assert.match(parseArgs(['--rate-limit', '1.5']).error, /whole number/);
  assert.match(parseArgs(['--max-output', '99999999']).error, /whole number/, 'the output cap can be lowered, never raised');
  assert.match(parseArgs(['--project', 'x']).error, /Unknown argument/);
});

test('scrubber: the root becomes a relative path, the home directory ~, system paths and secrets are hidden, structure is kept', () => {
  const scrub = createScrubber('/work/app');
  assert.equal(scrub('see /work/app/features/a.ts and /work/app'), 'see features/a.ts and .');
  assert.equal(scrub('open /etc/passwd or /tmp/x/y or C:\\Users\\me\\f.txt'), 'open [path] or [path] or [path]');
  assert.equal(scrub('the route /products and features/x/y.ts stay'), 'the route /products and features/x/y.ts stay');
  assert.equal(scrub('key sk-live-0123456789abcdefghij'), '[redacted]');
  assert.deepEqual(scrub({ a: ['/work/app/x', 1, null, true], b: { c: '/var/log/z' } }), { a: ['x', 1, null, true], b: { c: '[path]' } });
});

test('planEscapes: a file path or a path argument that leaves the project, and nothing else', () => {
  const file = (p) => ({ steps: [{ touches: { files: [{ path: p }] } }] });
  assert.equal(planEscapes(file('../x')), '../x');
  assert.equal(planEscapes(file('/etc/x')), '/etc/x');
  assert.equal(planEscapes(file('a\\..\\b')), 'a\\..\\b');
  assert.equal(planEscapes(file('features/a/b.ts')), null);
  assert.equal(planEscapes({ steps: [{ args: { route: '/products', title: '../prose' } }] }), null, 'only path-like keys are looked at');
  assert.equal(planEscapes({ steps: [{ args: { nested: { dir: '~/x' } } }] }), '~/x');
  assert.equal(planEscapes(null), null);
});

test('assertFeatureName and ToolError: a name passes, a path is a refusal with a code from the closed set', () => {
  assert.equal(assertFeatureName('billing-v2'), 'billing-v2');
  assert.throws(() => assertFeatureName('../x'), (e) => e instanceof ToolError && e.code === ERROR_CODES.PATH_OUTSIDE_ROOT);
  assert.throws(() => assertFeatureName('1x'), (e) => e.code === ERROR_CODES.INVALID_INPUT);
  assert.ok(Object.keys(ERROR_CODES).every((k) => ERROR_CODES[k] === k), 'a code is its own name');
});
