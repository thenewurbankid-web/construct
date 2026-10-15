// Line Import v2, the read-only English view of a written function (ENGLISH-RULES.md build step 6, fluent plan T2.4).
// The app keeps its typed code (decision 2, revised); line.import.writeAtoms also produces the function's English view:
// every atom call of the written body as its fluent sentence (`plus(a, b)` -> `adds(a).to(b)`), innermost first, so a
// sentence can hold another. A call the catalog's sentence cannot take stays as code, with the reason. Generated, never
// edited: it is rewritten whenever the function is. No model involved: deterministic.
//
//   loadFluentForm(file?)                 -> {ok: true, explainFluent} | {ok: false, reason}   (packages/line-codemod)
//   englishWriter(catalog, form?)         -> {ok: true, explain(callText) -> {sentence, reason}} | {ok: false, reason}
//   englishViewOf(fn, writer)             -> EnglishView (importV2/contract.mjs)
//
// fluent-form.js (T2.1a: toFluent/explainFluent/fluentFor) is read through loadFluentForm, a small adapter: when the
// file is not on this tree the view is `off` with one sentence and the write carries on.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ts } from '@construct/ast';
import { assertEnglishView } from './contract.mjs';

/** T2.1a's fluent writer (ENGLISH-RULES build step 5). */
export const FLUENT_FORM_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'line-codemod', 'fluent-form.js');

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const end = (s) => (/[.?!]$/.test(s) ? s : `${s}.`);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * The fluent writer of packages/line-codemod. Never throws.
 * @param {string} [file]
 * @returns {{ok: true, explainFluent: (call: string, catalog: any) => {sentence: string|null, atom?: string, reason?: string}} | {ok: false, reason: string}}
 */
export function loadFluentForm(file = FLUENT_FORM_FILE) {
  if (!fs.existsSync(file)) return { ok: false, reason: 'the fluent writer (line-codemod fluent-form.js) is not on this tree' };
  try {
    const mod = createRequire(import.meta.url)(file);
    if (typeof mod?.explainFluent !== 'function') return { ok: false, reason: 'the fluent writer has no explainFluent' };
    return { ok: true, explainFluent: mod.explainFluent };
  } catch (e) {
    return { ok: false, reason: `the fluent writer could not be loaded (${one(/** @type {any} */ (e)?.message ?? e).slice(0, 120)})` };
  }
}

/**
 * One atom call (source text) -> its sentence, against one catalog. Never throws.
 * @param {any} catalog The atom catalog (raw catalog.json or compiled); the static breakdown's.
 * @param {ReturnType<typeof loadFluentForm>} [form]
 * @returns {{ok: true, explain: (call: string) => {sentence: string|null, reason?: string}} | {ok: false, reason: string}}
 */
export function englishWriter(catalog, form = loadFluentForm()) {
  if (!form.ok) return { ok: false, reason: /** @type {any} */ (form).reason };
  if (!catalog || typeof catalog !== 'object') return { ok: false, reason: 'the atom catalog is not loaded' };
  const explainFluent = /** @type {any} */ (form).explainFluent;
  return {
    ok: true,
    explain(call) {
      try {
        const r = explainFluent(call, catalog);
        return r?.sentence ? { sentence: r.sentence } : { sentence: null, reason: one(r?.reason) || 'the sentence cannot take this call' };
      } catch (e) { return { sentence: null, reason: one(/** @type {any} */ (e)?.message ?? e).slice(0, 120) || 'the fluent writer failed' }; }
    },
  };
}

/**
 * The English view of one function: its atom calls as sentences. Pure but for the writer.
 * @param {{name: string, body: string, atoms: string[]}} fn `body`: the function as written; `atoms`: the atoms it calls.
 * @param {undefined | {ok: false, reason: string} | {ok: true, explain: (call: string) => {sentence: string|null, reason?: string}}} writer
 * @returns {import('./contract.mjs').EnglishView}
 */
export function englishViewOf(fn, writer) {
  if (!writer?.ok) {
    const reason = one(writer ? /** @type {any} */ (writer).reason : 'the English writer is not set up for this run').replace(/\.$/, '');
    const view = { via: /** @type {const} */ ('off'), code: '', sentences: [], plain: 0, reasons: [], full: false, reason, sentence: end(`${fn.name} has no English view: ${reason}`) };
    assertEnglishView(view);
    return view;
  }
  const atoms = new Set(fn.atoms);
  const text = fn.body;
  const sf = ts.createSourceFile('view.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  /** @type {{atom: string, sentence: string}[]} */
  const sentences = [];
  /** @type {{atom: string, reason: string}[]} */
  const reasons = [];
  const isAtomCall = (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && atoms.has(n.expression.text);
  // the atom calls under a node, not counting those inside another atom call (each call renders its own)
  const callsIn = (node, acc = []) => { ts.forEachChild(node, (ch) => { if (isAtomCall(ch)) acc.push(ch); else callsIn(ch, acc); }); return acc; };
  const render = (node, from, to) => {
    let out = '';
    let at = from;
    for (const c of callsIn(node)) { out += text.slice(at, c.getStart(sf)) + sentenceOf(c); at = c.end; }
    return out + text.slice(at, to);
  };
  const sentenceOf = (call) => {
    const code = render(call, call.getStart(sf), call.end);
    const atom = call.expression.text;
    const r = writer.explain(code);
    if (r.sentence) { sentences.push({ atom, sentence: r.sentence }); return r.sentence; }
    reasons.push({ atom, reason: one(r.reason) || 'the sentence cannot take this call' });
    return code;
  };
  const code = render(sf, 0, text.length);
  const full = sentences.length > 0 && reasons.length === 0;
  const sentence = full
    ? `${fn.name} reads as ${plural(sentences.length, 'sentence')} in its English view.`
    : sentences.length
      ? `${fn.name} reads as ${plural(sentences.length, 'sentence')} in its English view; ${plural(reasons.length, 'atom call')} stay${reasons.length === 1 ? 's' : ''} as code (${reasons[0].atom}: ${reasons[0].reason.replace(/\.$/, '')}).`
      : reasons.length
        ? `${fn.name} has no sentence in its English view yet: ${plural(reasons.length, 'atom call')} stay${reasons.length === 1 ? 's' : ''} as code (${reasons[0].atom}: ${reasons[0].reason.replace(/\.$/, '')}).`
        : `${fn.name} calls no atom, so its English view is its code.`;
  const view = { via: /** @type {const} */ ('fluent'), code, sentences, plain: reasons.length, reasons, full, sentence };
  assertEnglishView(view);
  return view;
}
