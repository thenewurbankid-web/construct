// Pure (DOMAIN-001) — the vetted list of real Qwen2.5-Coder tags from
// Ollama's own model library (https://ollama.com/library/qwen2.5-coder),
// verified live on 2026-09-18 (Epic 6.3/#99) rather than guessed: sizes
// 0.5b/1.5b/3b/7b/14b/32b, with approximate download sizes as shown there.
// Ollama's own "latest" alias currently points at 7b, but for *local*
// execution this feature recommends 0.5b (smallest/fastest, ~0.4 GB) as
// the default — re-verify against the live library if this ever needs
// updating; it's a snapshot, not a live lookup.
export type QwenTag = {
  tag: string;
  label: string;
  approxSize: string;
  recommended?: boolean;
};

export const QWEN_CODER_TAGS: QwenTag[] = [
  { tag: 'qwen2.5-coder:0.5b', label: '0.5B', approxSize: '~0.4 GB', recommended: true },
  { tag: 'qwen2.5-coder:1.5b', label: '1.5B', approxSize: '~1.0 GB' },
  { tag: 'qwen2.5-coder:3b', label: '3B', approxSize: '~1.9 GB' },
  { tag: 'qwen2.5-coder:7b', label: '7B', approxSize: '~4.7 GB' },
  { tag: 'qwen2.5-coder:14b', label: '14B', approxSize: '~9.0 GB' },
  { tag: 'qwen2.5-coder:32b', label: '32B', approxSize: '~20 GB' },
];

export function recommendedQwenTag(): string {
  return QWEN_CODER_TAGS.find((t) => t.recommended)?.tag ?? QWEN_CODER_TAGS[0].tag;
}
