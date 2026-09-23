// SERVICE-003 (part of #577/#594): a fetch() with no `signal` in its init, or a defineService()
// fn whose first parameter type has no `signal: AbortSignal`, lets a stale response land after
// its request was superseded. Off by default, opt-in like DOMAIN-002/WORKFLOW-004/STATE-001.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RULES } from '../packages/core/config.mjs';
import { detectLayerViolations, validateArchitecture } from '../packages/core/architecture-enforcer.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(REPO_ROOT, 'fixtures', 'staleness', 'features');
const BAD = fs.readFileSync(path.join(FIXTURES, 'bad', 'services', 'fetchOrder.ts'), 'utf8');
const GOOD = fs.readFileSync(path.join(FIXTURES, 'good', 'services', 'fetchOrder.ts'), 'utf8');
const NO_FETCH = 'export function noNetworkHere() {\n  return 1;\n}\n';
const SUGGESTED_FIX = '({ signal }: { signal: AbortSignal }) => fetch(url, { signal })';

const ruleIds = (source) => detectLayerViolations('service', source).map((v) => v.rule);
const on003 = (source) => detectLayerViolations('service', source, { serviceAbortSignal: true }).filter((v) => v.rule === 'SERVICE-003');

test('SERVICE-003 is registered off by default and reports nothing unless opted in', () => {
  assert.equal(DEFAULT_RULES['SERVICE-003'].severity, 'off');
  assert.deepEqual(ruleIds(BAD), []);
});

test('SERVICE-003: fires on the bad fixture (fetch() with no forwarded signal), file:line, exact suggestedFix', () => {
  const v = on003(BAD);
  assert.equal(v.length, 1);
  assert.equal(v[0].line, 5);
  assert.match(v[0].message, /fetch/);
  assert.equal(v[0].suggestedFix, SUGGESTED_FIX);
  assert.equal(v[0].why, "a response that arrives after its request was superseded must not land — XState's fromPromise hands the invoked function a signal, aborted when the invoking state exits, and a service that forwards it to fetch is cancelled for free");
});

test('SERVICE-003: silent on the good fixture (defineService signal type + forwarded fetch signal)', () => {
  assert.deepEqual(on003(GOOD), []);
});

test('SERVICE-003: a service with no network calls is never reported, even opted in', () => {
  assert.deepEqual(on003(NO_FETCH), []);
});

test('SERVICE-003: a defineService() fn with no signal in its first parameter type is reported even when the fetch() call it does not reach forwards nothing to check', () => {
  const source = `import { defineService } from '../../../../packages/core/typed-contracts/factories.ts';\n\nexport const fetchOrder = defineService('fetchOrder', async ({ id }: { id: string }) => {\n  return fetch(\`/api/orders/\${id}\`);\n});\n`;
  const v = on003(source);
  assert.equal(v.length, 1);
  assert.equal(v[0].suggestedFix, SUGGESTED_FIX);
});

test('SERVICE-003: validateArchitecture (the source of `--format json`) has the same fields as other rules and honours the architecture.yml opt-in', () => {
  const dir = makeTempDir('construct-service003-');
  const yml = (rules) => `version: 1\npreset: strict-nextjs\nfeatures:\n  root: features\n${rules}`;
  fs.writeFileSync(path.join(dir, 'architecture.yml'), yml(''));
  fs.mkdirSync(path.join(dir, 'features/shop/services'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features/shop/services/fetchOrder.ts'), BAD);
  fs.writeFileSync(path.join(dir, 'features/shop/services/noFetch.ts'), NO_FETCH);
  const all = () => validateArchitecture(dir).violations;
  assert.deepEqual(all().filter((v) => v.rule === 'SERVICE-003'), []);
  fs.writeFileSync(path.join(dir, 'architecture.yml'), yml('rules:\n  SERVICE-003: warning\n'));
  const found = all().filter((x) => x.rule === 'SERVICE-003');
  assert.equal(found.length, 1);
  const [v] = found;
  assert.equal(v.severity, 'warning');
  assert.equal(v.file, 'features/shop/services/fetchOrder.ts');
  assert.equal(v.suggestedFix, SUGGESTED_FIX);
  assert.deepEqual(Object.keys(v).sort(), ['docsUrl', 'expected', 'file', 'line', 'message', 'module', 'rule', 'severity', 'suggestedFix', 'why']);
});
