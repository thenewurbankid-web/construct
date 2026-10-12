// j5 (optional, OFF by default): local text embeddings over the SLOTTED decision text of a memory record (its intent,
// slot shapes and structure tokens), never code and never a project name. One AI profile step, construct.memory-embed
// (packages/core/ai-profiles.json): the Memory tab's switch flips it per project, it runs only with a measured win, and only
// against a local Ollama (nomic-embed-text); when it is not running, recall stays non-neural and says nothing is lost.
import { recallFrom, slotTokens } from './recall.mjs';

/**
 * The only text that is ever embedded: the record's slotted decision text.
 * @param {{intent: string, slots?: string[], neighbourhood?: string[]}} x
 * @returns {string}
 */
export const decisionText = (x) => slotTokens(x).join(' ');

/**
 * A local Ollama embedder. Only localhost is accepted: memory is never sent anywhere.
 * @param {{model?: string, url?: string, fetchFn?: typeof fetch}} [o]
 * @returns {(texts: string[]) => Promise<number[][]>}
 */
export function createOllamaEmbedder(o = {}) {
  const url = o.url ?? 'http://127.0.0.1:11434';
  const host = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) throw new Error('Memory embeddings run only on a local model; the URL must be localhost.');
  const model = o.model ?? 'nomic-embed-text';
  const f = o.fetchFn ?? fetch;
  return async (texts) => {
    const r = await f(`${url}/api/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, input: texts }) });
    if (!r.ok) throw new Error(`The local embedding model answered ${r.status}.`);
    const body = /** @type {any} */ (await r.json());
    return body.embeddings;
  };
}

const cos = (a, b) => { let d = 0; let x = 0; let y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return x && y ? d / Math.sqrt(x * y) : 0; };

/**
 * Recall with embeddings: the non-neural score blended 50/50 with the cosine of the decision texts. Falls back to the
 * non-neural recall when the embedder throws.
 * @param {import('./contract.mjs').MemoryRecord[]} records @param {string} step
 * @param {import('./recall.mjs').RecallContext} ctx @param {number} k
 * @param {(texts: string[]) => Promise<number[][]>} embed
 * @param {Map<string, number[]>} [cache] decision text -> vector
 * @returns {Promise<(import('./contract.mjs').Recalled & {i: number})[]>}
 */
export async function recallWithEmbeddings(records, step, ctx, k, embed, cache = new Map()) {
  try {
    const texts = [...new Set([decisionText(ctx), ...records.map(decisionText)])].filter((t) => !cache.has(t));
    if (texts.length) { const vs = await embed(texts); texts.forEach((t, i) => cache.set(t, vs[i])); }
    const q = /** @type {number[]} */ (cache.get(decisionText(ctx)));
    const extra = records.map((r) => (r.step === step ? Math.max(0, cos(q, /** @type {number[]} */ (cache.get(decisionText(r))))) : null));
    return recallFrom(records, step, ctx, k, { extra });
  } catch {
    return recallFrom(records, step, ctx, k);
  }
}
