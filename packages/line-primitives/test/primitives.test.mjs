// Runs every primitive's test kit (test/kits/<Name>.kit.tsx) under jsdom: kit/contract agreement, every state
// (axe clean), every event and every key. A primitive in the contract without a kit, or a kit without a library
// component, fails here.
import '../scripts/register-tsx.mjs';
import '../scripts/dom-env.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRIMITIVES } from '../contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KITS = path.join(HERE, 'kits');
const COMPONENTS = path.join(HERE, '..', 'library', 'components');

const { runKit, expectAxeClean } = await import(pathToFileURL(path.join(HERE, 'kit', 'harness.tsx')).href);
const built = PRIMITIVES.filter((p) => fs.existsSync(path.join(COMPONENTS, `${p.name}.tsx`)));

test('the axe check fails a page with an unnamed button (the harness can see violations)', async () => {
  document.body.innerHTML = '<button type="button"></button>';
  try {
    await assert.rejects(expectAxeClean(), /button-name/);
  } finally { document.body.innerHTML = ''; }
});

test('every built primitive has a test kit', () => {
  const missing = built.filter((p) => !fs.existsSync(path.join(KITS, `${p.name}.kit.tsx`))).map((p) => p.name);
  assert.deepEqual(missing, []);
});

for (const p of built) {
  const file = path.join(KITS, `${p.name}.kit.tsx`);
  if (!fs.existsSync(file)) continue;
  const { kit } = await import(pathToFileURL(file).href);
  runKit(kit, p);
}
