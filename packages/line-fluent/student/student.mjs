// Student runner (T3.2, docs/line/FLUENT-PLAN-2026-10-15.md "Wave 2 leaves", t3-2a-student): one C2 answer from
// qwen2.5-coder 1.5b through Ollama's raw /api/generate with the assistant turn prefilled. Three pure-ish steps:
// studentRequest builds the body, callStudent sends it (fetch injected), parseStudent turns prefill + output into
// {answer} or {error}. No other module of this repo had a qwen chat template or prefill helper; the template below
// is qwen2.5's own ChatML layout.

import { readFileSync } from 'node:fs';
import { validateAnswer } from '../contract/validate.mjs';

export const C2_SCHEMA = JSON.parse(readFileSync(new URL('../contract/answer.schema.json', import.meta.url), 'utf8'));
export const DEFAULT_URL = 'http://127.0.0.1:11434/api/generate';

/** qwen2.5 ChatML prompt; the prefill is appended after the assistant tag so the model continues it. */
export function qwenPrompt({ system, user, prefill = '' }) {
  return `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n${prefill}`;
}

/**
 * Ollama /api/generate body for one request {system, user, prefill}.
 * `schema` defaults to C2; pass null to send no `format` (free continuation of the prefill).
 */
export function studentRequest(request, { model = 'qwen2.5-coder:1.5b', maxTokens = 256, schema = C2_SCHEMA } = {}) {
  const body = { model, prompt: qwenPrompt(request), raw: true, stream: false };
  if (schema) body.format = schema;
  body.options = { temperature: 0, num_predict: maxTokens };
  return body;
}

/**
 * Prefill + model output -> {answer} | {error}. The output normally continues the prefill; if it is a whole
 * object on its own (a format grammar forces a leading `{`), it is parsed alone.
 */
export function parseStudent(prefill, responseText) {
  const out = String(responseText ?? '');
  const text = out.trimStart().startsWith('{') ? out : `${prefill ?? ''}${out}`;
  let answer;
  try {
    answer = JSON.parse(text);
  } catch {
    return { error: `The output is not one complete JSON object (it ends with ${JSON.stringify(text.slice(-20))}); finish the object and close every quote and bracket.` };
  }
  const result = validateAnswer(answer);
  if (!result.pass) return { error: result.errors[0] };
  return { answer };
}

/** POST the body; returns Ollama's text plus token counts and wall time (ms, from total_duration in ns). */
export async function callStudent(body, { fetch = globalThis.fetch, url = DEFAULT_URL } = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Ollama answered ${res.status} at ${url}.`);
  const data = await res.json();
  return {
    text: data.response ?? '',
    tokensIn: data.prompt_eval_count ?? 0,
    tokensOut: data.eval_count ?? 0,
    ms: Math.round((data.total_duration ?? 0) / 1e6),
  };
}
