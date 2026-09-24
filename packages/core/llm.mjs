// The one deliberate exception to "Construct makes no LLM calls" — and even
// here, scoped as tight as possible: this module does nothing but run a
// single prompt through a chosen provider's configured executor and return
// its raw text. It has no opinion about what to ask; import.mjs (per-file
// import fill, whole-route plan analysis) and generators.mjs (per-file
// create/generate fill, #101) decide that, and only call this at all when
// the caller explicitly opts in (`--llm <provider>`).
// Everything else — locating files, scaffolding layers, wiring
// breadcrumbs — stays fully deterministic regardless of this module.
import { spawn, spawnSync } from 'node:child_process';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';

// Defaults for the `ollama` provider below — overridable per call via its
// `options` parameter (see `callLlm`), which is how #100 (per-capability
// settings) wires a real model choice through without this module knowing
// anything about "capabilities". Exported so callers/tests can reference
// the same defaults instead of re-guessing them.
export const DEFAULT_OLLAMA_MODEL = 'qwen2.5-coder:7b';
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

// Ollama's own /api/generate defaults its RUNTIME context window to a small value (historically
// 2048 tokens) regardless of what the model itself supports ("context length" in `ollama show
// <model>`, 32768 for qwen2.5-coder:7b) — the model's ceiling and what a request actually gets
// allocated are two different numbers, and only options.num_ctx (never set anywhere in this
// codebase until now) controls the second one. A prompt with an inlined source file routinely
// exceeds the old undocumented default by a wide margin, so a real fill call was silently
// truncated from the model's point of view — a materially worse input than the identical prompt
// text sent to `claude`, which has no such default-truncation gap. See ollamaContextFor() below.
export const MIN_OLLAMA_CONTEXT = 4096; // never smaller than a short prompt legitimately needs
export const MAX_OLLAMA_CONTEXT = 32768; // qwen2.5-coder:7b's own ceiling; asking for more would just fail or thrash
const OLLAMA_CHARS_PER_TOKEN = 4; // conservative estimate, matches import.mjs's MAX_ANALYSIS_CHARS comment
const OLLAMA_OUTPUT_RESERVE_TOKENS = 1024; // headroom for the model's own reply, on top of the prompt

/**
 * The context window (`options.num_ctx`) Ollama should allocate for `prompt`, so a real prompt
 * (which can be many times the size of a short one, once a whole source file is inlined) is
 * never silently truncated the way it was with no override at all. Rounds up to the next power
 * of two — Ollama's own convention for `num_ctx` — and clamps to
 * [MIN_OLLAMA_CONTEXT, MAX_OLLAMA_CONTEXT].
 *
 * @param {string} prompt The full prompt text this call is about to send.
 * @returns {number} The `num_ctx` value to pass.
 */
export function ollamaContextFor(prompt) {
  const estimatedTokens = Math.ceil(String(prompt ?? '').length / OLLAMA_CHARS_PER_TOKEN) + OLLAMA_OUTPUT_RESERVE_TOKENS;
  const power = Math.ceil(Math.log2(Math.max(estimatedTokens, MIN_OLLAMA_CONTEXT)));
  return Math.min(2 ** power, MAX_OLLAMA_CONTEXT);
}

// #413: every model call is bounded. A model that never answers used to hang
// the calling command forever — and, in the Cockpit, every command queued
// behind it (ui/server/src/commandRunner.mjs serialises them). The default is
// generous (a local 7B model on a loaded box legitimately takes minutes), but
// it is finite, and the error it produces names the timeout so a human knows
// what to raise.
export const DEFAULT_LLM_TIMEOUT_SEC = 300;

/** The model-call timeout in milliseconds: `CONSTRUCT_LLM_TIMEOUT_SEC` (a
 * positive number of seconds) or the default. Pass `env` to test the
 * resolution without touching `process.env`. */
export function resolveLlmTimeoutMs(env = process.env) {
  const raw = Number(env.CONSTRUCT_LLM_TIMEOUT_SEC);
  const sec = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LLM_TIMEOUT_SEC;
  return Math.round(sec * 1000);
}

/** A per-call `options.timeoutMs` wins over the environment; anything else falls back to it. */
function timeoutOf(options) {
  const ms = Number(options?.timeoutMs);
  return Number.isFinite(ms) && ms > 0 ? ms : resolveLlmTimeoutMs();
}

const seconds = (ms) => (ms % 1000 === 0 ? String(ms / 1000) : (ms / 1000).toFixed(1));

function timedOut(provider, ms) {
  return new ConstructError(
    `The "${provider}" model did not answer within ${seconds(ms)} seconds and the call was stopped (CONSTRUCT_LLM_TIMEOUT_SEC, default ${DEFAULT_LLM_TIMEOUT_SEC}). The model may be overloaded or stuck; raise the timeout or pick a smaller model.`,
    { exitCode: EXIT_CODES.INTERNAL_ERROR },
  );
}

/** Read Ollama's streamed `/api/generate` body (newline-delimited JSON, one `{response, done}` object
 * per line), calling `onChunk(text)` for each non-empty piece as it arrives, and return the whole
 * concatenated response. A line that is not JSON is a real error, not something to skip. */
async function readOllamaStream(body, onChunk) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  const take = (line) => {
    if (!line.trim()) return;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      throw new ConstructError(`Ollama streamed a non-JSON line (${e.message}): ${line.slice(0, 200)}`, { exitCode: EXIT_CODES.INTERNAL_ERROR });
    }
    if (typeof obj.response === 'string' && obj.response) {
      full += obj.response;
      onChunk(obj.response);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      take(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  take(buffer);
  return full;
}

/**
 * #599 — the `claude` provider as an ASYNC child process that streams. The plain path is a blocking
 * `spawnSync`, which freezes the whole Node server while the model works: no WebSocket frame (a
 * step marker, a streamed thought) can be flushed to the Cockpit until the call ends, which is
 * exactly "nothing shows while the model is working". This path never blocks the event loop, hands
 * each piece of the model's text to `onChunk` as it is generated (`--output-format stream-json
 * --include-partial-messages` emits `text_delta`/`thinking_delta` events), and can be cancelled
 * (`signal` kills the child) or timed out. Used only when a caller passes `onChunk` or `signal`;
 * otherwise the original single synchronous call is unchanged.
 */
function claudeStreaming(prompt, options) {
  const timeout = timeoutOf(options);
  const onChunk = typeof options.onChunk === 'function' ? options.onChunk : null;
  const cancelledError = () => Object.assign(new ConstructError('The model call was cancelled.', { exitCode: EXIT_CODES.INTERNAL_ERROR }), { cancelled: true });
  if (options.signal?.aborted) return Promise.reject(cancelledError());
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompts', 'none'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false;
    let stdoutBuffer = '';
    let stderr = '';
    let streamed = '';
    let finalText = null;
    let resultError = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener?.('abort', onAbort);
      fn(value);
    };
    const onAbort = () => {
      child.kill('SIGKILL');
      finish(reject, cancelledError());
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, timedOut('claude', timeout));
    }, timeout);
    options.signal?.addEventListener?.('abort', onAbort, { once: true });

    const take = (line) => {
      if (!line.trim()) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return; // a non-JSON line on stdout is not a model event; the exit status decides success
      }
      if (msg.type === 'stream_event') {
        const delta = msg.event?.delta;
        const piece = delta?.type === 'text_delta' ? delta.text : delta?.type === 'thinking_delta' ? delta.thinking : '';
        if (piece) {
          if (delta.type === 'text_delta') streamed += piece;
          onChunk?.(piece);
        }
      } else if (msg.type === 'result') {
        if (msg.is_error) resultError = typeof msg.result === 'string' ? msg.result : JSON.stringify(msg);
        else if (typeof msg.result === 'string') finalText = msg.result;
      }
    };

    child.stdout.on('data', (data) => {
      stdoutBuffer += data.toString('utf8');
      let nl;
      while ((nl = stdoutBuffer.indexOf('\n')) >= 0) {
        take(stdoutBuffer.slice(0, nl));
        stdoutBuffer = stdoutBuffer.slice(nl + 1);
      }
    });
    child.stderr.on('data', (data) => { stderr += data.toString('utf8'); });
    child.on('error', (e) => finish(reject, new ConstructError(
      `Could not run the "claude" CLI (${e.message}). Is it installed and on your PATH?`,
      { exitCode: EXIT_CODES.INTERNAL_ERROR },
    )));
    child.on('close', (code) => {
      take(stdoutBuffer);
      if (resultError !== null || code !== 0) {
        finish(reject, new ConstructError(
          `"claude -p" exited with status ${code}: ${(resultError ?? (stderr || streamed)).slice(0, 500)}`,
          { exitCode: EXIT_CODES.INTERNAL_ERROR },
        ));
        return;
      }
      finish(resolve, finalText ?? streamed);
    });
    child.stdin.on('error', () => {}); // the child may exit before reading everything; close/exit reports why
    child.stdin.end(prompt);
  });
}

// Exported (not a private const) so tests can monkey-patch a provider with a
// fake implementation instead of actually shelling out to a real CLI/HTTP
// server. Every provider's shape is `(prompt, options?) -> string | Promise<string>`
// — `callLlm` always awaits the result, so a provider may be sync (like
// `claude`) or async (like `ollama`) freely. `options` is provider-specific;
// every provider honours `{ timeoutMs }` (#413); `ollama` also reads
// `{ model, baseUrl }` from it.
export const PROVIDERS = {
  // `-p`/`--print` (headless, one-shot), text in via stdin (so there's no
  // shell-quoting/argv-length limit on a large prompt), text out via stdout.
  // `--permission-prompts none` denies any tool-use attempt automatically
  // instead of hanging a non-interactive call — the prompt only ever asks
  // for a text completion, so nothing should try to use a tool anyway, but
  // this keeps a stuck permission prompt from being possible at all.
  // `timeout` + `killSignal: 'SIGKILL'` (#413): a CLI that never returns is
  // killed outright (SIGTERM could be caught and ignored by a stuck child),
  // and spawnSync reports it as `error.code === 'ETIMEDOUT'`.
  claude(prompt, options = {}) {
    // #599 -- with onChunk or a cancel signal the call is async and streams (claudeStreaming above);
    // the blocking spawnSync below is only the plain, callback-free path.
    if (options.onChunk || options.signal) return claudeStreaming(prompt, options);
    const timeout = timeoutOf(options);
    const res = spawnSync('claude', ['-p', '--output-format', 'text', '--permission-prompts', 'none'], {
      input: prompt,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout,
      killSignal: 'SIGKILL',
    });
    if (/** @type {any} */ (res.error)?.code === 'ETIMEDOUT') throw timedOut('claude', timeout);
    if (res.error) {
      throw new ConstructError(
        `Could not run the "claude" CLI (${res.error.message}). Is it installed and on your PATH?`,
        { exitCode: EXIT_CODES.INTERNAL_ERROR },
      );
    }
    if (res.status !== 0) {
      throw new ConstructError(
        `"claude -p" exited with status ${res.status}: ${(res.stderr || res.stdout || '').slice(0, 500)}`,
        { exitCode: EXIT_CODES.INTERNAL_ERROR },
      );
    }
    return res.stdout;
  },

  // Ollama's local HTTP API — deliberately NOT a CLI shell-out (unlike
  // `claude` above, which pipes through the real `claude` binary): Ollama
  // exposes a plain local HTTP server (`ollama serve`, on by default once
  // Ollama is installed/running), so this hits it directly via `fetch`,
  // non-streaming (`stream: false`) so the whole completion comes back as
  // one JSON object — matching every other provider's "one string in, one
  // string out" shape, no caller-visible difference from `claude`.
  //
  // `options` (this provider's second parameter, alongside `prompt`) is
  // `{ model?: string, baseUrl?: string }` — the target model is NOT
  // hardcoded. This is the one place #100 (per-capability LLM routing)
  // plugs in a real per-capability model choice; until that lands, or for
  // any caller that doesn't care, both fields default (see
  // DEFAULT_OLLAMA_MODEL / DEFAULT_OLLAMA_BASE_URL above) so
  // `PROVIDERS.ollama(prompt)` alone still works.
  //
  // Error rigor mirrors `claude`'s: a network failure (Ollama not running),
  // a timeout (#413), a non-2xx HTTP status, a non-JSON body, and a JSON
  // body missing the expected `response` field are each their own clear
  // ConstructError rather than a generic throw. `fetch`/HTTP has no direct
  // equivalent to spawnSync's `maxBuffer` (Node buffers the response body
  // itself, not this code), so there's nothing to configure there — the
  // failure modes that `maxBuffer` guards against for a subprocess pipe
  // don't apply to a single HTTP response the same way.
  //
  // One AbortSignal covers the whole exchange: connecting, waiting for the
  // (non-streamed, so possibly minutes-long) generation, and reading the
  // body. An AbortController with an ordinary (referenced) timer rather than
  // `AbortSignal.timeout`: that one is unref'd, so with nothing else keeping
  // the event loop alive it would never fire — a real socket does keep the
  // loop alive, but the timer must not depend on that.
  async ollama(prompt, options = {}) {
    const model = options.model || DEFAULT_OLLAMA_MODEL;
    const baseUrl = options.baseUrl || DEFAULT_OLLAMA_BASE_URL;
    const timeout = timeoutOf(options);
    // num_ctx: sized from the real prompt (see ollamaContextFor's own comment for why this
    // matters) unless the caller overrides it. If even MAX_OLLAMA_CONTEXT can't fit the whole
    // prompt, truncation is still unavoidable locally — warn instead of repeating the silent
    // version of this same mistake at a different number.
    const numCtx = options.numCtx || ollamaContextFor(prompt);
    const estimatedPromptTokens = Math.ceil(String(prompt ?? '').length / OLLAMA_CHARS_PER_TOKEN);
    if (estimatedPromptTokens > numCtx - OLLAMA_OUTPUT_RESERVE_TOKENS) {
      console.warn(
        `ollama: this prompt (~${estimatedPromptTokens} tokens) may not fully fit even at num_ctx=${numCtx} (${model}'s effective ceiling) — the model may still not see all of it.`,
      );
    }
    const controller = new AbortController();
    let expired = false;
    // #599 -- an external cancel (options.signal, e.g. the Cockpit's Cancel button) aborts this same
    // controller, but is reported as a cancel (error.cancelled), never as a timeout or a generic
    // failure: a person pressing Cancel is not an error to retry or to blame on the model.
    let cancelled = false;
    const onAbort = () => { cancelled = true; controller.abort(); };
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }
    const cancelledError = () => Object.assign(new ConstructError('The model call was cancelled.', { exitCode: EXIT_CODES.INTERNAL_ERROR }), { cancelled: true });
    if (cancelled) throw cancelledError(); // already aborted: never even make the request
    const timer = setTimeout(() => { expired = true; controller.abort(); }, timeout);
    const isTimeout = (e) => !cancelled && (expired || e?.name === 'TimeoutError' || e?.name === 'AbortError');
    // #599 -- with an onChunk callback the call streams (stream:true, one JSON object per line) and
    // hands each piece of the model's own output to the callback as it is generated; without one,
    // behaviour is exactly the single non-streamed request it always was.
    const onChunk = typeof options.onChunk === 'function' ? options.onChunk : null;

    let bodyText;
    let streamed = null;
    let res;
    try {
      try {
        res = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model, prompt, stream: Boolean(onChunk), options: { num_ctx: numCtx } }),
          signal: controller.signal,
        });
      } catch (e) {
        if (cancelled) throw cancelledError();
        if (isTimeout(e)) throw timedOut('ollama', timeout);
        throw new ConstructError(
          `Could not reach Ollama at ${baseUrl} (${e.message}). Is "ollama serve" running, and is the model ("${model}") pulled?`,
          { exitCode: EXIT_CODES.INTERNAL_ERROR },
        );
      }

      try {
        if (onChunk && res.ok && res.body) streamed = await readOllamaStream(res.body, onChunk);
        else bodyText = await res.text();
      } catch (e) {
        if (cancelled) throw cancelledError();
        if (isTimeout(e)) throw timedOut('ollama', timeout);
        if (e instanceof ConstructError) throw e;
        throw new ConstructError(
          `Ollama (${baseUrl}) closed the connection before the response was complete (${e.message}).`,
          { exitCode: EXIT_CODES.INTERNAL_ERROR },
        );
      }
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener?.('abort', onAbort);
    }
    if (!res.ok) {
      throw new ConstructError(
        `Ollama (${baseUrl}) responded ${res.status}: ${bodyText.slice(0, 500)}`,
        { exitCode: EXIT_CODES.INTERNAL_ERROR },
      );
    }
    if (streamed !== null) return streamed;

    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch (e) {
      throw new ConstructError(
        `Ollama returned a non-JSON response (${e.message}): ${bodyText.slice(0, 500)}`,
        { exitCode: EXIT_CODES.INTERNAL_ERROR },
      );
    }
    if (typeof parsed.response !== 'string') {
      throw new ConstructError(
        `Ollama's response had no "response" string field: ${bodyText.slice(0, 500)}`,
        { exitCode: EXIT_CODES.INTERNAL_ERROR },
      );
    }
    return parsed.response;
  },
};

// Async so every provider (sync like `claude`, async like `ollama`) is
// called the same way by every caller — `await callLlm(...)` always works
// regardless of which provider is selected. `options` is passed through
// untouched; only `ollama` currently reads it.
export async function callLlm(provider, prompt, options) {
  const impl = PROVIDERS[provider];
  if (!impl) {
    throw new ConstructError(
      `Unknown --llm provider "${provider}". Supported: ${Object.keys(PROVIDERS).join(', ')}`,
      { exitCode: EXIT_CODES.USAGE_ERROR },
    );
  }
  return impl(prompt, options);
}

/** Best-effort cleanup for a model response that ignored "no code fences" —
 * strips one leading/trailing ```-fenced block if the whole response is
 * wrapped in exactly one, otherwise returns the response untouched. */
export function stripCodeFence(text) {
  const trimmed = text.trim();
  const m = trimmed.match(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n```$/);
  return m ? m[1] : trimmed;
}
