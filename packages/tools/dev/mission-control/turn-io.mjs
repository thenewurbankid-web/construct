// Mission Control "full input / raw output" view (#913): a bench turn's exact request to Ollama
// (<run>/logs/turn-input/<turn>.json, written by qwen-agent.mjs) with its system prompt put back from
// logs/system-prompt.txt when the turn referenced it by sha256, and the raw response (logs/turn-output/<turn>.json:
// content, thinking, tool calls, parsed calls). The server renders the HTML; turn-io.client.js only adds the toggle.
// One route for server.mjs: /turn-io/api?run=&turn= and /turn-io/view.js (the client script).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/**
 * One turn's input and output files, or null when neither exists (logging off, or an older run).
 * @param {string} runDir
 * @param {number} turn
 */
export function readTurnIo(runDir, turn) {
  if (!Number.isInteger(turn) || turn < 1) return null;
  const logs = path.join(runDir, 'logs');
  const input = readJson(path.join(logs, 'turn-input', `${turn}.json`));
  const output = readJson(path.join(logs, 'turn-output', `${turn}.json`));
  if (!input && !output) return null;
  let systemPrompt = null;
  const ref = input?.messages?.find((m) => m?.role === 'system' && m.sha256 && m.file);
  if (ref) { try { systemPrompt = fs.readFileSync(path.join(logs, path.basename(ref.file)), 'utf8'); } catch { /* missing */ } }
  return { turn, input, output, systemPrompt, systemSha: ref?.sha256 ?? null };
}

const pre = (v) => `<pre>${esc(typeof v === 'string' ? v : JSON.stringify(v, null, 2))}</pre>`;

/** The HTML of the view: every message as sent (role, then its text), the options, then the raw output. */
export function renderTurnIo(v) {
  if (!v) return '<pre>No turn-input/turn-output files for this turn (BENCH_LOG_TURN_IO=0, or an older run).</pre>';
  const parts = [];
  if (v.input) {
    const { messages = [], tools, ...rest } = v.input;
    parts.push(`<h4>Full input: ${messages.length} messages as sent (model ${esc(rest.model)})</h4>`, pre({ ...rest, tools: Array.isArray(tools) ? tools.map((t) => t?.function?.name) : tools }));
    for (const [i, m] of messages.entries()) {
      const sys = m.role === 'system' && m.sha256;
      const body = sys ? (v.systemPrompt ?? `(system prompt ${m.sha256} not found in ${m.file})`) : m.content;
      parts.push(`<h5>#${i} ${esc(m.role)}${sys ? ` · ${esc(m.file)} sha256 ${esc(String(m.sha256).slice(0, 12))}` : ''}</h5>`, pre(body ?? ''));
      if (m.tool_calls) parts.push(pre(m.tool_calls));
    }
  }
  if (v.output) {
    const msg = v.output.response?.message ?? {};
    parts.push('<h4>Raw output</h4>');
    if (msg.thinking) parts.push('<h5>thinking</h5>', pre(msg.thinking));
    parts.push('<h5>content</h5>', pre(msg.content || '(empty)'));
    if (msg.tool_calls) parts.push('<h5>tool_calls (native)</h5>', pre(msg.tool_calls));
    parts.push('<h5>parsed calls</h5>', pre(v.output.parsedCalls ?? []));
    const { message: _m, ...meta } = v.output.response ?? {};
    parts.push('<h5>response fields</h5>', pre(meta));
  }
  return parts.join('');
}

/** /turn-io/view.js (the client) and /turn-io/api?run=&turn= ({html, turn} or 404). */
export function handleTurnIoRoute(u, res, resolveRun) {
  if (u.pathname === '/turn-io/view.js') {
    let b = null;
    try { b = fs.readFileSync(path.join(here, 'turn-io.client.js')); } catch { /* missing */ }
    res.writeHead(b ? 200 : 404, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    res.end(b ?? '');
    return;
  }
  if (u.pathname === '/turn-io/api') {
    const dir = resolveRun(u.searchParams.get('run'));
    const v = dir ? readTurnIo(dir, Number(u.searchParams.get('turn'))) : null;
    res.writeHead(v ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(v ? { turn: v.turn, html: renderTurnIo(v) } : { error: 'no turn input/output files' }));
    return;
  }
  res.writeHead(404); res.end('not found');
}
