// #936 -- the research tool: `research {question, feature?}` for the coder. A block answers first (blocks.mjs); else a
// read-only sub-agent (subagent.mjs). Every research call goes through ONE queue, so calls run strictly one after
// another through the one loaded model, and all of them read and write ONE ledger per run (ledger.mjs).
//
// Integration points (kept narrow so the builder wiring is a few lines):
//   researchTool(ctx)          -> {schema, handle(args, {turn})}
//   ledgerView(ctx, budget)    -> the ledger as compact English for the builder prompt each turn
//   researchHooks(o)           -> what qwen-agent.mjs calls behind --research: tools(list), message(), handles(name),
//                                 handle(args, turn), record(name, args, result, turn) (the coder's own results, distilled)
//   recordToolResult(ledger, ...) / distill(tool, result) -> the coder's tool results as ledger entries (distill.mjs)
import path from 'node:path';
import { words } from '@line/atoms';
import { jaccard } from '../memory/recall.mjs';
import { readLineProject } from '../model.mjs';
import { createLedger, LEDGER_FILE, DUPLICATE_OVERLAP } from './ledger.mjs';
import { answerWithBlocks, classifyQuestion } from './blocks.mjs';
import { recordToolResult } from './distill.mjs';
import { runSubagent, ollamaChat, DEFAULT_RESEARCH_MODEL, DEFAULT_MAX_TURNS } from './subagent.mjs';

export { createLedger, LEDGER_FILE, VIEW_HEADER, VIEW_LABELS } from './ledger.mjs';
export { distill, recordToolResult, isRefusal } from './distill.mjs';
export { classifyQuestion, answerWithBlocks, QUESTION_CLASSES } from './blocks.mjs';
export { runSubagent, READ_TOOLS, defaultSelectTools, RESEARCH_MODELS, DEFAULT_RESEARCH_MODEL } from './subagent.mjs';

/** The ledger budget the builder prompt gives the notes, in tokens. */
export const DEFAULT_VIEW_BUDGET = 600;

/**
 * A strict FIFO: each job starts only after the previous one settled. `peak` is the most jobs ever running at once.
 */
export function createQueue() {
  let tail = Promise.resolve();
  let running = 0; let peak = 0;
  return {
    /** @template T @param {() => Promise<T>} job @returns {Promise<T>} */
    run(job) {
      const p = tail.then(async () => {
        running += 1; peak = Math.max(peak, running);
        try { return await job(); } finally { running -= 1; }
      });
      tail = p.then(() => undefined, () => undefined);
      return p;
    },
    get peak() { return peak; },
  };
}

/** One queue per process: research calls from any run never overlap on the model. */
const SHARED_QUEUE = createQueue();
/** @type {WeakMap<object, ReturnType<typeof createLedger>>} */
const LEDGERS = new WeakMap();

/**
 * @typedef {object} ResearchContext
 * @property {string} root                 The project.
 * @property {string} [logDir]             Where the ledger is stored (research-ledger.json); none: in memory only.
 * @property {ReturnType<typeof createLedger>} [ledger]
 * @property {(req: {model: string, messages: any[], tools: any[]}) => Promise<any>} [chat]  Default: local Ollama.
 * @property {string} [ollama]
 * @property {string} [model]              Default qwen2.5-coder:7b (qwen2.5-coder:1.5b also fits).
 * @property {number} [maxTurns]           Sub-agent cap, default 4.
 * @property {(question: string) => string[]} [selectTools]  Read-tool names per question.
 * @property {Record<string, any>} [tools] The read-tool table (default READ_TOOLS).
 * @property {ReturnType<typeof createQueue>} [queue]
 * @property {number} [viewBudget]         Tokens of ledger view a sub-agent starts with.
 */

/** @param {ResearchContext} ctx */
export function ledgerOf(ctx) {
  if (ctx.ledger) return ctx.ledger;
  let l = LEDGERS.get(ctx);
  if (!l) {
    // Feature and item names stay as written in sentences (OrdersPage, orderCheckout), not turned into words.
    let names = [];
    try { const p = readLineProject(ctx.root); names = [...p.features.map((f) => f.name), ...p.features.flatMap((f) => f.items.map((i) => i.name)), ...p.library.map((x) => x.name)]; } catch { /* not a Line project */ }
    l = createLedger({ file: ctx.logDir ? path.join(ctx.logDir, LEDGER_FILE) : null, names });
    LEDGERS.set(ctx, l);
  }
  return l;
}

/** The ledger as compact English inside `budget` tokens (open questions, decisions, facts newest first). */
export const ledgerView = (ctx, budget = DEFAULT_VIEW_BUDGET) => ledgerOf(ctx).view(budget).text;

export const RESEARCH_SCHEMA = Object.freeze({ type: 'function', function: { name: 'research', description: 'Ask one question about the project (what a feature has, what a file may import, who uses a file, where something is defined, which atom fits). Read-only; the answer lands in your research notes with the files that back it.', parameters: { type: 'object', properties: { question: { type: 'string', description: 'One plain-English question' }, feature: { type: 'string', description: 'The feature it is about (optional)' } }, required: ['question'] } } });

/**
 * The research tool.
 * @param {ResearchContext} ctx
 */
export function researchTool(ctx) {
  const queue = ctx.queue ?? SHARED_QUEUE;
  const chat = ctx.chat ?? ollamaChat({ ollama: ctx.ollama });
  /**
   * @param {{question?: string, feature?: string}} args @param {{turn?: number}} [at]
   */
  const handle = (args, at = {}) => queue.run(async () => {
    const ledger = ledgerOf(ctx);
    const question = String(args?.question ?? '').trim();
    const turn = Number(at.turn ?? 0);
    if (!question) return { ok: false, code: 'NO_QUESTION', sentence: 'Ask one question in plain English.' };
    // Asked before and answered: the note already there, no block or model run.
    const seen = ledger.entries.find((e) => e.kind === 'question' && e.answeredBy && jaccard(words(e.english), words(question)) >= DUPLICATE_OVERLAP);
    const known = seen && ledger.entries.find((e) => e.id === seen.answeredBy && !e.supersededBy);
    if (known) return { ok: true, via: 'ledger', answer: known.english, cites: known.cites, sentence: known.english };
    const q = ledger.openQuestion(question) ?? ledger.add({ kind: 'question', english: /[?]$/.test(question) ? question : `${question.replace(/[.!]$/, '')}?`, source: 'coder', turn });
    const block = answerWithBlocks(ctx.root, question, { feature: args?.feature });
    if (block) {
      const [head, ...rest] = block.facts;
      const a = ledger.answer(q.id, { english: head.english, cites: head.cites, source: 'block', turn });
      for (const f of rest) ledger.add({ kind: 'fact', english: f.english, cites: f.cites, source: 'block', turn });
      const answer = block.facts.map((f) => f.english).join(' ');
      return { ok: true, via: 'block', class: block.cls, block: block.block, answer, cites: [...new Set(block.facts.flatMap((f) => f.cites))], sentence: a.english };
    }
    const r = await runSubagent({ root: ctx.root, question, view: ledger.view(ctx.viewBudget ?? 400).text, chat, model: ctx.model ?? DEFAULT_RESEARCH_MODEL, maxTurns: ctx.maxTurns ?? DEFAULT_MAX_TURNS, selectTools: ctx.selectTools, tools: ctx.tools });
    for (const name of r.refused) ledger.addMiss({ english: `Research asked for a tool it was not given, ${name.replace(/_/g, ' ')}.`, key: `research-tool:${name}`, source: 'subagent', turn });
    if (!r.ok || !r.answer) {
      return { ok: false, code: 'NO_ANSWER', via: 'subagent', class: classifyQuestion(question), turns: r.turns, sentence: `Research found no answer in ${r.turns} turns; the question stays open in your notes.`, cites: r.cites };
    }
    const a = ledger.answer(q.id, { english: r.answer, cites: r.cites, source: 'subagent', turn });
    return { ok: true, via: 'subagent', turns: r.turns, answer: a.english, cites: a.cites, sentence: a.english };
  });
  return { schema: RESEARCH_SCHEMA, handle };
}

/**
 * The builder hooks behind qwen-agent.mjs's opt-in --research flag.
 * @param {ResearchContext & {viewBudget?: number}} ctx
 */
export function researchHooks(ctx) {
  const tool = researchTool(ctx);
  return {
    /** The arm's tools plus research (before finish). */
    tools: (list) => [...list.filter((t) => t.function?.name !== 'finish'), tool.schema, ...list.filter((t) => t.function?.name === 'finish')],
    /** The ledger view as one message for this turn's context (null while the ledger is empty). */
    message: () => (ledgerOf(ctx).entries.length ? { role: 'user', content: ledgerView(ctx, ctx.viewBudget ?? DEFAULT_VIEW_BUDGET) } : null),
    handles: (name) => name === 'research',
    handle: (args, turn) => tool.handle(args, { turn }),
    /** The coder's own tool result into the ledger (research answers are already there). */
    record: (name, args, result, turn) => (name === 'research' ? [] : recordToolResult(ledgerOf(ctx), name, args, result, { root: ctx.root, turn })),
  };
}
