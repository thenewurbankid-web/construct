#!/usr/bin/env node
// drive-mcp (#941): drive.mjs's commands as a stdio MCP server, so a whole coding harness (Claude Code, OpenCode, ...)
// can drive qwen2.5-coder:1.5b, or write the code itself, through MCP tools only: no shell, no file reads or writes.
// Bench-local on purpose; it moves into packages/mcp only after a measured win. Same server pattern and SDK version
// as packages/mcp (McpServer + registerTool + zod/v4, stdout is the protocol channel only).
//
// Every tool runs the drive.mjs CLI as a child process, so behaviour, the 40-line output and the JSONL log are the
// CLI's own (task_try goes through heavy.sh there). Env: DRIVE_RUN (run id, default "default"), DRIVE_HARNESS
// (logged on every row, default "mcp").
//
//   node bench/isolation/drive-mcp.mjs
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVE = join(HERE, 'drive.mjs');
const LOG_DIR = join(HERE, 'results', 'claude-drive');
const TASK = z.string().regex(/^t\d\d-[\w-]+$/).describe('The task id, for example t03-book-availability.');

export function runDrive(args, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [DRIVE, ...args], { cwd: join(HERE, '../..'), env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, text: (out || err.split('\n').slice(-3).join('\n')).trim() }));
  });
}

// The next free <dir>/<harness>-<task>-<n>.<ext> (what the CLI arms wrote by hand is kept as a file here too).
function saveInput(sub, run, harness, task, ext, text) {
  const dir = join(LOG_DIR, sub, run);
  mkdirSync(dir, { recursive: true });
  const n = readdirSync(dir).filter((f) => f.startsWith(`${harness}-${task}-`)).length + 1;
  const path = join(dir, `${harness}-${task}-${n}.${ext}`);
  writeFileSync(path, text);
  return path;
}

export function createDriveMcpServer({ run = process.env.DRIVE_RUN || 'default', harness = process.env.DRIVE_HARNESS || 'mcp', exec = runDrive } = {}) {
  if (!/^[\w.-]+$/.test(run) || !/^\w+$/.test(harness)) throw new Error(`bad run "${run}" or harness "${harness}"`);
  const env = { DRIVE_RUN: run, DRIVE_HARNESS: harness };
  const server = new McpServer({ name: 'isolation-drive', version: '0.1.0' });
  const reply = ({ code, text }) => ({ content: [{ type: 'text', text }], ...(code === 0 ? {} : { isError: true }) });
  const tools = [
    ['task_show', 'The task\'s goal and SPEC excerpt plus the facts the harness knows: the function(s) to write, the exact signature, the header already in the file, and the types in scope. Not the file itself.',
      { task: TASK }, ({ task }) => exec(['show', task], env)],
    ['task_show_code', 'The task\'s goal and SPEC excerpt plus the complete starting file you will rewrite, and the read-only context files as signatures.',
      { task: TASK }, ({ task }) => exec(['show-code', task], env)],
    ['task_try', 'Send your brief (intent only) for ONE function to the small coder model (qwen2.5-coder:1.5b, up to 5 samples); it writes the body, its signature is prefilled. By default the harness adds the function\'s signature, types, spec and a worked example, and your brief is added as the lead\'s note. With raw: true your brief is the WHOLE prompt the coder sees. Describe intent; never write the implementation: a brief with a function body over 2 statements or more than 3 consecutive code lines is rejected (FAIL brief, counts as a try). On a task with several functions, call once per function with fn, and never name the other functions. Returns PASS, OK <fn> (that function done, more left), or FAIL <class> with the first error. Classes: brief, format, fragment, tsc, check, error.',
      { task: TASK, brief: z.string().min(1).max(8000).describe('Your intent for the coder: what the function must do, the spec\'s exact strings, names, signatures, types; at most a 3-line shape example from another domain.'),
        raw: z.boolean().optional().default(false).describe('true: send the brief alone as the whole prompt (same as the CLI\'s --raw). Default false: the brief is a note on the harness\'s own brief.'),
        fn: z.string().regex(/^[A-Za-z_$][\w$]*$/).optional().describe('The one function this brief is for. Required on a task with several functions (task_show lists them, in order).') },
      ({ task, brief, raw, fn }) => exec(['try', task, '--brief', saveInput('briefs', run, harness, task, 'txt', brief), '--run', run, ...(raw ? ['--raw'] : []), ...(fn ? ['--fn', fn] : [])], env)],
    ['task_check', 'Check a complete file you wrote for the task target: tsc plus the task check, no model. Returns PASS, or FAIL <class> with the first error.',
      { task: TASK, content: z.string().min(1).max(60000).describe('The complete new contents of the task\'s target file.') },
      ({ task, content }) => exec(['check', task, '--file', saveInput('written', run, harness, task, 'txt', content), '--run', run], env)],
  ];
  for (const [name, description, shape, fn] of tools) {
    server.registerTool(name, { title: name, description, inputSchema: z.object(shape) }, async (args) => reply(await fn(args)));
  }
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { StdioServerTransport } = await import('@modelcontextprotocol/server/stdio');
  await createDriveMcpServer().connect(new StdioServerTransport());
  process.stderr.write('isolation-drive: ready on stdio\n');
}
