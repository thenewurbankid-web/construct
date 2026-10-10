// Embedders behind ONE interface, so they are swappable:
//   { name: string, embed(descriptions) -> Promise<number[][]> }
// where a description is `{tokens: Map<token, weight>, text: string}` (see describe.mjs). Every returned vector is
// L2-normalised. Default: a deterministic hashed structural vector (no download, no network). Optional: local
// Ollama /api/embeddings (FG_EMBEDDER=ollama, FG_OLLAMA_MODEL, default nomic-embed-text); if Ollama is unreachable
// or the model is not installed the factory says why and falls back to the hashed embedder.

/** Dimension of the hashed structural vector. */
export const HASH_DIM = 512;
/**
 * Default merge threshold for (mean-centered) Ollama embeddings. Calibrated to the centered similarity scale, not
 * the raw cosine scale a general-purpose embedder returns -- see `centerBatch`. The fixtures alone don't pin this
 * (they're too small: every threshold from 0.7 to 0.95 scores 19/19 on them, see eval.mjs's --sweep and the
 * report), so this was picked against real subframe-app pages instead: 0.8 is where
 * RedesignedPortfolioHealth.tsx's 6 real `<MetricCard>`s cluster as one clean group (cosine 0.97) AND its 6
 * `<Table.Row>`s do too (via mergeSiblingPeers' near-miss merge), with no large false cluster surviving tier 2.
 * Below 0.8 an ancestor-chained false cluster (a `<div>` wrapper riding along with its own MetricCard-grid child,
 * plus two unrelated same-shaped wrappers elsewhere -- see grouper.mjs's `splitChainedClusters`) still forms.
 * Above 0.8 (checked up to 0.95) a *different*, worse false merge appears: three of the page's top-level
 * `<section>`s (each a large, differently-themed part of the page) cluster as "the same feature repeated" purely
 * on shared shallow scaffolding, and being the largest cluster on the page, that wins tier 2 outright and blocks
 * nearly everything nested in any of them -- an embedder-quality problem the acceptance-order fix does not (and
 * structurally cannot) fully cover, since these members share no ancestor relationship to guard against. 0.8 is
 * the narrow band that avoids both failure modes on this page; it has no comparable margin verified beyond it.
 */
export const OLLAMA_DEFAULT_THRESHOLD = 0.8;
/** Default Ollama embedding model. */
export const DEFAULT_OLLAMA_MODEL = "nomic-embed-text";
/**
 * Minimum batch size to mean-center (see `centerBatch`); below this the centroid direction is not a reliable
 * estimate of the embedding space's shared "anisotropic" direction, and centering as few as 2 vectors is
 * degenerate (it forces them to become exact opposites, cosine -1, regardless of their real content). Below this
 * size we fall back to plain per-vector normalization, same as before this change.
 */
export const MIN_CENTER_BATCH = 4;

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * L2-normalise a vector (a zero vector is returned unchanged).
 *
 * @param {number[]} v Vector.
 * @returns {number[]} Unit vector.
 */
export function normalize(v) {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

/**
 * Cosine similarity of two L2-normalised vectors (their dot product).
 *
 * @param {number[]} a Unit vector.
 * @param {number[]} b Unit vector of the same length.
 * @returns {number} Similarity in [-1, 1].
 */
export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * The default embedder: signed feature hashing of the weighted structural tokens, L2-normalised.
 *
 * @returns {{name: string, embed: (descriptions: {tokens: Map<string, number>}[]) => Promise<number[][]>}} Embedder.
 */
export function createHashedEmbedder() {
  return {
    name: "hashed-structural",
    defaultThreshold: 0.85,
    async embed(descriptions) {
      return descriptions.map(({ tokens }) => {
        const v = new Array(HASH_DIM).fill(0);
        for (const [token, weight] of [...tokens].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
          const h = fnv1a(token);
          v[h % HASH_DIM] += (h & 0x80000000 ? -1 : 1) * weight;
        }
        return normalize(v);
      });
    },
  };
}

/**
 * Mean-center a batch of vectors (subtract the batch centroid from each, then re-normalize to unit length).
 *
 * Why: general-purpose sentence embedders like nomic-embed-text are "anisotropic" -- embeddings of any two
 * sentences drawn from similar-sounding text tend to sit in a narrow cone around one shared, sentence-unrelated
 * direction (this is well documented for BERT-family embedding spaces). `describe.mjs`'s `text` sentences make
 * this worse for our case: every sentence shares the same boilerplate scaffolding ("element X; classes Y;
 * children Z; contains ...; N elements deep D; text bucket"), so almost all of the embedding's magnitude goes
 * into representing that shared template rather than the per-element differences we actually want to cluster on.
 * Subtracting the batch's own centroid removes that shared direction and leaves the part of each embedding that
 * is specific to its element, which is what a cosine threshold should be comparing.
 *
 * This matters more than it used to: it is the reason a page's real clusters (e.g. six genuinely repeated
 * cards) can end up sitting at a similar raw cosine to a handful of large, structurally-unrelated blocks that
 * merely share the anisotropic direction -- see grouper.mjs's acceptance-order fix and ancestor-pair guard, which
 * are the other half of defending against that risk. Centering reduces how often it happens; it does not by
 * itself guarantee two truly unrelated blocks never land above threshold together, which is why acceptance no
 * longer trusts size alone.
 *
 * This is done per page (per call to `embed`, which always receives one page's full candidate batch in real use
 * -- see `groupPage` in grouper.mjs), not as a one-time global correction, since the shared direction depends on
 * the mix of elements on that page. It needs no network round trip, no training data and adds no randomness (the
 * centroid is an exact, deterministic function of the batch).
 *
 * @param {number[][]} vectors Raw (not yet normalized) embeddings, one batch (e.g. one page).
 * @returns {number[][]} Centered, L2-normalised vectors, same order.
 */
export function centerBatch(vectors) {
  if (vectors.length < MIN_CENTER_BATCH) return vectors.map(normalize);
  const dim = vectors[0].length;
  const centroid = new Array(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) centroid[i] += v[i] / vectors.length;
  return vectors.map((v) => normalize(v.map((x, i) => x - centroid[i])));
}

/**
 * An embedder on a local Ollama server (`/api/embeddings`, one request per description, in order). The batch
 * returned by one `embed()` call is mean-centered before normalization -- see `centerBatch` for why.
 *
 * @param {{host?: string, model?: string, fetchImpl?: typeof fetch}} [options] Server and model.
 * @returns {{name: string, embed: Function}} Embedder.
 */
export function createOllamaEmbedder({ host = "http://127.0.0.1:11434", model = DEFAULT_OLLAMA_MODEL, fetchImpl = fetch } = {}) {
  return {
    name: `ollama:${model}`,
    defaultThreshold: OLLAMA_DEFAULT_THRESHOLD,
    async embed(descriptions) {
      const out = [];
      for (const { text } of descriptions) {
        const res = await fetchImpl(`${host}/api/embeddings`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, prompt: text }),
        });
        if (!res.ok) throw new Error(`Ollama /api/embeddings returned HTTP ${res.status}`);
        const body = await res.json();
        if (!Array.isArray(body.embedding)) throw new Error("Ollama /api/embeddings returned no embedding");
        out.push(body.embedding);
      }
      return centerBatch(out);
    },
  };
}

/**
 * Pick an embedder. `kind` "ollama" is checked first (server reachable, model installed) and otherwise falls back
 * to the hashed embedder with a `notice` explaining why. Never pulls a model.
 *
 * @param {{kind?: string, env?: object, fetchImpl?: typeof fetch}} [options] `kind` defaults to env FG_EMBEDDER,
 *   the model to FG_OLLAMA_MODEL, the host to OLLAMA_HOST.
 * @returns {Promise<{embedder: {name: string, embed: Function}, notice: string|null}>} The embedder, and a message
 *   when a fallback happened.
 */
export async function createEmbedder({ kind, env = process.env, fetchImpl = fetch } = {}) {
  const want = kind ?? env.FG_EMBEDDER ?? "hashed";
  if (want !== "ollama") {
    if (want !== "hashed" && want !== "structural") throw new Error(`unknown embedder "${want}" (use hashed or ollama)`);
    return { embedder: createHashedEmbedder(), notice: null };
  }
  const model = env.FG_OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const rawHost = env.OLLAMA_HOST || "http://127.0.0.1:11434";
  const host = /^https?:\/\//.test(rawHost) ? rawHost : `http://${rawHost}`;
  const fallback = (why) => ({ embedder: createHashedEmbedder(), notice: `${why} Falling back to the hashed structural embedder.` });
  let installed;
  try {
    const res = await fetchImpl(`${host}/api/tags`);
    if (!res.ok) return fallback(`Ollama at ${host} answered HTTP ${res.status}.`);
    installed = ((await res.json()).models ?? []).map((m) => m.name);
  } catch (e) {
    return fallback(`Ollama is not reachable at ${host} (${e.message}).`);
  }
  const has = installed.some((n) => n === model || n === `${model}:latest`);
  if (!has) {
    return fallback(`Embedding model "${model}" is not installed in Ollama (installed: ${installed.join(", ") || "none"}); install it yourself with \`ollama pull ${model}\`.`);
  }
  return { embedder: createOllamaEmbedder({ host, model, fetchImpl }), notice: null };
}
