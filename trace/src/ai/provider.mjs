// One tiny interface over the model backends: chat({ system, user, schema, maxTokens }) -> { text, usage }.
// Every call is a fresh single turn (no history) at temperature 0, so a small local model can do it.
//   ollama     local Qwen etc. (default http://localhost:11434)
//   openai     any OpenAI-compatible server: LM Studio, llama.cpp, vLLM (default http://localhost:1234)
//   anthropic  Claude via the Messages API (needs ANTHROPIC_API_KEY)
//   jev        open-jev, a small "system one" decision model (single choice only; random weights unless trained)
//   fake       a function, for tests
import { isLoopbackHost } from "./config.mjs";
const est = (s) => Math.ceil(String(s ?? "").length / 4);

// Reasoning models put their thinking in a separate field, or inline in <think>…</think>. Keep it apart from the answer.
export function splitThinking(text, thinking = "") {
  let t = thinking;
  const out = String(text ?? "").replace(/<think>([\s\S]*?)<\/think>/g, (_, x) => { t += (t ? "\n" : "") + x.trim(); return ""; }).trim();
  return { text: out, thinking: t };
}

// API keys go only where they belong: the Anthropic key to api.anthropic.com over https, nowhere else; an
// OpenAI-compatible key to a loopback server or a host the server's own ai.config.json lists under "keyHosts".
// Anything else gets no key (openai) or is refused (anthropic). baseUrl itself only ever comes from server config.
export function anthropicKey(url) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  const u = new URL(url);
  if (u.protocol !== "https:" || u.hostname !== "api.anthropic.com") throw new Error(`refusing to send ANTHROPIC_API_KEY to ${u.host}: it only goes to api.anthropic.com`);
  return key;
}
export function openaiKey(url, keyHosts = []) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const u = new URL(url);
  return isLoopbackHost(u.hostname) || keyHosts.includes(u.host.toLowerCase()) ? key : null;
}

async function post(url, headers, body, ms = 120000) {
  // redirect: "error": a redirect must never carry our headers (an API key) to another host
  const res = await fetch(url, { method: "POST", redirect: "error", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export function makeProvider({ provider, model, baseUrl, fn, keyHosts }) {
  if (provider === "fake") return async (req) => ({ text: await fn(req), usage: { in: est(req.system + req.user), out: 10 } });

  // open-jev (tools/jev/serve.py): answers typed questions in one forward pass, no tokens. It only does single
  // choice, so it can serve `choose` but not `pick-fields` or `draft-body`. Its epistemic confidence gates the
  // answer: below minConfidence it says "no fact settles it" and the question falls through to a person.
  if (provider === "jev") {
    const base = baseUrl || "http://127.0.0.1:8765";
    return async ({ structured }) => {
      if (!structured?.options || structured.multi) throw new Error("jev answers single-choice questions only (use ollama or anthropic for pick-fields and draft-body)");
      const facts = structured.facts.map((f, i) => `${i + 1}. ${f}`);
      const opts = structured.options.map((o, i) => `${i + 1}) ${o}`);
      let j;
      try {
        j = await post(`${base}/choose`, {}, {
          state: { part: structured.part, facts: structured.facts },
          questions: [
            { key: "choice", text: structured.question, options: opts },
            { key: "fact", text: "Which fact settles the question?", options: facts.length > 1 ? facts : [...facts, "none of them"] },
          ],
        }, 30000);
      } catch (err) {
        throw new Error(`${err.message} — is open-jev running? Start it with: npm run jev`);
      }
      const [c, f] = j.answers;
      const pick = (a, list) => Math.max(0, list.indexOf(a.choice)) + 1;
      const conf = c.confidence;
      const minConf = Number(process.env.JEV_MIN_CONFIDENCE ?? 0.5);
      const gated = conf < minConf;
      const thinking = `open-jev (${j.ms} ms forward pass): P(choice)=${JSON.stringify(Object.fromEntries(Object.entries(c.probabilities).map(([k, v]) => [k.split(")")[0], +v.toFixed(3)])))}, epistemic confidence ${conf.toFixed(3)} ${gated ? `< ${minConf} → answers "no fact settles it"` : `≥ ${minConf}`}`;
      return { text: JSON.stringify({ choice: pick(c, opts), fact: gated ? 0 : pick(f, facts) }), thinking, usage: { in: 0, out: 0 }, serverMs: j.ms, confidence: conf };
    };
  }

  if (provider === "ollama") {
    const base = baseUrl || "http://localhost:11434";
    return async ({ system, user, schema, maxTokens = 200 }) => {
      const j = await post(`${base}/api/chat`, {}, {
        model, stream: false, format: schema,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        options: { temperature: 0, seed: 42, num_predict: maxTokens, num_ctx: 2048 },
      });
      const { text, thinking } = splitThinking(j.message?.content ?? "", j.message?.thinking ?? "");
      return { text, thinking, usage: { in: j.prompt_eval_count ?? est(system + user), out: j.eval_count ?? est(text) } };
    };
  }

  if (provider === "openai") {
    const base = baseUrl || "http://localhost:1234";
    return async ({ system, user, maxTokens = 200 }) => {
      const key = openaiKey(base, keyHosts);
      const j = await post(`${base}/v1/chat/completions`, key ? { authorization: `Bearer ${key}` } : {}, {
        model, temperature: 0, seed: 42, max_tokens: maxTokens,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      });
      const m = j.choices?.[0]?.message ?? {};
      const { text, thinking } = splitThinking(m.content ?? "", m.reasoning_content ?? m.reasoning ?? "");
      return { text, thinking, usage: { in: j.usage?.prompt_tokens ?? est(system + user), out: j.usage?.completion_tokens ?? est(text) } };
    };
  }

  if (provider === "anthropic") {
    return async ({ system, user, maxTokens = 200 }) => {
      const url = baseUrl || "https://api.anthropic.com/v1/messages";
      const key = anthropicKey(url);
      const j = await post(url, { "x-api-key": key, "anthropic-version": "2023-06-01" }, {
        model, max_tokens: maxTokens, temperature: 0, system, messages: [{ role: "user", content: user }],
      });
      const text = (j.content ?? []).map((c) => c.text ?? "").join("");
      const thinking = (j.content ?? []).map((c) => c.thinking ?? "").join("");
      return { text, thinking, usage: { in: j.usage?.input_tokens ?? est(system + user), out: j.usage?.output_tokens ?? est(text) } };
    };
  }
  throw new Error(`unknown AI provider "${provider}" (use ollama, openai, anthropic, jev)`);
}

// ---------- streaming chat (the mail composer) ----------
// The one multi-turn, free-text use of a model. It yields { type: "thinking" | "text", delta } as they arrive and a
// final { type: "usage", in, out }. Aborting `signal` closes the connection, which stops the model generating.
async function* lines(res) {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { yield buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1); }
  }
  if (buf.trim()) yield buf;
}

// Splits <think>…</think> out of a text stream, even when a tag is cut between two chunks.
export function thinkSplitter() {
  let inThink = false, buf = "";
  const kind = () => (inThink ? "thinking" : "text");
  const feed = (delta) => {
    buf += delta;
    const out = [];
    for (;;) {
      const tag = inThink ? "</think>" : "<think>";
      const i = buf.indexOf(tag);
      if (i >= 0) { if (i) out.push({ type: kind(), delta: buf.slice(0, i) }); buf = buf.slice(i + tag.length); inThink = !inThink; continue; }
      let keep = 0;
      for (let k = Math.min(tag.length - 1, buf.length); k > 0; k--) if (tag.startsWith(buf.slice(-k))) { keep = k; break; }
      if (buf.length > keep) out.push({ type: kind(), delta: buf.slice(0, buf.length - keep) });
      buf = buf.slice(buf.length - keep);
      return out;
    }
  };
  feed.flush = () => { const out = buf ? [{ type: kind(), delta: buf }] : []; buf = ""; return out; };
  return feed;
}

async function open(url, headers, body, signal) {
  const res = await fetch(url, { method: "POST", redirect: "error", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(300000)].filter(Boolean)) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

export async function* streamChat({ provider, model, baseUrl, fn, keyHosts, system, messages, maxTokens = 900, temperature = 0, signal }) {
  const split = thinkSplitter();
  let usage = { in: est(system + messages.map((m) => m.content).join("")), out: 0 };
  if (provider === "fake") {
    const r = await fn({ system, messages, signal });
    const parts = typeof r === "string" ? r.match(/[\s\S]{1,12}/g) ?? [] : r;
    for await (const p of parts) { if (signal?.aborted) return; for (const e of split(typeof p === "string" ? p : p.delta)) yield e; }
    for (const e of split.flush()) yield e;
    yield { type: "usage", ...usage };
    return;
  }
  if (provider === "ollama") {
    const res = await open(`${baseUrl || "http://localhost:11434"}/api/chat`, {}, {
      model, stream: true, messages: [{ role: "system", content: system }, ...messages],
      options: { temperature, seed: 42, num_predict: maxTokens, num_ctx: 8192 },
    }, signal);
    for await (const line of lines(res)) {
      const j = JSON.parse(line);
      if (j.message?.thinking) yield { type: "thinking", delta: j.message.thinking };
      if (j.message?.content) for (const e of split(j.message.content)) yield e;
      if (j.done) usage = { in: j.prompt_eval_count ?? usage.in, out: j.eval_count ?? usage.out };
    }
  } else if (provider === "openai") {
    const key = openaiKey(baseUrl || "http://localhost:1234", keyHosts);
    const res = await open(`${baseUrl || "http://localhost:1234"}/v1/chat/completions`, key ? { authorization: `Bearer ${key}` } : {}, {
      model, stream: true, stream_options: { include_usage: true }, temperature, max_tokens: maxTokens, messages: [{ role: "system", content: system }, ...messages],
    }, signal);
    for await (const line of lines(res)) {
      if (!line.startsWith("data:") || line.includes("[DONE]")) continue;
      const j = JSON.parse(line.slice(5));
      const d = j.choices?.[0]?.delta ?? {};
      if (d.reasoning_content || d.reasoning) yield { type: "thinking", delta: d.reasoning_content ?? d.reasoning };
      if (d.content) for (const e of split(d.content)) yield e;
      if (j.usage) usage = { in: j.usage.prompt_tokens ?? usage.in, out: j.usage.completion_tokens ?? usage.out };
    }
  } else if (provider === "anthropic") {
    const url = baseUrl || "https://api.anthropic.com/v1/messages";
    const key = anthropicKey(url);
    const res = await open(url, { "x-api-key": key, "anthropic-version": "2023-06-01" }, { model, max_tokens: maxTokens, temperature, stream: true, system, messages }, signal);
    for await (const line of lines(res)) {
      if (!line.startsWith("data:")) continue;
      const j = JSON.parse(line.slice(5));
      if (j.type === "content_block_delta") {
        if (j.delta?.type === "thinking_delta") yield { type: "thinking", delta: j.delta.thinking };
        else if (j.delta?.text) for (const e of split(j.delta.text)) yield e;
      } else if (j.type === "message_start") usage.in = j.message?.usage?.input_tokens ?? usage.in;
      else if (j.type === "message_delta") usage.out = j.usage?.output_tokens ?? usage.out;
    }
  } else throw new Error(`the mail chat needs a text model, and "${provider}" only answers single-choice questions (use ollama, openai or anthropic)`);
  for (const e of split.flush()) yield e;
  yield { type: "usage", ...usage };
}
