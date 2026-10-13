// The 1.5b translator arm of the facts compiler: qwen2.5-coder:1.5b turns Smith's sentences plus the LSP index into
// the same facts shape compileFacts (facts.mjs) builds by rule. gloss.mjs's hallucination guard applies: a fact list
// that names an identifier, path or literal that is in neither Smith's text nor the index is dropped, and the
// compiler's own facts are used instead. A failed call, or fewer than three facts, falls back the same way.
//
//   glossFacts(smithSteps, index, {task, model?, chat?}) -> {text, facts, tokens, dropped, reason, raw}
//
// smithSteps: [{file, id?, sentences}] (Smith's sentences after the title), index: facts.mjs buildIndex's output,
// task: the rest of compileFacts's input (target, libraryPages, step, refusal, fetch).
import { approxTokens } from './index.mjs';
import { assembleFacts, compileFacts, refusalFact } from './facts.mjs';
import { introducedToken } from './gloss.mjs';

export const FACTS_MODEL = 'qwen2.5-coder:1.5b';
export const FACTS_OPTIONS = Object.freeze({ temperature: 0.1, num_predict: 700, seed: 1 });
export const FACTS_MIN = 3;
export const FACTS_MAX_TOKENS = 1200;
const OLLAMA = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';

export const FACTS_SYSTEM = [
  'You turn notes about a code project into short facts for a coding assistant.',
  'Write one fact per line. Each line starts with "- " and ends with its source in square brackets, e.g. [moduleScope] or [Smith features/x/pages/X.tsx].',
  'Cover: what exists (each file with its id, what it is based on, its route and what it renders), what is missing, and the exact import lines and prop types to use.',
  'Use only names, paths and values that appear in the notes. No headings, no other text.',
].join('\n');

/** The index as plain notes: exact names, paths, signatures, gaps. Source labels are part of it. */
export function indexNotes(index, task = {}) {
  const L = index.library;
  const out = ['Sources you can cite: moduleScope, quickInfo, Smith, ls.'];
  for (const f of index.features) out.push(`- feature ${f.name}: ${f.spec ? 'has spec.md' : 'no spec.md'}; declares ${f.kinds.length ? f.kinds.join(', ') : 'nothing'}; exports ${f.exports.length ? f.exports.join(', ') : 'nothing'}`);
  for (const u of index.units) out.push(`- unit ${u.file} id ${u.id}; base ${u.base ?? 'none'}; route ${u.route ?? 'none'}; signature ${u.signature ?? 'unknown'}${u.stub.length ? `; stub problems ${u.stub.join(', ')}` : ''}`);
  const pages = task.libraryPages ? L.pages.filter((p) => task.libraryPages.includes(p.name)) : L.pages;
  for (const p of pages) out.push(`- library page ${p.file} id ${p.id}; signature ${p.signature}; props ${p.props}`);
  out.push(`- library components: ${L.components.join(', ')}`);
  for (const x of L.fixtures) out.push(`- fixture ${x.file}: ${x.rows} rows {${x.fields.join(', ')}}`);
  return out.join('\n');
}

const smithNotes = (smithSteps) => smithSteps.map((s) => `- ${s.file}${s.id ? ` (${s.id})` : ''}: ${s.sentences.join(' ')}`).join('\n');

/** The messages sent: the index notes and Smith's sentences, never the code. */
export const factsMessages = (smithSteps, index, task) => [
  { role: 'system', content: FACTS_SYSTEM },
  { role: 'user', content: `Index (exact names):\n${indexNotes(index, task)}\n\nSmith (what each function does):\n${smithNotes(smithSteps)}\n\nFacts:` },
];

async function ollamaChat(model, messages, options) {
  const r = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages, stream: false, options }) });
  if (!r.ok) throw new Error(`ollama ${r.status}`);
  return (await r.json()).message?.content ?? '';
}

/** The fact lines of an answer ("- ..." lines), capped at FACTS_MAX_TOKENS. */
export function factLines(raw) {
  const lines = String(raw ?? '').split('\n').map((l) => l.trim()).filter((l) => /^[-*] /.test(l)).map((l) => l.replace(/^[-*] /, '').replace(/\*\*/g, '').trim()).filter(Boolean);
  const out = []; let tok = 0;
  for (const l of lines) { tok += approxTokens(l); if (tok > FACTS_MAX_TOKENS) break; out.push(l); }
  return out;
}

/**
 * Facts from the 1.5b, in compileFacts's shape; the compiler's facts when the guard drops them. Never throws.
 * @param {{file: string, id?: string, sentences: string[]}[]} smithSteps
 * @param {any} index
 * @param {{task: any, model?: string, chat?: (model: string, messages: object[], options: object) => Promise<string>}} o
 */
export async function glossFacts(smithSteps, index, o) {
  const task = { ...o.task, index };
  const fallback = (reason, raw = null) => { const c = compileFacts(task); return { ...c, dropped: true, reason, raw }; };
  let raw;
  try { raw = await (o.chat ?? ollamaChat)(o.model ?? FACTS_MODEL, factsMessages(smithSteps, index, o.task), { ...FACTS_OPTIONS }); } catch (e) { return fallback(`model call failed (${String(e?.message ?? e).split('\n')[0]})`); }
  const facts = factLines(raw);
  if (facts.length < FACTS_MIN) return fallback(`only ${facts.length} fact lines`, raw);
  const known = `${indexNotes(index, o.task)}\n${smithNotes(smithSteps)}`;
  for (const f of facts) {
    const bad = introducedToken(f, known);
    if (bad) return fallback(`introduces ${bad.kind} ${JSON.stringify(bad.value)} not in Smith's text or the index`, raw);
  }
  const all = o.task.refusal ? [...facts, refusalFact(o.task.refusal)] : facts;
  return { ...assembleFacts(all, task), dropped: false, reason: null, raw };
}
