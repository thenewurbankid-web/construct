// The command line of construct-mcp (#649): `--root <dir>`, `--rate-limit <n>`, `--max-output <bytes>`, `--help`, `--version`.
// Startup configuration only; a tool call never changes any of it.
import { DEFAULT_RATE_PER_MINUTE, MAX_RATE_PER_MINUTE, LIMITS } from './limits.mjs';

/** The text `construct-mcp --help` prints. */
export const USAGE = `construct-mcp: Construct's blocks as read-only, plan-only MCP tools over stdio.

Usage: construct-mcp [--root <dir>] [--rate-limit <calls per minute>] [--max-output <bytes>]

  --root <dir>         the project every tool reads (default: the working directory). Fixed for the life of the server;
                       no tool takes a path.
  --rate-limit <n>     calls per minute, a token bucket (default ${DEFAULT_RATE_PER_MINUTE}, at most ${MAX_RATE_PER_MINUTE})
  --max-output <bytes> a lower per-call output cap than the default ${LIMITS.outputBytes} bytes
  --help, --version

Set CONSTRUCT_DECISION_PLUGINS=on to let the decide tool load a decision plugin the project's architecture.yml names.
Claude Code:  claude mcp add construct -- node <path>/packages/mcp/bin/construct-mcp.mjs --root <project>`;

/**
 * Read the arguments of `construct-mcp`. Never throws: a bad value comes back as `error`.
 *
 * @param {string[]} argv The arguments after the script name.
 * @returns {{ root?: string, ratePerMinute?: number, maxOutputBytes?: number, help?: boolean, version?: boolean, error?: string }} What was asked for, or the reason it cannot be.
 *
 * @example
 * parseArgs(['--root', '/work/web', '--rate-limit', '60']); // => { root: '/work/web', ratePerMinute: 60 }
 */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return undefined;
      i += 1;
      return v;
    };
    if (flag === '--help' || flag === '-h') out.help = true;
    else if (flag === '--version' || flag === '-v') out.version = true;
    else if (flag === '--root') {
      const v = value();
      if (!v) return { error: '--root needs a directory.' };
      out.root = v;
    } else if (flag === '--rate-limit' || flag === '--max-output') {
      const v = value();
      const n = Number(v);
      const max = flag === '--rate-limit' ? MAX_RATE_PER_MINUTE : LIMITS.outputBytes;
      if (!v || !/^\d+$/.test(v) || n < 1 || n > max) return { error: `${flag} needs a whole number from 1 to ${max}.` };
      out[flag === '--rate-limit' ? 'ratePerMinute' : 'maxOutputBytes'] = n;
    } else return { error: `Unknown argument "${flag}".` };
  }
  return out;
}
