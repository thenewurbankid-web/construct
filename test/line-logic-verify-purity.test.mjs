// Line logic verification step 2: purity.mjs classifyUnit, the pure/impure split over Morpheus's effect facts. Small
// synthetic projects written to a temp dir per test. The Morpheus cases skip (with the link's own sentence) when the
// source repo is not linked on this machine; the fallback case runs everywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { linkStatus } from '../packages/line-links/index.mjs';
import { classifyUnit, classifyLocal, morpheusLinked } from '../packages/engine/line/logicVerify/purity.mjs';
import { classifyBefore } from '../packages/engine/line/logicVerify/verifyPair.mjs';

const status = linkStatus();
const skip = status.ok ? false : status.message;

/** A temp project from {relPath: source}. */
function project(t, files) {
  const root = makeTempDir('construct-lv2-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, src] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), src);
  }
  return root;
}

test('classifyUnit: Morpheus is linked and used', { skip }, async () => {
  assert.equal(await morpheusLinked(), true);
});

test('classifyUnit: a pure unit (arithmetic, a local write, a pure helper) has no chain', { skip }, async (t) => {
  const root = project(t, {
    'src/price.ts': "import { round2 } from './round';\nexport function withTax(p: number): number {\n  let total = p * 1.2;\n  total += 0;\n  return round2(total);\n}\n",
    'src/round.ts': 'export function round2(n: number): number {\n  return Math.round(n * 100) / 100;\n}\n',
  });
  assert.deepEqual(await classifyUnit({ root, file: 'src/price.ts', fn: 'withTax' }), { purity: 'pure', effectChain: [] });
});

test('classifyUnit: direct effects are own links with an empty via, in EFFECT_NAMES order', { skip }, async (t) => {
  const root = project(t, {
    'src/save.ts': "export function save(v: string): void {\n  console.log(v);\n  localStorage.setItem('k', v);\n  setTimeout(() => {}, 1);\n}\n",
  });
  assert.deepEqual(await classifyUnit({ root, file: 'src/save.ts', fn: 'save' }), {
    purity: 'impure',
    effectChain: [{ effect: 'storage', via: [] }, { effect: 'timer', via: [] }, { effect: 'console', via: [] }],
  });
});

test('classifyUnit: transitive effects name every item on the way, nearest first', { skip }, async (t) => {
  const root = project(t, {
    'src/total.ts': "import { load } from './load';\nexport function total(id: string): number {\n  return load(id) + 1;\n}\n",
    'src/load.ts': "import { readRaw } from './raw';\nexport function load(id: string): number {\n  return Number(readRaw(id));\n}\n",
    'src/raw.ts': "export function readRaw(id: string): string | null {\n  if (!id) throw new Error('no id');\n  return localStorage.getItem(id);\n}\n",
  });
  assert.deepEqual(await classifyUnit({ root, file: 'src/total.ts', fn: 'total' }), {
    purity: 'impure',
    effectChain: [
      { effect: 'storage', via: ['src/load.ts#load', 'src/raw.ts#readRaw'] },
      { effect: 'throw', via: ['src/load.ts#load', 'src/raw.ts#readRaw'] },
    ],
  });
  // the middle item sees the same effects one hop nearer
  assert.deepEqual((await classifyUnit({ root, file: 'src/load.ts', fn: 'load' })).effectChain.map((l) => l.via), [['src/raw.ts#readRaw'], ['src/raw.ts#readRaw']]);
});

test('classifyUnit: an effect it has itself wins over the same effect reached through a call', { skip }, async (t) => {
  const root = project(t, {
    'src/a.ts': "import { b } from './b';\nexport function a(): void {\n  b();\n  console.log('a');\n}\n",
    'src/b.ts': "export function b(): void {\n  console.log('b');\n}\n",
  });
  assert.deepEqual(await classifyUnit({ root, file: 'src/a.ts', fn: 'a' }), { purity: 'impure', effectChain: [{ effect: 'console', via: [] }] });
});

test('classifyUnit: unknown imports: an HTTP verb on one is a fetch through it, a logic-map toast names it, other calls add nothing', { skip }, async (t) => {
  const root = project(t, {
    'src/orders/save.ts': [
      "import { api } from '../api';",
      "import { toast } from '../toast';",
      "import { format } from 'date-fns';",
      "import { slug } from './missing';",
      'export async function save(o: { id: string }): Promise<string> {',
      "  await api.post('/orders', o);",
      "  toast.success('saved');",
      '  return slug(format(o.id));',
      '}',
      'export function label(o: { id: string }): string {',
      '  return slug(format(o.id));',
      '}',
      '',
    ].join('\n'),
  });
  assert.deepEqual(await classifyUnit({ root, file: 'src/orders/save.ts', fn: 'save' }), {
    purity: 'impure',
    effectChain: [{ effect: 'fetch', via: ['src/api.ts#api'] }, { effect: 'toast', via: ['src/toast.ts#toast'] }],
  });
  assert.deepEqual(await classifyUnit({ root, file: 'src/orders/save.ts', fn: 'label' }), { purity: 'pure', effectChain: [] });
});

test('classifyUnit: an import that resolves to a project object (not a Morpheus item) is opaque too', { skip }, async (t) => {
  const root = project(t, {
    'src/client.ts': "export const http = { get: (u: string) => fetch(u) };\n",
    'src/user.ts': "import { http } from './client';\nexport function loadUser(id: string) {\n  return http.get('/users/' + id);\n}\n",
  });
  assert.deepEqual(await classifyUnit({ root, file: 'src/user.ts', fn: 'loadUser' }), { purity: 'impure', effectChain: [{ effect: 'fetch', via: ['src/client.ts#http'] }] });
});

test('classifyLocal (link down): logic-map units and free globals, no transitive chain', (t) => {
  const root = project(t, {
    'src/a.ts': "import { b } from './b';\nexport function a(): number {\n  window.scrollTo(0, 0);\n  return b();\n}\n",
    'src/b.ts': "export function b(): number {\n  return Date.now();\n}\n",
  });
  assert.deepEqual(classifyLocal({ root, file: 'src/a.ts', fn: 'a' }), { purity: 'impure', effectChain: [{ effect: 'dom', via: [] }] });
});

test('verifyPair classifyBefore answers through classifyUnit', { skip }, async (t) => {
  const root = project(t, {
    'src/a.ts': "import { b } from './b';\nexport function a(): number {\n  return b();\n}\n",
    'src/b.ts': "export function b(): number {\n  return Date.now();\n}\n",
  });
  assert.deepEqual(await classifyBefore({ root, file: 'src/a.ts', fn: 'a' }), { purity: 'impure', effectChain: [{ effect: 'time', via: ['src/b.ts#b'] }] });
});
