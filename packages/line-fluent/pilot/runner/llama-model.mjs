// A local model through llama.cpp's llama-server, as the library run's model function (same shape as claudeModel):
// request {system, user, prefill, schema?} -> {text, tokensIn, tokensOut, costUsd, model}, text continuing the prefill.
// Faster than going through Ollama for a run: the server decodes several requests at once (its slots), and the long
// instructions every request shares are kept in each slot's cache (cache_prompt), so only the entries are new work.
// Start the server on the same GGUF Ollama stores, e.g.:
//   llama-server -m ~/.ollama/models/blobs/sha256-<qwen2.5-coder:7b> --port 8089 -np 4 -c 32768 -ngl 99 --cache-reuse 256
// A request that carries `schema` is held to it while the model writes (json_schema); the prefill is then left out.
import { qwenPrompt } from '../../student/student.mjs';
import { textAfterPrefill } from './claude-model.mjs';

export const DEFAULT_LLAMA_URL = 'http://127.0.0.1:8089';

/** POST one completion; returns llama-server's text and token counts. */
export async function callLlama(body, { url = DEFAULT_LLAMA_URL, fetch = globalThis.fetch } = {}) {
  const res = await fetch(`${url}/completion`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`llama-server answered ${res.status} at ${url}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return { text: data.content ?? '', tokensIn: data.tokens_evaluated ?? 0, tokensOut: data.tokens_predicted ?? 0 };
}

export function llamaModel({ model, url = DEFAULT_LLAMA_URL, maxTokens = 4096, call = callLlama } = {}) {
  return async (request) => {
    const held = Boolean(request.schema);
    const body = {
      prompt: qwenPrompt(held ? { ...request, prefill: '' } : request),
      n_predict: maxTokens,
      temperature: 0,
      cache_prompt: true,
      ...(held ? { json_schema: request.schema } : {}),
    };
    const out = await call(body, { url });
    return { text: textAfterPrefill(request.prefill, out.text), tokensIn: out.tokensIn, tokensOut: out.tokensOut, costUsd: 0, model };
  };
}
