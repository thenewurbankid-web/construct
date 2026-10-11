// A stand-in for @line/construct (LINE-MODULE (b)): the `construct` command as a function (contract.d.ts
// `RunConstruct`), answering from a table instead of spawning the CLI. A caller that shells out to `construct`
// (Cockpit's server, scripts) can be tested without the engine; test/cli.test.mjs checks the mock answers
// `--version` and `--help` the way the real command does.

/** The mock's version string. @returns {string} Always "0.0.0-mock". */
export function getVersion() {
  return '0.0.0-mock';
}

/**
 * @typedef {{ argv: string[], cwd: string }} ConstructInvocation
 * @typedef {{ exitCode: 0 | 1 | 2 | 3, stdout: string, stderr: string }} ConstructResult
 */

/**
 * A fake `construct`: `--version`/`-v` prints the version (exit 0), `--help`/`-h` prints usage (exit 0), no command
 * prints usage (exit 2, as the real one does), a command named in `answers` returns that answer, any other command
 * is unknown (exit 2). Every invocation is recorded in `calls`.
 * @param {{ answers?: Record<string, Partial<ConstructResult>> }} [opts] Canned results per command name.
 * @returns {((inv: ConstructInvocation) => Promise<ConstructResult>) & { calls: ConstructInvocation[] }} The fake.
 */
export function createConstructMock({ answers = {} } = {}) {
  /** @type {ConstructInvocation[]} */
  const calls = [];
  const usage = 'Construct (mock)\n\nRegistered commands (built-in + installed packages):\n' + Object.keys(answers).map((c) => `  construct ${c}`).join('\n');
  /** @type {(inv: ConstructInvocation) => Promise<ConstructResult>} */
  const run = async (inv) => {
    calls.push(inv);
    const [cmd] = inv.argv;
    if (cmd === '--version' || cmd === '-v') return { exitCode: 0, stdout: `${getVersion()}\n`, stderr: '' };
    if (cmd === '--help' || cmd === '-h') return { exitCode: 0, stdout: `${usage}\n`, stderr: '' };
    if (!cmd) return { exitCode: 2, stdout: `${usage}\n`, stderr: '' };
    const a = answers[cmd];
    if (!a) return { exitCode: 2, stdout: `${usage}\n`, stderr: '' };
    return { exitCode: a.exitCode ?? 0, stdout: a.stdout ?? '', stderr: a.stderr ?? '' };
  };
  return Object.assign(run, { calls });
}
