// The fixed whitelist of Line elements a streamed answer may embed (lib/StreamedText.tsx), and the sanitizer that keeps
// everything else plain text. An answer is markdown; only these self-closing tags, with only their own attributes
// (plain quoted values), stay as elements, and only when the screen showing the answer provides a component for them.
// Any other tag, raw HTML or script is escaped, so the markdown renderer (flowtoken, rehype-raw underneath) only ever
// sees text and whitelisted elements. What appears is decided by the screen's tool results, never by a model's markup.

/** The whitelisted tags and the attributes each may carry. */
export const STREAM_TAGS = Object.freeze({
  ProjectCard: ['name'],
  OptionChips: ['ids'],
  QuestionStep: ['id'],
  LibraryItem: ['id'],
  TraceLink: ['control'],
} as const);

export type StreamTag = keyof typeof STREAM_TAGS;

const TAG = /<([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z][A-Za-z0-9-]*="[^"<>&]*")*)\s*\/>/g;
const ATTR = /\s+([A-Za-z][A-Za-z0-9-]*)="([^"<>&]*)"/g;

// Only `<` can open markup; escaping it leaves the rest of the markdown as it was.
const escapeText = (s: string) => s.replace(/</g, '&lt;');

function allowedTag(name: string, attrs: string, allowed: ReadonlySet<string>): boolean {
  if (!allowed.has(name) || !(name in STREAM_TAGS)) return false;
  const own: readonly string[] = STREAM_TAGS[name as StreamTag];
  return [...attrs.matchAll(ATTR)].every((m) => own.includes(m[1]));
}

/** The answer with every tag escaped except the whitelisted ones in `allowed` (the tags the screen provides), which
 * are written back in the lower-case form the HTML parser gives them, with only their own attributes and an end tag. */
export function sanitizeStream(text: string, allowed: Iterable<string>): string {
  const ok = new Set(allowed);
  let out = '';
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    const at = m.index ?? 0;
    out += escapeText(text.slice(last, at));
    // An explicit end tag: the HTML parser ignores `/>` on a non-void element and would swallow what follows.
    out += allowedTag(m[1], m[2], ok) ? `<${m[1].toLowerCase()}${m[2]}></${m[1].toLowerCase()}>` : escapeText(m[0]);
    last = at + m[0].length;
  }
  return out + escapeText(text.slice(last));
}
