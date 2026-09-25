// #623 (part of #616) -- run the render proofs of a feature (`features/<f>/tests/generated/*.proof.test.ts`, written by
// `construct create proof`) and say WHAT KIND of failure each one is, in the words of the Playwright runner (testRunner.mjs):
//   app         the screen reached another state than the proof expects. A bug worth reporting; the failure NAMES the state.
//   convention  the proof could not find what it binds to (a file or an export of the shape is gone or renamed). Not a product bug.
//   other       anything else, shown verbatim.
// A plan step (flow `test.proof`), `construct test proof <feature>` and the Cockpit are this one block. Deterministic, no LLM,
// read-only: nothing is written in the project.
//
// How it runs, offline: the proof is bundled with the PROJECT's own esbuild (it comes with `tsx` and with `vite`, which every
// `construct init` project lists) into a throwaway directory, then run with `node --test`. No browser, no server, no network, and
// no new dependency: a project without esbuild is told to `npm install -D tsx`, and `npx tsx --test <file>` also runs the same file.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import yaml from 'js-yaml';
import { projectPaths, GENERATED_MARKER } from './testGenerator.mjs';
import { classifyFailure } from './testRunner.mjs';
import { proofStatus, proofSummary } from '../core/proof.mjs';

const PROOF_RE = /^[A-Za-z][A-Za-z0-9]*\.proof\.test\.ts$/;
const RUN_TIMEOUT_MS = 60_000;
const SAFE_ENV = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'SystemRoot'];
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const clean = (s) => String(s ?? '').replace(ANSI, '').replace(/\r/g, '');
const fail = (code, message) => ({ ok: false, error: { code, message } });

/**
 * Read node's TAP output: one entry per test with its title, whether it passed and, for a failure, the error message. Pure.
 *
 * @param {string} text What `node --test --test-reporter=tap` printed.
 * @returns {{ title: string, ok: boolean, durationMs: number, error: string }[]} The tests, in order.
 *
 * @example
 * readTap('TAP version 13\nok 1 - a\n  ---\n  duration_ms: 1\n  ...\n'); // => [{ title: 'a', ok: true, durationMs: 1, error: '' }]
 */
export function readTap(text) {
  const lines = clean(text).split('\n');
  const tests = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(not )?ok \d+ - (.*)$/.exec(lines[i]);
    if (!m) continue;
    const test = { title: m[2].replace(/ # .*$/, ''), ok: !m[1], durationMs: 0, error: '' };
    if (/^ {2}---$/.test(lines[i + 1] ?? '')) {
      const block = [];
      let j = i + 2;
      while (j < lines.length && !/^ {2}\.\.\.$/.test(lines[j])) block.push(lines[j++].replace(/^ {2}/, ''));
      try {
        const doc = yaml.load(block.join('\n'));
        test.durationMs = Math.round(Number(doc?.duration_ms) || 0);
        test.error = typeof doc?.error === 'string' ? doc.error : '';
      } catch { /* a block that is not YAML: the message stays empty and the test is still failed */ }
      i = j;
    }
    tests.push(test);
  }
  return tests;
}

/**
 * One failure message as a classified failure, with the words of the Playwright runner: `app` names the state that is wrong
 * (`summary` is the first line of the message), `other` keeps the message.
 *
 * @param {string} message The message an assertion of the proof threw.
 * @returns {{ kind: 'app'|'convention'|'other', title: string, message: string, summary?: string, expected?: string, reached?: string }} The classified failure.
 *
 * @example
 * classifyProofFailure('The page given no rows: the empty state is wrong, the screen shows blank.\nExpected: "empty"\nReceived: "blank"').kind; // => 'app'
 */
export function classifyProofFailure(message) {
  const failure = classifyFailure(message, { specText: '', origin: '' });
  if (failure.kind === 'app') return { ...failure, summary: failure.message.split('\n')[0], page: null };
  return failure;
}

/** A bundling error as a classified failure: a file or export the proof binds to is gone (convention), anything else is `other`. */
function classifyBuildError(text) {
  const missing = /Could not resolve "([^"]+)"|No matching export in "([^"]+)" for import "([^"]+)"/.exec(text);
  if (!missing) return { kind: 'other', title: 'The proof could not finish', message: text, step: null };
  const selector = missing[1] ?? `${missing[3]} in ${missing[2]}`;
  return {
    kind: 'convention',
    title: 'Harness problem, not a product bug',
    message: `The proof expected ${selector}, and it is not there. ${text}`,
    selector,
    event: null,
    why: 'The proof binds to the files the shape writes (page, controller, service, types).',
    step: null,
    page: null,
    fix: 'Put the file or export back (or regenerate the screen with `construct create layer ... --shape list|detail|form|dashboard|wizard`, then `construct create proof`). Do not file a product bug for this.',
  };
}

function findEsbuild(root) {
  try {
    const require = createRequire(path.join(root, 'package.json'));
    const resolveDir = (id) => { try { return path.dirname(require.resolve(`${id}/package.json`)); } catch { return null; } };
    return { esbuild: require('esbuild'), react: resolveDir('react') };
  } catch {
    return null;
  }
}

/** `node --test` on one bundle, in a clean environment, with a time limit. -> { code, output, timedOut } */
function runNode(file, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const env = {};
    for (const key of SAFE_ENV) if (process.env[key] !== undefined) env[key] = process.env[key];
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', file], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    const take = (d) => { if (output.length < 400_000) output += d; };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.once('error', (e) => { clearTimeout(timer); resolve({ code: null, output: String(e.message || e), timedOut }); });
    child.once('close', (code) => { clearTimeout(timer); resolve({ code, output, timedOut }); });
  });
}

/**
 * Run the render proofs of a feature and classify every result. Read-only: the proof is bundled into a throwaway directory
 * under the system temp directory (removed afterwards), nothing is written in the project. Resolves (never rejects) to
 * `{ ok: true, feature, durationMs, counts, tests, files, chain, summary }` (`summary` is the fixed-size `proofSummary`) or `{ ok: false, error: { code, message } }` for a run
 * that could not start: `NO_FEATURE`, `NO_PROOF` (nothing generated yet), `RUNNER_MISSING` (no esbuild in the project),
 * `DEPENDENCY_MISSING` (a package the proof imports is not installed) or `TIMEOUT`. `chain` is `proofStatus` of this run.
 *
 * @param {string} root Project root.
 * @param {string} feature The feature whose proofs run.
 * @param {{ name?: string, tmp?: string, timeoutMs?: number }} [opts] `name` runs only that proof file; `tmp` and `timeoutMs` are test seams.
 * @returns {Promise<object>} The classified result, or the reason the run could not start.
 *
 * @example
 * const run = await runProofs(root, 'products');
 * run.ok && run.counts.failed === 0; // => true when the screen is proven
 */
export async function runProofs(root, feature, opts = {}) {
  const { name, tmp = os.tmpdir(), timeoutMs = RUN_TIMEOUT_MS } = opts;
  let at;
  try { at = projectPaths(root, feature); } catch (e) { return fail('NO_FEATURE', String(e.message || e)); }
  let names = [];
  try { names = fs.readdirSync(at.genDir); } catch { /* no generated directory yet */ }
  const files = names.filter((n) => PROOF_RE.test(n) && (name === undefined || n === name)).sort()
    .filter((n) => { try { return fs.readFileSync(path.join(at.genDir, n), 'utf8').startsWith(`${GENERATED_MARKER}\n`); } catch { return false; } });
  if (!files.length) return fail('NO_PROOF', name ? `Feature "${feature}" has no proof named ${name}.` : `Feature "${feature}" has no proof yet. Generate it: construct create proof <Name> --feature ${feature}`);
  const tools = findEsbuild(root);
  if (!tools) return fail('RUNNER_MISSING', 'The proof is bundled with esbuild, which this project does not have. Install it once with: npm install -D tsx (it brings esbuild; vite brings it too). Then run this again, or run the file on its own with: npx tsx --test <file>.');

  const started = Date.now();
  const dir = fs.mkdtempSync(path.join(tmp, 'construct-proof-'));
  const tests = [];
  try {
    for (const file of files) {
      const abs = path.join(at.genDir, file);
      const out = path.join(dir, file.replace(/\.ts$/, '.cjs'));
      try {
        await tools.esbuild.build({ entryPoints: [abs], outfile: out, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', absWorkingDir: root, logLevel: 'silent', ...(tools.react ? { alias: { react: tools.react } } : {}) });
      } catch (e) {
        const text = clean((e.errors ?? []).map((x) => x.text).join('\n') || e.message);
        const bare = /Could not resolve "([^".][^"]*)"/.exec(text);
        if (bare) return fail('DEPENDENCY_MISSING', `The proof imports "${bare[1]}", which is not installed in this project. Run npm install, then run this again.`);
        tests.push({ file, area: 'generated', title: file.replace(/\.proof\.test\.ts$/, ' proof'), status: 'failed', durationMs: 0, failure: classifyBuildError(text) });
        continue;
      }
      const run = await runNode(out, dir, timeoutMs);
      if (run.timedOut) return fail('TIMEOUT', `The proof took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped.`);
      const read = readTap(run.output);
      if (!read.length) return fail('RUN_FAILED', `The proof ran but reported no test (exit ${run.code}). ${clean(run.output).trim().slice(0, 800)}`);
      for (const t of read) {
        tests.push({ file, area: 'generated', title: t.title, status: t.ok ? 'passed' : 'failed', durationMs: t.durationMs, ...(t.ok ? {} : { failure: classifyProofFailure(t.error || 'The test failed without a message.') }) });
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const counts = { total: tests.length, passed: tests.filter((t) => t.status === 'passed').length, failed: tests.filter((t) => t.status === 'failed').length, notRun: 0 };
  const chain = proofStatus([{ id: 'proof', result: { ok: true, counts } }]);
  const result = { ok: true, feature, durationMs: Date.now() - started, counts, tests, files: files.map((f) => `${at.genRel}/${f}`), chain };
  return { ...result, summary: proofSummary(result) };
}

/**
 * A finished proof run as text for a terminal (`construct test proof`): one line of counts, one line per test, each failure in the
 * words of its kind, and whether the chain of the screen is complete.
 *
 * @param {object} result A `runProofs` result.
 * @returns {string} The summary.
 *
 * @example
 * console.log(renderProofRunText(await runProofs(root, 'products')));
 */
export function renderProofRunText(result) {
  if (!result.ok) return result.error.message;
  const c = result.counts;
  const lines = [`Feature "${result.feature}": proof of the screen, ${c.passed} passed, ${c.failed} failed (${(result.durationMs / 1000).toFixed(1)} s, no browser)`];
  for (const t of result.tests) {
    lines.push(`  ${t.status === 'passed' ? 'PASS' : 'FAIL'}   ${t.title}`);
    const f = t.failure;
    if (!f) continue;
    if (f.kind === 'convention') {
      lines.push('          HARNESS PROBLEM, NOT A PRODUCT BUG');
      lines.push(`          ${f.message.split('\n')[0]}`);
      lines.push(`          Fix: ${f.fix}`);
    } else if (f.kind === 'app') {
      lines.push(`          APP BEHAVED DIFFERENTLY: ${f.summary}`);
    } else {
      lines.push(`          COULD NOT FINISH: ${f.message.split('\n')[0]}`);
    }
  }
  lines.push(result.chain.complete ? 'Chain: complete, the screen is proven.' : 'Chain: NOT complete, the proof is not green.');
  return lines.join('\n');
}
