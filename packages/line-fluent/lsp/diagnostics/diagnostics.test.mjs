// T4.3a: C3 fixtures become diagnostics and quick fixes; applying a fix's edit yields the fixed sentence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDiagnostics, codeActions, wordSpans } from './diagnostics.mjs';

const URI = 'file:///work/answer.fluent';

/** Offset of an LSP position in `text`. */
function offsetOf(text, { line, character }) {
  const lines = text.split('\n');
  return lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0) + character;
}

/** Applies TextEdits (non-overlapping) to `text`, last first. */
function applyEdits(text, edits) {
  return [...edits]
    .map((e) => ({ from: offsetOf(text, e.range.start), to: offsetOf(text, e.range.end), newText: e.newText }))
    .sort((a, b) => b.from - a.from)
    .reduce((t, e) => t.slice(0, e.from) + e.newText + t.slice(e.to), text);
}

/** The document range covering the first occurrence of `sentence` in `text`. */
function rangeOf(text, sentence) {
  const start = text.indexOf(sentence);
  const pos = (offset) => {
    const before = text.slice(0, offset).split('\n');
    return { line: before.length - 1, character: before.at(-1).length };
  };
  return { start: pos(start), end: pos(start + sentence.length) };
}

const c3 = (checks, refusal, fixes) => ({
  entry: 'x',
  pass: !Object.values(checks).includes('fail'),
  checks: { schema: 'pass', grammar: 'pass', equivalence: 'skip', types: 'skip', ...checks },
  refusal,
  fixes,
});

const fixtures = [
  {
    name: 'replace-word in a one-line document',
    text: 'every(x).in(xs).is().mapped().to(f).and().flattened()',
    sentence: 'every(x).in(xs).is().mapped().to(f).and().flattened()',
    result: c3(
      { grammar: 'fail' },
      "The word `flattened` is not in the grammar's verb list; use `flattens()`.",
      [{ kind: 'replace-word', from: 'flattened', to: 'flattens' }],
    ),
    failed: ['grammar'],
    word: 'flattened',
    fixed: 'every(x).in(xs).is().mapped().to(f).and().flattens()',
  },
  {
    name: 'remove-word in the middle drops the dot before it',
    text: "const s = checks().if(a).really().is().greater().than(fn(1, ')'));\n",
    sentence: "checks().if(a).really().is().greater().than(fn(1, ')'))",
    result: c3({ grammar: 'fail' }, 'The word `really` is not in the grammar; remove it.', [
      { kind: 'remove-word', word: 'really' },
    ]),
    failed: ['grammar'],
    word: 'really',
    fixed: "checks().if(a).is().greater().than(fn(1, ')'))",
  },
  {
    name: 'remove-word at the start drops the dot after it',
    text: '// answer\n\n  so().checks().if(xs).is().empty()\n',
    sentence: 'so().checks().if(xs).is().empty()',
    result: c3({ grammar: 'fail', equivalence: 'fail' }, 'The word `so` cannot start a sentence; remove it.', [
      { kind: 'remove-word', word: 'so' },
    ]),
    failed: ['grammar', 'equivalence'],
    word: 'so',
    fixed: 'checks().if(xs).is().empty()',
  },
  {
    name: 'a sentence spanning lines, with a non-word fix ignored',
    text: 'line one\nevery(x).in(xs).is().kept(\n  (y) => y > 1,\n).whenn()\ntail',
    sentence: 'every(x).in(xs).is().kept(\n  (y) => y > 1,\n).whenn()',
    result: c3({ equivalence: 'fail', types: 'fail' }, 'The word `whenn` is misspelled; use `when()`.', [
      { kind: 'replace-word', from: 'whenn', to: 'when' },
      { kind: 'use-existing', atom: 'filtered' },
    ]),
    failed: ['equivalence', 'types'],
    word: 'whenn',
    fixed: 'every(x).in(xs).is().kept(\n  (y) => y > 1,\n).when()',
  },
];

for (const f of fixtures) {
  test(`diagnostics: ${f.name}`, () => {
    const sentenceRange = rangeOf(f.text, f.sentence);
    const plain = toDiagnostics(f.result, { sentenceRange });
    assert.deepEqual(plain.map((d) => d.code), f.failed);
    for (const d of plain) {
      assert.equal(d.severity, 1);
      assert.equal(d.source, 'line-fluent');
      assert.deepEqual(d.range, sentenceRange);
    }
    assert.equal(plain[0].message, f.result.refusal);
    plain.slice(1).forEach((d) => assert.equal(d.message, d.code));

    const located = toDiagnostics(f.result, { sentenceRange, text: f.text });
    const w = located[0].range;
    const from = offsetOf(f.text, w.start);
    assert.equal(f.text.slice(from, offsetOf(f.text, w.end)), f.word);
    located.slice(1).forEach((d) => assert.deepEqual(d.range, sentenceRange));
  });

  test(`code actions: ${f.name}`, () => {
    const sentenceRange = rangeOf(f.text, f.sentence);
    const actions = codeActions(f.result, { uri: URI, text: f.text, sentenceRange });
    assert.equal(actions.length, 1);
    const [action] = actions;
    assert.equal(action.kind, 'quickfix');
    assert.match(action.title, /^(Replace|Remove) the word "/);
    assert.deepEqual(Object.keys(action.edit.changes), [URI]);
    const fixedText = applyEdits(f.text, action.edit.changes[URI]);
    assert.equal(fixedText, f.text.replace(f.sentence, f.fixed));
  });
}

test('a passing result has no diagnostics and no actions', () => {
  const text = 'checks().if(xs).is().empty()';
  const sentenceRange = rangeOf(text, text);
  const ok = c3({ equivalence: 'pass', types: 'pass' }, null, []);
  assert.deepEqual(toDiagnostics(ok, { sentenceRange }), []);
  assert.deepEqual(codeActions(ok, { uri: URI, text, sentenceRange }), []);
});

test('wordSpans gives each call its word and whole-call span', () => {
  const s = "a(1).b('x.y)').c()";
  assert.deepEqual(
    wordSpans(s).map(({ word, start, end }) => [word, s.slice(start, end)]),
    [['a', 'a(1)'], ['b', "b('x.y)')"], ['c', 'c()']],
  );
});
