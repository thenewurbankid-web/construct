// #948 item 3 -- the Pages Editor's AI quick fix is modelled: the model is asked for the ONE function the rule's line
// is in (signature prefilled, stopped at its closing brace), never the whole file; the buffer is re-linted and the fix
// refused while the rule still fires or a new diagnostic appears. Fake providers only (PROVIDERS.claude swapped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { quickFixPageBuffer } from './pageSource.mjs';
import { PagesEditorError } from './pagesEditor.mjs';
import { PROVIDERS } from '../../../packages/core/llm.mjs';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

const SRC = 'export function HomePage() {\n  const s: string = 5;\n  return <p>{s}</p>;\n}\n\nexport function Footer() {\n  return <p>footer</p>;\n}\n';

function makeProject(pageSource) {
  const root = makeTempDir('construct-page-source-ai-');
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n');
  fs.mkdirSync(path.join(root, 'features/billing/pages'), { recursive: true });
  fs.writeFileSync(path.join(root, 'features/billing/pages/HomePage.tsx'), pageSource);
  return root;
}

async function withFake(replies, fn) {
  const original = PROVIDERS.claude;
  const calls = [];
  PROVIDERS.claude = (prompt, options) => { calls.push({ prompt, options }); return replies[Math.min(calls.length - 1, replies.length - 1)]; };
  try { return { result: await fn().catch((e) => e), calls }; } finally { PROVIDERS.claude = original; }
}

test('AI quick fix: one function is asked for (signature prefilled); a whole-file reply is refused with an example, then the body lands', async () => {
  const root = makeProject(SRC);
  const { result, calls } = await withFake([
    'export function HomePage() {\n  const s: string = "5";\n  return <p>{s}</p>;\n}\n\nexport function Footer() {\n  return <b>changed</b>;\n}\n',
    '  const s: string = "5";\n  return <p>{s}</p>;\n}',
  ], () => quickFixPageBuffer(root, 'billing', 'HomePage.tsx', SRC, 'TS2322', 'ai', 'claude'));
  assert.ok(!(result instanceof Error), String(result?.message));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].options.output.prefill, 'export function HomePage() {\n');
  assert.deepEqual(calls[0].options.output.stop, ['\n}']);
  assert.match(calls[1].prompt, /Refused \(ONE_FUNCTION\)[\s\S]*a valid reply is only/);
  assert.equal(result.fixedSource, SRC.replace('= 5;', '= "5";'), 'only HomePage\'s body changed; Footer is untouched');
  assert.equal(result.attribution.fn, 'HomePage');
});

test('AI quick fix: refused when the rule still fires, or when a new diagnostic appears', async () => {
  const root = makeProject(SRC);
  const still = await withFake(['  const s: string = 6;\n  return <p>{s}</p>;\n}'], () => quickFixPageBuffer(root, 'billing', 'HomePage.tsx', SRC, 'TS2322', 'ai', 'claude'));
  assert.ok(still.result instanceof PagesEditorError);
  assert.equal(still.result.status, 422);
  assert.match(still.result.message, /TS2322 still fires at line 2/);
  assert.equal(still.calls.length, 2, 'one retry carrying the first error');
  const added = await withFake(['  const s: string = "5";\n  const n: number = "x";\n  return <p>{s}{n}</p>;\n}'], () => quickFixPageBuffer(root, 'billing', 'HomePage.tsx', SRC, 'TS2322', 'ai', 'claude'));
  assert.ok(added.result instanceof PagesEditorError);
  assert.match(added.result.message, /TS2322 still fires|adds a new diagnostic/);
});

test('AI quick fix: a rule outside any function gets no model call', async () => {
  const src = 'export const x: number = "no";\n';
  const root = makeProject(src);
  const { result, calls } = await withFake(['x'], () => quickFixPageBuffer(root, 'billing', 'HomePage.tsx', src, 'TS2322', 'ai', 'claude'));
  assert.equal(calls.length, 0);
  assert.ok(result instanceof PagesEditorError);
  assert.match(result.message, /outside any function/);
});
