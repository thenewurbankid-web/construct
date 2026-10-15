// A local model through Ollama, as the library run's model function (same shape as claude-model.mjs's claudeModel):
// request {system, user, prefill} -> {text, tokensIn, tokensOut, costUsd, model}, text continuing the prefill.
// Reuses the student's qwen ChatML prompt and Ollama call (student/student.mjs). A request that carries `schema` is
// held to it while the model writes (Ollama's format): the prefill is left out, since the grammar starts its own
// object, and the caller reads the whole object (readList, textAfterPrefill). Other turns run free. Cost is 0.
import { callStudent, studentRequest } from '../../student/student.mjs';
import { textAfterPrefill } from './claude-model.mjs';

/** Whether a --inside/--outside/--user name is an Ollama model (`qwen2.5-coder:7b`) rather than a Claude one. */
export const isOllamaModel = (name) => typeof name === 'string' && name.includes(':');

export function ollamaModel({ model, maxTokens = 4096, numCtx = 8192, call = callStudent } = {}) {
  return async (request) => {
    const held = Boolean(request.schema);
    const body = studentRequest(held ? { ...request, prefill: '' } : request, { model, maxTokens, schema: request.schema ?? null });
    body.options.num_ctx = numCtx;
    const out = await call(body);
    return { text: textAfterPrefill(request.prefill, out.text), tokensIn: out.tokensIn, tokensOut: out.tokensOut, costUsd: 0, model };
  };
}
