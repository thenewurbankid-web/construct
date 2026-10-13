// #936 -- the research ledger: ONE central reasoning memory per builder run, shared by the coder and every research
// sub-agent. Each entry is one plain-English sentence with the files it cites: a fact, a decision, an open question,
// or a miss (something asked for that no block or tool could give). Pruning is deterministic, never a model:
//   1. a superseded entry and an answered question leave the view (they stay in the JSON for the record);
//   2. duplicate facts merge: same cites and near-identical sentences (word Jaccard over line-atoms `words`, the same
//      Jaccard Line's memory recall uses) keep the newest;
//   3. over budget, old facts about one file collapse into one summary sentence that supersedes them;
//   4. still over budget, the oldest facts, then misses, then decisions leave the view (open questions last).
// Sentences go through packages/summarize (plainSentence -> checkSentence), the same rules every user-facing sentence
// in Line keeps. Persisted as JSON in the run's log folder (tmp + rename) so it survives turns and restarts.
//
// Reused, not rebuilt: summarize's sentence rules, line-atoms' `words` and memory/recall's `jaccard`. Not reused: the
// rule-factory's / @mx/reason's reason ledger (collect.mjs missesFromLedger) and GateLM's draft ledger
// (gatelm.reasoning): both are decision-ladder records (options, picked, decider per request) for scoring a chooser,
// not English findings with cites a model reads back; a ledger `miss` here is shaped so the rule factory can read it
// (see `toMissRecords`).
import fs from 'node:fs';
import path from 'node:path';
import { plainSentence, checkSentence } from '@line/summarize';
import { words } from '@line/atoms';
import { jaccard } from '../memory/recall.mjs';

export const LEDGER_VERSION = 1;
export const LEDGER_FILE = 'research-ledger.json';
export const ENTRY_KINDS = Object.freeze(['fact', 'decision', 'question', 'miss']);
export const ENTRY_SOURCES = Object.freeze(['block', 'subagent', 'coder']);
/** Two facts with the same cites whose word sets overlap this much are one fact. */
export const DUPLICATE_OVERLAP = 0.6;
/** The newest facts are never collapsed into a summary. */
export const KEEP_RECENT_FACTS = 3;

/**
 * @typedef {'fact'|'decision'|'question'|'miss'} EntryKind
 * @typedef {'block'|'subagent'|'coder'} EntrySource
 * @typedef {object} LedgerEntry
 * @property {string} id         e1, e2, ... in the order added.
 * @property {EntryKind} kind
 * @property {string} english    One sentence that passes checkSentence.
 * @property {string[]} cites    path or path:line.
 * @property {EntrySource} source
 * @property {number} turn       The builder turn it was added on.
 * @property {string} [supersedes] The id of the entry it replaces.
 * @property {string[]} [merged]   Ids a summary or a dedupe folded into it.
 * @property {string} [answers]    For a fact: the question it answers.
 * @property {string} [answeredBy] For a question: the fact that answers it.
 * @property {string} [supersededBy]
 * @property {string} [rule]       A rule or refusal code that backs it (kept out of the sentence: raw ids go in details).
 * @property {string} [key]        For a miss: what was attempted (tool + args), so a repeat folds into one entry.
 * @property {number} [count]      For a miss: how many times it was attempted.
 */

/**
 * About four characters a token: the estimate the builder's context budget uses.
 * @param {string} text
 * @returns {number}
 */
export const estimateTokens = (text) => Math.ceil(String(text ?? '').length / 4);

/**
 * One sentence that keeps the summarize rules: plainSentence's repair when the text does not pass as written.
 * @param {string} text @param {string[]} [names]
 * @returns {string}
 */
export function ledgerSentence(text, names = []) {
  const s = String(text ?? '').trim().replace(/\s+/g, ' ');
  if (checkSentence(s, { names }).ok) return s;
  return plainSentence(s, names).sentence;
}

const fileOf = (cite) => String(cite).replace(/:\d+(?::\d+)?$/, '');
const citeKey = (cites) => [...new Set(cites.map(String))].sort().join('|');

/** @param {any} e @returns {LedgerEntry} */
function assertEntry(e, names = []) {
  if (!ENTRY_KINDS.includes(e.kind)) throw new TypeError(`A ledger entry is a fact, a decision, a question or a miss, not "${e.kind}".`);
  if (!ENTRY_SOURCES.includes(e.source)) throw new TypeError(`A ledger entry comes from a block, a sub-agent or the coder, not "${e.source}".`);
  if (!checkSentence(e.english, { names }).ok) throw new TypeError(`A ledger entry is one plain sentence: "${e.english}".`);
  if (!Array.isArray(e.cites) || e.cites.some((c) => typeof c !== 'string' || !c)) throw new TypeError('A ledger entry cites paths as strings.');
  return e;
}

/**
 * A ledger, in memory, optionally stored at `file` (read back when it exists).
 * @param {{file?: string|null, names?: string[]}} [o] `names`: feature and item names kept as written in sentences.
 * @returns {any} add, addMiss, supersede, answer, openQuestion, prune, view, viewEntries, save, file, entries.
 */
export function createLedger({ file = null, names = [] } = {}) {
  /** @type {LedgerEntry[]} */
  let entries = [];
  if (file) {
    try {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (doc?.version === LEDGER_VERSION && Array.isArray(doc.entries)) entries = doc.entries.map((e) => assertEntry(e, names));
    } catch { /* a new ledger */ }
  }
  let next = entries.reduce((n, e) => Math.max(n, Number(e.id.slice(1)) || 0), 0) + 1;
  const byId = (id) => entries.find((e) => e.id === id);
  const live = (e) => !e.supersededBy && !(e.kind === 'question' && e.answeredBy);

  const save = () => {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ version: LEDGER_VERSION, entries }, null, 1)}\n`);
    fs.renameSync(tmp, file);
  };

  /**
   * Add one entry. A fact that duplicates a live fact (same cites, near-identical words) supersedes it.
   * @param {{kind: EntryKind, english: string, cites?: string[], source: EntrySource, turn?: number, supersedes?: string, answers?: string, rule?: string, key?: string, count?: number}} x
   * @returns {LedgerEntry}
   */
  const add = (x) => {
    const e = assertEntry({ id: `e${next}`, kind: x.kind, english: ledgerSentence(x.english, names), cites: [...new Set((x.cites ?? []).map(String))], source: x.source, turn: Number(x.turn ?? 0), ...(x.supersedes ? { supersedes: x.supersedes } : {}), ...(x.answers ? { answers: x.answers } : {}), ...(x.rule ? { rule: String(x.rule) } : {}), ...(x.key ? { key: String(x.key) } : {}), ...(x.count ? { count: Number(x.count) } : {}) }, names);
    next += 1;
    if (e.supersedes) {
      const old = byId(e.supersedes);
      if (!old) throw new TypeError(`There is no ledger entry ${e.supersedes} to replace.`);
      old.supersededBy = e.id;
    }
    if (e.kind === 'fact' && !e.supersedes) {
      const dup = entries.find((o) => live(o) && o.kind === 'fact' && citeKey(o.cites) === citeKey(e.cites) && jaccard(words(o.english), words(e.english)) >= DUPLICATE_OVERLAP);
      if (dup) { dup.supersededBy = e.id; e.supersedes = dup.id; e.merged = [dup.id, ...(dup.merged ?? [])]; }
    }
    entries.push(e);
    save();
    return e;
  };

  /** Replace entry `id` with a new sentence (same kind unless given). */
  const supersede = (id, x) => {
    const old = byId(id);
    if (!old) throw new TypeError(`There is no ledger entry ${id} to replace.`);
    return add({ kind: old.kind, cites: old.cites, source: old.source, turn: old.turn, ...x, supersedes: id });
  };

  /** Answer an open question: a fact that answers it; the question leaves the view. */
  const answer = (questionId, x) => {
    const q = byId(questionId);
    if (!q || q.kind !== 'question') throw new TypeError(`There is no question ${questionId} to answer.`);
    const f = add({ kind: 'fact', source: x.source ?? 'subagent', turn: x.turn ?? q.turn, english: x.english, cites: x.cites ?? [], answers: questionId });
    q.answeredBy = f.id;
    save();
    return f;
  };

  /**
   * Add a miss; the same attempt again (same `key`) supersedes the earlier miss with one entry and a count
   * ("..., tried 3 times."), so repeated failures cost one line.
   * @param {{english: string, key: string, cites?: string[], source?: EntrySource, turn?: number, rule?: string}} x
   */
  const addMiss = (x) => {
    const base = ledgerSentence(x.english, names).replace(/[.?!]$/, '');
    const prev = entries.find((e) => e.kind === 'miss' && !e.supersededBy && e.key === x.key);
    const count = (prev?.count ?? 0) + 1;
    return add({ kind: 'miss', english: count > 1 ? `${base}, tried ${count} times.` : `${base}.`, cites: x.cites ?? [], source: x.source ?? 'coder', turn: x.turn, rule: x.rule, key: x.key, count, ...(prev ? { supersedes: prev.id } : {}) });
  };

  /** The open question with these words, if one is already asked (so a repeat is not asked twice). */
  const openQuestion = (english) => entries.find((e) => e.kind === 'question' && live(e) && jaccard(words(e.english), words(english)) >= DUPLICATE_OVERLAP) ?? null;

  /**
   * Collapse old facts per file into one summary fact each (oldest first) until the view fits `budgetTokens`.
   * Mutates the ledger (the summary supersedes what it folds) and saves it. Returns the ids folded.
   * @param {number} budgetTokens
   */
  const prune = (budgetTokens) => {
    const folded = [];
    if (estimateTokens(render(viewEntries())) <= budgetTokens) return folded;
    const facts = entries.filter((e) => live(e) && e.kind === 'fact');
    const recent = new Set(facts.slice(-KEEP_RECENT_FACTS).map((e) => e.id));
    /** @type {Map<string, LedgerEntry[]>} */
    const byFile = new Map();
    for (const f of facts) {
      if (recent.has(f.id) || !f.cites.length) continue;
      const k = fileOf(f.cites[0]);
      byFile.set(k, [...(byFile.get(k) ?? []), f]);
    }
    // Biggest groups first: they save the most.
    for (const [file, group] of [...byFile].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
      if (group.length < 2) continue;
      // Shorter than its parts: the file's own name leaves each sentence ("OrdersPage renders ..." -> "renders ..."),
      // the line numbers leave the cites, and the sentence is capped.
      const stem = path.posix.basename(file).replace(/\.\w+$/, '');
      const parts = group.map((g) => g.english.replace(/[.?!]$/, '').replace(new RegExp(`^(?:The )?${stem.replace(/[$.]/g, '\\$&')}(?:\\.\\w+)?\\s+`), '')).map((s) => s.charAt(0).toLowerCase() + s.slice(1));
      let text = `Earlier notes on ${file}: ${parts.join('; ')}.`;
      if (text.length > 180) text = `${text.slice(0, 176).replace(/[;,]?\s+\S*$/, '')}, and more.`;
      const s = add({ kind: 'fact', source: 'block', turn: Math.max(...group.map((g) => g.turn)), english: text, cites: [...new Set(group.flatMap((g) => g.cites.map(fileOf)))] });
      s.merged = group.map((g) => g.id);
      for (const g of group) g.supersededBy = s.id;
      // The summary is the oldest knowledge about the file, so it sorts where its newest part was.
      entries.splice(entries.indexOf(s), 1);
      entries.splice(Math.max(...group.map((g) => entries.indexOf(g))) + 1, 0, s);
      folded.push(...s.merged);
      save();
      if (estimateTokens(render(viewEntries())) <= budgetTokens) break;
    }
    return folded;
  };

  /** Live entries in view order: open questions, decisions newest first, facts newest first, misses newest first. */
  const viewEntries = () => {
    const l = entries.filter(live);
    const newest = (k) => l.filter((e) => e.kind === k).reverse();
    return [...l.filter((e) => e.kind === 'question'), ...newest('decision'), ...newest('fact'), ...newest('miss')];
  };

  /**
   * The ledger as compact English inside `budgetTokens`: prune first, then leave out the lowest-priority lines
   * (oldest facts, then misses, then decisions; open questions go last).
   * @param {number} [budgetTokens]
   * @returns {{text: string, tokens: number, shown: number, hidden: number}}
   */
  const view = (budgetTokens = 600) => {
    prune(budgetTokens);
    let shown = viewEntries();
    const total = shown.length;
    const dropOrder = ['fact', 'miss', 'decision', 'question'];
    while (shown.length && estimateTokens(render(shown, total - shown.length)) > budgetTokens) {
      const kind = dropOrder.find((k) => shown.some((e) => e.kind === k));
      // The last of a kind in view order is its oldest.
      let idx = -1;
      shown.forEach((e, i) => { if (e.kind === kind) idx = i; });
      shown = shown.filter((_, i) => i !== idx);
    }
    const text = render(shown, total - shown.length);
    return { text, tokens: estimateTokens(text), shown: shown.length, hidden: total - shown.length };
  };

  return { add, addMiss, supersede, answer, openQuestion, prune, view, viewEntries, save, file, get entries() { return entries.slice(); } };
}

/**
 * The view's shape, stable for the turn builder (line/builder-context): the header line, then one line per entry
 * `- <Label>: <sentence> [<cites>; rule <rule>]` (the bracket only when there is something in it), then
 * `- <n> older notes are left out.` when the budget hid some. An empty ledger is the header plus `- None yet.`
 */
export const VIEW_HEADER = 'Research notes (what is known so far; cite these instead of reading again):';
export const VIEW_LABELS = Object.freeze({ question: 'Open question', decision: 'Decided', fact: 'Known', miss: 'Missing' });
/** @param {LedgerEntry} e */
const refs = (e) => {
  const parts = [...(e.cites.length ? [`${e.cites.slice(0, 3).join(', ')}${e.cites.length > 3 ? `, +${e.cites.length - 3}` : ''}`] : []), ...(e.rule ? [`rule ${e.rule}`] : [])];
  return parts.length ? ` [${parts.join('; ')}]` : '';
};
/** @param {LedgerEntry[]} list @param {number} [hidden] */
function render(list, hidden = 0) {
  const lines = list.map((e) => `- ${VIEW_LABELS[e.kind]}: ${e.english}${refs(e)}`);
  if (!list.length && !hidden) lines.push('- None yet.');
  return [VIEW_HEADER, ...lines, ...(hidden ? [`- ${hidden} older note${hidden === 1 ? ' is' : 's are'} left out.`] : [])].join('\n');
}

/**
 * The ledger's misses as the rule factory's miss records (packages/rule-factory/contract.mjs), so research misses can
 * feed it like the reason ledger's do.
 * @param {LedgerEntry[]} entries @param {string} [file]
 * @returns {any[]}
 */
export function toMissRecords(entries, file = LEDGER_FILE) {
  return entries.filter((e) => e.kind === 'miss').map((e) => ({ id: `research:${e.id}`, source: /** @type {const} */ ('miss-report'), step: 'research', decidedBy: /** @type {const} */ ('none'), miss: true, staticChoice: null, finalChoice: null, sentence: e.english, ref: { file }, label: null }));
}
