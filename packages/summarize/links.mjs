// cs1 -- the summarizer's links to Smith and atomic-codemod (Node only). Both are linked from their own git repo
// through packages/line-links, the way cu1 links @mx/*: a pinned commit, no source copy, and a soft failure (one
// plain-English sentence, the static path keeps working) when a source is missing or moved.
//
//   smithLinks()            where Smith and atomic-codemod stand, one sentence each
//   smithConnectors()       Smith's connector words, read from the linked Chain and Organism (the contract's list when
//                           Smith is not linked), so the summarizer and Smith cannot drift apart unnoticed
//   summarizeCode(code)     code written as Smith chains -> to-english -> summarize({kind: 'code'})
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importLinked, linkStatus, readLinks } from '../line-links/index.mjs';
import { SMITH_CONNECTORS } from './contract.mjs';
import { summarize } from './index.mjs';

const LINKS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'line-links');
/** The two link tables, beside cu1's links.json. */
export const SMITH_TABLE_FILES = Object.freeze({
  smith: path.join(LINKS_DIR, 'smith.json'),
  codemod: path.join(LINKS_DIR, 'atomic-codemod.json'),
});

/** @param {'smith'|'codemod'} which @param {{env?: NodeJS.ProcessEnv}} [options] */
const optionsFor = (which, options = {}) => ({ ...options, table: readLinks(SMITH_TABLE_FILES[which]) });

/**
 * Where Smith and atomic-codemod stand. Never throws.
 * @param {{env?: NodeJS.ProcessEnv}} [options]
 */
export function smithLinks(options = {}) {
  return { smith: linkStatus(optionsFor('smith', options)), codemod: linkStatus(optionsFor('codemod', options)) };
}

/**
 * Smith's connector words. Linked: the methods of Smith's Chain and Organism. Not linked: the contract's list, with
 * the reason in one sentence.
 * @param {{env?: NodeJS.ProcessEnv}} [options]
 * @returns {Promise<{linked: boolean, words: string[], reason?: string}>}
 */
export async function smithConnectors(options = {}) {
  const r = await importLinked('@smith/core', optionsFor('smith', options));
  if (!r.ok) return { linked: false, words: [...SMITH_CONNECTORS], reason: /** @type {any} */ (r).reason };
  const own = (C) => Object.getOwnPropertyNames(C.prototype).filter((n) => n !== 'constructor');
  return { linked: true, words: [...own(r.module.Chain), ...own(r.module.Organism)] };
}

/**
 * Code in the atomic pattern (Smith chains, named atoms) as plain English, through atomic-codemod's to-english step.
 * Never throws: when atomic-codemod is not linked or the code cannot be parsed, one sentence says so and the code
 * and the reason sit under Details.
 * @param {string} code One function (kind "function") or class method (kind "method").
 * @param {{kind?: 'function'|'method', env?: NodeJS.ProcessEnv, toEnglishOptions?: object}} [options] `toEnglishOptions`: passed to to-english as its third argument (e.g. {canonical: true} on atomic-codemod smith-hardening; the pinned commit ignores it)
 * @returns {Promise<import('./contract.mjs').Summary>}
 */
export async function summarizeCode(code, options = {}) {
  const { kind = 'function', toEnglishOptions, ...rest } = options;
  const r = await importLinked('@smith/to-english', optionsFor('codemod', rest));
  if (!r.ok) {
    return { sentences: ['This code is not put into words because atomic-codemod is not linked; the code and the reason are under Details.'], details: [{ label: 'Code', text: code }, { label: 'Why', text: /** @type {any} */ (r).reason }], via: 'static' };
  }
  const toEnglish = r.module.toEnglish ?? r.module.default?.toEnglish;
  let english;
  try {
    english = toEnglishOptions ? toEnglish(code, kind, toEnglishOptions) : toEnglish(code, kind);
  } catch (e) {
    return { sentences: ['This code could not be read, so it is not put into words; the code and the reason are under Details.'], details: [{ label: 'Code', text: code }, { label: 'Why', text: String(/** @type {any} */ (e)?.message ?? e).split('\n')[0] }], via: 'static' };
  }
  return summarize({ kind: 'code', english, code });
}
