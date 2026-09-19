import { API_BASE } from '@/lib/apiBase';
import type { PullProgress } from '../types';

// Split out of Ollama.tsx (MODULE-001's per-file export threshold) — the
// two model-mutating calls (pull/remove), as opposed to Ollama.tsx's two
// read-only fetches.

export const removeOllamaModel = (name: string) =>
  fetch(`${API_BASE}/api/ollama/models/${encodeURIComponent(name)}`, { method: 'DELETE', credentials: 'include' }).then((r) => r.json());

/** Streams `/api/ollama/pull`'s newline-delimited JSON progress events,
 * calling `onProgress` once per parsed line as it arrives — a real pull can
 * run for minutes, so this reads the response body incrementally instead of
 * waiting for it to finish before the caller sees anything. */
export async function pullOllamaModel(name: string, onProgress: (p: PullProgress) => void): Promise<void> {
  const res = await fetch(`${API_BASE}/api/ollama/pull`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.body) {
    const data = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(data.error || `Pull failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onProgress(JSON.parse(line));
      } catch {
        // A malformed/partial line shouldn't abort the whole pull.
      }
    }
  }
}
