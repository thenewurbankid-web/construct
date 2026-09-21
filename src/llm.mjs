// The one deliberate exception to "Construct makes no LLM calls" — and even
// here, scoped as tight as possible: this module does nothing but run a
// single prompt through a chosen provider's configured executor and return
// its raw text. It has no opinion about what to ask; import.mjs (per-file
// import fill, whole-route plan analysis) and generators.mjs (per-file
// create/generate fill, #101) decide that, and only call this at all when
// the caller explicitly opts in (`--llm <provider>`).
// Everything else — locating files, scaffolding layers, wiring
// breadcrumbs — stays fully deterministic regardless of this module.
import { spawnSync } from 'node:child_process';
import { ConstructError, EXIT_CODES } from './diagnostics.mjs';

// Defaults for the `ollama` provider below — overridable per call via its
// `options` parameter (see `callLlm`), which is how #100 (per-capability
// settings) wires a real model choice through without this module knowing
// anything about "capabilities". Exported so callers/tests can reference
// the same defaults instead of re-guessing them.
export const DEFAULT_OLLAMA_MODEL = 'qwen2.5-coder:7b';
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

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
    const timeout = timeoutOf(options);
    const res = spawnSync('claude', ['-p', '--output-format', 'text', '--permission-prompts', 'none'], {
      input: prompt,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout,
      killSignal: 'SIGKILL',
    });
    if (res.error?.code === 'ETIMEDOUT') throw timedOut('claude', timeout);
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
    const controller = new AbortController();
    let expired = false;
    const timer = setTimeout(() => { expired = true; controller.abort(); }, timeout);
    const isTimeout = (e) => expired || e?.name === 'TimeoutError' || e?.name === 'AbortError';

    let bodyText;
    let res;
    try {
      try {
        res = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model, prompt, stream: false }),
          signal: controller.signal,
        });
      } catch (e) {
        if (isTimeout(e)) throw timedOut('ollama', timeout);
        throw new ConstructError(
          `Could not reach Ollama at ${baseUrl} (${e.message}). Is "ollama serve" running, and is the model ("${model}") pulled?`,
          { exitCode: EXIT_CODES.INTERNAL_ERROR },
        );
      }

      try {
        bodyText = await res.text();
      } catch (e) {
        if (isTimeout(e)) throw timedOut('ollama', timeout);
        throw new ConstructError(
          `Ollama (${baseUrl}) closed the connection before the response was complete (${e.message}).`,
          { exitCode: EXIT_CODES.INTERNAL_ERROR },
        );
      }
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new ConstructError(
        `Ollama (${baseUrl}) responded ${res.status}: ${bodyText.slice(0, 500)}`,
        { exitCode: EXIT_CODES.INTERNAL_ERROR },
      );
    }

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
