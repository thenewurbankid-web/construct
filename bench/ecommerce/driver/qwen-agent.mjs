#!/usr/bin/env node
// The local builder: an agent loop over Ollama /api/chat with tool calling (default qwen2.5-coder:7b). Its tools are
// exactly the arm's CLI commands (plan-cli.mjs for Line, plain-cli.mjs for the control arm), called in-process, so it
// has the same single write path as the Claude builders. Same system prompt (BUILDER-PROMPT*.md, with SPEC.md in it).
//
//   node bench/ecommerce/driver/qwen-agent.mjs --project <dir> [--arm line|plain] [--builder qwen-7b]
//        [--model qwen2.5-coder:7b] [--max-turns 200] [--max-minutes 90] [--num-ctx 16384] [--ollama http://127.0.0.1:11434]
//
// Logs, per turn: tokens in (prompt_eval_count) and out (eval_count), wall time, tool calls and their outcomes, to
// <run>/logs/turns.jsonl and bench/ecommerce/results/<builder>.tokens.jsonl. Stops at the budget, when the model calls
// `finish`, or after 8 turns in a row without a tool call.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlanCli } from './plan-cli.mjs';
import { createPlainCli } from './plain-cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bench = path.join(here, '..');

function flags(argv) {
  const o = { project: process.env.BENCH_PROJECT, arm: 'line', builder: '', model: 'qwen2.5-coder:7b', maxTurns: 200, maxMinutes: 90, numCtx: 16384, ollama: process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434', log: process.env.BENCH_LOG };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i]; const v = argv[i + 1];
    if (k === '--project') { o.project = v; i += 1; } else if (k === '--arm') { o.arm = v; i += 1; } else if (k === '--builder') { o.builder = v; i += 1; }
    else if (k === '--model') { o.model = v; i += 1; } else if (k === '--max-turns') { o.maxTurns = Number(v); i += 1; } else if (k === '--max-minutes') { o.maxMinutes = Number(v); i += 1; }
    else if (k === '--num-ctx') { o.numCtx = Number(v); i += 1; } else if (k === '--ollama') { o.ollama = v; i += 1; } else if (k === '--log') { o.log = v; i += 1; }
  }
  if (!o.builder) o.builder = o.arm === 'plain' ? 'qwen-7b-plain' : 'qwen-7b';
  return o;
}

const fn = (name, description, properties = {}, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const S = (description) => ({ type: 'string', description });

/** The tools per arm: each is one CLI command. */
export const TOOLS = {
  line: [
    fn('plan_tools', 'plan-cli tools: list the Line plan tools you can add, each with its JSON Schema.'),
    fn('plan_status', 'plan-cli status: the plan, each step with its state and sentence.'),
    fn('plan_add', 'plan-cli add: add one plan step, either {tool, args, why} or {fix} to add a typed fix the last refusal offered. Auto approves it when Construct planned it clean; then call plan_run_next to land it.', { tool: S('A Line tool name, e.g. line.setCode (leave out when you send fix)'), args: { type: 'object', description: 'The tool arguments, as its JSON Schema says (leave out when you send fix)' }, why: S('One plain-English sentence: why this step.'), fix: S('The ref of a fix the last refused plan_add offered, e.g. "f1" (its recommended fix); adds that fix\'s step instead of tool and args') }, ['why']),
    fn('plan_run_next', 'plan-cli run-next: run the next ready step; returns whether it landed, its checks, and typed fixes when Construct refused it.'),
    fn('plan_findings', 'plan-cli findings: the library items, the features with their items, and the validate findings with keys.'),
    fn('plan_validate', 'plan-cli validate: construct validate --profile line counts and findings.'),
    fn('read_file', 'plan-cli read: one project file and its contentHash (pass it to line.setCode to replace the file).', { path: S('Project-relative path') }, ['path']),
    fn('list_dir', 'plan-cli ls: the entries of one project folder.', { path: S('Project-relative folder, "." for the root') }, ['path']),
    fn('finish', 'Stop: you believe every acceptance point is done, or you cannot make more progress.', { summary: S('What you built and what is left.') }, ['summary']),
  ],
  plain: [
    fn('list_dir', 'plain-cli ls: the entries of one project folder.', { path: S('Project-relative folder, "." for the root') }, ['path']),
    fn('tree', 'plain-cli tree: every file under a folder.', { path: S('Project-relative folder') }, ['path']),
    fn('read_file', 'plain-cli read: one project file.', { path: S('Project-relative path') }, ['path']),
    fn('write_file', 'plain-cli write: create or replace one file with this content.', { path: S('Project-relative path'), content: S('The whole file') }, ['path', 'content']),
    fn('run_script', 'plain-cli run: npm run build, lint or tsc in the project.', { script: { type: 'string', enum: ['build', 'lint', 'tsc'] } }, ['script']),
    fn('finish', 'Stop: you believe every acceptance point is done, or you cannot make more progress.', { summary: S('What you built and what is left.') }, ['summary']),
  ],
};

/** A tool call -> the CLI call. */
async function callTool(cli, arm, name, a) {
  const args = a && typeof a === 'object' ? a : {};
  if (arm === 'line') {
    if (name === 'plan_tools') return cli.run('tools');
    if (name === 'plan_status') return cli.run('status');
    if (name === 'plan_add') return cli.run('add', [String(args.tool ?? ''), JSON.stringify(typeof args.args === 'string' ? safeParse(args.args) : args.args ?? {})], { why: typeof args.why === 'string' ? args.why : undefined, fix: typeof args.fix === 'string' && args.fix.trim() ? args.fix.trim() : undefined });
    if (name === 'plan_run_next') return cli.run('run-next');
    if (name === 'plan_findings') return cli.run('findings');
    if (name === 'plan_validate') return cli.run('validate');
    if (name === 'read_file') return cli.run('read', [String(args.path ?? '')]);
    if (name === 'list_dir') return cli.run('ls', [String(args.path ?? '.')]);
  } else {
    if (name === 'list_dir') return cli.run('ls', [String(args.path ?? '.')]);
    if (name === 'tree') return cli.run('tree', [String(args.path ?? '.')]);
    if (name === 'read_file') return cli.run('read', [String(args.path ?? '')]);
    if (name === 'write_file') return cli.run('write', [String(args.path ?? '')], { content: typeof args.content === 'string' ? args.content : undefined });
    if (name === 'run_script') return cli.run('run', [String(args.script ?? '')]);
  }
  return { ok: false, code: 'UNKNOWN_TOOL', sentence: `There is no tool ${name}.` };
}
const safeParse = (s) => { try { return JSON.parse(s); } catch { return s; } };

/** Tool calls the model wrote as text instead of a tool call (small models do): {"name": ..., "arguments": ...}. */
export function textToolCalls(content) {
  const out = [];
  const s = String(content ?? '');
  // Balanced top-level {...} spans (strings respected), each parsed as JSON.
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== '{') continue;
    let depth = 0; let str = false; let esc = false; let end = -1;
    for (let j = i; j < s.length; j += 1) {
      const c = s[j];
      if (str) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') str = false; continue; }
      if (c === '"') str = true; else if (c === '{') depth += 1; else if (c === '}') { depth -= 1; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) break;
    const j = safeParse(s.slice(i, end + 1));
    if (j && typeof j === 'object' && typeof j.name === 'string') out.push({ function: { name: j.name, arguments: j.arguments ?? j.parameters ?? {} } });
    i = end;
  }
  return out;
}

/** The system prompt: the arm's BUILDER-PROMPT with SPEC.md in place of {{SPEC}}. */
export function systemPrompt(arm) {
  const prompt = fs.readFileSync(path.join(bench, arm === 'plain' ? 'BUILDER-PROMPT-PLAIN.md' : 'BUILDER-PROMPT.md'), 'utf8');
  return prompt.slice(prompt.indexOf('\n---\n') + 5).replace('{{SPEC}}', fs.readFileSync(path.join(bench, 'SPEC.md'), 'utf8'));
}

const clip = (s, n = 6000) => (s.length > n ? `${s.slice(0, n)}\n…(${s.length - n} more characters cut)` : s);

async function main() {
  const o = flags(process.argv.slice(2));
  if (!o.project) { console.error('Set --project or BENCH_PROJECT.'); process.exit(2); }
  const runDir = path.dirname(path.resolve(o.project));
  const logDir = path.join(runDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(path.join(bench, 'results'), { recursive: true });
  const cli = o.arm === 'plain' ? createPlainCli({ project: o.project, log: o.log ?? path.join(logDir, 'calls.jsonl'), builder: o.builder }) : createPlanCli({ project: o.project, log: o.log ?? path.join(logDir, 'calls.jsonl'), builder: o.builder });
  const turnsFile = path.join(logDir, 'turns.jsonl');
  const tokensFile = path.join(bench, 'results', `${o.builder}.tokens.jsonl`);
  const write = (f, e) => fs.appendFileSync(f, `${JSON.stringify(e)}\n`);
  const system = { role: 'system', content: systemPrompt(o.arm) };
  const first = { role: 'user', content: 'Start building. Use only your tools. Call finish when every acceptance point is done or you cannot make more progress.' };
  /** @type {any[]} */
  let history = [];
  const t0 = Date.now();
  const deadline = t0 + o.maxMinutes * 60_000;
  let idle = 0; let stop = 'max turns'; let turn = 0;
  write(turnsFile, { kind: 'start', at: new Date().toISOString(), builder: o.builder, model: o.model, arm: o.arm, maxTurns: o.maxTurns, maxMinutes: o.maxMinutes, numCtx: o.numCtx });
  for (turn = 1; turn <= o.maxTurns; turn += 1) {
    if (Date.now() > deadline) { stop = 'max wall time'; break; }
    // Keep the context inside num_ctx: the system prompt, the first message and the most recent exchanges.
    if (history.length > 40) history = history.slice(-40);
    while (history.length && history[0].role === 'tool') history.shift();
    const started = Date.now();
    let res;
    try {
      const r = await fetch(`${o.ollama}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: o.model, stream: false, messages: [system, first, ...history], tools: TOOLS[o.arm], options: { num_ctx: o.numCtx, temperature: 0.2 } }),
        signal: AbortSignal.timeout(Math.max(10_000, Math.min(600_000, deadline - Date.now()))),
      });
      res = await r.json();
      if (!r.ok) throw new Error(res?.error ?? `HTTP ${r.status}`);
    } catch (e) {
      write(turnsFile, { kind: 'error', turn, ms: Date.now() - started, error: String(/** @type {Error} */ (e).message ?? e) });
      stop = `model error: ${/** @type {Error} */ (e).message}`;
      break;
    }
    const msg = res.message ?? { role: 'assistant', content: '' };
    let calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    const fromText = !calls.length ? textToolCalls(msg.content) : [];
    if (fromText.length) calls = fromText;
    const tokens = { turn, in: res.prompt_eval_count ?? 0, out: res.eval_count ?? 0, ms: Date.now() - started, evalMs: Math.round((res.eval_duration ?? 0) / 1e6), promptMs: Math.round((res.prompt_eval_duration ?? 0) / 1e6) };
    history.push({ role: 'assistant', content: msg.content ?? '', ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) });
    const outcomes = [];
    let finished = null;
    for (const c of calls) {
      const name = c.function?.name; const args = typeof c.function?.arguments === 'string' ? safeParse(c.function.arguments) : c.function?.arguments;
      if (name === 'finish') { finished = String(args?.summary ?? ''); outcomes.push({ name, ok: true }); break; }
      const out = await callTool(cli, o.arm, name, args);
      outcomes.push({ name, args: clip(JSON.stringify(args ?? {}), 400), ok: out.ok, code: out.code ?? null, sentence: out.sentence });
      history.push({ role: 'tool', content: clip(JSON.stringify(out)) });
    }
    if (!calls.length) { idle += 1; history.push({ role: 'user', content: 'Use one of your tools (or call finish).' }); } else idle = 0;
    write(tokensFile, { builder: o.builder, model: o.model, ...tokens, source: 'ollama prompt_eval_count/eval_count', at: new Date().toISOString() });
    write(turnsFile, { kind: 'turn', ...tokens, textCalls: fromText.length > 0, calls: outcomes, said: clip(msg.content ?? '', 600) });
    console.log(`turn ${turn}: in ${tokens.in} out ${tokens.out} ${tokens.ms} ms; ${outcomes.map((x) => `${x.name}${x.ok ? '' : ` (${x.code})`}`).join(', ') || 'no tool call'}`);
    if (finished !== null) { stop = `finish: ${finished}`; break; }
    if (idle >= 8) { stop = '8 turns without a tool call'; break; }
  }
  write(turnsFile, { kind: 'end', at: new Date().toISOString(), turns: Math.min(turn, o.maxTurns), wallMs: Date.now() - t0, stop });
  console.log(JSON.stringify({ builder: o.builder, turns: Math.min(turn, o.maxTurns), wallMs: Date.now() - t0, stop }));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
