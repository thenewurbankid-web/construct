// #144/#141 — a model's output is never written blindly: it's extracted from
// prose, validated as parseable code, retried once on rejection, and a
// failed or rejected fill leaves the scaffolded stub (+ import breadcrumb).
// Every provider is faked; nothing shells out or touches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractCode, whyNotCode, requestFileText, OUTPUT_CONTRACT } from '../src/llm-fill.mjs';
import { createFeature, generateLayer, fillGeneratedFile } from '../src/generators.mjs';
import { importVertical } from '../src/import.mjs';
import { generate, importCommand } from '../src/cli.mjs';
import { PROVIDERS } from '../src/llm.mjs';
import { ConstructError } from '../src/diagnostics.mjs';

const CODE = 'export function Foo() { return 7; }';
const PROSE = "I wasn't able to write directly to the file, so here is the content, please apply it manually:";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'construct-llm-fill-'));

/** `responses`: array consumed one per call (last repeats) or a function(callNo). Error entries are thrown. */
async function withFake(responses, fn) {
  const original = PROVIDERS.claude;
  const calls = [];
  PROVIDERS.claude = (prompt) => {
    calls.push(prompt);
    const r = typeof responses === 'function' ? responses(calls.length) : responses[Math.min(calls.length, responses.length) - 1];
    if (r instanceof Error) throw r;
    return r;
  };
  try {
    return { result: await fn(), calls };
  } finally {
    PROVIDERS.claude = original;
  }
}

async function captureConsole(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...p) => lines.push(p.join(' '));
  const priorExit = process.exitCode;
  process.exitCode = undefined;
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  const exitCode = process.exitCode;
  process.exitCode = priorExit;
  return { out: lines.join('\n'), exitCode };
}

// ---- extractCode / whyNotCode ---------------------------------------------

test('extractCode: raw code, whole-response fence, prose+ONE fence, and ambiguous multiple fences', () => {
  assert.deepEqual(extractCode(CODE), { code: CODE, how: 'raw' });
  assert.deepEqual(extractCode('```ts\n' + CODE + '\n```'), { code: CODE, how: 'fence' });
  assert.deepEqual(extractCode(`${PROSE}\n\n\`\`\`tsx\n${CODE}\n\`\`\`\n\nLet me know if that works.`), { code: CODE, how: 'fence-in-prose' });
  assert.equal(extractCode('```ts\nconst a = 1;\n```\nand\n```ts\nconst b = 2;\n```').how, 'ambiguous-fences');
});

test('whyNotCode: accepts real code, rejects prose, empty text and a lone identifier', () => {
  assert.equal(whyNotCode(CODE), null);
  assert.equal(whyNotCode('const X = <div>hi</div>;\nexport default X;'), null, 'JSX is fine');
  assert.match(whyNotCode(PROSE), /does not parse/);
  assert.match(whyNotCode(''), /empty/);
  assert.match(whyNotCode('Done'), /not a file body/);
});

// ---- requestFileText: retry policy ----------------------------------------

test('requestFileText appends the stdout-only / no-file-access contract to the prompt', async () => {
  const { calls } = await withFake([CODE], () => requestFileText('claude', 'PROMPT'));
  assert.ok(calls[0].startsWith('PROMPT'));
  assert.ok(calls[0].includes(OUTPUT_CONTRACT));
  assert.match(OUTPUT_CONTRACT, /no file or tool access/);
});

test('requestFileText retries exactly once after a rejection, telling the model why, and succeeds if the retry is clean', async () => {
  const { result, calls } = await withFake([PROSE, CODE], () => requestFileText('claude', 'P'));
  assert.equal(result.status, 'filled');
  assert.equal(result.attempts, 2);
  assert.match(calls[1], /previous reply was rejected because it does not parse/);
});

test('requestFileText gives up after one retry (2 calls max) and reports the rejection', async () => {
  const { result, calls } = await withFake([PROSE], () => requestFileText('claude', 'P'));
  assert.equal(calls.length, 2);
  assert.equal(result.status, 'rejected');
  assert.equal(result.attempts, 2);
  assert.match(result.reason, /does not parse/);
});

test('requestFileText does NOT retry a thrown provider error — it reports status "failed" after 1 call', async () => {
  const { result, calls } = await withFake([new Error('spawnSync claude ENOENT')], () => requestFileText('claude', 'P'));
  assert.equal(calls.length, 1);
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /ENOENT/);
});

test('requestFileText rethrows an unknown-provider USAGE_ERROR instead of reporting it per file', async () => {
  await assert.rejects(() => requestFileText('nope', 'P'), (e) => e instanceof ConstructError && e.exitCode === 2);
});

// ---- generators.mjs fillGeneratedFile (create / generate) -----------------

function scaffoldDomain() {
  const dir = tmp();
  createFeature(dir, 'checkout');
  const file = generateLayer(dir, 'domain', 'Foo', 'checkout');
  return { dir, file, stub: fs.readFileSync(file, 'utf8') };
}

test('fillGeneratedFile extracts the code from a prose+fence response and writes only the code', async () => {
  const { dir, file } = scaffoldDomain();
  const { result } = await withFake([`${PROSE}\n\n\`\`\`ts\n${CODE}\n\`\`\``], () => fillGeneratedFile(dir, file, 'domain', { feature: 'checkout', name: 'Foo', llm: 'claude' }));
  assert.equal(result.status, 'filled');
  assert.equal(fs.readFileSync(file, 'utf8').trim(), CODE);
});

test('fillGeneratedFile with a pure-prose response leaves the stub byte-identical and reports the rejection', async () => {
  const { dir, file, stub } = scaffoldDomain();
  const { result } = await withFake([PROSE], () => fillGeneratedFile(dir, file, 'domain', { feature: 'checkout', name: 'Foo', llm: 'claude' }));
  assert.equal(result.status, 'rejected');
  assert.match(result.reason, /does not parse/);
  assert.equal(fs.readFileSync(file, 'utf8'), stub);
});

test('fillGeneratedFile with a throwing provider leaves the stub and reports "failed" (no throw)', async () => {
  const { dir, file, stub } = scaffoldDomain();
  const { result } = await withFake([new Error('rate limited')], () => fillGeneratedFile(dir, file, 'domain', { feature: 'checkout', name: 'Foo', llm: 'claude' }));
  assert.equal(result.status, 'failed');
  assert.equal(fs.readFileSync(file, 'utf8'), stub);
});

test('generate --llm reports a rejected fill per file, keeps the stub and sets a non-zero exit code', async () => {
  const dir = tmp();
  createFeature(dir, 'checkout');
  const { result } = await withFake([PROSE], () => captureConsole(() => generate(['domain', 'Foo', '--feature', 'checkout', '--llm', 'claude', '--dir', dir])));
  assert.match(result.out, /stub kept — the model's output was rejected: it does not parse/);
  assert.doesNotMatch(result.out, /LLM-filled/);
  assert.equal(result.exitCode, 3);
  assert.equal(fs.readFileSync(path.join(dir, 'features/checkout/domain/Foo.tsx'), 'utf8'), 'export function Foo() {\n  return true;\n}\n');
});

// ---- import.mjs -------------------------------------------------------------

function importSetup() {
  const dir = tmp();
  createFeature(dir, 'checkout');
  const src = path.join(dir, 'Old.tsx');
  fs.writeFileSync(src, 'export function useOld() { return 42; }\n');
  return { dir, src, domainFile: path.join(dir, 'features/checkout/domain/Foo.tsx') };
}

test('importVertical: prose+fence response is extracted, valid code written, no breadcrumb', async () => {
  const { dir, src, domainFile } = importSetup();
  const { result } = await withFake([`${PROSE}\n\n\`\`\`tsx\n${CODE}\n\`\`\``], () => importVertical(dir, 'Foo', 'checkout', ['domain'], src, { llm: 'claude' }));
  assert.equal(result.fills[0].status, 'filled');
  assert.equal(result.llmFilled, true);
  const content = fs.readFileSync(domainFile, 'utf8');
  assert.equal(content.trim(), CODE);
  assert.doesNotMatch(content, /TODO\(import\)|wasn't able/);
});

test('importVertical: pure-prose response leaves a valid stub WITH the TODO(import) breadcrumb and reports why (after one retry)', async () => {
  const { dir, src, domainFile } = importSetup();
  const { result, calls } = await withFake([PROSE], () => importVertical(dir, 'Foo', 'checkout', ['domain'], src, { llm: 'claude' }));
  assert.equal(calls.length, 2, 'one bounded retry');
  assert.equal(result.llmFilled, false);
  assert.equal(result.fills[0].status, 'rejected');
  assert.match(result.fills[0].reason, /does not parse/);
  const content = fs.readFileSync(domainFile, 'utf8');
  assert.match(content, /^\/\*\* TODO\(import\): port the relevant logic from \.\.\/\.\.\/\.\.\/Old\.tsx/);
  assert.match(content, /export function Foo\(\)/);
  assert.doesNotMatch(content, /wasn't able/);
});

test('importVertical: a first bad reply then a clean retry writes the code', async () => {
  const { dir, src, domainFile } = importSetup();
  const { result } = await withFake([PROSE, CODE], () => importVertical(dir, 'Foo', 'checkout', ['domain'], src, { llm: 'claude' }));
  assert.equal(result.fills[0].status, 'filled');
  assert.equal(result.fills[0].attempts, 2);
  assert.equal(fs.readFileSync(domainFile, 'utf8').trim(), CODE);
});

// ---- #141: a THROWING provider ----------------------------------------------

test('#141 importVertical: a throwing provider leaves stub + breadcrumb, reports "failed", and does not lose sibling files', async () => {
  const { dir, src } = importSetup();
  // domain file's call throws; hook file's call succeeds.
  const hookCode = 'export function useFoo() { return 1; }';
  const { result } = await withFake((n) => (n === 1 ? new Error('provider exploded') : hookCode), () =>
    importVertical(dir, 'Foo', 'checkout', ['domain', 'hook'], src, { llm: 'claude' }),
  );
  const [domain, hook] = result.fills;
  assert.equal(domain.status, 'failed');
  assert.match(domain.reason, /provider exploded/);
  assert.equal(hook.status, 'filled');
  const domainContent = fs.readFileSync(domain.file, 'utf8');
  assert.match(domainContent, /TODO\(import\)/);
  assert.match(domainContent, /export function Foo\(\)/);
  assert.equal(fs.readFileSync(hook.file, 'utf8').trim(), hookCode);
});

test('#141 importVertical: an unknown provider is rejected up front, before anything is scaffolded', async () => {
  const { dir, src, domainFile } = importSetup();
  await assert.rejects(() => importVertical(dir, 'Foo', 'checkout', ['domain'], src, { llm: 'gpt-9' }), /Unknown --llm provider/);
  assert.equal(fs.existsSync(domainFile), false);
});

test('#141/#144 import CLI report: names each unfilled file, its reason and attempts, and exits non-zero', async () => {
  const { dir, src } = importSetup();
  const { result } = await withFake((n) => (n === 1 ? new Error('rate limited') : PROSE), () =>
    captureConsole(() => importCommand(['Foo', '--feature', 'checkout', '--layers', 'domain,hook', '--from', src, '--llm', 'claude', '--dir', dir])),
  );
  assert.match(result.out, /2 of 2 file\(s\) were NOT filled by "claude"/);
  assert.match(result.out, /domain\/Foo\.tsx: the LLM call failed after 1 attempt\(s\) — rate limited/);
  assert.match(result.out, /hooks\/useFoo\.tsx: the model's output was rejected after 2 attempt\(s\)/);
  assert.equal(result.exitCode, 3);
});
