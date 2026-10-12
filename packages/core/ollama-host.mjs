// #865: the one place OLLAMA_HOST is turned into a URL a client can fetch. Ollama itself accepts a
// scheme-less host (`0.0.0.0:11434`, `localhost`), so every reader normalises through here rather
// than concatenating the raw env var (which breaks on Termux/Android setups that export a bind address).

/** The default Ollama address, shared by machine.mjs, llm.mjs and ui/server/src/ollama.mjs. */
export const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434';

/**
 * Normalise an OLLAMA_HOST value: add `http://` when there is no scheme, add `:11434` when there is
 * no port on a plain http host, map the bind-all address `0.0.0.0` to loopback, drop a trailing slash.
 *
 * @param {string | undefined | null} raw The OLLAMA_HOST value.
 * @returns {string} A URL without a trailing slash; the default when `raw` is empty or unparseable.
 */
export function normalizeOllamaHost(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return OLLAMA_DEFAULT_URL;
  const hasScheme = /^https?:\/\//i.test(value);
  let u;
  try {
    u = new URL(hasScheme ? value : `http://${value}`);
  } catch {
    return OLLAMA_DEFAULT_URL;
  }
  if (u.hostname === '0.0.0.0') u.hostname = '127.0.0.1';
  if (u.hostname === '[::]') u.hostname = '[::1]';
  // Ollama's default port applies only when the user gave neither a scheme nor a port.
  const port = u.port || (hasScheme ? '' : '11434');
  const path = u.pathname.replace(/\/+$/, '');
  return `${u.protocol}//${u.hostname}${port ? `:${port}` : ''}${path}`;
}
