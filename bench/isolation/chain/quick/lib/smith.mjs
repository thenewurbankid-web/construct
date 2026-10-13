// Smith as a tool for the quick kill-tests (#942): TS function -> JS (types removed, the way exp/smith-system1-data's
// smithInput does it, packages/tools/smith-system1/sources.mjs:81 on that branch) -> packages/summarize/links.mjs
// summarizeCode (atomic-codemod's to-english, linked through packages/line-links) -> sentences.
// A plan line in to-english's raw template ("return x", "if a: b") goes through the same plainSentence step, so the
// plan and Smith's output are compared in the same form.
import { createRequire } from 'node:module';
import { summarizeCode, smithLinks, SMITH_TABLE_FILES } from '../../../../../packages/summarize/links.mjs';
import { plainSentence, summarize } from '../../../../../packages/summarize/index.mjs';
import { importLinked, readLinks } from '../../../../../packages/line-links/index.mjs';

const ts = createRequire(import.meta.url)('typescript');

/** CHAIN_SMITH_RAW=1: the hardened to-english (atomic-codemod smith-hardening) parses TS/TSX itself, so each top-level
 * function goes in as written (types and `export` kept); one function per call, since to-english describes the first. */
const RAW = process.env.CHAIN_SMITH_RAW === '1';

/** Top-level function declarations of a TS source, as JS without `export`. */
export function functionsOf(source) {
  if (RAW) {
    const sf = ts.createSourceFile('x.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    return sf.statements.filter(ts.isFunctionDeclaration).map((st) => ({ name: st.name?.text ?? '', code: st.getText(sf) }));
  }
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }, reportDiagnostics: false }).outputText;
  const sf = ts.createSourceFile('x.js', js, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
  return sf.statements.filter(ts.isFunctionDeclaration).map((st) => ({ name: st.name?.text ?? '', code: st.getText(sf).replace(/^export\s+/, '') }));
}

/** to-english's raw line as the sentence summarize() makes of it (packages/summarize/index.mjs:141 codeLine). */
export const planSentence = (line) => plainSentence(String(line).replace(/^return\b/, 'it returns').replace(/: /g, ', ').replace(/; then /g, ', then ')).sentence;

/** A Smith sentence that is not real English: a placeholder for an expression or a statement to-english cannot read. */
export const isUnhandled = (s) => /\(\.\.\.\)|\(a step that does not translate cleanly\)/.test(String(s));

export const norm =(s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');

/** CHAIN_SMITH_CANONICAL=1: hardened to-english (cbc2567+) with {all: true, canonical: true}, called through
 * packages/line-links' importLinked (same link table as summarizeCode; LINE_LINKS_ALLOW_DRIFT=1 for a non-pinned head),
 * so equivalent forms (ternary vs if/return, guards, ...) read as the same English. */
const CANONICAL = process.env.CHAIN_SMITH_CANONICAL === '1';

/**
 * Every top-level function of a TS/TSX source, described by hardened Smith: its step sentences (head dropped) and
 * its unhandled pieces as {kind, type, code}.
 * @returns {Promise<Record<string, {sentences: string[], unhandled: {kind: string, type: string, code: string}[]}>>}
 */
export async function describe(source, { canonical = CANONICAL } = {}) {
  const r = await importLinked('@smith/to-english', { table: readLinks(SMITH_TABLE_FILES.codemod) });
  if (!r.ok) throw new Error(r.reason);
  const toEnglish = r.module.toEnglish ?? r.module.default?.toEnglish;
  let d;
  try { d = toEnglish(source, 'function', { all: true, canonical }); } catch (e) { return { __parse: { sentences: [], unhandled: [{ kind: 'parse', type: 'SyntaxError', code: String(e?.message ?? e).split('\n')[0] }] } }; }
  const out = {};
  for (const fn of d.functions ?? []) {
    out[fn.name] = {
      sentences: summarize({ kind: 'code', english: fn, code: '' }).sentences.slice(1),
      unhandled: (fn.unhandled ?? []).map((u) => ({ kind: u.kind, type: u.type, code: source.slice(u.start, u.end) })),
    };
  }
  return out;
}

/** Smith's step sentences per function (the "<name> works in N steps" head is dropped). */
export async function smithOf(source) {
  if (CANONICAL) return Object.fromEntries(Object.entries(await describe(source)).map(([k, v]) => [k, v.sentences]));
  const out = {};
  for (const fn of functionsOf(source)) {
    const s = await summarizeCode(fn.code, { kind: 'function' });
    out[fn.name] = (s.sentences ?? []).slice(1);
  }
  return out;
}

export const smithReady = () => smithLinks().codemod.ok;

/**
 * Exact-template match of a plan ({fn: rawLines[]}) against Smith's sentences ({fn: sentences[]}).
 * score = matched / max(plan lines, code sentences), over all functions, so a missing or an extra step both cost.
 */
export function matchPlan(plan, smith) {
  let matched = 0, planN = 0, codeN = 0;
  const gaps = [];
  for (const [fn, lines] of Object.entries(plan)) {
    const want = lines.map((l) => norm(planSentence(l)));
    const got = (smith[fn] ?? []).map(norm);
    planN += want.length; codeN += got.length;
    const pool = [...got];
    for (const w of want) {
      const i = pool.indexOf(w);
      if (i >= 0) { matched++; pool.splice(i, 1); } else gaps.push({ fn, plan: w });
    }
  }
  return { matched, planN, codeN, score: matched / Math.max(planN, codeN, 1), gaps };
}
