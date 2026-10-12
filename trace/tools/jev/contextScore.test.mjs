import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreLine, rankLines, capFor, overlap } from './contextScore.mjs';
import { keyTokens, usesKey, splitSentence, labelLine, buildRun, joinActions } from './contextLines.mjs';
import { evaluate } from './eval-context.mjs';

test('fix steps outrank paths in a refusal, which outrank fields and lists', () => {
  const fix = { text: 'Add fixes[0].step instead', kind: 'fix', keys: ['fixes[0].step'] };
  const path = { text: 'features/catalog/spec.md already exists', kind: 'refusal-path', keys: ['features/catalog/spec.md'] };
  const code = { text: 'code: STALE', kind: 'field', src: 'add.code', keys: ['STALE'] };
  const item = { text: 'the Line tools are line.promote', kind: 'list-item', keys: ['line.promote'] };
  const { ranked } = rankLines([item, code, path, fix]);
  assert.deepEqual(ranked.map((l) => l.kind), ['fix', 'refusal-path', 'list-item', 'field']);
  for (const l of ranked) assert.ok(l.score >= 0 && l.score <= 1);
});

test('lexical overlap with the attempted step breaks ties, and the score is deterministic', () => {
  const a = { text: 'the feature pages are features/cart/pages/CartPage.tsx', kind: 'refusal-path', keys: ['features/cart/pages/CartPage.tsx'] };
  const b = { text: 'the feature pages are features/catalog/pages/ListPage.tsx', kind: 'refusal-path', keys: ['features/catalog/pages/ListPage.tsx'] };
  const attempt = 'add line.addRoute {"route":"/cart","file":"features/cart/pages/CartPage.tsx"}';
  assert.ok(scoreLine(a, { attempt }) > scoreLine(b, { attempt }));
  assert.equal(scoreLine(a, { attempt }), scoreLine(a, { attempt }));
  assert.ok(overlap('x', '') === 0);
});

test('the cap is 5, and 15 once a refusal repeats', () => {
  assert.equal(capFor(0), 5);
  assert.equal(capFor(2), 15);
  const lines = Array.from({ length: 20 }, (_, i) => ({ text: `line ${i}`, kind: 'status', keys: [] }));
  assert.equal(rankLines(lines, { cap: capFor(1) }).kept.length, 15);
});

test('key tokens: paths, tools, exports, fix refs; a <placeholder> matches any name', () => {
  const k = keyTokens('A route serves a feature page: name a file like features/<feature>/pages/<Name>.tsx');
  assert.ok(k.includes('features/<feature>/pages/<Name>.tsx'));
  assert.ok(usesKey('{"file":"features/cart/pages/CartPage.tsx"}', 'features/<feature>/pages/<Name>.tsx'));
  assert.ok(!usesKey('{"page":"ListPage"}', 'features/<feature>/pages/<Name>.tsx'));
  assert.ok(keyTokens('Add fixes[0].step instead; use line.setCode').includes('line.setCode'));
  assert.ok(keyTokens('Creates ListPage in feature catalog').includes('ListPage'));
  assert.ok(usesKey('read ["features/catalog/spec.md"]', 'cmd:read'));
});

test('a sentence splits into clauses and one line per listed path', () => {
  const ls = splitSentence('A route serves a feature page: name a file like features/<feature>/pages/<Name>.tsx (the feature pages are features/product/pages/DetailPage.tsx, features/catalog/pages/ListPage.tsx; each is in fixes). Add fixes[0].step instead.');
  assert.ok(ls.some((l) => l.kind === 'list-item' && l.text.endsWith('features/product/pages/DetailPage.tsx')));
  assert.ok(ls.some((l) => l.kind === 'list-item' && l.text.endsWith('features/catalog/pages/ListPage.tsx')));
  assert.ok(ls.some((l) => l.text.startsWith('Add fixes[0].step')));
});

test('labels: used + accepted is useful, ignored + refused is noise, else unclear', () => {
  const line = { keys: ['features/catalog/spec.md'] };
  assert.equal(labelLine(line, 'read features/catalog/spec.md', 'accepted'), 'useful');
  assert.equal(labelLine(line, 'add line.addRoute {}', 'refused'), 'noise');
  assert.equal(labelLine(line, 'add line.setCode features/catalog/spec.md', 'refused'), 'unclear');
  assert.equal(labelLine(line, 'status', 'accepted'), 'unclear');
});

test('a run joins turns to calls and labels the lines a refusal showed', () => {
  const calls = [
    { kind: 'call', cmd: 'add', args: { tool: 'line.setCode', args: { file: 'features/catalog/spec.md' } }, result: { ok: false, code: 'STALE', sentence: 'features/catalog/spec.md already exists; read it first and pass its contentHash.', tool: 'line.setCode' } },
    { kind: 'approval', stepId: 's1' },
    { kind: 'call', cmd: 'read', args: ['features/catalog/spec.md'], result: { ok: true, sentence: 'Read features/catalog/spec.md (6 lines).' } },
  ];
  const turns = [
    { kind: 'turn', turn: 1, in: 100, out: 10, calls: [{ name: 'plan_add' }], said: '' },
    { kind: 'turn', turn: 2, in: 150, out: 5, calls: [{ name: 'read_file' }], said: '' },
  ];
  assert.equal(joinActions(calls, turns).length, 2);
  const rows = buildRun('r', calls, turns);
  const by = Object.fromEntries(rows.map((r) => [r.text, r.label]));
  assert.equal(by['features/catalog/spec.md already exists'], 'useful');
  assert.equal(by['code: STALE'], 'unclear');
  assert.equal(rows[0].shownTokens, 40);
  assert.ok(rows.every((r) => /^r:0:[a-z0-9]+$/.test(r.id)));
  const m = evaluate(rows);
  assert.equal(m.turnsWithUseful, 1);
  assert.equal(m['r@5'], 1);
});
