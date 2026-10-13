// #932 the builder's context budget: what the model is sent each turn, compacted deterministically (no model call) so
// the request fits num_ctx instead of Ollama silently cutting the oldest content (the rules and the spec).
// Evidence: lending-qwen-7b-r1 turn 16 sent ~19k tokens into a 16k window; the same refused setCode and its 4.9k-char
// TYPE_ERROR refusal were in it 7 times, the 4.9k-char plan_status answer 4 times.
//
//   estimateTokens(messages, tools?)   chars / 3.4 (calibrated on that run: 3.36-3.85 chars per prompt_eval token)
//   compactHistory(history, o)         the history (everything after the system prompt and the first message) as sent:
//     1. identical failed calls (same tool, same args, same refusal code) collapse to the last attempt and its error,
//        marked "(repeated N times)"; the earlier copies go
//     2. plan_status answers list only the steps not done; the done ones become a count
//     3. tool answers older than the last `keepRecent` exchanges and longer than `bigChars` become their first
//        sentence line; the latest plan_status answer stays whole (it carries the current feature's points)
//     4. still over `budget` tokens: the oldest exchanges go, whole, until it fits
//   The system prompt and the first message (the spec overview and the seed card) are never in `history`, so never cut.
//   Returns {messages, before, after, dropped, collapsed, summarised}; the caller logs before/after per turn.

/** Characters per token for the estimate (lending-qwen-7b-r1 turns 1-13: 3.36-3.85; the low end, so it over-counts). */
export const CHARS_PER_TOKEN = 3.4;

const textOf = (m) => String(m?.content ?? '') + (m?.tool_calls ? JSON.stringify(m.tool_calls) : '');
/**
 * A deterministic token estimate for a request: every message's content and tool calls, plus the tool schemas.
 * @param {any[]} messages @param {any[]} [tools]
 * @returns {number}
 */
export function estimateTokens(messages, tools = []) {
  const chars = messages.reduce((n, m) => n + textOf(m).length, 0) + (tools.length ? JSON.stringify(tools).length : 0);
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const canon = (v) => JSON.stringify(v ?? {}, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

/** The calls an assistant message made: its tool_calls, else the {"name", "arguments"} JSON it wrote as text. */
function callsOf(m) {
  if (Array.isArray(m.tool_calls) && m.tool_calls.length) return m.tool_calls.map((c) => ({ name: c.function?.name, args: typeof c.function?.arguments === 'string' ? parse(c.function.arguments) : c.function?.arguments }));
  const j = parse(String(m.content ?? '').trim());
  return j && typeof j.name === 'string' ? [{ name: j.name, args: j.arguments ?? j.parameters ?? {} }] : [];
}

/**
 * The history as exchanges: an assistant message and the tool (or nudge) messages that answer it.
 * @param {any[]} history
 * @returns {{assistant: any|null, replies: any[]}[]}
 */
export function exchangesOf(history) {
  const out = [];
  for (const m of history) {
    if (m.role === 'assistant' || !out.length) out.push({ assistant: m.role === 'assistant' ? m : null, replies: m.role === 'assistant' ? [] : [m] });
    else out[out.length - 1].replies.push(m);
  }
  return out;
}

/** The key of a failed one-call exchange (tool, canonical args, refusal code), or null when it is not one. */
function failKey(x) {
  if (!x.assistant) return null;
  const calls = callsOf(x.assistant);
  if (calls.length !== 1 || x.replies.length !== 1) return null;
  const r = parse(x.replies[0].content);
  if (!r || r.ok !== false) return null;
  return `${calls[0].name} ${canon(calls[0].args)} ${r.code ?? ''}`;
}

const isStatus = (x) => Boolean(x.assistant) && callsOf(x.assistant).some((c) => c.name === 'plan_status');

/** A plan_status answer with only the steps not done; the done ones become `doneSteps: N`. Unchanged when not one. */
export function collapseDone(content) {
  const r = parse(content);
  if (!r || !Array.isArray(r.steps)) return content;
  const done = r.steps.filter((s) => s?.state === 'done').length;
  if (!done) return content;
  return JSON.stringify({ ...r, steps: r.steps.filter((s) => s?.state !== 'done'), doneSteps: done });
}

/** A tool answer as its first sentence line (ok, code kept), marked as cut. */
export function summarise(content) {
  const r = parse(content);
  const first = String(r?.sentence ?? content).split('\n')[0];
  const line = first.length > 300 ? `${first.slice(0, 297)}...` : first;
  return JSON.stringify({ ...(r && 'ok' in r ? { ok: r.ok } : {}), ...(r?.code ? { code: r.code } : {}), sentence: line, compacted: `${String(content).length} characters cut; call the tool again for the whole answer` });
}

/**
 * The history compacted for one request (see the header). Pure: `history` is not changed.
 * @param {any[]} history Messages after the system prompt and the first message.
 * @param {{fixed?: any[], tools?: any[], budget?: number, keepRecent?: number, bigChars?: number}} [o]
 *   `fixed`: the messages always sent (system prompt, first message), counted in the budget; `budget`: tokens for the
 *   whole request (num_ctx minus room for the answer); `keepRecent`: exchanges kept whole (4); `bigChars`: a tool answer
 *   longer than this is summarised once it is older than that (600).
 * @returns {{messages: any[], before: number, after: number, dropped: number, collapsed: number, summarised: number}}
 */
export function compactHistory(history, { fixed = [], tools = [], budget = Infinity, keepRecent = 4, bigChars = 600 } = {}) {
  const before = estimateTokens([...fixed, ...history], tools);
  let xs = exchangesOf(history).map((x) => ({ assistant: x.assistant, replies: x.replies.map((m) => ({ ...m })) }));
  // 1. identical failed calls: the last attempt stays, marked with the count; the earlier ones go.
  /** @type {Map<string, number>} */
  const times = new Map();
  for (const x of xs) { const k = failKey(x); if (k) times.set(k, (times.get(k) ?? 0) + 1); }
  const lastAt = new Map();
  xs.forEach((x, i) => { const k = failKey(x); if (k) lastAt.set(k, i); });
  let collapsed = 0;
  xs = xs.filter((x, i) => {
    const k = failKey(x);
    if (!k || (times.get(k) ?? 1) < 2) return true;
    if (lastAt.get(k) !== i) { collapsed += 1; return false; }
    const r = parse(x.replies[0].content);
    x.replies[0].content = JSON.stringify({ ...r, repeated: `(repeated ${times.get(k)} times)` });
    return true;
  });
  // 2. plan_status: done steps as a count.
  for (const x of xs) if (isStatus(x)) for (const m of x.replies) if (m.role === 'tool') m.content = collapseDone(m.content);
  // 3. old large answers: their first sentence line; the latest plan_status stays whole.
  const lastStatus = xs.map(isStatus).lastIndexOf(true);
  let summarised = 0;
  xs.forEach((x, i) => {
    if (i >= xs.length - keepRecent || i === lastStatus) return;
    for (const m of x.replies) if (m.role === 'tool' && String(m.content).length > bigChars) { m.content = summarise(m.content); summarised += 1; }
  });
  // 4. over budget: the oldest exchanges go (the last one always stays).
  let dropped = 0;
  const flat = () => xs.flatMap((x) => [...(x.assistant ? [x.assistant] : []), ...x.replies]);
  while (xs.length > 1 && estimateTokens([...fixed, ...flat()], tools) > budget) { xs.shift(); dropped += 1; }
  const messages = flat();
  // A tool answer never leads (its call went with the dropped exchange).
  while (messages.length && messages[0].role === 'tool') messages.shift();
  return { messages, before, after: estimateTokens([...fixed, ...messages], tools), dropped, collapsed, summarised };
}
