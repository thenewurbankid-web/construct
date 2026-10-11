// The logic kinds (iv2-fit, minimal): usecases, services and domains sit beside components, pages, workflows and
// fixtures in the library and in every feature. validate --profile line accepts them (LINE-LAYOUT), they need no
// library base yet (LINE-BASE), and the Line model reads them as items of their kind.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { validateLine } from '../packages/core/profiles/line/index.mjs';
import { ITEM_KINDS, LOGIC_KINDS, KIND_SINGULAR, normalizeLineConfig } from '../packages/core/profiles/line/contract.mjs';
import { readLineProject } from '../packages/engine/line/model.mjs';
import { LINE_KINDS } from '../packages/engine/line/contract.mjs';

function project(files) {
  const dir = makeTempDir('construct-iv2-kinds-');
  for (const [rel, content] of Object.entries({ 'architecture.yml': 'version: 1\npreset: line\n', ...files })) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

test('the kinds: the three logic kinds join the four, with the same folder names in the library and features', () => {
  assert.deepEqual(ITEM_KINDS, ['components', 'pages', 'workflows', 'fixtures', 'usecases', 'services', 'domains']);
  assert.deepEqual(LOGIC_KINDS, ['usecases', 'services', 'domains']);
  assert.deepEqual([...LINE_KINDS], [...ITEM_KINDS], 'the engine contract and the profile list the same kinds');
  for (const k of ITEM_KINDS) assert.ok(KIND_SINGULAR[k]);
  assert.deepEqual(normalizeLineConfig(undefined).traceExcludes, []);
});

test('validate: usecases/, services/ and domains/ are allowed in a feature and the library and need no base; other folders are still refused', () => {
  const dir = project({
    'library/README.md': '# Library\n',
    'library/services/ordersApi.ts': 'export function getOrders(): string[] {\n  return [];\n}\n',
    'library/domains/money.ts': 'export function formatTotal(n: number): string {\n  return String(n);\n}\n',
    'features/orders/spec.md': '# orders\n',
    'features/orders/usecases/useOrders.ts': 'export function useOrders(): string[] {\n  return [];\n}\n',
    'features/orders/services/ordersCache.ts': 'export const cache: string[] = [];\n',
    'features/orders/domains/orderRules.ts': 'export const isOpen = (s: string): boolean => s === "open";\n',
    'features/orders/helpers/x.ts': 'export const x = 1;\n',
  });
  const r = validateLine(dir);
  const hits = r.violations.map((v) => `${v.rule} ${v.file}`).sort();
  assert.deepEqual(hits, ['LINE-LAYOUT features/orders/helpers'], 'only the unknown folder is reported');
  const layout = validateLine(dir, { rules: ['LINE-LAYOUT'] }).violations[0];
  assert.match(layout.message, /a feature holds only components\/, pages\/, workflows\/, fixtures\/, usecases\/, services\/ and domains\/ plus spec\.md/);
});

test('model: the Line project reads the logic kinds as items, and the feature summary says what they are', () => {
  const dir = project({
    'library/README.md': '# Library\n',
    'features/orders/spec.md': '# orders\n',
    'features/orders/services/ordersApi.ts': 'export function getOrders(): string[] {\n  return [];\n}\n',
  });
  const p = readLineProject(dir);
  const items = p.features.find((f) => f.name === 'orders').items;
  assert.deepEqual(items.map((i) => [i.kind, i.name, i.status]), [['services', 'ordersApi', 'ok']]);
});
