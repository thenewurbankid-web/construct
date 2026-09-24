import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repairRelativeImports } from '../packages/core/import-repair.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

function project() {
  const root = makeTempDir('import-repair-');
  const w = (rel, src) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, src);
    return abs;
  };
  return { root, w };
}

test('a specifier that differs from an existing file only by case is rewritten to the exact spelling', () => {
  const { w } = project();
  w('features/orders/services/OrdersApi.tsx', 'export const x = 1;\n');
  const hook = w('features/orders/hooks/useOrders.tsx', "import { x } from '../services/ordersApi';\nexport const useOrders = () => x;\n");
  const repairs = repairRelativeImports([hook]);
  assert.deepEqual(repairs.map((r) => [r.from, r.to]), [['../services/ordersApi', '../services/OrdersApi']]);
  assert.match(fs.readFileSync(hook, 'utf8'), /from '\.\.\/services\/OrdersApi'/);
});

test('folder segments and dynamic imports are repaired too; extensions the author wrote are kept', () => {
  const { w } = project();
  w('features/orders/Services/OrdersApi.ts', 'export const x = 1;\n');
  const file = w('features/orders/hooks/a.ts', "export const load = () => import('../services/ordersapi');\nimport y from \"../services/ordersApi.ts\";\n");
  repairRelativeImports([file]);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /import\('\.\.\/Services\/OrdersApi'\)/);
  assert.match(text, /"\.\.\/Services\/OrdersApi\.ts"/);
});

test('imports that already resolve, that match nothing, or that are ambiguous are left alone', () => {
  const { w } = project();
  w('features/o/services/Api.tsx', '');
  w('features/o/services/API.ts', '');
  w('features/o/domain/Money.tsx', '');
  const file = w('features/o/hooks/h.tsx', "import a from '../domain/Money';\nimport b from '../domain/Nope';\nimport c from '../services/api';\nimport d from 'react';\n");
  const before = fs.readFileSync(file, 'utf8');
  assert.deepEqual(repairRelativeImports([file]), []);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});
