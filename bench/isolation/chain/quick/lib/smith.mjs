// Smith as a tool for the quick kill-tests (#942): TS function -> JS (types removed, the way exp/smith-system1-data's
// smithInput does it, packages/tools/smith-system1/sources.mjs:81 on that branch) -> packages/summarize/links.mjs
// summarizeCode (atomic-codemod's to-english, linked through packages/line-links) -> sentences.
// A plan line in to-english's raw template ("return x", "if a: b") goes through the same plainSentence step, so the
// plan and Smith's output are compared in the same form.
import { createRequire } from 'node:module';
import { summarizeCode, smithLinks } from '../../../../../packages/summarize/links.mjs';
import { plainSentence } from '../../../../../packages/summarize/index.mjs';

const ts = createRequire(import.meta.url)('typescript');

/** Top-level function declarations of a TS source, as JS without `export`. */
export function functionsOf(source) {
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }, reportDiagnostics: false }).outputText;
  const sf = ts.createSourceFile('x.js', js, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
  return sf.statements.filter(ts.isFunctionDeclaration).map((st) => ({ name: st.name?.text ?? '', code: st.getText(sf).replace(/^export\s+/, '') }));
}

/** to-english's raw line as the sentence summarize() makes of it (packages/summarize/index.mjs:141 codeLine). */
export const planSentence = (line) => plainSentence(String(line).replace(/^return\b/, 'it returns').replace(/: /g, ', ').replace(/; then /g, ', then ')).sentence;

export const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');

/** Smith's step sentences per function (the "<name> works in N steps" head is dropped). */
export async function smithOf(source) {
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
