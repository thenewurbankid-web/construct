import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildReviewPrompt, reviewImport } from '../packages/core/import-review.mjs';
import { PROVIDERS } from '../packages/core/llm.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

function fixture() {
  const root = makeTempDir('import-review-');
  const src = path.join(root, 'old', 'Cart.ts');
  const out = path.join(root, 'features', 'shop', 'domain', 'Cart.tsx');
  fs.mkdirSync(path.dirname(src), { recursive: true });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(src, 'export const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);\n');
  fs.writeFileSync(out, 'export const total = () => 0;\n');
  return { root, src, out, plan: { feature: 'shop', units: [{ name: 'Cart', layers: ['domain'], from: src }] }, results: [{ name: 'Cart', source: src, files: [out] }] };
}

async function withFake(reply, fn) {
  const original = PROVIDERS.claude;
  const prompts = [];
  PROVIDERS.claude = (prompt) => {
    prompts.push(prompt);
    return reply;
  };
  try {
    return await fn(prompts);
  } finally {
    PROVIDERS.claude = original;
  }
}

test('the review prompt carries the plan, the source and the written file, and says not to report rule violations', () => {
  const { root, plan, results } = fixture();
  const p = buildReviewPrompt(root, plan, results);
  assert.match(p, /unit Cart: layers domain/);
  assert.match(p, /source: old\/Cart\.ts/);
  assert.match(p, /reduce\(/);
  assert.match(p, /written: features\/shop\/domain\/Cart\.tsx/);
  assert.match(p, /Do NOT report style, naming, or architecture-rule violations/);
});

test('reviewImport returns cleaned findings, defaults unknown kinds/severities, drops empties, and writes nothing', async () => {
  const { root, out, plan, results } = fixture();
  const before = fs.readFileSync(out, 'utf8');
  const reply = JSON.stringify({
    findings: [
      { file: 'features/shop/domain/Cart.tsx', kind: 'fix', severity: 'error', summary: 'total ignores its input', detail: 'source sums xs' },
      { file: 'x', kind: 'weird', severity: 'huge', summary: 'odd one' },
      { file: 'y', summary: '   ' },
    ],
  });
  await withFake('```json\n' + reply + '\n```', async () => {
    const { findings } = await reviewImport(root, plan, results);
    assert.equal(findings.length, 2);
    assert.deepEqual(findings[0], { file: 'features/shop/domain/Cart.tsx', kind: 'fix', severity: 'error', summary: 'total ignores its input', detail: 'source sums xs' });
    assert.equal(findings[1].kind, 'decision');
    assert.equal(findings[1].severity, 'warning');
  });
  assert.equal(fs.readFileSync(out, 'utf8'), before, 'the review is read-only');
});

test('an empty findings list is a clean review, and a non-JSON reply is an error that names the provider', async () => {
  const { root, plan, results } = fixture();
  await withFake('{"findings":[]}', async () => assert.deepEqual((await reviewImport(root, plan, results)).findings, []));
  await withFake('looks fine to me', async () => assert.rejects(() => reviewImport(root, plan, results), /"claude" did not return valid JSON for the review/));
});
