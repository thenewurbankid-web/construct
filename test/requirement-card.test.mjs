// #640 -- a requirement becomes a noun-verb card with closed vocabularies. The parser is deterministic and never guesses:
// an unknown word is a closed question; every word is covered, open or a stop word (validateCard proves it); the worked
// example in docs/REQUIREMENT-CARD.md is executed here so it cannot go stale. No model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CARD_ERROR_CODES, CARD_LIMITS, CARD_VERSION, cardSummary, defaultLexicon, openQuestion, parseRequirement, readBack, resolveOpen, validateCard, validateLexicon,
} from '../packages/core/requirement-card.mjs';
import { CHOOSER_LIMITS } from '../packages/core/chooser.mjs';
import { suggest } from '../packages/core/decision-provider.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const codes = (r) => r.errors.map((e) => e.code);
const clone = (v) => structuredClone(v);

const BILLING = 'A logged-in user needs to see their current subscription plan and be able to click a button to manage their billing details safely via Stripe.';
const UPLOAD = 'A user wants to upload a profile picture and see it update instantly.';
const SEARCH = 'A customer wants to search products with instant keyboard filtering.';
const parse = (text) => {
  const r = parseRequirement(text);
  assert.ok(r.card, JSON.stringify(r.errors));
  return r;
};
const nounText = (card, id) => card.nouns.find((n) => n.id === id).text;
const shape = (card) => ({
  nouns: card.nouns.map((n) => `${n.kind}:${n.text}`),
  verbs: card.verbs.map((v) => `${v.kind}:${v.text}>${v.on.map((id) => nounText(card, id)).join('+')}`),
  checks: card.checks.map((c) => `${c.from}=${c.name}`),
  open: card.open.map((o) => o.text),
});

test('the error codes are a frozen name-to-name map and the size limits equal the chooser limits', () => {
  assert.equal(Object.isFrozen(CARD_ERROR_CODES), true);
  for (const [k, v] of Object.entries(CARD_ERROR_CODES)) assert.equal(k, v);
  assert.equal(CARD_VERSION, 'requirement-card.v1');
  for (const k of ['minOptions', 'maxOptions', 'question', 'label', 'why']) assert.equal(CARD_LIMITS[k], CHOOSER_LIMITS[k], k);
});

test('lexicon shape: the groups the story names exist, every adjective maps to real checks, and a broken lexicon is refused by code', () => {
  const lex = defaultLexicon();
  assert.deepEqual(validateLexicon(lex), { valid: true, errors: [] });
  const has = (list, words) => words.every((w) => list.includes(w));
  assert.ok(has(lex.verbs.read, ['see', 'view', 'show', 'list', 'display', 'browse']));
  assert.ok(has(lex.verbs.interact, ['click', 'press', 'tap', 'type', 'select', 'drag', 'upload']));
  assert.ok(has(lex.verbs.write, ['manage', 'save', 'update', 'create', 'delete', 'submit', 'change', 'pay']));
  assert.ok(has(lex.verbs.navigate, ['open', 'go', 'visit', 'return', 'redirect']));
  assert.ok(has(Object.keys(lex.nouns['ui-part']), ['button', 'form', 'table', 'list', 'card', 'dialog', 'menu', 'input', 'page']));
  assert.ok(has(Object.keys(lex.nouns.state), ['logged-in', 'signed-in', 'guest', 'admin']));
  assert.ok(has(Object.keys(lex.adjectives), ['safely', 'securely', 'instantly', 'quickly', 'privately', 'reliably', 'accessibly']));
  assert.ok(has(Object.keys(lex.checks), ['auth-session-check', 'server-only-secret', 'latency-budget']));
  for (const [adj, names] of Object.entries(lex.adjectives)) for (const n of names) assert.ok(lex.checks[n]?.why, `${adj} -> ${n}`);
  assert.equal(Object.isFrozen(lex), true);

  const bad = (edit) => { const l = clone(lex); edit(l); return codes(validateLexicon(l)); };
  assert.deepEqual(codes(validateLexicon(null)), ['LEXICON_NOT_OBJECT']);
  assert.deepEqual(bad((l) => { l.adjectives.safely = ['no-such-check']; }), ['LEXICON_CHECK_UNKNOWN']);
  assert.deepEqual(bad((l) => { l.verbs.read.push('click'); }), ['LEXICON_WORD_CLASH']);
  assert.deepEqual(bad((l) => { l.stopWords.actors.push('button'); }), ['LEXICON_WORD_CLASH']);
  assert.deepEqual(bad((l) => { delete l.verbs.navigate; }), ['LEXICON_SHAPE']);
  assert.deepEqual(bad((l) => { l.questions.noun.options.pop(); }), ['LEXICON_QUESTION_INVALID']);
  assert.equal(parseRequirement('A user can click.', { lexicon: { version: 1 } }).errors[0].code, 'PARSE_LEXICON_INVALID');
});

test('the subscription-billing sentence gives the exact card: nouns, verbs, and "safely" kept as three named checks', () => {
  const { card, open } = parse(BILLING);
  assert.deepEqual(open, []);
  assert.deepEqual(validateCard(card), { valid: true, errors: [] });
  assert.deepEqual(card.nouns.map((n) => [n.id, n.kind, n.text, n.properties ?? null, n.span]), [
    ['n1', 'state', 'logged-in user', ['session'], [2, 16]],
    ['n2', 'entity', 'current subscription plan', ['planName', 'status'], [36, 61]],
    ['n3', 'ui-part', 'button', ['interactive'], [85, 91]],
    ['n4', 'entity', 'billing details', null, [108, 123]],
    ['n5', 'external', 'Stripe', null, [135, 141]],
  ]);
  assert.deepEqual(card.verbs.map((v) => [v.id, v.kind, v.text, v.on, v.span]), [
    ['v1', 'read', 'see', ['n2'], [26, 29]],
    ['v2', 'interact', 'click', ['n3'], [77, 82]],
    ['v3', 'write', 'manage', ['n4', 'n5'], [95, 101]],
  ]);
  assert.deepEqual(card.checks.map((c) => [c.id, c.name, c.from, c.span]), [
    ['c1', 'auth-session-check', 'safely', [124, 130]],
    ['c2', 'server-only-secret', 'safely', [124, 130]],
    ['c3', 'validated-redirect', 'safely', [124, 130]],
  ]);
  for (const item of [...card.nouns, ...card.verbs]) assert.equal(BILLING.slice(...item.span), item.text, 'every span points at the words it came from');
});

test('the two other examples of #641 are classified without a model or an open question', () => {
  const upload = parse(UPLOAD).card;
  assert.deepEqual(shape(upload), { nouns: ['entity:profile picture'], verbs: ['interact:upload>profile picture', 'read:see>profile picture', 'write:update>profile picture'], checks: ['instantly=latency-budget'], open: [] });
  const search = parse(SEARCH).card;
  assert.deepEqual(shape(search), { nouns: ['entity:products', 'ui-part:keyboard'], verbs: ['read:search>products', 'read:filtering>products+keyboard'], checks: ['instant=latency-budget'], open: [] });
  for (const card of [upload, search]) assert.deepEqual(validateCard(card), { valid: true, errors: [] });
});

test('templates: "When <trigger>, <actor> can <verb> <noun>", "<actor> can <verb> <noun> via <external>", several sentences', () => {
  const when = parse('When the user clicks the button, the page shows their profile.').card;
  assert.deepEqual(shape(when).verbs, ['interact:clicks>button', 'read:shows>page+profile']);
  const via = parse('A guest can pay an invoice via PayPal.').card;
  assert.deepEqual(shape(via), { nouns: ['state:guest', 'entity:invoice', 'external:PayPal'], verbs: ['write:pay>invoice+PayPal'], checks: [], open: [] });
  const two = parse('An admin can delete an order.\nA visitor can browse the products!').card;
  assert.deepEqual(shape(two).verbs, ['write:delete>order', 'read:browse>products']);
  assert.deepEqual(validateCard(two), { valid: true, errors: [] });
  const list = parse('A user can list orders. The page shows a list.').card;
  assert.deepEqual(shape(list).verbs, ['read:list>orders', 'read:shows>page+list'], 'list is a verb after "can", a noun elsewhere');
});

test('an unknown word becomes a closed question of 2-5 options and is never guessed', () => {
  const { card, open } = parse('A user can frobnicate the widget.');
  assert.deepEqual(shape(card), { nouns: [], verbs: [], checks: [], open: ['frobnicate', 'widget'] });
  assert.deepEqual(card.open.map((o) => [o.id, o.slot, o.span]), [['o1', 'verb', [11, 21]], ['o2', 'noun', [26, 32]]]);
  assert.deepEqual(open.map((q) => q.options.map((o) => o.id)), [['read', 'write', 'interact', 'navigate', 'ignore'], ['entity', 'state', 'ui-part', 'external', 'ignore']]);
  for (const q of open) {
    assert.ok(q.options.length >= CHOOSER_LIMITS.minOptions && q.options.length <= CHOOSER_LIMITS.maxOptions);
    assert.equal(q.chosen, null);
    assert.ok(q.options.every((o) => o.enabled && o.label && o.why));
  }
  assert.deepEqual(validateCard(card), { valid: true, errors: [] }, 'open words count as covered');
  assert.equal(openQuestion(card, card.open[1]).question, open[1].question);
});

test('a decision provider can suggest an option for an open question, and only suggests', async () => {
  const { open } = parse('A user can frobnicate the widget.');
  const s = await suggest(open[1], { provider: 'rules' });
  assert.equal(s.option, 'entity');
  assert.equal(s.provider, 'rules');
});

test('resolveOpen: valid answers give a new card, partial answers leave questions open, the input is untouched', () => {
  const { card } = parse('A user can frobnicate the widget.');
  const before = clone(card);
  const r = resolveOpen(card, { o1: 'write', o2: 'entity' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(card, before, 'never mutates');
  assert.notEqual(r.card, card);
  assert.deepEqual(shape(r.card), { nouns: ['entity:widget'], verbs: ['write:frobnicate>widget'], checks: [], open: [] });
  assert.deepEqual(r.card.answers.map((a) => [a.open, a.option]), [['o1', 'write'], ['o2', 'entity']]);
  assert.deepEqual(r.open, []);
  assert.deepEqual(validateCard(r.card), { valid: true, errors: [] });

  const partial = resolveOpen(card, { o2: 'ui-part' });
  assert.deepEqual(shape(partial.card), { nouns: ['ui-part:widget'], verbs: [], checks: [], open: ['frobnicate'] });
  assert.equal(partial.open.length, 1);
  const rest = resolveOpen(partial.card, { o1: 'ignore' });
  assert.equal(rest.ok, true);
  assert.deepEqual(shape(rest.card), { nouns: ['ui-part:widget'], verbs: [], checks: [], open: [] });
  assert.deepEqual(validateCard(rest.card), { valid: true, errors: [] }, 'an ignored word is covered by its recorded answer');
  assert.deepEqual(resolveOpen(card, { o1: 'write' }).card.answers.map((a) => a.text), ['frobnicate']);
});

test('resolveOpen: unknown questions, unknown options, wrong-slot options and bad input are typed errors, never throws', () => {
  const { card } = parse('A user can frobnicate the widget.');
  const err = (answers, c = card) => { const r = resolveOpen(c, answers); assert.equal(r.ok, false); assert.equal(r.card, null); return codes(r); };
  assert.deepEqual(err({ o9: 'entity' }), ['RESOLVE_UNKNOWN_OPEN']);
  assert.deepEqual(err({ o2: 'teleport' }), ['RESOLVE_UNKNOWN_OPTION']);
  assert.deepEqual(err({ o2: 'write' }), ['RESOLVE_UNKNOWN_OPTION'], 'a verb option is not offered for a noun');
  assert.deepEqual(err({ o1: 'entity' }), ['RESOLVE_UNKNOWN_OPTION'], 'a noun option is not offered for a verb');
  assert.deepEqual(err({ o1: 7 }), ['RESOLVE_UNKNOWN_OPTION']);
  assert.deepEqual(err({ o9: 'x', o2: 'y' }), ['RESOLVE_UNKNOWN_OPEN', 'RESOLVE_UNKNOWN_OPTION'], 'every problem is reported');
  for (const bad of [null, 'entity', ['entity'], undefined, 3]) assert.deepEqual(err(bad), ['RESOLVE_ANSWERS_INVALID']);
  for (const badCard of [null, {}, 'card', { ...card, version: 'x' }]) assert.equal(err({ o1: 'read' }, badCard)[0], 'RESOLVE_CARD_INVALID');
  assert.deepEqual(resolveOpen(card, {}).card.open.map((o) => o.id), ['o1', 'o2'], 'no answers: the same questions remain');
});

test('adjectives are never dropped: each one gives its named checks, two adjectives give at least two checks', () => {
  const { card } = parse('A user can quickly and securely save a form privately.');
  assert.deepEqual(card.checks.map((c) => `${c.from}=${c.name}`), [
    'quickly=latency-budget',
    'securely=auth-session-check', 'securely=server-only-secret',
    'privately=auth-session-check', 'privately=owner-only-access',
  ]);
  assert.deepEqual([...new Set(card.checks.map((c) => c.from))], ['quickly', 'securely', 'privately']);
  for (const [adj, names] of Object.entries(defaultLexicon().adjectives)) {
    const c = parse(`A user can save a form ${adj}.`).card;
    assert.deepEqual(c.checks.map((x) => x.name), names, adj);
    assert.ok(c.checks.every((x) => x.why && x.from === adj));
  }
});

test('determinism: the same text gives a byte-identical card, summary and read-back on a second run', () => {
  for (const text of [BILLING, UPLOAD, SEARCH, 'A user can frobnicate the widget.']) {
    const a = parseRequirement(text);
    const b = parseRequirement(text);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(JSON.stringify(cardSummary(a.card)), JSON.stringify(cardSummary(b.card)));
    assert.equal(JSON.stringify(readBack(a.card)), JSON.stringify(readBack(b.card)));
  }
});

test('validateCard: schema problems and the coverage proof are named by code', () => {
  const good = parse(BILLING).card;
  const bad = (edit) => { const c = clone(good); edit(c); return codes(validateCard(c)); };
  assert.deepEqual(codes(validateCard(null)), ['CARD_NOT_OBJECT']);
  assert.deepEqual(bad((c) => { c.version = 'v2'; }), ['CARD_VERSION_INVALID']);
  assert.deepEqual(bad((c) => { c.source.text = ''; }), ['CARD_SOURCE_INVALID']);
  assert.deepEqual(bad((c) => { c.nouns = 'x'; }), ['CARD_LIST_INVALID']);
  assert.deepEqual(bad((c) => { c.nouns[0] = 4; }), ['CARD_ITEM_NOT_OBJECT', 'CARD_COVERAGE_UNCOVERED_WORD']);
  assert.deepEqual(bad((c) => { c.nouns[1].id = 'x'; }), ['CARD_ID_INVALID', 'CARD_VERB_TARGET_UNKNOWN']);
  assert.deepEqual(bad((c) => { c.nouns[0].id = 'n2'; }), ['CARD_ID_DUPLICATE']);
  assert.deepEqual(bad((c) => { c.nouns[1].kind = 'thing'; }), ['CARD_KIND_INVALID']);
  assert.deepEqual(bad((c) => { c.verbs[0].kind = 'run'; }), ['CARD_KIND_INVALID']);
  assert.deepEqual(bad((c) => { c.nouns[1].span = [61, 36]; }), ['CARD_SPAN_INVALID', 'CARD_COVERAGE_UNCOVERED_WORD', 'CARD_COVERAGE_UNCOVERED_WORD', 'CARD_COVERAGE_UNCOVERED_WORD']);
  assert.deepEqual(bad((c) => { c.nouns[1].text = 'plan'; }), ['CARD_SPAN_TEXT_MISMATCH']);
  assert.deepEqual(bad((c) => { c.nouns[1].properties = [3]; }), ['CARD_PROPERTIES_INVALID']);
  assert.deepEqual(bad((c) => { c.verbs[0].on = ['n9']; }), ['CARD_VERB_TARGET_UNKNOWN']);
  assert.deepEqual(bad((c) => { c.checks[0].name = 'be-nice'; }), ['CARD_CHECK_UNKNOWN']);
  assert.deepEqual(bad((c) => { c.checks[0].why = ''; }), ['CARD_CHECK_FIELD_INVALID']);
  assert.deepEqual(bad((c) => { c.nouns[2].span = [77, 91]; c.nouns[2].text = BILLING.slice(77, 91); }), ['CARD_SPAN_OVERLAP']);
  const open = clone(parse('A user can frobnicate the widget.').card);
  open.open[0].slot = 'adverb';
  assert.deepEqual(codes(validateCard(open)), ['CARD_OPEN_INVALID']);
  open.open[0].slot = 'verb';
  open.answers = [{ open: 'o1', text: 'wrong', span: [11, 21], slot: 'verb', option: 'read' }];
  assert.deepEqual(codes(validateCard(open)), ['CARD_ANSWER_INVALID']);
});

test('coverage: a word that is neither in a span, open, nor a stop word fails, and dropping an item is caught', () => {
  const card = clone(parse(BILLING).card);
  card.verbs.splice(0, 1); // "see" is no longer covered
  const r = validateCard(card);
  assert.deepEqual(codes(r), ['CARD_COVERAGE_UNCOVERED_WORD']);
  assert.match(r.errors[0].message, /"see"/);
  const dropped = clone(parse(UPLOAD).card);
  dropped.checks = []; // "instantly" is no longer covered
  assert.match(validateCard(dropped).errors[0].message, /"instantly"/);
  const fresh = { version: CARD_VERSION, source: { text: 'Hello there' }, nouns: [], verbs: [], checks: [], open: [] };
  assert.deepEqual(codes(validateCard(fresh)), ['CARD_COVERAGE_UNCOVERED_WORD', 'CARD_COVERAGE_UNCOVERED_WORD']);
  fresh.open = [{ id: 'o1', text: 'Hello', span: [0, 5], slot: 'noun', question: 'What is "Hello"?' }, { id: 'o2', text: 'there', span: [6, 11], slot: 'noun', question: 'What is "there"?' }];
  assert.deepEqual(validateCard(fresh), { valid: true, errors: [] });
});

test('parseRequirement: unusable input is a typed error, not a throw', () => {
  for (const bad of [undefined, null, '', '   ', 42, {}]) {
    const r = parseRequirement(bad);
    assert.equal(r.card, null);
    assert.deepEqual(codes(r), ['PARSE_TEXT_INVALID']);
  }
  const wrong = parseRequirement('A user can click a button.', { answers: [{ open: 'o1', text: 'x', span: [1, 2], slot: 'noun', option: 'entity' }] });
  assert.deepEqual(codes(wrong), ['PARSE_ANSWER_INVALID']);
  assert.equal(parseRequirement('A user can click a button.', { answers: 'nope' }).card.verbs.length, 1);
});

test('summary: a fixed maximum size whatever the input, and a small card is not truncated', () => {
  const small = cardSummary(parse(BILLING).card);
  assert.deepEqual(small.counts, { nouns: 5, verbs: 3, checks: 3, open: 0 });
  assert.equal(small.truncated, false);
  assert.equal(small.readBack.length, 11);
  const huge = parse(`${'A user can click a button and see a table via Stripe safely, then frobnicate the gizmo. '.repeat(60)}`).card;
  const summary = cardSummary(huge);
  assert.equal(summary.truncated, true);
  assert.ok(huge.nouns.length > CARD_LIMITS.items);
  for (const k of ['nouns', 'verbs', 'checks']) assert.ok(summary[k].length <= CARD_LIMITS.items, k);
  assert.ok(summary.open.length <= CARD_LIMITS.maxOptions);
  assert.ok(summary.readBack.length <= CARD_LIMITS.lines);
  assert.ok(summary.text.length <= CARD_LIMITS.text);
  assert.ok(summary.readBack.every((l) => l.length <= CARD_LIMITS.line));
  assert.ok(JSON.stringify(summary).length < 6000, `summary is ${JSON.stringify(summary).length} bytes`);
  assert.ok(JSON.stringify(huge).length > 10 * JSON.stringify(summary).length, 'the card is much larger than its summary');
});

test('read-back: one plain-English line per noun, verb and check', () => {
  const lines = readBack(parse(BILLING).card);
  assert.deepEqual(lines.map((l) => l.id), ['n1', 'n2', 'n3', 'n4', 'n5', 'v1', 'v2', 'v3', 'c1', 'c2', 'c3']);
  assert.equal(lines[0].line, '"logged-in user" is a state of the user: session.');
  assert.equal(lines[7].line, '"manage" changes "billing details", "Stripe".');
  assert.match(lines[8].line, /^"safely" needs auth-session-check: /);
  assert.ok(lines.every((l) => l.line.length <= CARD_LIMITS.line));
});

test('nothing here can reach a model or the network: the module imports only node:fs and node:url and uses no client', () => {
  const src = fs.readFileSync(path.join(here, '..', 'packages', 'core', 'requirement-card.mjs'), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ['node:fs', 'node:url']);
  assert.doesNotMatch(src, /\b(fetch|XMLHttpRequest|WebSocket|child_process|https?:\/\/|require\()/);
  assert.doesNotMatch(src, /\bimport\s*\(/);
  const lexicon = fs.readFileSync(path.join(here, '..', 'packages', 'core', 'requirement-lexicon.json'), 'utf8');
  assert.doesNotThrow(() => JSON.parse(lexicon), 'the lexicon is data only');
  const exported = JSON.parse(fs.readFileSync(path.join(here, '..', 'packages', 'core', 'package.json'), 'utf8')).exports;
  assert.equal(exported['./requirement-card'], './requirement-card.mjs');
});

test('the worked example in docs/REQUIREMENT-CARD.md runs and produces exactly the card the doc shows', async () => {
  const doc = fs.readFileSync(path.join(here, '..', 'docs', 'REQUIREMENT-CARD.md'), 'utf8');
  const code = /<!-- card-example:code -->\n```js\n([\s\S]*?)```/.exec(doc)?.[1];
  const shown = /<!-- card-example:result -->\n```json\n([\s\S]*?)```/.exec(doc)?.[1];
  assert.ok(code && shown, 'the doc carries both example blocks');
  assert.match(code, /'@line\/construct-core\/requirement-card'/);
  const url = pathToFileURL(path.join(here, '..', 'packages', 'core', 'requirement-card.mjs')).href;
  const dir = makeTempDir('og640-doc-');
  const file = path.join(dir, 'example.mjs');
  fs.writeFileSync(file, code.replace("'@line/construct-core/requirement-card'", `'${url}'`));
  const { card } = await import(pathToFileURL(file).href);
  assert.deepEqual(validateCard(card), { valid: true, errors: [] });
  assert.equal(card.source.text, BILLING);
  assert.deepEqual(JSON.parse(shown), JSON.parse(JSON.stringify(card)));
});
