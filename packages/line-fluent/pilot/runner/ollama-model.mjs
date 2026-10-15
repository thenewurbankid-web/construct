// A local model through Ollama, as the library run's model function (same shape as claude-model.mjs's claudeModel):
// request {system, user, prefill} -> {text, tokensIn, tokensOut, costUsd, model}, text continuing the prefill.
// Reuses the student's qwen ChatML prompt and Ollama call (student/student.mjs); no format grammar, since the run's
// turns ask for JSON objects, JSON arrays (batches) and plain questions alike. Local runs cost nothing.
import { callStudent, studentRequest } from '../../student/student.mjs';
import { textAfterPrefill } from './claude-model.mjs';

/** Whether a --inside/--outside/--user name is an Ollama model (`qwen2.5-coder:7b`) rather than a Claude one. */
export const isOllamaModel = (name) => typeof name === 'string' && name.includes(':');

export function ollamaModel({ model, maxTokens = 4096, numCtx = 16384, call = callStudent } = {}) {
  return async (request) => {
    const body = studentRequest(request, { model, maxTokens, schema: null });
    body.options.num_ctx = numCtx;
    const out = await call(body);
    return { text: textAfterPrefill(request.prefill, out.text), tokensIn: out.tokensIn, tokensOut: out.tokensOut, costUsd: 0, model };
  };
}
