// Readable gloss: a quick plain-English paraphrase of Smith's sentences, from a small local model (owner rule: every
// Smith summary comes with one). DISPLAY ONLY: Smith's exact text stays the record and the only thing checked.
//
//   glossFor(smithSentences, {model: 'qwen2.5-coder:1.5b'})
//     -> {text, gloss, smith, dropped, reason, cached, model}
//
// `text` is what to show beside the summary: the gloss, or Smith's own text when the gloss was dropped.
// The prompt holds only Smith's sentences, never the code. Low temperature, capped output, cached by sentence hash.
// Hallucination guard: a gloss that names an identifier or a literal not in Smith's text is dropped (`gloss: null`,
// `dropped: true`, `reason` says which token), and Smith's text is shown alone. A failed model call drops the same way.
import crypto from 'node:crypto';

export const GLOSS_MODEL = 'qwen2.5-coder:1.5b';
export const GLOSS_OPTIONS = Object.freeze({ temperature: 0.1, num_predict: 96, seed: 1 });
export const GLOSS_MAX_CHARS = 320;
const OLLAMA = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';

export const GLOSS_SYSTEM = [
  'You rewrite a description of a piece of code into plain, everyday English for a developer skimming it.',
  'Write one or two short sentences. Say what it does and why it matters, not each step.',
  'Use only names and values that appear in the description; do not invent any. No code, no lists, no preamble.',
].join('\n');

/** The messages sent for a gloss: Smith's sentences and nothing else. */
export const glossMessages = (smithText) => [{ role: 'system', content: GLOSS_SYSTEM }, { role: 'user', content: `Description:\n${smithText}\n\nPlain English:` }];

const asText = (s) => (Array.isArray(s) ? s.join(' ') : String(s ?? '')).replace(/\s+/g, ' ').trim();
export const glossKey = (smithText, model) => crypto.createHash('sha256').update(`${model}\0${smithText}`).digest('hex');

/** The model's answer, cleaned: no markdown, quotes or preamble, at most two sentences and GLOSS_MAX_CHARS. */
export function cleanGloss(raw) {
  let s = String(raw ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/[*_#>]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(plain english|in plain english|summary|here is[^:]*)\s*:\s*/i, '').replace(/^["'“]|["'”]$/g, '').trim();
  const sentences = s.match(/[^.!?]+[.!?]+(\s|$)/g) ?? (s ? [s] : []);
  s = sentences.slice(0, 2).join('').trim();
  if (s.length > GLOSS_MAX_CHARS) s = `${s.slice(0, GLOSS_MAX_CHARS).replace(/\s+\S*$/, '')}.`;
  return s;
}

/**
 * The code-like tokens of a text: quoted literals, numbers, `<Tag>`s, backticked spans, and words shaped like
 * identifiers (camelCase, PascalCase with an inner capital, a `_`/`$`/digit, a dotted path, a call `f()`), plus a
 * capitalized word that does not start a sentence.
 */
const QUOTED = /(?<![\w])'([^'\n]*)'(?![\w])|"([^"\n]*)"|`([^`\n]*)`/g;

export function codeTokens(text) {
  const out = [];
  const t = String(text);
  // A quote opens and closes only off a word (so "state's" and "isn't" are not quotes); a backticked span is code.
  for (const m of t.matchAll(QUOTED)) {
    if (m[3] != null) out.push({ kind: 'code', value: m[3].trim() });
    else out.push({ kind: 'literal', value: m[1] ?? m[2] });
  }
  const bare = t.replace(QUOTED, ' ');
  for (const m of bare.matchAll(/<\/?([A-Za-z][\w.:-]*)/g)) out.push({ kind: 'identifier', value: m[1] });
  for (const m of bare.matchAll(/(?<![\w.])\d+(?:\.\d+)?(?![\w])/g)) out.push({ kind: 'number', value: m[0] });
  const words = bare.replace(/<\/?[A-Za-z][\w.:-]*>?/g, ' ').split(/\s+/).filter(Boolean);
  words.forEach((raw, i) => {
    const w = raw.replace(/^[^\w$]+|[^\w$)]+$/g, '').replace(/\(\)$/, '');
    if (!w || /^\d/.test(w)) return;
    const prev = i === 0 ? '' : words[i - 1];
    const startsSentence = i === 0 || /[.!?:]$/.test(prev);
    const idShaped = /[a-z][A-Z]/.test(w) || /^[A-Z][a-z0-9]+[A-Z]/.test(w) || /[_$]/.test(w) || /[A-Za-z]\d|\d[A-Za-z]/.test(w) || /\w\.\w/.test(w) || /\(\)$/.test(raw.replace(/[^\w$()]+$/g, ''));
    // An all-caps word of 2-5 letters (ID, HTML, URL, JSON) is an acronym, not an identifier.
    const midCap = !startsSentence && /^[A-Z]/.test(w) && w !== 'I' && !/^[A-Z]{2,5}s?$/.test(w);
    if (idShaped || midCap) out.push({ kind: 'identifier', value: w });
  });
  return out;
}

/**
 * The first identifier or literal of `gloss` that Smith's text does not contain, or null. Identifiers are matched
 * case-sensitively as whole words (a dotted path also by its parts); literals by their inner text.
 */
export function introducedToken(gloss, smithText) {
  const smith = String(smithText);
  const smithWords = new Set(smith.split(/[^\w$]+/).filter(Boolean));
  for (const tok of codeTokens(gloss)) {
    if (tok.kind === 'number') { if (!new RegExp(`(?<![\\w.])${tok.value.replace('.', '\\.')}(?![\\w])`).test(smith)) return tok; continue; }
    if (tok.kind === 'literal') { if (!smith.includes(tok.value)) return tok; continue; }
    if (tok.kind === 'code') { if (!smith.includes(tok.value) && !(tok.value.match(/[\w$]+/g) ?? []).every((w) => smithWords.has(w))) return tok; continue; }
    const parts = tok.value.split('.').filter(Boolean);
    if (!(smithWords.has(tok.value) || smith.includes(tok.value) || parts.every((p) => smithWords.has(p)))) return tok;
  }
  return null;
}

async function ollamaChat(model, messages, options) {
  const r = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages, stream: false, options }) });
  if (!r.ok) throw new Error(`ollama ${r.status}`);
  const j = await r.json();
  return j.message?.content ?? '';
}

const defaultCache = new Map();

/**
 * A 1-2 sentence plain paraphrase of Smith's sentences. Never throws.
 * @param {string|string[]} smithSentences Smith's English (the record).
 * @param {{model?: string, chat?: (model: string, messages: object[], options: object) => Promise<string>, cache?: Map<string, object>}} [o]
 *   `chat` is injectable for tests (default: Ollama /api/chat); `cache` defaults to one in-memory Map per process.
 */
export async function glossFor(smithSentences, o = {}) {
  const model = o.model ?? GLOSS_MODEL;
  const chat = o.chat ?? ollamaChat;
  const cache = o.cache ?? defaultCache;
  const smith = asText(smithSentences);
  const base = { smith, model };
  if (!smith) return { ...base, text: '', gloss: null, dropped: true, reason: 'no Smith text', cached: false };
  const key = glossKey(smith, model);
  if (cache.has(key)) return { ...cache.get(key), cached: true };
  let res;
  try {
    const gloss = cleanGloss(await chat(model, glossMessages(smith), { ...GLOSS_OPTIONS }));
    const bad = gloss ? introducedToken(gloss, smith) : null;
    if (!gloss) res = { ...base, text: smith, gloss: null, dropped: true, reason: 'empty gloss' };
    else if (bad) res = { ...base, text: smith, gloss: null, dropped: true, reason: `introduces ${bad.kind} ${JSON.stringify(bad.value)} not in Smith's text`, rejected: gloss };
    else res = { ...base, text: gloss, gloss, dropped: false, reason: null };
  } catch (e) {
    return { ...base, text: smith, gloss: null, dropped: true, reason: `model call failed (${String(e?.message ?? e).split('\n')[0]})`, cached: false };
  }
  cache.set(key, res);
  return { ...res, cached: false };
}
