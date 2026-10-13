// S8: Smith golden tests. The corpus placeholder rate may not regress past
// the thresholds below, which were set from the measured value after S5-S7
// (380 Construct functions: 0 placeholders, 0 throws, 100% clean in both
// logic and JSX). The owner's closing bar (logic >= 95%, JSX >= 80% clean)
// is asserted too, but the measured thresholds are the stricter ones.
//
// The in-repo fixture (bench/fixtures/smith-sample.tsx) runs everywhere and
// is also checked against a golden English snapshot; refresh it after an
// intended wording change with SMITH_UPDATE_GOLDEN=1 node --test smith-golden.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { toEnglish } = require('./to-english');
const corpus = require('./bench/corpus');

const THRESHOLDS = {
  maxPlaceholderRate: 0, // placeholders per chip, measured 0 / 16.5k chips
  maxThrows: 0,
  minCleanLogic: 1.0, // measured 207/207
  minCleanJsx: 1.0, // measured 173/173
};
const OWNER_BAR = { minCleanLogic: 0.95, minCleanJsx: 0.8 };

const FIXTURE = path.join(__dirname, 'bench/fixtures/smith-sample.tsx');
const GOLDEN = path.join(__dirname, 'bench/fixtures/smith-sample.golden.json');

function assertBucket(name, b, minClean) {
  const leftovers = JSON.stringify(b.byType);
  assert.ok(b.throws <= THRESHOLDS.maxThrows, `${name}: ${b.throws} functions threw`);
  assert.ok(b.placeholderRate <= THRESHOLDS.maxPlaceholderRate, `${name}: placeholder rate ${b.placeholderRate} > ${THRESHOLDS.maxPlaceholderRate} (${leftovers})`);
  assert.ok(b.cleanRate >= minClean, `${name}: clean ${b.cleanRate} < ${minClean} (${leftovers})`);
}

const live = corpus.loadCorpus();

test('golden: Construct corpus placeholder rate stays at or under the measured threshold', { skip: !live.files.length && 'no corpus (set SMITH_CORPUS)' }, () => {
  const m = corpus.measure(live.functions, corpus.currentDescriber(toEnglish));
  assert.ok(live.functions.length >= 300, `corpus shrank to ${live.functions.length} functions`);
  assertBucket('overall', m.overall, 0);
  assertBucket('logic', m.logic, Math.max(THRESHOLDS.minCleanLogic, OWNER_BAR.minCleanLogic));
  assertBucket('jsx', m.jsx, Math.max(THRESHOLDS.minCleanJsx, OWNER_BAR.minCleanJsx));
});

test('golden: in-repo fixture has no placeholders, in logic or JSX', () => {
  const fns = corpus.extractFunctions(fs.readFileSync(FIXTURE, 'utf8'));
  assert.ok(fns.some((f) => f.jsx) && fns.some((f) => !f.jsx));
  const m = corpus.measure(fns, corpus.currentDescriber(toEnglish));
  assertBucket('fixture logic', m.logic, THRESHOLDS.minCleanLogic);
  assertBucket('fixture jsx', m.jsx, THRESHOLDS.minCleanJsx);
});

test('golden: in-repo fixture English matches the snapshot (whole file, {all: true})', () => {
  const r = toEnglish(fs.readFileSync(FIXTURE, 'utf8'), 'function', { all: true });
  const actual = r.functions.map((f) => ({ name: f.name, kind: f.kind, english: f.english }));
  if (process.env.SMITH_UPDATE_GOLDEN) fs.writeFileSync(GOLDEN, `${JSON.stringify(actual, null, 2)}\n`);
  assert.deepEqual(actual, JSON.parse(fs.readFileSync(GOLDEN, 'utf8')));
});
