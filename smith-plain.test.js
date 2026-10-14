// Plain style ({ style: 'plain' }, toEnglish's default): calls read as their
// result, operators in words, absence as "there is no x".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toEnglish, reorderChip } = require('./to-english');
const { pastParticiple } = require('./plain-words');
const K1 = require('./bench/k1/tasks.json');

const step = (body, sig = 'a, b, c') => {
  const r = toEnglish(`function run(${sig}) {\n  ${body}\n}`, 'function');
  assert.deepEqual(r.unhandled, []);
  return r.steps[0].english;
};

test("the owner's isWithinPath reads as plain English", () => {
  const code = `export function isWithinPath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const path = stripLocale(pathname);
  return path === href || path.startsWith(\`\${href}/\`);
}`;
  const r = toEnglish(code, 'function');
  assert.equal(r.english, 'is within path using pathname and href: if there is no pathname, return false; then let path be pathname with locale stripped; then return whether path equals href or path starts with the text "{href}/".');
  assert.equal(toEnglish(code, 'function', { style: 'exact' }).english, "is within path using pathname and href: if not (pathname): return false; then let path be strip locale of pathname; then return path === href or path starts with text of href and '/'.");
});

test('plain is the default; exact is opt-in', () => {
  const code = 'function f(a, b) {\n  return a === b;\n}';
  assert.equal(toEnglish(code, 'function').english, toEnglish(code, 'function', { style: 'plain' }).english);
  assert.equal(toEnglish(code, 'function', { style: 'exact' }).english, 'f using a and b: return a === b.');
});

test('calls read as their result: verb + noun with a past participle', () => {
  assert.equal(step('return stripLocale(a);'), 'return a with locale stripped');
  assert.equal(step('return normalizeTitle(a);'), 'return a with title normalized');
  assert.equal(step('return applyDiscount(a, b);'), 'return a and b with discount applied');
  assert.equal(step('return sortItems(a);'), 'return a with items sorted');
  assert.equal(step('return buildIndex(a);'), 'return a new index from a');
  assert.equal(step('return splitWords(a);'), 'return a with words split');
  assert.equal(step('return hideMenu(a);'), 'return a with menu hidden');
});

test('calls read as their result: the verb table', () => {
  assert.equal(step('return getUser(a);'), 'return the user for a');
  assert.equal(step('return findOrder(a, b);'), 'return the order for a and b');
  assert.equal(step('return getConfig();'), 'return the config');
  assert.equal(step('return isEmpty(a);'), 'return whether a is empty');
  assert.equal(step('return hasAccess(a, b);'), 'return whether a has access b');
  assert.equal(step('return canEdit(a);'), 'return whether a can edit');
  assert.equal(step('return toSlug(a);'), 'return a as slug');
  assert.equal(step('return formatDate(a);'), 'return a formatted as date');
  assert.equal(step('return makeRequest(a, b);'), 'return a new request from a with b');
  assert.equal(step('return createUser(a);'), 'return a new user from a');
  assert.equal(step('return convertToCelsius(a);'), 'return a converted to celsius');
  assert.equal(step('return parseQuery(a);'), 'return a parsed as query');
});

test('method calls keep "a\'s b" / "a verb b" unless they hit the table', () => {
  assert.equal(step('return a.startsWith(b);'), 'return whether a starts with b');
  assert.equal(step('return a.items.filter(b);'), "return a's items filter b");
  assert.equal(step('return a.toLowerCase();'), 'return a as lower case');
  assert.equal(step('return a.getName();'), "return a's name");
  assert.equal(step('return a.isBefore(b);'), 'return whether a is before b');
  assert.equal(step('return a.stripLocale(b);'), 'return a strip locale b');
});

test('names that are not verbs keep the exact reading', () => {
  assert.equal(step('return pageCount(a);'), 'return page count of a');
  assert.equal(step('return combine(a, b);'), 'return combine of a and b');
  assert.equal(step('return fetchOne(a);'), 'return fetch one of a');
  assert.equal(step('return sortBy(a, b);'), 'return sort by of a and b');
});

test('past participles: regular, doubled, -e, -y and irregular', () => {
  const pairs = { strip: 'stripped', map: 'mapped', filter: 'filtered', normalize: 'normalized', apply: 'applied', build: 'built', split: 'split', send: 'sent', sort: 'sorted', open: 'opened' };
  for (const [v, p] of Object.entries(pairs)) assert.equal(pastParticiple(v), p);
});

test('template literals read as the text "..." with parts inline', () => {
  assert.equal(step('return `${a}/`;'), 'return the text "{a}/"');
  assert.equal(step('return `Hello ${a.name}!`;'), `return the text "Hello {a's name}!"`);
  assert.equal(step('return `plain`;'), 'return the text "plain"');
});

test('operators in words', () => {
  assert.equal(step('return a === b;'), 'return whether a equals b');
  assert.equal(step('return a == b;'), 'return whether a equals b');
  assert.equal(step('return a !== b;'), "return whether a doesn't equal b");
  assert.equal(step('return a < b;'), 'return whether a is less than b');
  assert.equal(step('return a <= b;'), 'return whether a is at most b');
  assert.equal(step('return a > b;'), 'return whether a is greater than b');
  assert.equal(step('return a >= b;'), 'return whether a is at least b');
  assert.equal(step('return a > 1 && b < 2;'), 'return whether a is greater than 1 and b is less than 2');
  assert.equal(step('return a ?? b;'), 'return a or else b');
  assert.equal(step('return a + b;'), 'return a + b');
});

test('a boolean return reads "return whether ..."; "not" only for a known boolean', () => {
  assert.equal(step('return !a;', 'a: boolean'), 'return whether not a');
  assert.equal(step('return !(a > 1);'), 'return whether not (a is greater than 1)');
  assert.equal(step('return true;'), 'return true');
  assert.equal(step('return a;', 'a: boolean'), 'return whether a');
  assert.equal(step('return isEmpty(a);'), 'return whether a is empty');
});

test('absence: !x on a non-boolean reads "there is no x", and an if uses a comma', () => {
  assert.equal(step('if (!a) return b;'), 'if there is no a, return b');
  assert.equal(step('if (!a) return b;', 'a: boolean, b'), 'if not a, return b');
  assert.equal(step('if (!a.href) { return b; } else { return c; }'), "if there is no a's href, return b, otherwise return c");
  assert.equal(step('if (a && isEmpty(b)) return c;'), 'if a and b is empty, return c');
});

test('reorderChip reads chips in the same style as toEnglish (plain by default)', () => {
  const code = 'function run(a, b, c) {\n  return combine(a, b, c);\n}';
  const tokens = toEnglish(code, 'function').steps[0].tokens;
  const args = tokens.map((t, i) => (t.type === 'arg' ? i : -1)).filter((i) => i >= 0);
  const order = tokens.map((_, i) => i);
  [order[args[0]], order[args[1]]] = [order[args[1]], order[args[0]]];
  const { code: rebuilt, broken } = reorderChip(code, 'function', 0, order);
  assert.equal(broken, null);
  assert.match(rebuilt, /combine\(b, a, c\)/);
});

test('discrimination: every K1 mutant still reads differently from its reference (plain, exact, canonical)', () => {
  for (const t of K1.tasks) {
    for (const style of ['plain', 'exact']) {
      for (const canonical of [false, true]) {
        const read = (src) => toEnglish(t.prelude + src, 'function', { all: true, style, canonical }).functions.map((f) => f.english).join('\n');
        const ref = read(t.reference);
        t.mutants.forEach((m, i) => {
          assert.notEqual(read(m), ref, `${t.id} mutant ${i + 1} reads the same as the reference (${style}${canonical ? ', canonical' : ''})`);
        });
      }
    }
  }
});
