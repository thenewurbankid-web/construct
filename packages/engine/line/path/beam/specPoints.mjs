// #949 Trace beam: a spec point's text as the beam's point, by fixed rules (no model). What the page shows comes from
// the fixture (api) or is computed from its fields; what it keeps (state), what the member does (action) and whether
// every page shows it (shared) are read from the wording. Examples are derived from the fixture file, never from the
// acceptance tests. The rules are the lending bench's vocabulary; an unknown point gets no data slots, not a guess.
import fs from 'node:fs';
import path from 'node:path';

export const BOOKS_FIXTURE = 'library/fixtures/books.json';
const tsType = (v) => (Array.isArray(v) ? 'unknown[]' : v === null ? 'null' : typeof v === 'object' ? 'object' : typeof v);

/** Computed values (domain functions over the api fields), by the words that ask for them. */
/** @type {[RegExp, string][]} */
const COMPUTED = [
  [/six at a time|Page \d+ of \d+|Previous page/, 'pageOf'],
  [/Sort by/, 'sortBooks'],
  [/labelled "Genre"/, 'filterByGenre'],
  [/Find a book|contains what was typed/, 'searchBooks'],
  [/"On loan"|"Available"/, 'availability'],
  [/at most \d+ books/, 'canPick'],
  [/Loan length|Return by|return-by/, 'loanTerms'],
  [/missing or wrong value|aria-invalid/, 'validateRequest'],
  [/moves its return-by date|renewed only once/, 'renewLoan'],
];
const STATE = /six at a time|Page \d+ of|Sort by|"Genre"|Find a book|status message|pressing|fields labelled|Change branch|asks "|text box/;
const ACTION = /button|pressing|Press|"Remove|Renew|Cancel|Send request|"Save"/;
const SHARED = /Every page/;

/**
 * The beam point for one spec point.
 * @param {string} root The project the point is planned in.
 * @param {{id: string, text: string, feature: string, page?: string|null, only?: string}} p `page`: the page file
 *   (project-relative); omitted, the feature's page is used (the one named for `/done` when the text opens that route);
 *   null: no page. `only`: plan only the slots of this layer (a point that is one module, e.g. a store).

 * @returns {any} A point for shortestPlan.
 */
export function specPoint(root, { id, text, feature, page, only }) {
  let rows = [];
  try { rows = JSON.parse(fs.readFileSync(path.join(root, BOOKS_FIXTURE), 'utf8')); } catch { /* no fixture */ }
  const first = rows[0] ?? {};
  const types = `type Book = { ${Object.entries(first).map(([k, v]) => `${k}: ${tsType(v)}`).join('; ')} };`;
  const slots = [];
  const contract = { target: BOOKS_FIXTURE.replace(/\.json$/, ''), exists: rows.length > 0 };
  // computed values need the api fields they are computed from: a point that only computes still reads the books
  const computes = COMPUTED.some(([re]) => re.test(text));
  const booksMentioned = (/\bbooks?\b|title|author/i.test(text) || computes) && feature !== 'loans' && feature !== 'request' || (/\bbooks?\b|title/i.test(text) && feature === 'request');
  const countOnly = /number of picked books/.test(text);
  if (booksMentioned && !countOnly && rows.length) {
    if (feature === 'book') {
      slots.push({ id: 'books', kind: 'api', layer: 'service', name: 'findBook', entity: 'book', in: '{ id: string }', out: 'Book | undefined', types, contract,
        examples: [{ id: 'find-first', input: { id: first.id }, expect: first }, { id: 'find-unknown', input: { id: 'no-such-book' }, expect: undefined }] });
    } else if (feature === 'picks' || feature === 'request') {
      slots.push({ id: 'books', kind: 'api', layer: 'service', name: 'pickedBooks', entity: 'book', in: '{ ids: string[] }', out: 'Book[]', types, contract,
        examples: [{ id: 'picked-two', input: { ids: [rows[1]?.id, rows[0]?.id] }, expect: [rows[1], rows[0]], compare: 'ids' }] });
    } else {
      slots.push({ id: 'books', kind: 'api', layer: 'service', name: 'listBooks', entity: 'book', in: 'Record<string, never>', out: 'Book[]', types, contract,
        examples: [{ id: 'list-all', input: {}, expect: rows, compare: 'ids' }] });
    }
  }
  if (/\bpicks\b|\bpicked\b/i.test(text)) {
    slots.push({ id: 'picks', kind: 'api', layer: 'contract', name: 'listPicks', feature: 'picks', entity: 'pick', in: 'void', out: 'string[]', examples: [{ id: 'picks-empty', expect: [] }] });
    if (/Add to my picks/.test(text)) slots.push({ id: 'addPick', kind: 'action', layer: 'contract', name: 'addPick', feature: 'picks', entity: 'pick', in: 'string', out: 'void' });
    if (/"Remove/.test(text)) slots.push({ id: 'removePick', kind: 'action', layer: 'contract', name: 'removePick', feature: 'picks', entity: 'pick', in: 'string', out: 'void' });
  }
  if (/\bloans?\b/i.test(text) && (feature === 'loans' || feature === 'request')) slots.push({ id: 'loans', kind: 'api', layer: 'contract', name: 'listLoans', feature: 'loans', entity: 'loan' });
  if (/mock loan service/.test(text)) slots.push({ id: 'createLoan', kind: 'action', layer: 'service', name: 'createLoan', feature: 'request', entity: 'loan' });
  const api = slots.filter((s) => s.kind === 'api').map((s) => s.id);
  for (const [re, name] of COMPUTED) if (re.test(text)) slots.push({ id: name, kind: 'computed', layer: 'domain', name, entity: name, from: api.slice(0, 1) });
  if (only) for (let i = slots.length - 1; i >= 0; i--) if (slots[i].layer !== only) slots.splice(i, 1);
  for (const s of slots) if (s.from) s.from = s.from.filter((d) => slots.some((x) => x.id === d));

  let pageInfo = null;
  if (page !== null) {
    let file = page ?? null;
    if (!file) {
      let files = [];
      try { files = fs.readdirSync(path.join(root, 'features', feature, 'pages')).filter((f) => /\.tsx$/.test(f)).sort(); } catch { /* none */ }
      const done = /The page at `\/request\/done`/.test(text);
      const pick = files.find((f) => (done ? /Done/.test(f) : !/Done/.test(f))) ?? files[0];
      file = pick ? `features/${feature}/pages/${pick}` : `features/${feature}/pages/${feature[0].toUpperCase()}${feature.slice(1)}Page.tsx`;
    }
    pageInfo = { name: path.basename(file).replace(/\.tsx$/, ''), file, exists: fs.existsSync(path.join(root, file)) };
  }
  return { id, feature, text, page: pageInfo, traits: { state: STATE.test(text), action: ACTION.test(text), shared: SHARED.test(text) }, slots };
}

/**
 * The numbered points of a SPEC.md, each with its feature (from its story heading's `(feature \`x\`)`).
 * @param {string} specText
 * @returns {{id: string, text: string, feature: string}[]}
 */
export function specPointsOf(specText) {
  const out = []; let feature = null;
  for (const line of specText.split('\n')) {
    const h = /\(feature `([^`]+)`\)/.exec(line);
    if (h) { feature = h[1]; continue; }
    const m = /^\d+\.\s+([A-Z]+-\d+):\s+(.+)$/.exec(line);
    if (m && feature) out.push({ id: m[1], text: m[2].trim(), feature });
  }
  return out;
}
