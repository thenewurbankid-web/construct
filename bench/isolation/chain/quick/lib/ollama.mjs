// Quick kill-tests (#942): the two Ollama calls the tests need. Run only under packages/tools/dev/heavy.sh.
// chat(): one fresh single-turn call, its answer forced to a JSON schema through Ollama `format` (never code in JSON,
// never a tool call parsed out of free text). embed(): nomic-embed-text vectors.
export const OLLAMA = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
export const MODELS = Object.freeze({ coder: 'qwen2.5-coder:1.5b', embed: 'nomic-embed-text' });

/**
 * @param {{model?: string, system: string, user: string, format?: object, options?: object}} a
 * @returns {Promise<{content: string, json: any, promptTokens: number, evalTokens: number, ms: number}>}
 */
export async function chat({ model = MODELS.coder, system, user, format, options = {} }) {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model, stream: false, keep_alive: '10m', format,
      options: { temperature: 0, seed: 7, num_ctx: 4096, num_predict: 512, ...options },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Ollama chat ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const content = j.message?.content ?? '';
  let json = null;
  if (format) { try { json = JSON.parse(content); } catch { json = null; } }
  return { content, json, promptTokens: j.prompt_eval_count ?? 0, evalTokens: j.eval_count ?? 0, ms: Date.now() - t0 };
}

/** @param {string[]} input @returns {Promise<number[][]>} */
export async function embed(input) {
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODELS.embed, input, keep_alive: '10m' }),
  });
  if (!res.ok) throw new Error(`Ollama embed ${res.status}: ${await res.text()}`);
  return (await res.json()).embeddings;
}

export function cosine(a, b) {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return d / Math.sqrt(x * y);
}
