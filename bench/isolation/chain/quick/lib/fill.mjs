// One function per request (#942): every model call that writes code gets the function's signature prefilled
// (bench/isolation/blocks/prefill.mjs: raw ChatML, assistant turn = signature + `{`, stopped at the closing brace),
// so it can only write that one body; anything after the closing brace is cut.
//   prefilledFunction({ model, system, user, signature, seed, options, fetchImpl }) -> { code, body, tokens, ms }
//   fillBody({ signature, plan, seed, fetchImpl, system, example, model }) -> { body, tokens, ms }   (K5 / K5b fills)
import { prefilledGenerate, closingBrace } from '../../../blocks/prefill.mjs';
import { OLLAMA, MODELS } from './ollama.mjs';

export const FILL_SYSTEM = 'You fill the body of one Trace stub. The signature is already written and locked. Follow the test plan: one statement per plan line, in order.';
export const FILL_EXAMPLE = "Example.\nStub: function dueLabel(loan: Loan): string\nPlan:\n  if loan's renewed: return 'Renewed'\n  return 'Renew'\nFunction:\n```ts\nfunction dueLabel(loan: Loan): string {\n  if (loan.renewed) {\n    return 'Renewed';\n  }\n  return 'Renew';\n}\n```";

export const fillUser = (signature, plan, example = FILL_EXAMPLE) => `${example}\n\nStub: ${signature}\nPlan:\n${plan.map((l) => `  ${l}`).join('\n')}\nFunction:`;

export async function prefilledFunction({ model = MODELS.coder, system, user, signature, seed, options = {}, fetchImpl }) {
  const c = await prefilledGenerate({
    ollama: { url: OLLAMA, keepAlive: '10m', timeoutMs: 600_000 }, model,
    options: { temperature: 0.7, num_ctx: 4096, num_predict: 512, ...options }, system, user, signature, lang: 'ts', seed,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  const cut = closingBrace(c.raw);
  const body = (cut >= 0 ? c.raw.slice(0, cut - 1) : c.raw).replace(/\s+$/, '');
  return { code: `${signature.replace(/\s*\{?\s*$/, '')} {\n${body}\n}`, body, tokens: c.tokensIn + c.tokensOut, ms: c.ms };
}

export async function fillBody({ signature, plan, seed, fetchImpl, system = FILL_SYSTEM, example = FILL_EXAMPLE, model }) {
  const r = await prefilledFunction({ model, system, user: fillUser(signature, plan, example), signature, seed, fetchImpl });
  return { body: r.body, tokens: r.tokens, ms: r.ms };
}
