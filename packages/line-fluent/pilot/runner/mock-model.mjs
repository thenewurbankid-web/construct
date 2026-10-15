// Mock model for the pilot runner: answers from a fixtures map, no network.
// fixtures: { [entryId]: string | string[] } — the text that follows the prefill; an array is consumed one per call
// (first try, retry, ...), repeating the last text once exhausted. The entry id is read from the request's prefill
// (`{"entry": "<id>", ...`) or `request.entry`. Tokens are a chars/4 estimate.
const PREFILL_ID = /^\s*\{\s*"entry"\s*:\s*"((?:[^"\\]|\\.)*)"/;

const estimate = (s) => Math.ceil(String(s ?? '').length / 4);

export function requestEntryId(request) {
  const match = PREFILL_ID.exec(request?.prefill ?? '');
  return match ? JSON.parse(`"${match[1]}"`) : request?.entry ?? null;
}

export function mockModel(fixtures) {
  const calls = new Map();
  return async (request) => {
    const id = requestEntryId(request);
    if (!Object.hasOwn(fixtures, id)) throw new Error(`mockModel has no fixture for entry ${id}.`);
    const texts = [].concat(fixtures[id]);
    const n = calls.get(id) ?? 0;
    calls.set(id, n + 1);
    const text = texts[Math.min(n, texts.length - 1)];
    return {
      text,
      tokensIn: estimate(`${request.system ?? ''}${request.user ?? ''}${request.prefill ?? ''}`),
      tokensOut: estimate(text),
    };
  };
}
