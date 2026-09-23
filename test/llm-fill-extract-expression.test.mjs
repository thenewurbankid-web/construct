// #522 -- wiring `construct refactor extract-expression` (packages/core/extractExpression.mjs,
// #517) into the --llm fill surface: when an LLM's own fill output for a page/component file
// trips PAGE-008/COMPONENT-005 (inline conditional/loop JSX), the fill result names the exact
// deterministic command to run, instead of leaving a human (or a future LLM call) to hand-write
// the extraction. A fake PROVIDERS.claude stands in for a real LLM call, same pattern as
// test/create-fill.test.mjs and test/import.test.mjs — nothing here shells out or makes a real
// network call.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createFeature, generateLayer, fillGeneratedFile, extractExpressionHint } from '../packages/core/generators.mjs';
import { importVertical } from '../packages/core/import.mjs';
import { extractExpression } from '../packages/core/extractExpression.mjs';
import { validateArchitecture } from '../packages/core/architecture-enforcer.mjs';
import { create } from '../packages/core/cli.mjs';
import { PROVIDERS } from '../packages/core/llm.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

function tmpProject() {
  return makeTempDir('construct-llm-extract-');
}

async function withFakeClaude(response, fn) {
  const original = PROVIDERS.claude;
  const calls = [];
  PROVIDERS.claude = (prompt) => {
    calls.push(prompt);
    return typeof response === 'function' ? response(calls.length) : response;
  };
  try {
    return { result: await fn(), calls };
  } finally {
    PROVIDERS.claude = original;
  }
}

// The exact real fixture test/extract-expression.test.mjs proves extractExpression takes from
// flagged to clean end-to-end (ItemList/ItemRow derived names) — reused here as "what an LLM
// fill might hand back", not authored fresh for this test.
const INLINE_LOOP_PAGE = `export default function CpoHome(props: { title: string; items: string[] }) {
  return (
    <div className="home">
      <header>
        <h1>{props.title}</h1>
      </header>
      <main>
        <ul>
          {props.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </main>
    </div>
  );
}
`;

const INLINE_CONDITIONAL_COMPONENT = `export function StatusBadge(props: { ok: boolean }) {
  return props.ok ? <span>OK</span> : <span>Down</span>;
}
`;

test('#522: LAYER_CONSTRAINTS for page/component names extract-expression as the tool for inline JSX logic', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const file = generateLayer(dir, 'page', 'Foo', 'checkout');
  const { calls } = await withFakeClaude('export function FooPage() { return null; }', () =>
    fillGeneratedFile(dir, file, 'page', { feature: 'checkout', name: 'Foo', llm: 'claude' }),
  );
  assert.match(calls[0], /construct refactor extract-expression/);
  assert.match(calls[0], /never hand-author that extraction yourself/);
});

test('#522: fillGeneratedFile reports a fixCommand when the model\'s own page output has inline loop JSX', async () => {
  const dir = tmpProject();
  createFeature(dir, 'cpo');
  const file = generateLayer(dir, 'page', 'CpoHome', 'cpo');

  const { result: outcome } = await withFakeClaude(INLINE_LOOP_PAGE, () =>
    fillGeneratedFile(dir, file, 'page', { feature: 'cpo', name: 'CpoHome', llm: 'claude' }),
  );

  assert.equal(outcome.status, 'filled');
  assert.equal(outcome.fixCommand, `construct refactor extract-expression features/cpo/pages/CpoHomePage.tsx`);

  // Proof this points at a REAL fix, not a suggestion that doesn't work: running the named
  // deterministic block on the exact file it named takes PAGE-008 from flagged to clean —
  // exactly what an LLM would otherwise have been left to hand-write in raw tokens.
  const before = validateArchitecture(dir, { files: ['features/cpo/pages/CpoHomePage.tsx'] });
  assert.ok(before.violations.some((v) => v.rule === 'PAGE-008'));

  const extracted = extractExpression(dir, file);
  assert.equal(extracted.expression.name, 'ItemList');
  assert.ok(fs.existsSync(path.join(dir, extracted.expression.file)));

  const after = validateArchitecture(dir, { files: ['features/cpo/pages/CpoHomePage.tsx'] });
  assert.deepEqual(after.violations.filter((v) => v.rule === 'PAGE-008'), []);
});

test('#522: fillGeneratedFile reports a fixCommand when the model\'s own component output has an inline conditional', async () => {
  const dir = tmpProject();
  createFeature(dir, 'billing');
  const file = generateLayer(dir, 'component', 'StatusBadge', 'billing');

  const { result: outcome } = await withFakeClaude(INLINE_CONDITIONAL_COMPONENT, () =>
    fillGeneratedFile(dir, file, 'component', { feature: 'billing', name: 'StatusBadge', llm: 'claude' }),
  );

  assert.equal(outcome.status, 'filled');
  assert.equal(outcome.fixCommand, 'construct refactor extract-expression features/billing/components/StatusBadge.tsx');

  const extracted = extractExpression(dir, file);
  const after = validateArchitecture(dir, { files: ['features/billing/components/StatusBadge.tsx'] });
  assert.deepEqual(after.violations.filter((v) => v.rule === 'COMPONENT-005'), []);
  assert.ok(extracted.expression.name);
});

test('#522: no fixCommand when the model\'s output is already clean (no regression on the common case)', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const file = generateLayer(dir, 'page', 'Plain', 'checkout');
  const { result: outcome } = await withFakeClaude('export function PlainPage() { return <div>ok</div>; }', () =>
    fillGeneratedFile(dir, file, 'page', { feature: 'checkout', name: 'Plain', llm: 'claude' }),
  );
  assert.equal(outcome.status, 'filled');
  assert.equal(outcome.fixCommand, undefined);
});

test('#522: extractExpressionHint never fires for a non-page/component layer', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const file = generateLayer(dir, 'domain', 'Foo', 'checkout');
  assert.equal(extractExpressionHint(dir, file, 'domain'), undefined);
});

test('#522: construct create page --llm claude prints the extract-expression hint right after the fill line', async () => {
  const dir = tmpProject();
  createFeature(dir, 'cpo');
  const logs = [];
  const originalLog = console.log;
  console.log = (...parts) => logs.push(parts.join(' '));
  try {
    await withFakeClaude(INLINE_LOOP_PAGE, () =>
      create(['page', 'CpoHome', '--feature', 'cpo', '--dir', dir, '--llm', 'claude']),
    );
  } finally {
    console.log = originalLog;
  }
  const fillLine = logs.findIndex((l) => l.startsWith('Created + LLM-filled'));
  assert.ok(fillLine >= 0, 'expected a "Created + LLM-filled" line');
  assert.match(logs[fillLine + 1], /construct refactor extract-expression features\/cpo\/pages\/CpoHomePage\.tsx/);
  assert.match(logs[fillLine + 1], /rather than hand-editing/);
});

test('#522: importVertical\'s per-file fill also reports a fixCommand for a ported page with inline loop JSX', async () => {
  const dir = tmpProject();
  createFeature(dir, 'cpo');
  const sourceDir = makeTempDir('construct-llm-extract-src-');
  const sourceFile = path.join(sourceDir, 'OldCpoHome.tsx');
  fs.writeFileSync(sourceFile, 'old source, never actually read by the fake provider');

  const { result } = await withFakeClaude(INLINE_LOOP_PAGE, () =>
    importVertical(dir, 'CpoHome', 'cpo', ['page'], sourceFile, { llm: 'claude' }),
  );

  assert.equal(result.fills[0].status, 'filled');
  assert.equal(result.fills[0].fixCommand, 'construct refactor extract-expression features/cpo/pages/CpoHomePage.tsx');
});
