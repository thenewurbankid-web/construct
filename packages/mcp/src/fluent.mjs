// T5.2 (docs/line/FLUENT-PLAN-2026-10-15.md, E5) -- the fluent tools line_english and line_atoms as plain functions over the
// code the CLI and the codemod already use: englishView is `construct english`'s own (@line/fluent cli/english.mjs), toAtoms
// and loadCatalog are @line/codemod's over Smith's catalog. This file only picks the source (a project-relative file,
// checked inside the root, or a snippet) and caps what comes out. Both read; nothing is written. The modules load inside
// each call, so tools/list loads none of them.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ToolError, LIMITS } from './limits.mjs';
import { projectFile } from './lsp.mjs';

/** The most functions line_english lists, sites line_atoms lists, and characters of one English view. */
export const FLUENT_LIMITS = Object.freeze({ functions: 40, sites: 40, ambiguous: 20, englishChars: 1200, codeChars: 16 * 1024, sourceChars: 64 * 1024 });

const require = createRequire(import.meta.url);
const english = () => import('@line/fluent/cli/english.mjs');
let catalog = null;
/** Smith's compiled atom catalog, loaded once (the same file the codemod and the fluent LSP read). */
const smithCatalog = () => {
  if (catalog) return catalog;
  const { loadCatalog } = require('@line/codemod/atoms-catalog.js');
  const file = require.resolve('@line/smith/package.json').replace(/package\.json$/, 'src/atoms/catalog.json');
  catalog = loadCatalog(file, { runtimeRoot: path.dirname(file) });
  return catalog;
};

/**
 * The source a call names: exactly one of a project-relative file (checked inside the root) and a snippet.
 * @param {{root: string}} ctx The server context.
 * @param {{file?: string, code?: string}} args The checked input.
 * @returns {{source: string, from: string}}
 * @throws {ToolError} INVALID_INPUT, PATH_OUTSIDE_ROOT or NOT_FOUND.
 */
function sourceOf(ctx, { file, code }) {
  if ((file === undefined) === (code === undefined)) throw new ToolError('INVALID_INPUT', 'Give exactly one of `file` (a project-relative file) and `code` (a snippet).');
  if (code !== undefined) return { source: code, from: 'snippet' };
  const rel = projectFile(ctx.root, file);
  const source = fs.readFileSync(path.join(ctx.root, rel), 'utf8');
  if (source.length > FLUENT_LIMITS.sourceChars) throw new ToolError('INVALID_INPUT', `${rel.slice(0, 120)} has ${source.length} characters and these tools read at most ${FLUENT_LIMITS.sourceChars}; send one function as code.`);
  return { source, from: rel };
}

/** A parse failure as a typed refusal with the line, never the parser's text. */
const parseError = (from, e) => new ToolError('PARSE_FAILED', `Cannot parse ${from.slice(0, 120)}${e?.loc ? ` at line ${e.loc.line}` : ''}.`);

const cap = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * `line_english`: the English view of each top-level function of a file or snippet, as `construct english --json` prints it.
 * @param {{root: string}} ctx The server context (its real root).
 * @param {{file?: string, code?: string}} args The checked input.
 * @returns {Promise<{ok: true, from: string, total: number, functions: {name: string, line: number, english: string, cut?: true}[], sentence: string}>}
 * @throws {ToolError} INVALID_INPUT, PATH_OUTSIDE_ROOT, NOT_FOUND or PARSE_FAILED.
 */
export async function lineEnglish(ctx, args) {
  const { source, from } = sourceOf(ctx, args);
  const { englishView } = await english();
  let view;
  try { view = englishView(source); } catch (e) { throw parseError(from, e); }
  const functions = view.slice(0, FLUENT_LIMITS.functions).map((v) => ({ ...v, english: cap(v.english, FLUENT_LIMITS.englishChars), ...(v.english.length > FLUENT_LIMITS.englishChars ? { cut: /** @type {const} */ (true) } : {}) }));
  const sentence = view.length === 0
    ? 'No top-level function to describe: declare one with function or const name = () => ....'
    : `${view.length} top-level function${view.length === 1 ? '' : 's'}${view.length > functions.length ? `, the first ${functions.length} shown` : ''}.`;
  return { ok: true, from, total: view.length, functions, sentence };
}

/**
 * `line_atoms`: the deterministic JS -> atoms rewrite of a file or snippet over Smith's catalog: the atoms it uses, each
 * rewrite as a site with a stable id, and where several atoms fit, a closed choice (`ambiguous[].alternatives`) the caller
 * answers by site id in `choices` and calls again.
 * @param {{root: string}} ctx The server context (its real root).
 * @param {{file?: string, code?: string, choices?: Record<string, string>}} args The checked input.
 * @returns {Promise<any>} `{ok, from, atoms, converted, sites, ambiguous, untranslated, code?, sentence}`.
 * @throws {ToolError} INVALID_INPUT, PATH_OUTSIDE_ROOT, NOT_FOUND, PARSE_FAILED or ANSWER_REFUSED.
 */
export async function lineAtoms(ctx, args) {
  const { source, from } = sourceOf(ctx, args);
  const { toAtoms } = require('@line/codemod/atoms-transform.js');
  const run = (choices) => {
    try { return toAtoms(source, { catalog: smithCatalog(), kind: 'module', choices }); } catch (e) { throw parseError(from, e); }
  };
  let r = run({});
  const choices = Object.entries(args.choices ?? {});
  if (choices.length) {
    // A choice answers one place the plain rewrite left open, with one of the atoms it offered there.
    const offered = new Map(r.ambiguous.map((a) => [a.id, a.alternatives]));
    for (const [id, atom] of choices) {
      if (!offered.has(id)) throw new ToolError('ANSWER_REFUSED', `${id.slice(0, 80)} is not an open place of this code; answer an id from ambiguous.`);
      if (!offered.get(id).includes(atom)) throw new ToolError('ANSWER_REFUSED', `${atom.slice(0, 80)} is not an option at ${id.slice(0, 80)}; the options are ${offered.get(id).join(', ')}.`);
    }
    r = run(Object.fromEntries(choices));
  }
  const untranslated = {};
  for (const u of r.untranslated) untranslated[u.reason] = (untranslated[u.reason] ?? 0) + 1;
  const site = (s) => ({ id: s.id, atom: s.atom });
  const atoms = Object.keys(r.atoms).sort();
  const code = r.code.length <= FLUENT_LIMITS.codeChars ? { code: r.code } : {};
  const sentence = [
    r.converted ? `${r.converted} rewrite${r.converted === 1 ? '' : 's'} into ${atoms.length} atom${atoms.length === 1 ? '' : 's'}.` : 'Nothing here matches an atom.',
    r.ambiguous.length ? `${r.ambiguous.length} place${r.ambiguous.length === 1 ? ' fits' : 's fit'} several atoms: answer each by id in choices.` : '',
    code.code === undefined ? `The rewritten code is longer than ${FLUENT_LIMITS.codeChars} characters, so it is left out.` : '',
  ].filter(Boolean).join(' ');
  return {
    ok: true,
    from,
    atoms,
    converted: r.converted,
    sites: r.sites.slice(0, FLUENT_LIMITS.sites).map(site),
    ambiguous: r.ambiguous.slice(0, FLUENT_LIMITS.ambiguous).map((a) => ({ id: a.id, alternatives: a.alternatives })),
    untranslated,
    ...code,
    sentence: cap(sentence, LIMITS.lineChars * 2),
  };
}
