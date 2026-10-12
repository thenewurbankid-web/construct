// Line Import v2: every import still resolves after a step (importV2/resolve.mjs). Found on max-ai-ui /opportunity
// (iv2-mocks): the logic map said "all kept" while 9 importers named a file the step had deleted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { unresolvedImports, brokenImports } from '../packages/engine/line/importV2/resolve.mjs';
import { createLogicOnDisk } from '../packages/engine/line/importLoopDisk.mjs';
import { measure, loopChecks, newLogic } from '../packages/engine/line/importLoop.mjs';

function app() {
  const root = makeTempDir('construct-iv2-resolve-');
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  w('tsconfig.json', '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } } }\n');
  w('src/lib/api.ts', 'export const api = 1;\n');
  w('src/lib/data.json', '{}\n');
  w('src/lib/esm.ts', 'export const esm = 1;\n');
  w('src/lib/index.ts', "export * from './api';\n");
  w('src/page.tsx', [
    "import { api } from '@/lib/api';",
    "import data from './lib/data.json';",
    "import { esm } from './lib/esm.js';",
    "import * as lib from './lib';",
    "import React from 'react';",
    "// import { gone } from './gone';",
    "/* import { gone2 } from './gone2'; */",
    'export default function Page() { return api + esm; }',
    '',
  ].join('\n'));
  w('src/page.test.tsx', "jest.mock('@/lib/api');\nconst x = require('./lib/api');\n");
  return { root, w };
}

const FILES = ['src/page.tsx', 'src/page.test.tsx', 'src/lib/api.ts', 'src/lib/index.ts', 'src/lib/esm.ts'];

test('unresolvedImports: relative, alias, json, index, a .js specifier naming a .ts file and jest mocks all resolve; packages and comments are not read', () => {
  const { root } = app();
  assert.deepEqual(unresolvedImports(root, FILES), []);
});

test('a move that deletes a file its importers still name is caught, with the file and line; an app\'s own old breakage is not the import\'s', () => {
  const { root, w } = app();
  w('src/legacy.ts', "import { old } from './never-there';\nexport const legacy = old;\n");
  const files = [...FILES, 'src/legacy.ts'];
  const baseline = unresolvedImports(root, files);
  assert.deepEqual(baseline.map((b) => `${b.file}:${b.line} ${b.spec}`), ['src/legacy.ts:1 ./never-there']);
  // "the step": api.ts moved into the library, its importers left behind
  fs.mkdirSync(path.join(root, 'src/library/services'), { recursive: true });
  fs.renameSync(path.join(root, 'src/lib/api.ts'), path.join(root, 'src/library/services/api.ts'));
  const broken = brokenImports(root, files, baseline);
  assert.deepEqual(broken.map((b) => `${b.file}:${b.line} ${b.spec}`), [
    'src/page.tsx:1 @/lib/api',
    'src/page.test.tsx:1 @/lib/api',
    'src/page.test.tsx:2 ./lib/api',
    'src/lib/index.ts:1 ./api',
  ].sort((a, b) => FILES.indexOf(a.split(':')[0]) - FILES.indexOf(b.split(':')[0])));
});

test('the loop: a step that moves a file and leaves its importers behind stops on "imports", even though the logic map keeps every unit', async () => {
  const { root, w } = app();
  w('architecture.yml', 'version: 1\n');
  const ops = createLogicOnDisk(root, 'src', { cache: false, characterizeWith: async () => ({ tests: [], sentence: 'No tests here.' }) });
  const logic = { ...newLogic(null), closure: await ops.closure(root, 'src', null) };
  const map = await ops.buildMap(root, 'src', logic.closure);
  await ops.save('logic-map', map);
  await ops.save('baseline', { files: map.files });
  // "the step": api.ts moves into the library and nobody re-points its importers
  fs.mkdirSync(path.join(root, 'src/library/services'), { recursive: true });
  fs.renameSync(path.join(root, 'src/lib/api.ts'), path.join(root, 'src/library/services/api.ts'));
  const m = await measure(ops, { root, folder: 'src', logic });
  const checks = loopChecks(m, logic, { at: 'step', folder: 'src' });
  const by = Object.fromEntries(checks.map((c) => [c.id, c]));
  assert.equal(by['logic-map'].state, 'pass', 'the map still finds every unit (moved)');
  assert.equal(by.imports.state, 'fail');
  assert.match(by.imports.sentence, /^4 imports name a file that is not there; the first: src\/lib\/index\.ts \(line 1\) imports \.\/api\.$/);
  assert.deepEqual(by.imports.fixes.map((f) => f.id), ['recheck']);
});
