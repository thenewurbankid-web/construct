// QuickJS spike (#947): per isolation task,
//   examples   the task's own examples, read off its check.mjs (fixture ids in, the exact strings the check expects
//              out), as a scenario plus a partial View (view.mjs `match`). Q-exec runs a candidate on these; Q-plan runs
//              a plan sketch on them.
//   scenarios  the inputs Q-diff runs both the candidate and the plan sketch on: every fixture book (and an unknown id)
//              for the book pages, several pick lists, every page of the catalogue, every genre. The plan's View on a
//              scenario is the expectation; no expected string is written here.
// A scenario: {props?, picks? (localStorage "picks" before render), actions? [{click: text} | {change: label, value}],
// ops? (store tasks: [op, arg] with op list | add | remove | set | raw)}.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BOOKS = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'tasks/_shared/library/fixtures/books.json'), 'utf8'));
const book = (id) => ({ props: { params: { id } } });
const allBooks = BOOKS.map((b) => book(b.id));
const UNKNOWN = [book('no-such-book'), book('')];
const pickSets = [['salt-and-lanterns', 'copper-roads'], ['winter-ferry'], ['quiet-atoms', 'river-kings', 'glass-harbour'], []];

export const EXAMPLES = {
  't01-book-by-author': {
    examples: [
      { scenario: book('salt-and-lanterns'), expect: { h1: 'Salt and Lanterns', contains: ['by Ines Okafor'] } },
      { scenario: book('copper-roads'), expect: { contains: ['by Mara Quill'] } },
    ],
    scenarios: allBooks,
  },
  't02-book-page-count': {
    examples: [
      { scenario: book('salt-and-lanterns'), expect: { contains: ['312 pages'] } },
      { scenario: book('orchard-at-night'), expect: { h1: 'Orchard at Night', contains: ['248 pages'] } },
    ],
    scenarios: allBooks,
  },
  't03-book-availability': {
    examples: [
      { scenario: book('salt-and-lanterns'), expect: { contains: ['Available'], absent: ['On loan', 'true', 'false'] } },
      { scenario: book('winter-ferry'), expect: { contains: ['On loan'], absent: ['Available'] } },
    ],
    scenarios: allBooks,
  },
  't04-book-not-found': {
    examples: [
      { scenario: book('glass-harbour'), expect: { h1: 'Glass Harbour', links: [{ text: 'Back to the catalogue', href: '/' }] } },
      { scenario: book('no-such-book'), expect: { contains: ['We could not find that book'], links: [{ text: 'Back to the catalogue', href: '/' }] } },
    ],
    scenarios: [...allBooks, ...UNKNOWN],
  },
  't05-book-add-to-picks': {
    examples: [
      { scenario: { ...book('salt-and-lanterns'), actions: [{ click: 'Add to my picks' }] }, expect: { contains: ['Added to your picks'], picks: ['salt-and-lanterns'] } },
      { scenario: book('winter-ferry'), expect: { noEnabledButton: ['Add to my picks'] } },
    ],
    scenarios: BOOKS.flatMap((b) => [book(b.id), ...(b.available ? [{ ...book(b.id), actions: [{ click: 'Add to my picks' }] }] : [])]),
  },
  't06-picks-store': {
    examples: [
      { scenario: { ops: [['list'], ['add', 'a'], ['add', 'b'], ['add', 'a'], ['list'], ['remove', 'a'], ['list'], ['raw'], ['set', '["x","y"]'], ['list']] },
        expect: { lists: [[], ['a', 'b'], ['b'], ['x', 'y']], stored: [['b']] } },
    ],
    scenarios: [
      { ops: [['list'], ['add', 'a'], ['add', 'b'], ['add', 'a'], ['list'], ['remove', 'a'], ['list'], ['raw'], ['set', '["x","y"]'], ['list']] },
      { ops: [['remove', 'z'], ['list'], ['add', 'z'], ['add', 'y'], ['remove', 'z'], ['raw'], ['add', 'z'], ['list'], ['raw']] },
      { ops: [['set', '["q"]'], ['add', 'q'], ['add', 'r'], ['list'], ['remove', 'q'], ['remove', 'r'], ['list'], ['raw']] },
    ],
  },
  't07-picks-page-list': {
    examples: [
      { scenario: { picks: ['salt-and-lanterns', 'copper-roads'] }, expect: { h1: 'My picks', contains: ['Salt and Lanterns', 'Ines Okafor', 'Copper Roads', 'Mara Quill'], buttons: [{ text: 'Remove Salt and Lanterns' }, { text: 'Remove Copper Roads' }] } },
      { scenario: { picks: ['salt-and-lanterns', 'copper-roads'], actions: [{ click: 'Remove Salt and Lanterns' }] }, expect: { absent: ['Salt and Lanterns'], picks: ['copper-roads'] } },
    ],
    scenarios: pickSets.filter((p) => p.length).flatMap((p) => {
      const first = BOOKS.find((b) => b.id === p[0]);
      return [{ picks: p }, { picks: p, actions: [{ click: `Remove ${first.title}` }] }];
    }),
  },
  't08-picks-page-empty': {
    examples: [
      { scenario: { picks: null }, expect: { h1: 'My picks', contains: ['You have not picked any books yet'], absent: ['Request these books'] } },
    ],
    scenarios: [{ picks: null }, { picks: [] }, ...pickSets.filter((p) => p.length).map((p) => ({ picks: p }))],
  },
  't09-browse-heading-availability': {
    examples: [
      { scenario: {}, expect: { h1: 'Library catalogue', counts: { Available: 13, 'On loan': 2 }, absent: ['true', 'false'], bookLinkCount: 15 } },
    ],
    scenarios: [{}],
  },
  't10-browse-paging': {
    examples: [
      { scenario: {}, expect: { bookLinkCount: 6, contains: ['Page 1 of 3'], buttons: [{ text: 'Previous page', disabled: true }, { text: 'Next page', disabled: false }] } },
      { scenario: { actions: [{ click: 'Next page' }] }, expect: { contains: ['Page 2 of 3'] } },
      { scenario: { actions: [{ click: 'Next page' }, { click: 'Next page' }] }, expect: { contains: ['Page 3 of 3'], bookLinkCount: 3, buttons: [{ text: 'Next page', disabled: true }] } },
    ],
    scenarios: [{}, { actions: [{ click: 'Next page' }] }, { actions: [{ click: 'Next page' }, { click: 'Next page' }] }, { actions: [{ click: 'Next page' }, { click: 'Previous page' }] }],
  },
  't11-browse-sort-title': {
    examples: [
      { scenario: {}, expect: { bookLinks: [...BOOKS].sort((a, b) => a.title.localeCompare(b.title)).map((b) => ({ text: b.title, href: `/books/${b.id}` })) } },
    ],
    scenarios: [{}],
  },
  't12-browse-genre-filter': {
    examples: [
      { scenario: {}, expect: { selects: [{ label: 'Genre', options: ['All genres', 'Fiction', 'History', 'Science'] }], bookLinkCount: 15 } },
      { scenario: { actions: [{ change: 'Genre', value: 'History' }] }, expect: { unordered: true, bookLinks: BOOKS.filter((b) => b.genre === 'History').map((b) => ({ text: b.title, href: `/books/${b.id}` })) } },
      { scenario: { actions: [{ change: 'Genre', value: 'History' }, { change: 'Genre', value: 'All genres' }] }, expect: { bookLinkCount: 15 } },
    ],
    scenarios: [{}, ...['Fiction', 'History', 'Science'].map((g) => ({ actions: [{ change: 'Genre', value: g }] })), { actions: [{ change: 'Genre', value: 'Science' }, { change: 'Genre', value: 'All genres' }] }],
  },
};

/**
 * The partial View a plan's View demands of a candidate (Q-diff): its heading, its lines in order, its book links (in
 * order unless the plan says `unordered`), its buttons with their state, its selects, the picks and store reads, and the
 * strings it says must not show. A plan View field left out is not checked.
 */
export function expectFromPlan(pv) {
  if (!pv || pv.thrown) return null;
  const e = {};
  for (const k of ['h1', 'lines', 'contains', 'absent', 'buttons', 'noEnabledButton', 'selects', 'picks', 'lists', 'stored', 'unordered', 'bookLinkCount', 'counts']) if (pv[k] !== undefined) e[k] = pv[k];
  if (pv.links) {
    // book links are compared as the whole list (every book shown, nothing extra); other links must be present
    const books = pv.links.filter((l) => l.href.startsWith('/books/'));
    const other = pv.links.filter((l) => !l.href.startsWith('/books/'));
    if (books.length) e.bookLinks = books;
    if (other.length) e.links = other;
  }
  return e;
}
