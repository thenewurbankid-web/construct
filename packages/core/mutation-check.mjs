// `construct mutation-check` (#750, part of epic #461's "Change check"): an on-demand test-strength
// signal for the files a session actually touched, wrapping Stryker (Apache-2.0) instead of hand-building
// a mutation engine. Unlike check-change.mjs (behaviour-preserving verdict, cheap enough to run on every
// keystroke), this is deliberately never triggered by that live path -- mutation testing re-runs the test
// command once per surviving mutant, so it stays a button/CLI call the developer chooses to make.
import path from 'node:path';
import { defineBlock, emptyScope } from './block-contract.mjs';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';

/**
 * Reduces Stryker's raw per-mutant results to the fixed-size document this block reports: a mutation
 * score and the surviving mutants (the ones a scoped test command didn't catch). `NoCoverage` and other
 * non-terminal statuses are counted but excluded from the score denominator, matching Stryker's own
 * "valid mutants" convention -- an uncovered mutant isn't a test-strength failure, it's a coverage gap.
 *
 * @param {Array<{status: string, fileName: string, location?: {start?: {line: number}}, mutatorName: string}>} mutantResults
 * @returns {{ mutationScore: number|null, counts: object, survivingMutants: Array<{file: string, line: number|null, mutator: string}> }}
 */
export function summarizeMutantResults(mutantResults) {
  const counts = { killed: 0, survived: 0, timeout: 0, noCoverage: 0, other: 0, total: mutantResults.length };
  const survivingMutants = [];
  for (const m of mutantResults) {
    switch (m.status) {
      case 'Killed':
        counts.killed++;
        break;
      case 'Timeout':
        counts.timeout++;
        break;
      case 'Survived':
        counts.survived++;
        survivingMutants.push({ file: m.fileName, line: m.location?.start?.line ?? null, mutator: m.mutatorName });
        break;
      case 'NoCoverage':
        counts.noCoverage++;
        break;
      default:
        counts.other++;
    }
  }
  const detected = counts.killed + counts.timeout;
  const valid = detected + counts.survived;
  const mutationScore = valid === 0 ? null : Math.round((detected / valid) * 10000) / 100;
  return { mutationScore, counts, survivingMutants };
}

// Lazily imported -- @stryker-mutator/core is a real dependency for the `run` path, but tests inject
// their own `runStryker` so the suite never pays for an actual mutation run.
async function defaultRunStryker(cliOptions) {
  const { Stryker } = await import('@stryker-mutator/core');
  return new Stryker(cliOptions).runMutationTest();
}

/**
 * Runs a Stryker mutation test scoped to `files` only (never the whole project), using the repo's own
 * test command as Stryker's "command" test runner so no project-specific Stryker plugin is needed.
 *
 * @param {string} root Project root (Stryker resolves `mutate` patterns relative to its cwd).
 * @param {string[]} files Root-relative or absolute file paths to mutate.
 * @param {{ testCommand?: string, concurrency?: number, runStryker?: (cliOptions: object) => Promise<Array> }} [options]
 *   `testCommand` defaults to `npm test`; `runStryker` is an injection point for tests.
 * @returns {Promise<{ files: string[], mutationScore: number|null, counts: object, survivingMutants: object[] }>}
 * @throws {ConstructError} USAGE_ERROR when `files` is empty.
 */
export async function mutationCheck(root, files, options = {}) {
  if (!files || files.length === 0) {
    throw new ConstructError('mutation-check requires at least one file', { exitCode: EXIT_CODES.USAGE_ERROR });
  }
  const relFiles = files.map((f) => (path.isAbsolute(f) ? path.relative(root, f) : f).split(path.sep).join('/'));
  const runStryker = options.runStryker || defaultRunStryker;
  const cliOptions = {
    mutate: relFiles,
    testRunner: 'command',
    commandRunner: { command: options.testCommand || 'npm test' },
    reporters: [],
    logLevel: 'error',
    fileLogLevel: 'off',
    allowConsoleColors: false,
    concurrency: options.concurrency || 1,
    cleanTempDir: true,
  };
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const mutantResults = await runStryker(cliOptions);
    return { files: relFiles, ...summarizeMutantResults(mutantResults) };
  } finally {
    process.chdir(previousCwd);
  }
}

/**
 * The block-contract shape for the mutation check, so the Cockpit's on-demand button (depends on the
 * Cockpit strip slice, #751, for placement) and later MCP exposure reuse this instead of re-wiring CLI
 * flag parsing. `writes: false`: Stryker mutates copies in its own sandbox, never the working tree.
 */
export const mutationCheckBlock = defineBlock({
  id: 'mutation-check',
  writes: false,
  declaredScope: () => emptyScope(),
  actions: () => [],
  run: async (scope, args = {}, ctx = {}) => {
    const root = ctx.root;
    if (!root) throw new ConstructError('mutation-check block requires ctx.root', { exitCode: EXIT_CODES.INTERNAL_ERROR });
    const { files, testCommand, runStryker } = args;
    ctx.lastResult = await mutationCheck(root, files, { testCommand, runStryker });
    return { changedFiles: [] };
  },
});

const USAGE = 'Usage: construct mutation-check <file...> [--test-command <cmd>] [--dir <root>]';

/**
 * `construct mutation-check <file...> [--test-command <cmd>] [--dir <root>]`: prints the mutation-check
 * document as JSON. Explicitly on-demand -- there is no flag that wires this into check-change's live path.
 *
 * @param {string[]} args CLI arguments.
 * @param {{ getRoot: (args: string[]) => string }} deps Same root-resolution injection as check-change.
 * @returns {Promise<void>}
 */
export async function mutationCheckCommand(args, { getRoot }) {
  const skip = new Set();
  const ci = args.indexOf('--test-command');
  const testCommand = ci >= 0 ? args[ci + 1] : undefined;
  if (ci >= 0) { skip.add(ci); skip.add(ci + 1); }
  const di = args.indexOf('--dir');
  if (di >= 0) { skip.add(di); skip.add(di + 1); }
  const files = args.filter((_, i) => !skip.has(i));
  if (files.length === 0) throw new ConstructError(USAGE, { exitCode: EXIT_CODES.USAGE_ERROR });
  const root = getRoot(args);
  const result = await mutationCheck(root, files, { testCommand });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}
