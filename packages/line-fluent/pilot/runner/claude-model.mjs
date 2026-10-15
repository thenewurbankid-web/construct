// Claude model for the pilot runner (T1.4): model(request) -> {text, tokensIn, tokensOut, costUsd} through the
// `claude` CLI, so it runs on the owner's own Claude plan with no API key. Lean by construction: the request's
// system prompt replaces Claude Code's, no tools, no MCP servers, no settings files, no saved session.
// The CLI cannot prefill, so the prompt asks the reply to start with the prefill and textAfterPrefill() cuts the
// reply back to the text after it, which is what runner.mjs parses.
import { spawn } from 'node:child_process';

export const DEFAULT_TIMEOUT_MS = 180_000;

/** The CLI arguments for one request: model, the request's system prompt, JSON output with usage. */
export function claudeArgs({ model, system }) {
  return [
    '-p', '--model', model,
    '--system-prompt', system,
    '--output-format', 'json',
    '--no-session-persistence',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--setting-sources', '',
    '--settings', '{"alwaysThinkingEnabled":false}',
    '--tools', '',
  ];
}

/** The user turn: the request's text, then the instruction a prefill stands for. */
export function claudePrompt({ user, prefill }) {
  return `${user}\n\nReply with the JSON object only, nothing before or after it. Start exactly with: ${prefill}`;
}

/**
 * The reply cut to what follows the prefill. A reply that starts with the prefill is cut as is; one that holds a
 * JSON object with the same entry (different spacing, a code fence) is re-written as prefill + rest, keeping its
 * field order so the C2 order check still sees the model's order. Anything else comes back unchanged and fails to
 * parse, which the runner turns into a schema refusal.
 */
export function textAfterPrefill(prefill, reply) {
  const raw = String(reply ?? '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const json = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  if (json.startsWith(prefill)) return json.slice(prefill.length);
  try {
    const obj = JSON.parse(json);
    const wanted = JSON.parse(`${prefill}x"}`).entry;
    if (obj && typeof obj === 'object' && obj.entry === wanted && typeof obj.decision === 'string') {
      const { entry, decision, ...rest } = obj;
      const more = JSON.stringify(rest).slice(1);
      return `${decision}"${more === '}' ? '}' : `, ${more}`}`;
    }
  } catch {
    // not JSON: returned as is below
  }
  return raw;
}

/** Runs the CLI once: resolves {stdout, stderr, code}; rejects on spawn failure or timeout. */
export function runClaude(args, input, { timeoutMs = DEFAULT_TIMEOUT_MS, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { env: { ...env, MAX_THINKING_TOKENS: '0' } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`claude did not answer within ${Math.round(timeoutMs / 1000)} seconds and was stopped.`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not run the claude CLI (${e.message}). Is it installed and on PATH?`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    child.stdin.end(input);
  });
}

/**
 * The runner's model function for one Claude model ('haiku', 'sonnet', 'opus' or a full id). `run` is injectable
 * for tests. Tokens are the CLI's real counts (input including cache reads and writes); costUsd is the CLI's figure.
 */
export function claudeModel({ model = 'haiku', run = runClaude, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return async (request) => {
    const { stdout, stderr, code } = await run(claudeArgs({ model, system: request.system }), claudePrompt(request), { timeoutMs });
    let out;
    try {
      out = JSON.parse(stdout);
    } catch {
      throw new Error(`claude exited with ${code} and no JSON result: ${String(stderr || stdout).slice(0, 300)}`);
    }
    if (out.is_error) throw new Error(`claude reported an error: ${String(out.result ?? out.subtype).slice(0, 300)}`);
    const u = out.usage ?? {};
    return {
      text: textAfterPrefill(request.prefill, out.result),
      tokensIn: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      tokensOut: u.output_tokens ?? 0,
      costUsd: out.total_cost_usd ?? 0,
      model,
    };
  };
}

/** The CLI arguments for a kept-open process: the same request flags, streaming JSON both ways. */
export function sessionArgs({ model, system }) {
  return [...claudeArgs({ model, system }).map((a) => (a === 'json' ? 'stream-json' : a)), '--input-format', 'stream-json', '--verbose'];
}

/**
 * Like claudeModel, but each process stays open across requests instead of starting per call (about 1s saved per
 * call). Processes are kept per system prompt, one request at a time each, and replaced after `turns` requests so
 * earlier requests do not pile up in the context (a kept-open process remembers its conversation).
 */
export function claudeSession({ model = 'haiku', turns = 4, timeoutMs = DEFAULT_TIMEOUT_MS, spawnFn = spawn } = {}) {
  const idle = new Map(); // system -> open processes waiting for a request
  const open = (system) => {
    const child = spawnFn('claude', sessionArgs({ model, system }), { env: { ...process.env, MAX_THINKING_TOKENS: '0' } });
    const proc = { child, used: 0, waiter: null, buf: '', dead: null };
    child.stdout.on('data', (d) => {
      proc.buf += d;
      for (let i = proc.buf.indexOf('\n'); i >= 0; i = proc.buf.indexOf('\n')) {
        const line = proc.buf.slice(0, i);
        proc.buf = proc.buf.slice(i + 1);
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.type === 'result' && proc.waiter) {
          const w = proc.waiter;
          proc.waiter = null;
          w.resolve(m);
        }
      }
    });
    const end = (why) => {
      proc.dead = why;
      if (proc.waiter) proc.waiter.reject(new Error(why));
      proc.waiter = null;
    };
    child.on('error', (e) => end(`Could not run the claude CLI (${e.message}). Is it installed and on PATH?`));
    child.on('close', (code) => end(`claude exited with ${code} mid-request`));
    return proc;
  };
  const take = (system) => {
    const list = idle.get(system) ?? [];
    let proc = list.pop();
    while (proc?.dead) proc = list.pop();
    return proc ?? open(system);
  };
  const release = (system, proc) => {
    if (proc.dead || proc.used >= turns) {
      if (!proc.dead) proc.child.stdin.end();
      return;
    }
    (idle.get(system) ?? idle.set(system, []).get(system)).push(proc);
  };
  const call = async (request) => {
    const proc = take(request.system);
    const m = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        proc.child.kill('SIGKILL');
        reject(new Error(`claude did not answer within ${Math.round(timeoutMs / 1000)} seconds and was stopped.`));
      }, timeoutMs);
      proc.waiter = { resolve: (x) => (clearTimeout(timer), resolve(x)), reject: (e) => (clearTimeout(timer), reject(e)) };
      proc.used += 1;
      proc.child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: claudePrompt(request) } })}\n`);
    });
    release(request.system, proc);
    if (m.is_error) throw new Error(`claude reported an error: ${String(m.result ?? m.subtype).slice(0, 300)}`);
    const u = m.usage ?? {};
    return {
      text: textAfterPrefill(request.prefill, m.result),
      tokensIn: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      tokensOut: u.output_tokens ?? 0,
      costUsd: m.total_cost_usd ?? 0,
      model,
    };
  };
  call.close = () => {
    for (const list of idle.values()) for (const p of list) if (!p.dead) p.child.stdin.end();
    idle.clear();
  };
  return call;
}
