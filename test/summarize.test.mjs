import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { summarizeProject, summarizeCompact, summarizeSince } from '../src/summarize.mjs';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'construct-summarize-'));
}

function writeFile(root, relPath, content) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

function seedCheckoutFeature(root) {
  writeFile(
    root,
    'features/checkout/index.ts',
    `export { initCheckout } from './workflows/initCheckout';\nexport { useCheckoutStatus } from './hooks/useCheckoutStatus';\n`
  );
  writeFile(
    root,
    'features/checkout/workflows/initCheckout.ts',
    `/** Boots the checkout flow's state machine. */\nexport function initCheckout() {\n  return true;\n}\n`
  );
  writeFile(root, 'features/checkout/hooks/useCheckoutStatus.ts', `export function useCheckoutStatus() {\n  return 'idle';\n}\n`);
  writeFile(root, 'features/checkout/components/Summary.tsx', `export function Summary() {\n  return <div />;\n}\n`);
}

test('summarizeProject json is a stable-shaped array of per-feature Summary roll-ups', () => {
  const root = tmpRoot();
  seedCheckoutFeature(root);
  const json = summarizeProject(root, { format: 'json' });
  const parsed = JSON.parse(json);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, 1);
  const feature = parsed[0];
  assert.deepEqual(Object.keys(feature).sort(), ['feature', 'layers', 'loc', 'publicApi'].sort());
  assert.equal(feature.feature, 'checkout');
  assert.deepEqual(feature.publicApi.sort(), ['initCheckout', 'useCheckoutStatus'].sort());
  assert.equal(typeof feature.loc, 'number');
  assert.ok(feature.layers.workflow && feature.layers.workflow.length === 1);
  const fileSummary = feature.layers.workflow[0];
  assert.deepEqual(Object.keys(fileSummary).sort(), ['complexityEstimate', 'exports', 'imports', 'jsdoc', 'layer', 'loc', 'path'].sort());
});

test('summarizeProject md contains a section per feature with the expected headers', () => {
  const root = tmpRoot();
  seedCheckoutFeature(root);
  const md = summarizeProject(root, { format: 'md' });
  assert.match(md, /^# Construct Project Summary/);
  assert.match(md, /## Feature: checkout/);
  assert.match(md, /### Public API/);
  assert.match(md, /### Layers/);
  assert.match(md, /### Total LOC: \d+/);
  assert.match(md, /- `initCheckout`/);
});

test('summarizeProject with a --feature filter only includes that feature', () => {
  const root = tmpRoot();
  seedCheckoutFeature(root);
  writeFile(root, 'features/billing/index.ts', `export function billFoo() {}\n`);
  const parsed = JSON.parse(summarizeProject(root, { feature: 'checkout' }));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].feature, 'checkout');
});

test('summarizeCompact renders one no-filler paragraph per feature including JSDoc and public API', () => {
  const root = tmpRoot();
  seedCheckoutFeature(root);
  const text = summarizeCompact(root);
  assert.match(text, /Feature "checkout"/);
  assert.match(text, /Public API: initCheckout, useCheckoutStatus\./);
  assert.match(text, /Boots the checkout flow's state machine\./);
  assert.equal(text.split('\n\n').length, 1);
});

test('summarizeCompact reports when there are no features', () => {
  const root = tmpRoot();
  assert.equal(summarizeCompact(root), 'No features found.');
});

test('summarizeSince reports gracefully (does not throw) when root is not a git repository', () => {
  const root = tmpRoot();
  seedCheckoutFeature(root);
  const result = summarizeSince(root, 'HEAD');
  assert.match(result, /Could not compute a diff against "HEAD"/);
});

test('summarizeSince only includes features touched since the given ref', () => {
  const root = tmpRoot();
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  seedCheckoutFeature(root);
  writeFile(root, 'features/billing/index.ts', `export function billFoo() {}\n`);
  git('add', '.');
  git('commit', '-q', '-m', 'initial');

  // Only touch the checkout feature after the initial commit.
  writeFile(root, 'features/checkout/components/Summary.tsx', `export function Summary() {\n  return <div className="v2" />;\n}\n`);

  const result = summarizeSince(root, 'HEAD');
  assert.match(result, /Feature "checkout"/);
  assert.ok(!result.includes('Feature "billing"'));
});

test('summarizeSince reports when no features changed since the ref', () => {
  const root = tmpRoot();
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  seedCheckoutFeature(root);
  git('add', '.');
  git('commit', '-q', '-m', 'initial');
  const result = summarizeSince(root, 'HEAD');
  assert.match(result, /No changed features found since HEAD\./);
});
