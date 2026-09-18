// Epic #57 / #58 — the XState inspector must be strictly opt-in and dev-only.
// The helper is TypeScript (ui/client/lib), so exercise it through Node's
// built-in type stripping in a child process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const HELPER = new URL('../ui/client/lib/xstateInspector.ts', import.meta.url).pathname;

function resolve(env) {
  const out = execFileSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '-e', `import(${JSON.stringify(HELPER)}).then((m) => console.log(JSON.stringify(m.resolveInspectorConfig(${JSON.stringify(env)}))))`],
    { encoding: 'utf8' },
  );
  return JSON.parse(out);
}

test('disabled by default (dev, no URL) — there is no default hosted URL', () => {
  const c = resolve({ NODE_ENV: 'development' });
  assert.equal(c.enabled, false);
  assert.match(c.reason, /not set/);
});

test('disabled in production even if a URL is set', () => {
  assert.equal(resolve({ NODE_ENV: 'production', NEXT_PUBLIC_XSTATE_INSPECT_URL: 'http://127.0.0.1:3000/inspect' }).enabled, false);
});

test('enabled only with dev + explicit URL', () => {
  assert.deepEqual(resolve({ NODE_ENV: 'development', NEXT_PUBLIC_XSTATE_INSPECT_URL: ' http://127.0.0.1:3000/inspect ' }), {
    enabled: true,
    url: 'http://127.0.0.1:3000/inspect',
  });
});
