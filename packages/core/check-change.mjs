// `construct check-change` (#747, first slice of epic #461's "Change check"): a deterministic, LLM-free
// verdict on whether an unsaved/staged edit changed behaviour, shown as an indicator before saving rather
// than only at PR/CI time (owner steer on #461, 2026-09-21). Today this wraps `packages/ast`'s
// `semanticDiff` (AST-level behaviour-preserving check); later slices (fast-check equivalence, scoped
// Stryker, a symbolic spike) add sections to the same JSON document without changing this shape.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { semanticDiff, semanticDiffMapped, normalizeSpecifiers } from '@construct/ast/semantic-diff';
import { pureExportEquivalence } from '@construct/ast/pure-export-equivalence';
import { defineBlock, emptyScope } from './block-contract.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';

/**
 * The git-tracked content of `relPath` at `ref` (default `HEAD`), or `null` when the file doesn't exist at
 * that ref (a new, not-yet-committed file: nothing to compare against, so the caller reports `cant-tell`
 * rather than guessing).
 *
 * @param {string} root Project root (git working directory).
 * @param {string} relPath Root-relative file path.
 * @param {string} [ref] A git ref; `HEAD` is "the last saved commit", not necessarily the index.
 * @returns {string|null} The file's content at `ref`, or `null` if it isn't tracked there.
 */
function readAtRef(root, relPath, ref = 'HEAD') {
  const gitPath = relPath.split(path.sep).join('/');
  const result = spawnSync('git', ['show', `${ref}:${gitPath}`], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout;
}

/**
 * The change-check document for one file: the unsaved/staged working-tree content against its content at
 * `ref`, run through `semanticDiff`. Pure I/O + a pure diff -- no LLM, no network.
 *
 * @param {string} root Project root.
 * @param {string} filePath Root-relative or absolute path to the file to check.
 * @param {{ ref?: string }} [options] `ref` defaults to `HEAD`.
 * @returns {{ file: string, verdict: 'same-behaviour'|'changed'|'cant-tell', operations: string[], reason?: string, propertyCheck?: { checked: object[], skipped: object[] } }}
 * @throws {ConstructError} USAGE_ERROR when the working-tree file doesn't exist.
 *
 * @example
 * checkChangeForFile(root, 'features/cart/domain/total.ts');
 * // => { file: 'features/cart/domain/total.ts', verdict: 'same-behaviour', operations: [] }
 */
export function checkChangeForFile(root, filePath, options = {}) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  const relPath = path.relative(root, abs);
  if (!fs.existsSync(abs)) {
    throw new ConstructError(`No such file: ${relPath}`, { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const afterSource = fs.readFileSync(abs, 'utf8');
  const beforeSource = readAtRef(root, relPath, options.ref);
  if (beforeSource === null) {
    return { file: relPath, verdict: 'cant-tell', operations: [], reason: `not present at ${options.ref || 'HEAD'} (new file)` };
  }
  const { verdict, operations, reason } = semanticDiff(beforeSource, afterSource);
  const document = { file: relPath, verdict, operations };
  if (reason) document.reason = reason;
  // Property check (#749) only adds signal once something actually changed structurally -- same-behaviour
  // (a rename/reorder/reformat) has no logic difference to catch a counter-example for, so it's omitted
  // rather than reported as an always-empty section.
  if (verdict === 'changed') document.propertyCheck = pureExportEquivalence(beforeSource, afterSource);
  return document;
}

/**
 * Whether every pure export the edit touched was proven equivalent by fast-check (and none was skipped).
 * @param {{ checked: { verdict: string }[], skipped: object[] }} pc A `pureExportEquivalence` result.
 * @returns {boolean} `true` only when at least one export was checked, all are equivalent and none was skipped.
 */
const allEquivalent = (pc) => pc.checked.length > 0 && pc.skipped.length === 0 && pc.checked.every((c) => c.verdict === 'equivalent');

/**
 * The change check for a file that MOVED (Line Import v2): its content at the old path (`beforeSource`, else git `ref`)
 * against the working-tree file at the new path, through `semanticDiffMapped` so the imports the move rewrote are read
 * as the same modules (`moves`: old module path -> new module path, every move of the import). When the AST differs,
 * the pure exports decide: if fast-check proves every touched pure export equivalent, it is `same-behaviour`
 * (operation `equivalent`); a counter-example keeps it `changed`, with the example in `propertyCheck`.
 *
 * @param {string} root Project root.
 * @param {string} fromPath Root-relative path before the move.
 * @param {string} toPath Root-relative path after the move.
 * @param {{ ref?: string, beforeSource?: string, moves?: Record<string, string>, aliases?: {prefix: string, dir: string}[] }} [options] `beforeSource` wins over `ref` (default `HEAD`); `aliases` (tsconfig `paths`, project-relative dirs) map `@/x` specifiers like relative ones.
 * @returns {{ file: string, from: string, verdict: 'same-behaviour'|'changed'|'cant-tell', operations: string[], reason?: string, propertyCheck?: { checked: object[], skipped: object[] } }}
 * @throws {ConstructError} USAGE_ERROR when the file at `toPath` does not exist.
 *
 * @example
 * checkChangeForMove(root, 'src/a/total.ts', 'src/a/library/domain/total.ts', { moves: { 'src/a/total': 'src/a/library/domain/total' } });
 * // => { file: 'src/a/library/domain/total.ts', from: 'src/a/total.ts', verdict: 'same-behaviour', operations: [] }
 */
export function checkChangeForMove(root, fromPath, toPath, options = {}) {
  const rel = (p) => (path.isAbsolute(p) ? path.relative(root, p) : p).split(path.sep).join('/');
  const from = rel(fromPath);
  const to = rel(toPath);
  const abs = path.join(root, to);
  if (!fs.existsSync(abs)) throw new ConstructError(`No such file: ${to}`, { exitCode: EXIT_CODES.USAGE_ERROR });
  const afterSource = fs.readFileSync(abs, 'utf8');
  const beforeSource = typeof options.beforeSource === 'string' ? options.beforeSource : readAtRef(root, from, options.ref);
  if (beforeSource === null) return { file: to, from, verdict: 'cant-tell', operations: [], reason: `not present at ${options.ref || 'HEAD'} (new file)` };
  const moves = options.moves ?? {};
  const aliases = options.aliases ?? [];
  const { verdict, operations, reason } = semanticDiffMapped(beforeSource, afterSource, { beforeFile: from, afterFile: to, moves, aliases });
  const document = { file: to, from, verdict, operations };
  if (reason) document.reason = reason;
  if (verdict === 'changed') {
    const propertyCheck = pureExportEquivalence(normalizeSpecifiers(beforeSource, from, moves, aliases), normalizeSpecifiers(afterSource, to, moves, aliases));
    document.propertyCheck = propertyCheck;
    if (allEquivalent(propertyCheck)) { document.verdict = 'same-behaviour'; document.operations = ['equivalent']; }
  }
  return document;
}

/**
 * The block-contract shape (`packages/core/block-contract.mjs`) for the change check, so the Cockpit strip
 * and later MCP exposure reuse the exact same read-only block instead of re-wiring the CLI's flag parsing.
 * `writes: false`: it only reads the working tree and git history.
 */
export const checkChangeBlock = defineBlock({
  id: 'check-change',
  writes: false,
  declaredScope: () => emptyScope(),
  actions: () => [],
  run: async (scope, args = {}, ctx = {}) => {
    const root = ctx.root;
    if (!root) throw new ConstructError('check-change block requires ctx.root', { exitCode: EXIT_CODES.INTERNAL_ERROR });
    const { file, ref } = args;
    if (!file) throw new ConstructError('check-change block requires args.file', { exitCode: EXIT_CODES.USAGE_ERROR });
    ctx.lastResult = checkChangeForFile(root, file, { ref });
    return { changedFiles: [] };
  },
});

/**
 * `construct check-change --file <path> [--ref <ref>] [--dir <root>]`: prints the change-check document as
 * JSON (the only output format -- this is meant to be called by the Cockpit and later the MCP layer, not
 * read as prose). `--ref` defaults to `HEAD` ("since the last save"), not the git index.
 *
 * @param {string[]} args CLI arguments.
 * @param {{ getRoot: (args: string[]) => string }} deps Injected so callers (packages/core/cli.mjs) resolve
 *   the project root the same way every other command does, without this module importing cli.mjs back.
 * @returns {Promise<void>} Resolves after printing; sets a non-zero exit code via ConstructError on failure.
 */
export async function checkChangeCommand(args, { getRoot }) {
  const fi = args.indexOf('--file');
  if (fi < 0 || !args[fi + 1]) {
    throw new ConstructError('Usage: construct check-change --file <path> [--ref <ref>] [--dir <root>]', { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const file = args[fi + 1];
  const ri = args.indexOf('--ref');
  const ref = ri >= 0 ? args[ri + 1] : undefined;
  const root = getRoot(args);
  const document = checkChangeForFile(root, file, { ref });
  console.log(JSON.stringify({ ok: true, ...document }, null, 2));
}
