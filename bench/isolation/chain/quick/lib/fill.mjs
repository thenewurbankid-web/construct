// One stub body per request (#942 K5 fill): the 1.5b gets the signature prefilled (bench/isolation/blocks/prefill.mjs:
// raw ChatML, assistant turn = signature + `{`, stopped at the closing brace), so it can only write that body.
//   fillBody({ signature, plan, seed, fetchImpl }) -> { body, tokens, ms }
import { prefilledGenerate, closingBrace } from '../../../blocks/prefill.mjs';
import { OLLAMA, MODELS } from './ollama.mjs';

export const FILL_SYSTEM = 'You fill the body of one Trace stub. The signature is already written and locked. Follow the test plan: one statement per plan line, in order.';
export const FILL_EXAMPLE = "Example.\nStub: function dueLabel(loan: Loan): string\nPlan:\n  if loan's renewed: return 'Renewed'\n  return 'Renew'\nFunction:\n```ts\nfunction dueLabel(loan: Loan): string {\n  if (loan.renewed) {\n    return 'Renewed';\n  }\n  return 'Renew';\n}\n```";

export const fillUser = (signature, plan) => `${FILL_EXAMPLE}\n\nStub: ${signature}\nPlan:\n${plan.map((l) => `  ${l}`).join('\n')}\nFunction:`;

export async function fillBody({ signature, plan, seed, fetchImpl }) {
  const c = await prefilledGenerate({
    ollama: { url: OLLAMA, keepAlive: '10m', timeoutMs: 600_000 }, model: MODELS.coder,
    options: { temperature: 0.7, num_ctx: 4096, num_predict: 512 }, system: FILL_SYSTEM, user: fillUser(signature, plan),
    signature, lang: 'ts', seed, ...(fetchImpl ? { fetchImpl } : {}),
  });
  const cut = closingBrace(c.raw);
  const body = (cut >= 0 ? c.raw.slice(0, cut - 1) : c.raw).replace(/\s+$/, '');
  return { body, tokens: c.tokensIn + c.tokensOut, ms: c.ms };
}
