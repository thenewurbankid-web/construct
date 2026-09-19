// #174 — one layer classifier: graph-driven, honoring custom layer patterns and frozen regions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { classifyFile, classifyProjectFile } from '../src/architecture-graph.mjs';
import { classifyFile as enforcerClassifyFile } from '../src/architecture-enforcer.mjs';
import { classifyLayer, parseFile, summarizeFeature } from '../src/parser.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

function project(files, architectureYml) {
  const root = makeTempDir('construct-classify-');
  if (architectureYml) fs.writeFileSync(path.join(root, 'architecture.yml'), architectureYml);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return root;
}

test('there is a single classifier: the enforcer and parser expose the graph-driven one', () => {
  assert.equal(enforcerClassifyFile, classifyFile);
  assert.equal(classifyLayer('features/x/hooks/useFoo.ts'), 'hook');
  assert.equal(classifyLayer('app/dashboard/page.tsx'), 'route');
  assert.equal(classifyLayer('random/file.ts'), null);
});

test('parseFile classifies through a custom layer pattern from architecture.yml', () => {
  const root = project(
    { 'features/x/adapters/Thing.ts': 'export const a = 1;\n', 'features/x/services/S.ts': 'export const s = 1;\n' },
    'layers:\n  adapter:\n    pattern: "features/*/adapters/**"\n    canImport: [domain, types]\n',
  );
  assert.equal(parseFile(root, 'features/x/adapters/Thing.ts').layer, 'adapter');
  assert.equal(parseFile(root, 'features/x/services/S.ts').layer, 'service');
  assert.equal(summarizeFeature(root, 'x').layers.adapter.length, 1);
});

test('a custom pattern can re-home a canonical layer (services under features/*/api)', () => {
  const root = project(
    { 'features/x/api/Client.ts': 'export const c = 1;\n' },
    'layers:\n  service:\n    pattern: "features/*/api/**"\n',
  );
  assert.equal(parseFile(root, 'features/x/api/Client.ts').layer, 'service');
});

test('react-spa framework classifies src/App.tsx as the route', () => {
  const root = project({ 'src/App.tsx': 'export const A = 1;\n' }, 'project:\n  framework: react-spa\n');
  assert.equal(parseFile(root, 'src/App.tsx').layer, 'route');
});

test('a file inside a frozen region is never classified', () => {
  const root = project(
    { 'features/x/components/Vendor.tsx': 'export const V = 1;\n', 'features/x/components/Own.tsx': 'export const O = 1;\n' },
    'frozen:\n  - features/x/components/Vendor.tsx\n',
  );
  assert.equal(parseFile(root, 'features/x/components/Vendor.tsx').layer, null);
  assert.equal(parseFile(root, 'features/x/components/Own.tsx').layer, 'component');
  assert.equal(classifyProjectFile(root, path.join(root, 'features/x/components/Vendor.tsx')), null);
});
