// Line feature detail, the pure part (contract.mjs LineFeatureDetail): grouping items by kind, the static summary
// sentences, the spec.md parser and the static coverage match. No fs, no model: the real reader (feature.mjs) and the
// contract's mock (mock.mjs, which also runs in the browser) both build their LineFeatureDetail from these.
import { LINE_KINDS } from './contract.mjs';
import { summarize } from '@line/summarize';

/** Kind -> [singular, plural] as a person says it. */
const NOUNS = { pages: ['page', 'pages'], components: ['component', 'components'], workflows: ['workflow', 'workflows'], fixtures: ['fixture', 'fixtures'],
  usecases: ['usecase', 'usecases'], services: ['service', 'services'], domains: ['domain', 'domains'], expressions: ['expression', 'expressions'], atoms: ['atom', 'atoms'] };
/** The order the summary and the screen list kinds in. */
export const KIND_ORDER = Object.freeze(['pages', 'components', 'workflows', 'fixtures', 'usecases', 'services', 'domains', 'expressions', 'atoms']);

/** The logic kinds (iv2-fit, minimal) need no library base yet; an expression may have none (line-expressions). */
const LOGIC = ['usecases', 'services', 'domains', 'expressions', 'atoms'];
const count = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;
const listing = (parts) => (parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

/**
 * The items of one feature, keyed by kind (every kind present).
 * @param {import('./contract.mjs').FeatureItem[]} items
 * @returns {Record<import('./contract.mjs').LineKind, import('./contract.mjs').FeatureItem[]>}
 */
export function groupItems(items) {
  /** @type {any} */
  const out = {};
  for (const k of LINE_KINDS) out[k] = items.filter((i) => i.kind === k);
  return out;
}

/**
 * One import of a feature item, as the summary says it.
 * @typedef {{name: string, area: 'library'|'same'|'feature', feature?: string, libraryId?: string|null}} ItemUse
 */

/**
 * The Auto summary: what the feature holds, what each item is built on, what else it uses, and whether it passes.
 * @param {string} name Feature name.
 * @param {import('./contract.mjs').FeatureItem[]} items
 * @param {Map<string, string>} libraryNames Library id -> library item name.
 * @param {Map<string, ItemUse[]>} uses Feature item id -> what it imports (other than its base).
 * @returns {string[]}
 */
export function summarySentences(name, items, libraryNames, uses) {
  const grouped = groupItems(items);
  const parts = KIND_ORDER.filter((k) => grouped[k].length).map((k) => count(grouped[k].length, NOUNS[k]));
  if (!parts.length) return [`${name} has nothing in it yet.`];
  const out = [`${name} has ${listing(parts)}.`];
  for (const k of KIND_ORDER) {
    for (const it of grouped[k]) {
      const { value, libraryId } = it.base;
      if (libraryId) out.push(`${it.name} is based on ${libraryNames.get(libraryId) ?? libraryId.split('/').pop()}.`);
      else if (value) out.push(`${it.name} names "${value}" as its base, but the library has no such item.`);
      else if (LOGIC.includes(k)) out.push(`${it.name} is ${/^[aeiou]/.test(NOUNS[k][0]) ? 'an' : 'a'} ${NOUNS[k][0]} of ${name}.`);
      else out.push(`${it.name} has no library base yet.`);
      for (const u of uses.get(it.id) ?? []) {
        if (u.area === 'library') out.push(`${it.name} also uses ${u.name} from the library.`);
        else if (u.area === 'same') out.push(`${it.name} uses ${u.name} from this feature.`);
        else out.push(`${it.name} uses ${u.name} from feature ${u.feature}, which a feature may not do.`);
      }
    }
  }
  const problems = items.filter((i) => i.status === 'problem').length;
  out.push(problems === 0 ? `Everything in ${name} passes the checks.` : `${count(problems, ['item needs', 'items need'])} attention.`);
  // cs1: the summary is made and checked by the one summarizer; item names stay as the person wrote them.
  const names = [...items.map((i) => i.name), ...[...uses.values()].flat().map((u) => u.name)];
  return summarize({ kind: 'feature', name, names, sentences: out }).sentences;
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/;
const STORY_HEADING = /^#{2,6}\s+(.+?)\s*#*\s*$/;
const TITLE = /^#\s+(.+?)\s*#*\s*$/;

/**
 * A spec.md split into stories and acceptance points. A "## " (or deeper) heading starts a story; every list item
 * under it is one acceptance point. List items before any story heading belong to one story named after the spec's
 * "# " title. Ids are positional: s1, s1.p1, s1.p2, s2, ...
 * @param {string} text
 * @returns {{id: string, text: string, points: {id: string, text: string}[]}[]}
 */
export function parseSpec(text) {
  /** @type {{id: string, text: string, points: {id: string, text: string}[]}[]} */
  const stories = [];
  let title = 'Spec';
  let current = null;
  let fence = false;
  for (const raw of String(text).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; continue; }
    if (fence) continue;
    const t = TITLE.exec(raw);
    if (t) { title = t[1]; continue; }
    const h = STORY_HEADING.exec(raw);
    if (h) { current = { id: `s${stories.length + 1}`, text: h[1].replace(/^story:\s*/i, ''), points: [] }; stories.push(current); continue; }
    const li = LIST_ITEM.exec(raw);
    if (li) {
      if (!current) { current = { id: `s${stories.length + 1}`, text: title, points: [] }; stories.push(current); }
      current.points.push({ id: `${current.id}.p${current.points.length + 1}`, text: li[1] });
    }
  }
  return stories;
}

const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Static coverage: a point is covered by every feature item it names (whole word, any case) and every test of the
 * feature whose title it contains or that contains it (words only, any case).
 * @param {ReturnType<typeof parseSpec>} stories
 * @param {{itemNames: string[], testTitles: string[]}} evidence
 * @returns {any[]} The stories with each point marked covered and by what.
 */
export function coverSpec(stories, { itemNames, testTitles }) {
  return stories.map((st) => ({
    ...st,
    points: st.points.map((pt) => {
      const by = [];
      for (const n of itemNames) if (new RegExp(`(^|[^A-Za-z0-9_])${escape(n)}([^A-Za-z0-9_]|$)`, 'i').test(pt.text)) by.push(n);
      const w = words(pt.text);
      for (const title of testTitles) {
        const tw = words(title);
        if (tw && w && (w.includes(tw) || tw.includes(w))) by.push(`test "${title}"`);
      }
      return { ...pt, covered: by.length > 0, by };
    }),
  }));
}

/**
 * Test titles in a test file's source: test('...'), it('...'), describe is not a test.
 * @param {string} src
 * @returns {string[]}
 */
export function testTitles(src) {
  return [...String(src).matchAll(/\b(?:test|it)(?:\.\w+)*\s*\(\s*(['"`])((?:(?!\1).)+)\1/g)].map((m) => m[2]);
}
