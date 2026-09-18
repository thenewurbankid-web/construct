// Thin wrapper around Ollama's local HTTP API (default
// http://localhost:11434, overridable via OLLAMA_HOST for anyone running it
// on a non-default port/host). Deliberately hand-rolled `fetch()` calls
// rather than an npm Ollama client: the API surface used here is four small,
// stable endpoints (version/tags/pull/delete), and the existing `claude`
// provider in src/llm.mjs already sets the project's precedent of calling
// the tool as directly as possible rather than adding a dependency for a
// thin HTTP wrapper — see the Epic 6.1 issue comment for the fuller
// reasoning. No LLM call happens in this module; it only manages which
// models are installed for the `ollama` provider in src/llm.mjs to use.
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

// Keep detection calls snappy — a non-running daemon should fail fast
// (connection refused) rather than hang the UI, but a slow/loaded one still
// gets a real few seconds rather than an instant false negative.
const DETECT_TIMEOUT_MS = 3000;

/** Is the local Ollama daemon up? Never throws — a non-running daemon (the
 * expected case when Ollama isn't installed, or isn't started) is a normal,
 * reportable state, not an error. */
export async function getOllamaStatus() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/version`, { signal: AbortSignal.timeout(DETECT_TIMEOUT_MS) });
    if (!res.ok) return { running: false };
    const data = await res.json();
    return { running: true, version: data.version ?? null, host: OLLAMA_HOST };
  } catch {
    return { running: false, host: OLLAMA_HOST };
  }
}

/** Installed models, as Ollama's own `/api/tags` reports them (name, size,
 * modified date, etc.) — passed through as-is rather than reshaped, so the
 * UI has access to whatever Ollama itself considers a model's identity. */
export async function listOllamaModels() {
  const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(DETECT_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Ollama /api/tags returned ${res.status}`);
  const data = await res.json();
  return data.models || [];
}

/** Starts a model pull and returns the raw fetch Response so the caller
 * (the /api/ollama/pull route) can stream Ollama's own newline-delimited
 * JSON progress events straight through to the browser as they arrive,
 * instead of buffering a multi-GB download in memory. No timeout here — a
 * real pull can legitimately run for many minutes. */
export async function startOllamaPull(name) {
  const res = await fetch(`${OLLAMA_HOST}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, stream: true }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Ollama /api/pull returned ${res.status}`);
  }
  return res;
}

export async function removeOllamaModel(name) {
  const res = await fetch(`${OLLAMA_HOST}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama /api/delete returned ${res.status}${text ? `: ${text}` : ''}`);
  }
  return { removed: name };
}
