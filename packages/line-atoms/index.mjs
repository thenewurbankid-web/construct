// Line logic atoms (roadmap item 2): the catalog. Reads every atoms/<id>/atom.json (contract.mjs AtomDescriptor),
// answers which atoms exist, and which atom a request means (matchAtoms, for the drafter). Static: no model, no
// network; the descriptors are the only input.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATOM_ROLES, ATOM_USERS, assertAtom, toSmithEntry } from './contract.mjs';

export { ATOM_ROLES, ATOM_USERS, assertAtom, toSmithEntry };

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Where the atoms live. */
export const ATOMS_DIR = path.join(HERE, 'atoms');
/** The package name a project imports atoms from. */
export const PACKAGE = '@line/atoms';

/** @type {import('./contract.mjs').AtomDescriptor[]|null} */
let cache = null;

/**
 * Every atom's descriptor, checked, sorted by id.
 * @returns {import('./contract.mjs').AtomDescriptor[]}
 */
export function listAtoms() {
  if (cache) return cache;
  const ids = fs.readdirSync(ATOMS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(ATOMS_DIR, e.name, 'atom.json'))).map((e) => e.name).sort();
  cache = Object.freeze(ids.map((id) => Object.freeze(assertAtom(JSON.parse(fs.readFileSync(path.join(ATOMS_DIR, id, 'atom.json'), 'utf8'))))));
  return cache;
}

/**
 * One atom by id, or null.
 * @param {string} id
 * @returns {import('./contract.mjs').AtomDescriptor|null}
 */
export function getAtom(id) {
  return listAtoms().find((a) => a.id === id) ?? null;
}

/**
 * The import specifier of an atom, e.g. "@line/atoms/client-pagination".
 * @param {string} id
 * @returns {string}
 */
export const atomImport = (id) => `${PACKAGE}/${id}`;

/** Words that carry no meaning for matching a request to an atom. */
const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'and', 'or', 'with', 'for', 'in', 'on', 'by', 'it', 'its', 'this', 'that', 'add', 'make', 'create', 'use', 'show', 'please', 'new', 'some', 'one', 'my', 'our', 'page', 'list']);
/** A few spellings that mean the same thing. */
const SAME = { paginated: 'paginate', pagination: 'paginate', pages: 'paginate', paging: 'paginate', filtering: 'filter', filters: 'filter', sorting: 'sort', sorted: 'sort', searching: 'search', validation: 'validate', validated: 'validate', validating: 'validate', permissions: 'permission', roles: 'role', steps: 'step', wizard: 'step', stepper: 'step', polling: 'poll', debounced: 'debounce', debouncing: 'debounce', optimistically: 'optimistic', exporting: 'export', csv: 'csv', undoing: 'undo', dates: 'date', loading: 'load', infinite: 'infinite', scroll: 'infinite', scrolling: 'infinite' };

/**
 * The meaningful words of a text, lower-case, stemmed by the SAME table.
 * @param {string} text
 * @returns {string[]}
 */
export function words(text) {
  return (String(text).toLowerCase().match(/[a-z0-9]+/g) ?? []).map((w) => SAME[w] ?? w).filter((w) => !STOP.has(w));
}

/**
 * The atoms a request means, best first: each atom's phrases (and role words) against the request's words.
 * Deterministic. A match needs at least half of a phrase's words in the request.
 * @param {string} request e.g. "add a paginated list of orders"
 * @param {{limit?: number, min?: number}} [o]
 * @returns {import('./contract.mjs').AtomMatch[]}
 */
export function matchAtoms(request, o = {}) {
  const asked = new Set(words(request));
  if (!asked.size) return [];
  const out = [];
  for (const a of listAtoms()) {
    let best = 0;
    let hits = 0;
    for (const phrase of [...a.phrases, a.title, ATOM_ROLES[a.role]]) {
      const ws = [...new Set(words(phrase))];
      if (!ws.length) continue;
      const hit = ws.filter((w) => asked.has(w)).length;
      const ratio = hit / ws.length;
      if (ratio > best || (ratio === best && hit > hits)) {
        best = ratio;
        hits = hit;
      }
    }
    if (best >= (o.min ?? 0.5)) {
      out.push({ hits, composes: a.composes, id: a.id, role: a.role, title: a.title, sentence: `Use the ${a.title.toLowerCase()} atom: ${a.english.charAt(0).toLowerCase()}${a.english.slice(1)}`, confidence: Math.round(best * 100) / 100, import: atomImport(a.id) });
    }
  }
  // On a tie, the atom whose phrase shares more words with the request; then an atom built from another matched atom (paginated-query from client-pagination) ranks first: it does
  // the whole job the request names.
  const builtOn = (x, y) => (x.composes.includes(y.id) ? -1 : y.composes.includes(x.id) ? 1 : 0);
  out.sort((x, y) => y.confidence - x.confidence || y.hits - x.hits || builtOn(x, y) || x.id.localeCompare(y.id));
  return out.slice(0, o.limit ?? 3).map(({ hits: _h, composes: _c, ...m }) => m);
}
