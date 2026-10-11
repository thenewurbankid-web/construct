// The typed contract of @line/construct: a command-line package (bin `construct`, construct.mjs), not a library.
// Its public surface is the command line below plus getVersion(); its commands come from @line/construct-core
// (command-registry, builtin-commands, plugin-commands), which it reaches only through that package's "exports".
// A stand-in lives in ./mock.mjs; its own tests in ./test/.

/** `construct <command> [...args]`: the process exit status (@line/construct-core/diagnostics EXIT_CODES). */
export type ConstructExitCode =
  | 0 // OK, and `--help` with a command
  | 1 // VIOLATIONS: a check found errors
  | 2 // USAGE_ERROR: no command, an unknown command, bad arguments
  | 3; // INTERNAL_ERROR: an unexpected error

/** What one run of the `construct` command takes and gives back. */
export interface ConstructInvocation {
  /** argv after `construct`: a command name (or `--help`/`-h`, `--version`/`-v`) and its arguments. */
  argv: string[];
  /** Where `--dir` is resolved from and installed plugin commands are discovered. */
  cwd: string;
}

export interface ConstructResult {
  exitCode: ConstructExitCode;
  /** What the command printed to stdout (`--version`: the version; `--help`: usage plus the registered commands). */
  stdout: string;
  stderr: string;
}

/** The real CLI version: packages/cli/package.json "version", or the value baked into the built bundle. */
export { getVersion } from './version.mjs';

/** The CLI as a function: what ./mock.mjs stands in for (the real one is the `construct` process). */
export type RunConstruct = (invocation: ConstructInvocation) => Promise<ConstructResult>;
