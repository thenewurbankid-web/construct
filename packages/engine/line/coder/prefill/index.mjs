// prefill (#948): modelled model I/O for code. One function per request: the exact signature is prefilled through its
// `{`, the generation stops at the closing brace, the body is spliced back and checked (parse, locked signature, tsc
// inside the function), and a refusal carries a concrete example. Lifted from bench/isolation/blocks/prefill.mjs and
// briefGuard.mjs (#941). `codeInArgs` keeps code out of tool-call JSON. `ollamaGenerate` is the raw /api/generate call
// (tests pass a fake `generate` instead). The switch back to the old free-form path is LINE_LEGACY_IO=1.
import { chatmlPrompt } from './prefill.mjs';

export { STOP, fnGoal, chatmlPrompt, prefillFor, closingBrace, completeFunction, takeBody, FILL_EXAMPLE } from './prefill.mjs';
export { checkBrief, codeInArgs, MAX_BODY_STATEMENTS, MAX_CODE_LINES } from './briefGuard.mjs';
export { functionsIn, functionAt, spliceBody, tscGate, checkFill, fillOne, fillEach } from './fill.mjs';
export { legacyIo, LEGACY_IO_ENV, CODE_TOOLS, isCodeTool, CODE_ARG_NAMES, choiceExample } from '../../../../core/modelled-io.mjs';

/**
 * The prefilled request over Ollama /api/generate with raw: true (Construct applies Qwen2.5's ChatML template, so the
 * assistant turn starts with the signature). Local only.
 * @param {{model: string, ollama?: string, fetch?: typeof fetch, numPredict?: number, temperature?: number, timeoutMs?: number}} o
 * @returns {(q: {system: string, user: string, prefill: string, stop: readonly string[]}) => Promise<string>}
 */
export function ollamaGenerate({ model, ollama = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434', fetch: doFetch = globalThis.fetch, numPredict = 512, temperature = 0.2, timeoutMs = 300_000 }) {
  const base = /^https?:/.test(ollama) ? ollama.replace(/\/$/, '') : `http://${ollama}`;
  return async ({ system, user, prefill, stop }) => {
    const r = await doFetch(`${base}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, raw: true, stream: false, prompt: chatmlPrompt({ system, user, prefill }), options: { temperature, stop: [...stop], num_predict: numPredict } }), signal: AbortSignal.timeout(timeoutMs) });
    const body = /** @type {any} */ (await r.json().catch(() => ({})));
    if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
    return String(body.response ?? '');
  };
}
