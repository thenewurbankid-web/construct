// A stand-in for @line/construct-mcp (LINE-MODULE (b)): the same entry names (contract.d.ts), with a server that
// answers canned tool results instead of running Construct's blocks. A client under test (an agent harness, Cockpit)
// uses it to exercise the MCP flow without a project on disk; test/mock.test.mjs keeps the names in step with the
// real entry and checks the answers have the real result shape.

import { ERROR_CODES } from './src/limits.mjs';

// The limits, error codes and rate bucket are plain values with no dependencies: the mock shares the real ones.
export { LIMITS, ERROR_CODES, ToolError, DEFAULT_RATE_PER_MINUTE, MAX_RATE_PER_MINUTE, createTokenBucket } from './src/limits.mjs';

export const USAGE = 'construct-mcp (mock): Construct\'s blocks as read-only, plan-only MCP tools over stdio.';
/** The mock's one tool. */
export const TOOLS = Object.freeze([{ name: 'construct_mock', title: 'Mock tool', description: 'Answers what the mock was given.' }]);
/** The plan tools: none in the mock. */
export const PLAN_TOOLS = Object.freeze([]);
/** The Train Line tools: none in the mock. */
export const TRAIN_MCP_TOOLS = Object.freeze([]);

/**
 * Arguments are taken as given: `--root <dir>` only.
 * @param {string[]} argv The arguments.
 * @returns {{ root?: string, error?: string }} The root, when given.
 */
export function parseArgs(argv) {
  const i = argv.indexOf('--root');
  return i >= 0 && argv[i + 1] ? { root: argv[i + 1] } : {};
}

/**
 * No containment on a mock root: the folder comes back as given.
 * @param {string} dir A folder.
 * @returns {string} The folder.
 */
export function openRoot(dir) {
  return dir;
}

/**
 * Every mock root counts as contained; never throws.
 * @param {string} _root A folder.
 */
export function assertContained(_root) {}

/**
 * A mock root has no link that leaves it.
 * @param {string} _root A folder.
 * @returns {null} No escaping link.
 */
export function findEscapingLink(_root) {
  return null;
}

/**
 * A scrubber that leaves text as it is (the real one replaces the root's absolute path).
 * @param {string} _root A folder.
 * @returns {(text: string) => string} The identity scrubber.
 */
export function createScrubber(_root) {
  return (text) => text;
}

/**
 * A fake server: `callTool(name, args)` returns `{ content: [{ type: 'text', text }], structuredContent }` with the
 * canned answer for `name` (an unknown tool gives `isError: true`), and records the call.
 * @param {{ answers?: Record<string, unknown> }} [options] Canned structured results per tool name.
 * @returns {{ calls: {name: string, args: object}[], connect: (t: unknown) => Promise<void>, close: () => Promise<void>, callTool: (name: string, args?: object) => Promise<object> }} The fake.
 */
export function createConstructMcpServer({ answers = { construct_mock: { ok: true } } } = {}) {
  const calls = [];
  return {
    calls,
    async connect() {},
    async close() {},
    async callTool(name, args = {}) {
      calls.push({ name, args });
      if (!(name in answers)) return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: ERROR_CODES.INVALID_INPUT, message: `No tool named ${name}.` } }) }] };
      return { content: [{ type: 'text', text: JSON.stringify(answers[name]) }], structuredContent: answers[name] };
    },
  };
}
