const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const generate = require('@babel/generator').default;

const REGISTRY_PATH = path.join(__dirname, 'atoms-registry.json');
const EMBED_MODEL = 'nomic-embed-text';
const SIMILARITY_THRESHOLD = 0.92;

function load() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function save(entries) {
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(entries, null, 2));
}

// Structural fingerprint: parse + regenerate with fixed formatting so that
// whitespace/quote-style differences never cause a false "not a duplicate".
function normalize(code, kind) {
  const wrapped = kind === 'organism' ? code : `class __W__ {\n${code}\n}`;
  const ast = parser.parse(wrapped, { sourceType: 'module', plugins: ['typescript'] });
  return generate(ast, { retainLines: false, compact: true }).code;
}

async function embed(code, ollamaUrl) {
  const r = await fetch(`${ollamaUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: code }),
  });
  if (!r.ok) throw new Error(`Ollama embeddings responded ${r.status}`);
  const data = await r.json();
  return data.embedding;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Look for a reusable atom/tissue/organism before minting a new one.
// 1. exact structural match (free, deterministic) wins outright.
// 2. otherwise fall back to embedding similarity for a "probably the same idea" match.
async function findExisting(code, kind, ollamaUrl) {
  const entries = load().filter((e) => e.kind === kind);
  const fingerprint = normalize(code, kind);

  const exact = entries.find((e) => e.fingerprint === fingerprint);
  if (exact) return { match: exact, via: 'exact' };

  if (!entries.length) return null;

  const vector = await embed(code, ollamaUrl);
  let best = null;
  let bestScore = 0;
  for (const e of entries) {
    const score = cosineSimilarity(vector, e.embedding);
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  if (best && bestScore >= SIMILARITY_THRESHOLD) {
    return { match: best, via: 'embedding', score: bestScore };
  }
  return null;
}

// Governance rule: once an atom/tissue/organism is registered under a name,
// it can only be REUSED, never redefined -- new needs get a new name
// alongside it, never a rewrite of an existing one. That protects every
// other organism silently depending on it (the whole point of sharing atoms
// via inheritance instead of copy-pasting them).
class AtomRedefinitionError extends Error {
  constructor(name, kind, existing) {
    super(
      `"${name}" is already registered as ${/^[aeiou]/i.test(kind) ? 'an' : 'a'} ${kind} with different code. ` +
        `Existing atoms can only be reused, never redefined -- register a new name instead.`
    );
    this.name = 'AtomRedefinitionError';
    this.existingEntry = existing;
  }
}

async function register(name, kind, code, ollamaUrl) {
  const entries = load();
  const fingerprint = normalize(code, kind);

  const existingByName = entries.find((e) => e.name === name && e.kind === kind);
  if (existingByName) {
    if (existingByName.fingerprint === fingerprint) return existingByName; // identical -- no-op, not a redefinition
    throw new AtomRedefinitionError(name, kind, existingByName);
  }

  const vector = await embed(code, ollamaUrl);
  const entry = { id: `${kind}:${name}:${entries.length}`, name, kind, code, fingerprint, embedding: vector };
  entries.push(entry);
  save(entries);
  return entry;
}

module.exports = {
  load,
  findExisting,
  register,
  cosineSimilarity,
  normalize,
  embed,
  SIMILARITY_THRESHOLD,
  AtomRedefinitionError,
};
