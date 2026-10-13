// #936 -- the research sub-agent: a fresh, few-turn, READ-ONLY model loop for a question no block answered. Its context
// is the ledger's view plus the question and a small read-tool set (selectTools(question), injectable); it ends with
// ONE short English answer whose cites are checked against the project (a path that does not exist is dropped).
// A tool call outside the read set is refused and logged as a miss; the turn cap is hard.
import fs from 'node:fs';
import path from 'node:path';
import { matchAtoms } from '@line/atoms';
import { readLineFeature } from '../feature.mjs';
import { BLOCK_ANSWERERS } from './blocks.mjs';

export const DEFAULT_RESEARCH_MODEL = 'qwen2.5-coder:7b';
export const RESEARCH_MODELS = Object.freeze(['qwen2.5-coder:7b', 'qwen2.5-coder:1.5b']);
export const DEFAULT_MAX_TURNS = 4;

const fn = (name, description, properties = {}, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const S = (description) => ({ type: 'string', description });
const clip = (s, n = 3000) => (s.length > n ? `${s.slice(0, n)}\n...(${s.length - n} more characters cut)` : s);

/** A project-relative path inside `root` (never outside it, never node_modules), or null. */
export function inside(root, rel) {
  const abs = path.resolve(root, String(rel ?? '.'));
  const r = path.relative(path.resolve(root), abs);
  if (r.startsWith('..') || path.isAbsolute(r) || r.split(path.sep).includes('node_modules')) return null;
  return abs;
}

/** The facts of a block answer as tool output. */
const factsOut = (a) => (a ? { ok: true, facts: a.facts } : { ok: false, sentence: 'That block found nothing for this.' });

/**
 * The read tools a research sub-agent may use: each {def, run(root, args)}. All read; none writes.
 * @type {Record<string, {def: any, run: (root: string, a: any) => any}>}
 */
export const READ_TOOLS = Object.freeze({
  read_file: { def: fn('read_file', 'Read one project file (first 3000 characters).', { path: S('Project-relative path') }, ['path']), run: (root, a) => {
    const abs = inside(root, a.path);
    if (!abs) return { ok: false, sentence: 'That path is outside the project.' };
    try { return { ok: true, path: a.path, text: clip(fs.readFileSync(abs, 'utf8')) }; } catch { return { ok: false, sentence: `There is no file ${a.path}.` }; }
  } },
  list_dir: { def: fn('list_dir', 'List one project folder.', { path: S('Project-relative folder, "." for the root') }, ['path']), run: (root, a) => {
    const abs = inside(root, a.path ?? '.');
    if (!abs) return { ok: false, sentence: 'That path is outside the project.' };
    try { return { ok: true, entries: fs.readdirSync(abs, { withFileTypes: true }).filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules').map((e) => (e.isDirectory() ? `${e.name}/` : e.name)) }; } catch { return { ok: false, sentence: `There is no folder ${a.path}.` }; }
  } },
  feature_summary: { def: fn('feature_summary', 'A feature in plain English: its items, their bases, open acceptance points.', { feature: S('Feature name') }, ['feature']), run: (root, a) => {
    try { const d = readLineFeature(root, String(a.feature ?? '')); return { ok: true, sentences: d.summary.sentences }; } catch (e) { return { ok: false, sentence: String(/** @type {any} */ (e).sentence ?? /** @type {Error} */ (e).message) }; }
  } },
  atoms: { def: fn('atoms', 'The shipped logic atoms that match a need, best first.', { need: S('What the code must do, in words') }, ['need']), run: (_root, a) => ({ ok: true, atoms: matchAtoms(String(a.need ?? ''), { limit: 3 }).map((m) => ({ sentence: m.sentence, import: m.import })) }) },
  importable: { def: fn('importable', 'What one file may import: the library and its own feature, each in one sentence.', { file: S('Project-relative file') }, ['file']), run: (root, a) => factsOut(BLOCK_ANSWERERS.imports(root, String(a.file ?? ''))) },
  who_uses: { def: fn('who_uses', 'The files that import or render one file.', { file: S('Project-relative file') }, ['file']), run: (root, a) => factsOut(BLOCK_ANSWERERS.callers(root, String(a.file ?? ''))) },
});

/** The answer tool every sub-agent ends with. */
export const ANSWER_TOOL = fn('answer', 'Give your answer: one short English sentence, and the project paths that back it.', { answer: S('The answer in plain English'), cites: { type: 'array', items: { type: 'string' }, description: 'Project-relative paths (path or path:line) you read that back the answer' } }, ['answer']);

/** The default per-question tool choice: the file tools, plus the blocks the question's words point at. */
export function defaultSelectTools(question) {
  const q = String(question).toLowerCase();
  const names = ['read_file', 'list_dir'];
  if (/\bfeature|page|spec|accept/.test(q)) names.push('feature_summary');
  if (/\batom|helper|logic|paginat|filter|sort|search|debounce|poll|undo|export|validat/.test(q)) names.push('atoms');
  if (/\bimport|depend|use|call|render/.test(q)) names.push('importable', 'who_uses');
  return names;
}

/**
 * The default model call: Ollama /api/chat, local only.
 * @param {{ollama?: string, numCtx?: number, fetchFn?: typeof fetch}} [o]
 */
export function ollamaChat(o = {}) {
  const url = o.ollama ?? 'http://127.0.0.1:11434';
  const f = o.fetchFn ?? fetch;
  return async ({ model, messages, tools }) => {
    const r = await f(`${url}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: false, messages, tools, options: { num_ctx: o.numCtx ?? 8192, temperature: 0.1 } }), signal: AbortSignal.timeout(300_000) });
    const body = /** @type {any} */ (await r.json());
    if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
    return body;
  };
}

const PATHISH = /(?:^|[\s(["'`])((?:[\w@.-]+\/)+[\w.-]+\.\w{1,5}(?::\d+)?)/g;
const firstSentences = (text, n = 1) => (String(text).replace(/\s+/g, ' ').trim().match(/[^.?!]+[.?!]+/g) ?? [String(text).trim()]).slice(0, n).join(' ').trim();

/**
 * Run one sub-agent for `question`.
 * @param {{root: string, question: string, view: string, chat: (req: {model: string, messages: any[], tools: any[]}) => Promise<any>, model?: string, maxTurns?: number, selectTools?: (q: string) => string[], tools?: Record<string, {def: any, run: (root: string, a: any) => any}>}} o
 * @returns {Promise<{ok: boolean, answer: string|null, cites: string[], turns: number, read: string[], refused: string[], stop: string}>}
 */
export async function runSubagent(o) {
  const tools = o.tools ?? READ_TOOLS;
  const chosen = (o.selectTools ?? defaultSelectTools)(o.question).filter((n) => tools[n]);
  const defs = [...chosen.map((n) => tools[n].def), ANSWER_TOOL];
  const model = o.model ?? DEFAULT_RESEARCH_MODEL;
  const maxTurns = Math.max(1, o.maxTurns ?? DEFAULT_MAX_TURNS);
  const messages = [
    { role: 'system', content: `You are a read-only research helper for one question about a project. You can read; you cannot change any file. Use only your tools. Within ${maxTurns} turns, call answer with one short English sentence and the project paths that back them.` },
    { role: 'user', content: `${o.view}\n\nQuestion: ${o.question}` },
  ];
  const read = new Set(); const refused = [];
  const exists = (c) => { const abs = inside(o.root, String(c).replace(/:\d+(?::\d+)?$/, '')); return !!abs && fs.existsSync(abs); };
  const done = (text, cites, turns) => {
    const kept = [...new Set([...(cites ?? []), ...[...String(text).matchAll(PATHISH)].map((m) => m[1])].map(String))].filter(exists);
    return { ok: true, answer: firstSentences(text), cites: kept.length ? kept : [...read].slice(0, 3), turns, read: [...read], refused, stop: 'answered' };
  };
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const res = await o.chat({ model, messages, tools: defs });
    const msg = res?.message ?? { role: 'assistant', content: '' };
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    messages.push({ role: 'assistant', content: msg.content ?? '', ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) {
      if (String(msg.content ?? '').trim()) return done(msg.content, [], turn);
      messages.push({ role: 'user', content: 'Use a read tool, or call answer.' });
      continue;
    }
    for (const c of calls) {
      const name = c.function?.name;
      let args = c.function?.arguments;
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      args = args && typeof args === 'object' ? args : {};
      if (name === 'answer' && String(args.answer ?? '').trim()) return done(args.answer, Array.isArray(args.cites) ? args.cites : [], turn);
      let out;
      if (!chosen.includes(name)) {
        refused.push(String(name));
        out = tools[name]
          ? { ok: false, code: 'NOT_GIVEN', sentence: `${name} was not given for this question; your tools are ${chosen.join(', ')} and answer.` }
          : { ok: false, code: 'READ_ONLY', sentence: `Research is read-only; ${name} is not one of your tools (${chosen.join(', ')}, answer).` };
      } else {
        out = tools[name].run(o.root, args);
        for (const k of ['path', 'file']) if (typeof args[k] === 'string' && out.ok) read.add(args[k]);
      }
      messages.push({ role: 'tool', content: clip(JSON.stringify(out)) });
    }
  }
  return { ok: false, answer: null, cites: [...read].slice(0, 3), turns: maxTurns, read: [...read], refused, stop: 'turn cap' };
}
