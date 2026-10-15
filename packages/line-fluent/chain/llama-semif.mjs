// seraph's semif model (@mx/seraph SemifModel: `complete` with first-token log-probabilities) over llama.cpp's
// llama-server, so jev's letter questions (@mx/reason letters.ts: calibratedChoice, pickAmong) run on the same server
// and slots as the library run, without Ollama. `/completion` with n_probs returns the first token's top choices.
import { DEFAULT_LLAMA_URL } from '../pilot/runner/llama-model.mjs';

/** Qwen's chat template for semif's messages (it sends one user message). */
export function chatPrompt(messages) {
  return `${messages.map((m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`).join('')}<|im_start|>assistant\n`;
}

/** A GBNF grammar allowing exactly one of the given strings. */
const oneOfGrammar = (choices) => `root ::= ${choices.map((c) => JSON.stringify(c)).join(' | ')}`;

/**
 * @param {{model?: string, url?: string, fetch?: typeof fetch}} [options]
 * @returns {{model: string, complete: (request: object) => Promise<{text: string, topLogprobs?: {token: string, logprob: number}[]}>}}
 */
export function llamaSemifModel({ model = 'qwen2.5-coder:7b', url = DEFAULT_LLAMA_URL, fetch = globalThis.fetch } = {}) {
  return {
    model,
    async complete({ messages, maxTokens = 1, topLogprobs = 0, oneOf, signal }) {
      const body = {
        prompt: chatPrompt(messages),
        n_predict: maxTokens,
        temperature: 0,
        cache_prompt: true,
        ...(topLogprobs ? { n_probs: topLogprobs } : {}),
        ...(oneOf?.length ? { grammar: oneOfGrammar(oneOf) } : {}),
      };
      const res = await fetch(`${url}/completion`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
      if (!res.ok) throw new Error(`llama-server answered ${res.status} at ${url}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const first = data.completion_probabilities?.[0];
      const top = (first?.top_logprobs ?? first?.probs ?? []).map((t) => ({ token: t.token ?? t.tok_str, logprob: t.logprob ?? Math.log(t.prob ?? 0) }));
      return { text: data.content ?? '', ...(top.length ? { topLogprobs: top } : {}) };
    },
  };
}
