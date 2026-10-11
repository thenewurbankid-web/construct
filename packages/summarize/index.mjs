// cs1 -- summarize(input): the one place Line makes the text a person reads (contract.mjs). Pure and static: no model,
// no fs, so the engine, the server and the contract's in-browser mock all share it. Every sentence it answers passes
// checkSentence; anything technical (a tool call, an id, code, options with confidence, the reasoning) goes to
// `details`, which Cockpit shows under a collapsed Details (<PlainFirst>).
//
// Code written as Smith chains (`order.is().paid()`, `order.will().ship()`) reads as English through atomic-codemod's
// to-english step; links.mjs runs that step through packages/line-links and hands its output here as {kind: 'code'}.
import { ID_PATTERNS, TOOL_WORDS, checkSentence, camelToWords, rawIds, slotTokens, slotWords } from './check.mjs';
import { SMITH_CONNECTORS, SUMMARY_KINDS, assertSummary } from './contract.mjs';

export { checkSentence, slotWords, camelToWords, SMITH_CONNECTORS, SUMMARY_KINDS, assertSummary };

const PREFIX_WORDS = { step: 'a step', ses: 'this session', plan: 'this plan', fix: 'a fix', run: 'a run', req: 'a request', msg: 'a message' };
/** What each ID_PATTERNS entry is called in a sentence, in the same order. */
const ID_WORDS = [
  () => 'an id',
  () => 'a commit',
  (m) => (TOOL_WORDS[m] ? `"${TOOL_WORDS[m]}"` : `"${camelToWords(m.split('.').pop()).replace(/^./, (c) => c.toUpperCase())}"`),
  () => 'a rule',
  (m) => PREFIX_WORDS[/^[a-z]+/.exec(m)?.[0] ?? ''] ?? 'an id',
  () => 'a spec point',
  () => 'a finding',
];

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const stop = (s) => (/[.?!]["')]?$/.test(s) ? s : `${s}.`);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One sentence made plain: raw ids said as words (and returned, for Details), slot names as words, a capital and a
 * full stop. Answers a sentence that passes checkSentence. `names` (item and feature names) stay as written.
 * @param {string} text
 * @param {string[]} [names]
 * @returns {{sentence: string, ids: string[]}}
 */
export function plainSentence(text, names = []) {
  let s = String(text ?? '').trim().replace(/\s+/g, ' ');
  const ids = rawIds(s);
  ID_PATTERNS.forEach((re, i) => {
    s = s.replace(new RegExp(re.source, re.flags), (m) => ID_WORDS[i](m));
  });
  for (const slot of slotTokens(s).filter((w) => !names.includes(w))) s = s.replace(new RegExp(`\\b${escape(slot)}\\b`, 'g'), slotWords(slot));
  const ok = (t) => checkSentence(t, { names }).ok;
  s = stop(names.some((n) => s.startsWith(n)) ? s : capital(s));
  if (!ok(s)) s = stop(`Line says: ${s.replace(/[.?!]$/, '')}`);
  if (!ok(s)) s = 'Line has a message for you; the full text is under Details.';
  return { sentence: s, ids };
}

/** Split a paragraph into sentences (a full stop, question or exclamation mark followed by a space). */
export const splitSentences = (text) => String(text ?? '').trim().split(/(?<!\b(?:e\.g|i\.e|etc|vs)\.)(?<=[.?!])\s+(?=["'(]?[A-Za-z0-9])/).filter(Boolean);

/** Plain sentences for a paragraph, plus the raw ids it named (as one Details entry). */
function plainParagraph(texts, names = []) {
  const sentences = [];
  const ids = [];
  // A one-word fragment ("Saved.") leads the sentence after it ("Saved: Creates StatusBadge ..."), the way
  // "Waiting for your approval: ..." reads, instead of standing alone as a fragment.
  const parts = texts.flatMap(splitSentences).reduce((acc, part) => {
    const prev = acc[acc.length - 1];
    if (prev !== undefined && /^\S+[.!]$/.test(prev)) acc[acc.length - 1] = `${prev.slice(0, -1)}: ${part}`;
    else acc.push(part);
    return acc;
  }, /** @type {string[]} */ ([]));
  for (const part of parts) {
    const p = plainSentence(part, names);
    sentences.push(p.sentence);
    ids.push(...p.ids);
  }
  return { sentences: sentences.length ? sentences : ['Line has nothing to say about this yet.'], ids: [...new Set(ids)] };
}

const idsDetail = (ids) => (ids.length ? [{ label: 'Ids', text: ids.join(', ') }] : []);
const json = (v) => JSON.stringify(v);
const optionText = (o) => `${o.id}: ${o.sentence}${typeof o.confidence === 'number' ? ` (confidence ${o.confidence.toFixed(2)})` : ''}${o.recommended ? ' (recommended)' : ''}`;

/** The plan-only fields a tool call does not show (planTools requestOf). */
const requestOf = (args) => { const { expect: _e, retry: _r, fixOf: _f, ...req } = args ?? {}; return req; };

function planStep({ step }) {
  const { sentences, ids } = plainParagraph([step.sentence]);
  const r = step.result && typeof step.result === 'object' ? step.result : null;
  const details = [
    { label: 'Tool call', text: `${step.tool}(${json(requestOf(step.args))})` },
    { label: 'Step', text: `${step.id} (step ${step.n}, ${step.state})` },
    ...(r && Array.isArray(r.checks) ? r.checks.map((c) => ({ label: 'Check', text: `${c.ok ? 'Passed' : 'Failed'}: ${c.sentence}` })) : []),
    ...(r && r.apply && Array.isArray(r.apply.files) ? r.apply.files.map((f) => ({ label: 'File written', text: f })) : []),
    ...(r && Array.isArray(r.options) ? r.options.map((o) => ({ label: 'Option', text: optionText({ id: o.fixId ?? o.id, sentence: o.sentence, recommended: o.recommended }) })) : []),
    ...idsDetail(ids),
  ];
  return { sentences, details };
}

function finding({ finding: f }) {
  const { sentences, ids } = plainParagraph([f.sentence]);
  return {
    sentences,
    details: [
      { label: 'Rule', text: f.rule },
      { label: 'Where', text: `${f.file}:${f.line}` },
      ...(f.key ? [{ label: 'Finding key', text: f.key }] : []),
      ...(f.fixes ?? []).map((x) => ({ label: 'Fix', text: optionText({ id: x.id, sentence: x.sentence, recommended: x.rank === 1 }) })),
      ...idsDetail(ids.filter((i) => i !== f.rule)),
    ],
  };
}

function feature({ name, sentences: given, names = [] }) {
  const { sentences, ids } = plainParagraph(given, [name, ...names]);
  return { sentences, details: [{ label: 'Feature', text: name }, { label: 'Written by', text: 'static rules from the feature items, their bases and their imports (no model)' }, ...idsDetail(ids)] };
}

function status({ text, details = [] }) {
  const { sentences, ids } = plainParagraph([text]);
  return { sentences, details: [...details, ...idsDetail(ids)] };
}

const FROM = { oracle: 'Oracle', trace: 'Trace', gatelm: 'GateLM', reasoning: 'The reasoning log', line: 'Line' };

function message({ from, text, details = [], options = [], reasoning }) {
  const { sentences, ids } = plainParagraph([text]);
  return {
    sentences,
    details: [
      { label: 'From', text: FROM[from] ?? String(from) },
      ...details,
      ...options.map((o) => ({ label: 'Option', text: optionText(o) })),
      ...(reasoning ? [{ label: 'Reasoning', text: reasoning }] : []),
      ...idsDetail(ids),
    ],
  };
}

/** One to-english line as a sentence: "if a: b" -> "If a, b."; "return x" -> "It returns x."; "let x be y" stays. */
function codeLine(english) {
  const t = String(english).replace(/^return\b/, 'it returns').replace(/: /g, ', ').replace(/; then /g, ', then ');
  return plainSentence(t).sentence;
}

function code({ english, code: source }) {
  if (!english || !english.title) return { sentences: ['This code could not be put into words; it is under Details.'], details: source ? [{ label: 'Code', text: source }] : [] };
  const steps = english.steps ?? [];
  const head = plainSentence(`${english.title} works in ${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`).sentence;
  return {
    sentences: [head, ...steps.map((s) => codeLine(s.english))],
    details: [...(source ? [{ label: 'Code', text: source }] : []), ...steps.map((s, i) => ({ label: `Step ${i + 1} code`, text: s.code }))],
  };
}

const MAKERS = { 'plan-step': planStep, finding, feature, status, message, code };

/**
 * The plain-English summary of one input. Never throws for a known kind; an unknown kind answers one sentence
 * saying so, with the input under Details.
 * @param {import('./contract.mjs').SummaryInput} input
 * @returns {import('./contract.mjs').Summary}
 */
export function summarize(input) {
  const make = MAKERS[/** @type {any} */ (input)?.kind];
  const out = make
    ? make(/** @type {any} */ (input))
    : { sentences: ['Line cannot put this into words yet; it is under Details.'], details: [{ label: 'Input', text: json(input) }] };
  const names = input?.kind === 'feature' ? [input.name, ...(input.names ?? [])] : [];
  return assertSummary({ sentences: out.sentences, details: out.details, via: 'static' }, (t) => checkSentence(t, { names }));
}

/** Plain sentences only (for callers that keep their own Details, like the feature summary). */
export const plainSentences = (sentences, names = []) => plainParagraph(sentences, names).sentences;
