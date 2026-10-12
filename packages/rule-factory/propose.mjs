// cs2 -- rule proposals: candidate static rules made from labelled misses. Each one is data (a lexicon addition merged
// by the drafter's mergeLexicon, or a fix-ranking rule read by fixRanking.mjs), the misses it came from and its own
// test case. Nothing is applied here: a proposal ships only through the accuracy gate (gate.mjs) and a person running
// `construct line rules apply`.
//
//   label (drafter word)        proposal
//   verb:<verb>                 verb      the word means <verb> (everyday verbs) and never becomes a question (grammar)
//   grammar                     grammar   the word names nothing (everyday grammar)
//   handler:<shape>             handler   the word asks for a handler of that shape (the handler templates read it)
//   catalog:<object>            catalog   a business word for <object> (a lexicon entry; its role is the role the
//                                         lexicon already uses most for that object)
//   a fix id (a fix choice)     fix-rank  for that rule, the right fix's family ranks above the one static code chose
// "none fits", unlabelled items and steps with no kind of static rule yet make no proposal (counted, with a sentence).
import crypto from 'node:crypto';
import { NONE_FITS, PROPOSAL_KINDS, assertRuleProposal } from './contract.mjs';

const fixFamily = (id) => String(id).split(':')[0];
const idOf = (kind, change) => `rp-${crypto.createHash('sha256').update(`${kind}\n${JSON.stringify(change)}`).digest('hex').slice(0, 12)}`;
/** A stable held-out flag for a fix item (about a third of them), so a fix-rank proposal has a held-out score too. */
export const heldOutItem = (id) => parseInt(crypto.createHash('sha256').update(`rule-factory:${id}`).digest('hex').slice(0, 8), 16) % 3 === 0;

/**
 * The role the lexicon uses most for an object (ties: the first in the lexicon's roles), or null.
 * @param {any} lexicon @param {string} object
 * @returns {string|null}
 */
export function roleFor(lexicon, object) {
  const count = new Map();
  for (const e of lexicon.entries) if (e.object === object) count.set(e.role, (count.get(e.role) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || lexicon.roles.indexOf(a[0]) - lexicon.roles.indexOf(b[0]))[0]?.[0] ?? null;
}

/** Is the word already where the change would put it? */
function alreadyThere(lexicon, kind, word, value) {
  const ev = lexicon.everyday ?? { grammar: [], verbs: {}, handlers: {} };
  if (kind === 'verb') return (ev.verbs[value] ?? []).includes(word);
  if (kind === 'grammar') return ev.grammar.includes(word);
  if (kind === 'handler') return (ev.handlers[value] ?? []).includes(word);
  return lexicon.entries.some((e) => e.word === word || e.synonyms.includes(word));
}

/**
 * Proposals from labelled items.
 * @param {import('./contract.mjs').LabelItem[]} items
 * @param {{lexicon: any}} o The lexicon in force (to skip what is already there and to pick a catalog role).
 * @returns {{proposals: import('./contract.mjs').RuleProposal[], skipped: {reason: string, count: number, sentence: string}[]}}
 */
export function proposeRules(items, o) {
  const groups = new Map();
  const skip = new Map();
  const skipped = (reason, sentence) => { const s = skip.get(reason) ?? { reason, count: 0, sentence }; s.count += 1; skip.set(reason, s); };
  const add = (kind, change, it, test, sentence) => {
    const id = idOf(kind, change);
    const g = groups.get(id) ?? { id, kind, target: PROPOSAL_KINDS[kind], change, evidence: [], test, sentence };
    g.evidence.push(it.id);
    if (g.test.kind === 'train-cases' && test.kind === 'train-cases') g.test = { kind: 'train-cases', caseIds: [...new Set([...g.test.caseIds, ...test.caseIds])] };
    if (g.test.kind === 'fix-items' && test.kind === 'fix-items') g.test = { kind: 'fix-items', items: [...g.test.items, ...test.items.filter((x) => !g.test.items.some((y) => y.id === x.id))] };
    groups.set(id, g);
  };
  for (const it of items) {
    if (it.correct === null) { skipped('unlabelled', 'Misses nobody has labelled yet make no rule.'); continue; }
    if (it.correct === NONE_FITS) { skipped('none-fits', 'Misses where none of the options fits make no rule (a new option is a person\'s call).'); continue; }
    if (it.source === 'drafter' && it.about.word) {
      const w = it.about.word;
      const [k, v] = it.correct.split(':');
      const test = { kind: /** @type {const} */ ('train-cases'), caseIds: [String(it.about.caseId)] };
      const kind = /** @type {'verb'|'grammar'|'handler'|'catalog'} */ (k);
      if (!['verb', 'grammar', 'handler', 'catalog'].includes(k)) { skipped('unknown-label', 'A label of a kind Line has no rule for makes no rule.'); continue; }
      if (alreadyThere(o.lexicon, kind, w, v)) { skipped('already-there', 'A word the lexicon already has makes no rule.'); continue; }
      if (k === 'verb') add('verb', { everyday: { verbs: { [v]: [w] }, grammar: [w] } }, it, test, `Read "${w}" as asking to ${v} something.`);
      else if (k === 'grammar') add('grammar', { everyday: { grammar: [w] } }, it, test, `Read "${w}" as an everyday word that names nothing.`);
      else if (k === 'handler') add('handler', { everyday: { handlers: { [v]: [w] }, grammar: [w] } }, it, test, `Read "${w}" as a handler that does ${v}.`);
      else {
        const role = roleFor(o.lexicon, v);
        if (!role) { skipped('no-role', 'A business word for an object the lexicon has no role for makes no rule yet.'); continue; }
        add('catalog', { entries: [{ word: w, synonyms: [], role, object: v }] }, it, test, `Add "${w}" to the lexicon as a business word for a ${v.replace(/-/g, ' ')}.`);
      }
      continue;
    }
    const rule = it.about.rule;
    if (/ fix choice$/.test(it.step) && rule && /^LINE-[A-Z]+$/.test(rule) && it.chosen) {
      const prefer = fixFamily(it.correct); const over = fixFamily(it.chosen);
      if (prefer === over || !prefer.startsWith(`${rule}/`) || !over.startsWith(`${rule}/`)) { skipped('same-fix', 'A fix choice whose right fix is of the family static code chose makes no rule.'); continue; }
      const item = { id: it.id, options: it.options.filter((x) => x !== NONE_FITS), chosen: it.chosen, correct: it.correct, heldOut: heldOutItem(it.id) };
      add('fix-rank', { rule, prefer, over }, it, { kind: 'fix-items', items: [item] }, `For ${rule}, rank "${prefer.split('/')[1]}" fixes above "${over.split('/')[1]}" fixes.`);
      continue;
    }
    skipped(`no-kind:${it.step}`, `Misses of ${it.step} have no kind of static rule yet.`);
  }
  const proposals = [...groups.values()].map((g) => assertRuleProposal({ ...g, sentence: `${g.sentence.replace(/\.$/, '')} (from ${g.evidence.length} miss${g.evidence.length === 1 ? '' : 'es'}).` }));
  proposals.sort((a, b) => b.evidence.length - a.evidence.length || a.id.localeCompare(b.id));
  return { proposals, skipped: [...skip.values()] };
}

/**
 * The static overlay (staticOverlay.mjs) that adds these proposals: lexicon changes merged in order, fix-ranking rules
 * listed.
 * @param {import('./contract.mjs').RuleProposal[]} proposals
 * @returns {import('@line/construct-engine/line/static-overlay').StaticOverlay}
 */
export function overlayOf(proposals) {
  /** @type {any} */
  const lexicon = { entries: [], everyday: { grammar: [], verbs: {}, handlers: {}, phrases: [] } };
  const fixRanking = [];
  for (const p of proposals) {
    if (p.target === 'fix-ranking') { fixRanking.push(p.change); continue; }
    lexicon.entries.push(...(p.change.entries ?? []));
    const ev = p.change.everyday ?? {};
    lexicon.everyday.grammar.push(...(ev.grammar ?? []));
    for (const [k, ws] of Object.entries(ev.verbs ?? {})) lexicon.everyday.verbs[k] = [...(lexicon.everyday.verbs[k] ?? []), ...ws];
    for (const [k, ws] of Object.entries(ev.handlers ?? {})) lexicon.everyday.handlers[k] = [...(lexicon.everyday.handlers[k] ?? []), ...ws];
    lexicon.everyday.phrases.push(...(ev.phrases ?? []));
  }
  return { lexicon, fixRanking };
}
