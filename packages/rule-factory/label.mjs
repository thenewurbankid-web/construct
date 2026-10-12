// cs2 -- labelling: every miss with closed options becomes one LabelItem (contract.mjs), a closed question "which
// option was right?" with "none fits" last. The picker (jev, until Line-1 ships) answers it through Line's one decide()
// (step construct.label-miss), only while that step's profile is on with a measured win; it ships off, so today, as
// whenever the picker is not available, the rules answer what they can and the result says so in one sentence. A person's own answer (they overrode the static choice) is the label already.
// Claude's labelling is optional and offline: `labellingJsonl` writes the items as JSONL for a person or Claude to
// fill in (`correct`, `labelledBy`), and `importLabelling` reads them back, refusing any answer outside the options.
// jev's and the rules' answers are in the file too, for review; a person overrides one by changing `labelledBy`.
import { NONE_FITS, assertLabelItem } from './contract.mjs';

/** The intent verbs a drafter word can stand for (the lexicon's everyday verbs). */
export const WORD_VERBS = Object.freeze(['add', 'remove', 'promote', 'update', 'fix']);
/** The handler shapes the static templates write (lexicon.mjs HANDLER_SHAPES). */
export const WORD_HANDLERS = Object.freeze(['log', 'navigate', 'call', 'set']);
/** The Line AI step labelling runs as (packages/core/ai-profiles.json). */
export const LABEL_STEP = 'construct.label-miss';

const objectOf = (intent) => String(intent ?? '').split('.')[1] ?? null;
const verbOf = (intent) => {
  const v = String(intent ?? '').split('.')[0];
  return WORD_VERBS.includes(v) ? v : null;
};

/**
 * The closed options for a word the drafter could not read in a request of `intent`.
 * @param {string} intent
 * @returns {string[]}
 */
export function wordOptions(intent) {
  const obj = objectOf(intent);
  return [
    ...WORD_VERBS.map((v) => `verb:${v}`), 'grammar',
    ...(obj ? [`catalog:${obj}`] : []),
    ...(obj === 'handler' ? WORD_HANDLERS.map((h) => `handler:${h}`) : []),
    NONE_FITS,
  ];
}

/** An option id in plain words, for jev and for people. @param {string} id @returns {string} */
export function optionLabel(id) {
  if (id === NONE_FITS) return 'None of these fits';
  const [k, v] = id.split(':');
  if (k === 'verb') return `It asks to ${v} something`;
  if (k === 'grammar') return 'It is an everyday word that names nothing';
  if (k === 'catalog') return `It is a business word for a ${v.replace(/-/g, ' ')}`;
  if (k === 'handler') return `It says what a handler does: ${v}`;
  return id;
}

/**
 * What the rules say about a drafter word. When the drafter got the request's intent right, the word it could not read
 * named nothing it needed: grammar. When it missed the intent's verb, the first word it could not read stands for that
 * verb. Anything else the rules cannot tell (null).
 * @param {{words: string[], intent: string, drafted: string|null}} ctx @param {string} word
 * @returns {string|null}
 */
export function rulesForWord(ctx, word) {
  if (ctx.drafted === ctx.intent) return 'grammar';
  const v = verbOf(ctx.intent);
  return v && verbOf(ctx.drafted) !== v && ctx.words[0] === word ? `verb:${v}` : null;
}

/**
 * The label items for a set of miss records. Hits, and misses with no closed options, have none.
 * @param {import('./contract.mjs').MissRecord[]} records
 * @returns {import('./contract.mjs').LabelItem[]}
 */
export function labelItemsOf(records) {
  /** @type {import('./contract.mjs').LabelItem[]} */
  const out = [];
  for (const r of records) {
    if (!r.miss) continue;
    if (r.source === 'drafter') {
      const ctx = { words: r.context?.words ?? [], intent: r.context?.intent ?? '', drafted: r.staticChoice };
      for (const word of ctx.words) {
        const rulesSaid = rulesForWord(ctx, word);
        out.push({
          id: `${r.id}:${word}`, missId: r.id, source: r.source, step: r.step, kind: r.kind ?? null,
          question: `In "${r.context?.request ?? ''}", what does "${word}" stand for?`,
          options: wordOptions(ctx.intent), chosen: null, correct: null, labelledBy: null, rulesSaid,
          facts: [`The request asks for ${ctx.intent}.`, `The drafter read it as ${ctx.drafted ?? 'nothing'}.`, `The drafter could not read "${word}".`],
          about: { word, caseId: r.ref.caseId, intent: ctx.intent },
        });
      }
      continue;
    }
    const opts = (r.options ?? []).filter((o) => o !== NONE_FITS);
    if (!opts.length) continue;
    const options = [...opts, NONE_FITS];
    const known = r.correct !== undefined && r.correct !== null && options.includes(r.correct) ? r.correct : null;
    const byPerson = known !== null && (r.decidedBy === 'person' || r.decidedBy === 'agent');
    out.push({
      id: r.id, missId: r.id, source: r.source, step: r.step, kind: r.kind ?? null,
      question: /\?$/.test(r.context?.question ?? '') ? String(r.context?.question) : 'Which option was right?',
      options, chosen: r.staticChoice, correct: byPerson ? known : null, labelledBy: byPerson ? 'person' : null, rulesSaid: known,
      facts: [r.sentence, ...(r.staticChoice ? [`Static code chose ${r.staticChoice}.`] : [])],
      about: { ...(r.context?.rule ? { rule: r.context.rule } : {}) },
    });
  }
  return out.map(assertLabelItem);
}

/**
 * Label the items: a person's answer stands; jev answers the rest through decide(); when jev is not available the rules
 * answer what they can. Never throws for a model problem.
 * @param {import('./contract.mjs').LabelItem[]} items
 * @param {{decide?: (step: string, options: any[], context: any) => Promise<any>, off?: string}} [o] `decide`: Line's decide()
 *   (default: the process's decider); `off`: jev is turned off for this run, and why (decide is not called).
 * @returns {Promise<{items: import('./contract.mjs').LabelItem[], by: Record<string, number>, agreement: {both: number, agree: number}, via: 'jev'|'rules', sentence: string}>}
 */
export async function labelWithJev(items, o = {}) {
  const decide = o.off ? async () => null : o.decide ?? (await import('@line/construct-core/line-decide')).decide;
  /** @type {string|null} */
  let note = o.off ?? null;
  let jevAnswered = 0;
  const out = [];
  for (const it of items) {
    if (it.labelledBy) { out.push(it); continue; }
    let d = null;
    try {
      d = await decide(LABEL_STEP, it.options.map((id) => ({ id, label: optionLabel(id) })), { question: it.question, facts: it.facts });
    } catch (e) {
      note ??= `Labelling with jev failed (${String(/** @type {any} */ (e)?.message ?? e).split('\n')[0]}).`;
    }
    if (d && d.via === 'jev' && it.options.includes(d.choice)) {
      jevAnswered += 1;
      out.push({ ...it, correct: d.choice, labelledBy: 'jev' });
      continue;
    }
    if (d?.attribution?.note) note ??= d.attribution.note;
    else if (d && d.via !== 'jev') note ??= `the ${LABEL_STEP} step is off in its profile (no measured win over static)`;
    out.push(it.rulesSaid ? { ...it, correct: it.rulesSaid, labelledBy: 'rules' } : it);
  }
  const by = { jev: 0, rules: 0, person: 0, claude: 0, unlabelled: 0 };
  for (const it of out) by[it.labelledBy ?? 'unlabelled'] += 1;
  const both = out.filter((it) => it.labelledBy === 'jev' && it.rulesSaid !== null);
  const agreement = { both: both.length, agree: both.filter((it) => it.correct === it.rulesSaid).length };
  const via = jevAnswered > 0 ? 'jev' : 'rules';
  const left = by.unlabelled ? ` ${by.unlabelled} stay unlabelled for a person or Claude (labelling JSONL).` : '';
  const sentence = !items.length ? 'There were no misses with closed options to label.' : via === 'jev'
    ? `jev labelled ${by.jev} of ${items.length} misses; the rules labelled ${by.rules} and people ${by.person}.${left}`
    : `jev was not available (${String(note ?? 'it gave no answer').replace(/\.$/, '')}), so the rules labelled ${by.rules} of ${items.length} misses and people ${by.person}.${left}`;
  return { items: out.map(assertLabelItem), by, agreement, via, sentence };
}

/**
 * The items as labelling JSONL, one item per line, for a person or Claude to fill in `correct` (one of `options`) and
 * `labelledBy` ("person" or "claude"). Offline: nothing is sent anywhere.
 * @param {import('./contract.mjs').LabelItem[]} items
 * @returns {string}
 */
export function labellingJsonl(items) {
  return items.map((it) => JSON.stringify({ ...it, optionLabels: Object.fromEntries(it.options.map((id) => [id, optionLabel(id)])) })).join('\n') + (items.length ? '\n' : '');
}

/**
 * Read a filled labelling JSONL back over the items. A line for an unknown item, an answer outside its options, or a
 * labeller other than a person or Claude is refused with a sentence; an empty answer leaves the item as it was.
 * @param {string} text
 * @param {import('./contract.mjs').LabelItem[]} items
 * @returns {{items: import('./contract.mjs').LabelItem[], imported: number, refused: {line: number, sentence: string}[]}}
 */
export function importLabelling(text, items) {
  const byId = new Map(items.map((it) => [it.id, it]));
  const refused = [];
  let imported = 0;
  String(text).split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let x;
    try { x = JSON.parse(line); } catch { refused.push({ line: i + 1, sentence: `Line ${i + 1} is not JSON.` }); return; }
    const it = byId.get(x?.id);
    if (!it) { refused.push({ line: i + 1, sentence: `Line ${i + 1} names no miss Line knows.` }); return; }
    // jev's and the rules' own answers are written for people to review; reading them back changes nothing.
    if (x.correct === null || x.correct === undefined || x.correct === '' || x.labelledBy === 'jev' || x.labelledBy === 'rules') return;
    if (!it.options.includes(x.correct)) { refused.push({ line: i + 1, sentence: `Line ${i + 1} answers "${x.correct}", which is not one of its options.` }); return; }
    if (x.labelledBy !== 'person' && x.labelledBy !== 'claude') { refused.push({ line: i + 1, sentence: `Line ${i + 1} must say it was labelled by a person or Claude.` }); return; }
    byId.set(it.id, assertLabelItem({ ...it, correct: x.correct, labelledBy: x.labelledBy }));
    imported += 1;
  });
  return { items: items.map((it) => /** @type {any} */ (byId.get(it.id))), imported, refused };
}
