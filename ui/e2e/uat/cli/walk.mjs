// Shared by the scripted CLI UAT walks (ui/e2e/uat/cli/*.walk.mjs): rows of docs/line/review.md that have no screen,
// walked the way a developer would, through the real `construct` CLI where a command exists and the documented engine
// entry point where none does. Each walk prints a short transcript, checks with plain assertions, works in a fresh temp
// folder and removes it. Run one with `node ui/e2e/uat/cli/<row>.walk.mjs`, all with `node ui/e2e/uat/cli/run-all.mjs`.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
export const CLI = path.join(REPO, 'packages/cli/construct.mjs');

/** Print one transcript line: `$ command`, `> output` or a plain note. */
export const say = (s) => console.log(s);

/**
 * Run a command the way a person types it, from the repo root.
 * @param {string[]} argv e.g. ['node', 'packages/cli/construct.mjs', 'line', 'rules', 'gate']
 * @param {{cwd?: string, env?: Record<string, string>, timeout?: number}} [o]
 */
export function run(argv, o = {}) {
  say(`$ ${argv.map((a, i) => (i === 0 && a === process.execPath ? "node" : a)).map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
  const r = spawnSync(argv[0], argv.slice(1), { cwd: o.cwd ?? REPO, encoding: 'utf8', env: { ...process.env, ...o.env }, timeout: o.timeout ?? 600_000, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** `construct <args>` through the real CLI entry. */
export const construct = (args, o) => run([process.execPath, path.relative(REPO, CLI), ...args], o);

/** Show the first `n` lines of some output, indented. */
export function show(text, n = 8) {
  const lines = text.trim().split('\n').filter(Boolean);
  for (const l of lines.slice(0, n)) say(`  > ${l}`);
  if (lines.length > n) say(`  > ... (${lines.length - n} more lines)`);
}

/** A fresh temp folder that `cleanup()` removes. */
export function tempDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `construct-uat-${tag}-`));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Copy a folder (skipping node_modules) into `to`. */
export function copyDir(from, to) {
  fs.cpSync(from, to, { recursive: true, filter: (src) => !src.split(path.sep).includes('node_modules') });
  return to;
}

/**
 * Run the walk's steps; prints "PASS <row>" or "FAIL <row>: <why>" and sets the exit code.
 * @param {string} row
 * @param {() => Promise<void>|void} body
 * @param {() => void} [cleanup]
 */
export async function walk(row, body, cleanup) {
  say(`== ${row}`);
  try {
    await body();
    say(`PASS ${row}`);
  } catch (e) {
    say(`FAIL ${row}: ${String(/** @type {any} */ (e)?.message ?? e).split('\n')[0]}`);
    process.exitCode = 1;
  } finally {
    cleanup?.();
  }
}
