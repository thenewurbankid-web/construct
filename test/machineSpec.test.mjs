// #576 / #584 (R1) -- machine-spec.v1: schema, validator and `construct research spec`.
//
// Three things are pinned here:
//   1. the worked example passes, and each checked-in failing fixture fails with
//      exactly the SPEC-* code it exists to demonstrate;
//   2. every SPEC-* rule fires on a one-line mutation of the example, with the
//      path pointing at the offending item;
//   3. the hand-written structural pass and packages/core/research/
//      machine-spec.v1.schema.json agree (ajv, draft-07, is a dev dependency
//      only -- see the module header for why it is not used at runtime).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import {
  validateMachineSpec,
  renderMachineSpecReport,
  SPEC_RULES,
  ITEM_SHAPES,
  LIST_FIELDS,
  TOP_LEVEL_REQUIRED,
  TOP_LEVEL_FIELDS,
} from '../packages/core/research/machine-spec.mjs';
import { EXIT_CODES } from '../packages/core/diagnostics.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESEARCH = path.join(REPO_ROOT, 'packages', 'core', 'research');
const EXAMPLE = path.join(RESEARCH, 'examples', 'machine-spec.v1.example.json');
const FIXTURES = path.join(REPO_ROOT, 'fixtures', 'machine-spec');
const BIN = path.join(REPO_ROOT, 'packages', 'cli', 'construct.mjs');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(RESEARCH, 'machine-spec.v1.schema.json'), 'utf8'));
const ajvValidate = new Ajv({ allErrors: true }).compile(SCHEMA);

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const example = () => readJson(EXAMPLE);
const rules = (result) => result.violations.map((v) => v.rule);
const run = (args) => spawnSync('node', [BIN, ...args], { encoding: 'utf8', cwd: REPO_ROOT });

/** Mutate a copy of the example and assert the validator fires `rule` at `at` (and only the listed rules). */
function failsWith(rule, at, mutate, { only = [rule] } = {}) {
  const spec = example();
  mutate(spec);
  const result = validateMachineSpec(spec, { file: 'mutated.json' });
  assert.equal(result.status, 'failed', `expected ${rule}, but the spec passed: ${JSON.stringify(spec).slice(0, 200)}`);
  assert.deepEqual([...new Set(rules(result))].sort(), [...only].sort(), `rules fired: ${JSON.stringify(result.violations.map((v) => [v.rule, v.path]))}`);
  const hit = result.violations.find((v) => v.rule === rule);
  assert.equal(hit.path, at);
  assert.equal(hit.module, 'machine-spec');
  assert.equal(hit.severity, 'error');
  assert.equal(hit.file, 'mutated.json');
  assert.match(hit.why, /\S/, 'every violation carries a why line');
  assert.ok(Array.isArray(hit.expected));
  return result;
}

// ---------------------------------------------------------------------------
// 1. Example and fixtures

test('the worked example passes both the validator and the schema, with full coverage', () => {
  const result = validateMachineSpec(example(), { file: 'example' });
  assert.equal(result.status, 'passed', JSON.stringify(result.violations, null, 2));
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.counts, { sentences: 6, covered: 5, outOfScope: 1, states: 5, events: 4, transitions: 5, functions: 3 });
  assert.equal(ajvValidate(example()), true, JSON.stringify(ajvValidate.errors));
  assert.match(renderMachineSpecReport(result), /^✓ machine-spec\.v1 example passed — 6 sentence\(s\): 5 covered, 1 out of scope; 5 state\(s\)/);
});

test('each checked-in failing fixture fails with exactly the code it demonstrates', () => {
  const expected = {
    'unreachable-state.json': ['SPEC-007', 'states[5]'],
    'untyped-function.json': ['SPEC-008', 'functions[1].output'],
    'uncovered-sentence.json': ['SPEC-010', 'requirement[5]'],
    'unknown-type.json': ['SPEC-014', 'functions[2].input'],
  };
  assert.deepEqual(fs.readdirSync(FIXTURES).sort(), Object.keys(expected).sort(), 'every fixture in the folder is pinned here');
  for (const [name, [rule, at]] of Object.entries(expected)) {
    const result = validateMachineSpec(readJson(path.join(FIXTURES, name)), { file: name });
    assert.equal(result.status, 'failed', name);
    assert.deepEqual(rules(result), [rule], `${name}: ${JSON.stringify(result.violations)}`);
    assert.equal(result.violations[0].path, at, name);
  }
  // The untyped function is the one fixture the schema can also see; ajv agrees on it.
  assert.equal(ajvValidate(readJson(path.join(FIXTURES, 'untyped-function.json'))), false);
  // The others are the validator's own (a graph walk, a coverage check and a name lookup are not JSON Schema).
  assert.equal(ajvValidate(readJson(path.join(FIXTURES, 'unreachable-state.json'))), true);
  assert.equal(ajvValidate(readJson(path.join(FIXTURES, 'uncovered-sentence.json'))), true);
  assert.equal(ajvValidate(readJson(path.join(FIXTURES, 'unknown-type.json'))), true);
});

// ---------------------------------------------------------------------------
// 2. Every rule, one mutation each

test('SPEC-001 fires on structural problems and stops the meaning pass', () => {
  const cases = [
    ['version', (s) => { s.version = 2; }],
    ['bogus', (s) => { s.bogus = true; }],
    ['name', (s) => { s.name = ''; }],
    ['requirement', (s) => { s.requirement = []; }],
    ['states', (s) => { s.states = {}; }],
    ['states[0].colour', (s) => { s.states[0].colour = 'red'; }],
    ['states[0].initial', (s) => { s.states[0].initial = 'yes'; }],
    ['events[0].req', (s) => { s.events[0].req = []; }],
    ['events[0].req', (s) => { s.events[0].req = ['s1', 's1']; }],
    ['transitions[0].guard', (s) => { s.transitions[0].guard = ' spaced '; }],
    ['transitions[0].from', (s) => { delete s.transitions[0].from; }],
    ['functions[0].name', (s) => { s.functions[0].name = 'verify credentials'; }],
    ['functions[0].postcondition', (s) => { delete s.functions[0].postcondition; }],
    ['outOfScope[0].reason', (s) => { s.outOfScope[0].reason = ''; }],
    ['requirement[1]', (s) => { s.requirement[1] = 'a bare string'; }],
    ['ext', (s) => { s.ext = []; }],
  ];
  for (const [at, mutate] of cases) {
    const result = failsWith('SPEC-001', at, mutate);
    assert.equal(result.counts, null, `${at}: no counts while the structure is broken`);
  }
  // A structural problem elsewhere does not hide as a meaning violation: only SPEC-001 fires even
  // though the mutated spec would also be unreachable/uncovered once its shape is fixed.
  failsWith('SPEC-001', 'states[0].initial', (s) => { s.states[0].initial = 'yes'; s.states.push({ id: 'orphan', req: ['s1'] }); });
  const notObject = validateMachineSpec('nope');
  assert.deepEqual(rules(notObject), ['SPEC-001']);
  assert.equal(notObject.file, '<spec>');
});

test('SPEC-002: duplicate ids in each list, pointing at the second occurrence', () => {
  // Renaming s6 to s1 also strands the outOfScope link to s6, so SPEC-009 rides along.
  failsWith('SPEC-002', 'requirement[5].id', (s) => { s.requirement[5].id = 's1'; }, { only: ['SPEC-002', 'SPEC-009'] });
  // Renaming "failed" to "idle" leaves t4/t5 pointing at a state that no longer exists.
  failsWith('SPEC-002', 'states[3].id', (s) => { s.states[3].id = 'idle'; }, { only: ['SPEC-002', 'SPEC-004'] });
  failsWith('SPEC-002', 'events[3].id', (s) => { s.events[3].id = 'SUBMIT'; }, { only: ['SPEC-002', 'SPEC-005'] });
  failsWith('SPEC-002', 'transitions[4].id', (s) => { s.transitions[4].id = 't1'; });
  failsWith('SPEC-002', 'functions[2].name', (s) => { s.functions[2].name = 'verifyCredentials'; });
  failsWith('SPEC-002', 'outOfScope[1].req', (s) => { s.outOfScope.push({ req: 's6', reason: 'again' }); });
});

test('SPEC-003: exactly one initial state', () => {
  failsWith('SPEC-003', 'states', (s) => { delete s.states[0].initial; });
  failsWith('SPEC-003', 'states', (s) => { s.states[1].initial = true; });
  failsWith('SPEC-003', 'states', (s) => { s.states[0].initial = false; });
});

test('SPEC-004 / SPEC-005: transitions naming unknown states or events, with the known ones as expected', () => {
  // Pointing t2 elsewhere also strands signedIn, so SPEC-007 rides along.
  const r = failsWith('SPEC-004', 'transitions[1].to', (s) => { s.transitions[1].to = 'loggedIn'; }, { only: ['SPEC-004', 'SPEC-007'] });
  assert.deepEqual(r.violations[0].expected, ['idle', 'checking', 'signedIn', 'failed', 'lockedOut']);
  failsWith('SPEC-004', 'transitions[4].from', (s) => { s.transitions[4].from = 'retrying'; });
  const e = failsWith('SPEC-005', 'transitions[0].event', (s) => { s.transitions[0].event = 'SEND'; });
  assert.deepEqual(e.violations[0].expected, ['SUBMIT', 'VALID', 'INVALID', 'RETRY']);
});

test('SPEC-006: two transitions with the same from/event/guard are ambiguous; a different guard is not', () => {
  failsWith('SPEC-006', 'transitions[5]', (s) => { s.transitions.push({ from: 'checking', to: 'idle', event: 'INVALID', req: ['s4'] }); });
  failsWith('SPEC-006', 'transitions[5]', (s) => { s.transitions.push({ from: 'checking', to: 'idle', event: 'INVALID', guard: 'attemptsExhausted', req: ['s4'] }); });
  const spec = example();
  spec.transitions.push({ from: 'checking', to: 'idle', event: 'INVALID', guard: 'serverDown', req: ['s4'] });
  assert.equal(validateMachineSpec(spec).status, 'passed');
});

test('SPEC-007: unreachable states, found by walking transitions from the initial state', () => {
  failsWith('SPEC-007', 'states[2]', (s) => { s.transitions.splice(1, 1); });
  // Reachability is transitive: cutting the first edge strands everything downstream.
  const r = failsWith('SPEC-007', 'states[1]', (s) => { s.transitions.splice(0, 1); });
  assert.deepEqual(r.violations.map((v) => v.path), ['states[1]', 'states[2]', 'states[3]', 'states[4]']);
  // A self-loop or a back edge does not make a state reachable on its own.
  failsWith('SPEC-007', 'states[5]', (s) => {
    s.states.push({ id: 'island', req: ['s1'] });
    s.transitions.push({ from: 'island', to: 'idle', event: 'RETRY', req: ['s1'] });
  });
});

test('SPEC-008: a function without an input or output type is named, not buried in a schema message', () => {
  const r = failsWith('SPEC-008', 'functions[1].output', (s) => { delete s.functions[1].output; });
  assert.match(r.violations[0].message, /Missing required field "output" \(function "recordFailedAttempt"\)/);
  failsWith('SPEC-008', 'functions[0].input', (s) => { s.functions[0].input = '   '; });
  failsWith('SPEC-008', 'functions[2].output', (s) => { s.functions[2].output = 42; });
  // Untyped is a meaning-level refusal: the rest of the spec is still measured and checked.
  assert.deepEqual(r.counts?.functions, 3);
});

test('SPEC-009: a req link to a sentence that does not exist', () => {
  failsWith('SPEC-009', 'functions[2].req[0]', (s) => { s.functions[2].req = ['s99']; });
  failsWith('SPEC-009', 'outOfScope[0].req', (s) => { s.outOfScope[0].req = 's7'; }, { only: ['SPEC-009', 'SPEC-010'] });
});

test('SPEC-010 / SPEC-011: every sentence is covered or out of scope, never neither and never both', () => {
  const r = failsWith('SPEC-010', 'requirement[5]', (s) => { delete s.outOfScope; });
  assert.match(r.violations[0].message, /Sentence "s6" \("The sign-in page must load in under two seconds\."\)/);
  failsWith('SPEC-010', 'requirement[6]', (s) => { s.requirement.push({ id: 's7', text: 'Nobody implemented this.' }); });
  failsWith('SPEC-011', 'outOfScope[1]', (s) => { s.outOfScope.push({ req: 's2', reason: 'not really' }); });
});

test('SPEC-012: a final state with a way out', () => {
  failsWith('SPEC-012', 'transitions[5].from', (s) => { s.transitions.push({ from: 'signedIn', to: 'idle', event: 'RETRY', req: ['s4'] }); });
});

test('SPEC-013 / SPEC-014 (#576): a type string that does not parse, or names a type nothing declares', () => {
  failsWith('SPEC-013', 'functions[1].output', (s) => { s.functions[1].output = '{ attempts: '; });
  failsWith('SPEC-013', 'events[0].payload', (s) => { s.events[0].payload = 'string; const x = 1'; });
  failsWith('SPEC-013', 'types[0].definition', (s) => { s.types[0].definition = 'string |'; });
  failsWith('SPEC-014', 'functions[2].input', (s) => { s.functions[2].input = 'Sesion'; });
  failsWith('SPEC-014', 'events[1].payload', (s) => { s.events[1].payload = '{ session: Sesion }'; });
  failsWith('SPEC-014', 'types[0].definition', (s) => { s.types[0].definition = '{ user: Account }'; });
  // Built-ins, declared names, generics, qualified names and self-reference are fine; the check names the root of A.B.
  const ok = example();
  ok.types.push({ name: 'Tree', definition: '{ children: Tree[]; at: Date; meta: Record<string, Partial<Session>> }' });
  ok.functions[2].input = 'Array<Tree> | Readonly<Session> | typeof globalThis';
  assert.equal(validateMachineSpec(ok).status, 'passed', JSON.stringify(validateMachineSpec(ok).violations));
  failsWith('SPEC-014', 'functions[2].input', (s) => { s.functions[2].input = 'Elsewhere.Thing'; });
  // A duplicate declared type is SPEC-002 at the second one; a bad declaration is structural.
  failsWith('SPEC-002', 'types[1].name', (s) => { s.types.push({ name: 'Session', definition: 'string' }); });
  failsWith('SPEC-001', 'types[0].name', (s) => { s.types[0].name = 'not an identifier'; }, { only: ['SPEC-001'] });
});

test('every SPEC-* code has a rule line and a why line, and no code is used for two checks', () => {
  const codes = Object.keys(SPEC_RULES);
  assert.deepEqual(codes, Array.from({ length: 14 }, (_, i) => `SPEC-${String(i + 1).padStart(3, '0')}`));
  for (const code of codes) assert.match(SPEC_RULES[code], /\S/);
});

// ---------------------------------------------------------------------------
// 3. Schema and validator lockstep

test('machine-spec.v1.schema.json is a draft-07 schema following the house convention', () => {
  assert.equal(SCHEMA.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(SCHEMA.$id, 'https://construct.dev/schemas/machine-spec.v1.json');
  assert.equal(SCHEMA.additionalProperties, false);
  assert.equal(SCHEMA.properties.version.const, 1);
});

test('the validator enforces exactly the fields the schema declares (required arrays read from the schema, not copied)', () => {
  assert.deepEqual(SCHEMA.required, [...TOP_LEVEL_REQUIRED]);
  assert.deepEqual(Object.keys(SCHEMA.properties), [...TOP_LEVEL_FIELDS]);
  for (const [field, { shape, minItems }] of Object.entries(LIST_FIELDS)) {
    const prop = SCHEMA.properties[field];
    assert.equal(prop.type, 'array', field);
    assert.equal(prop.items.$ref, `#/definitions/${shape}`, field);
    assert.equal(prop.minItems ?? 0, minItems, field);
    const def = SCHEMA.definitions[shape];
    assert.deepEqual(def.required, Object.keys(ITEM_SHAPES[shape].required), `${shape}.required`);
    assert.deepEqual(Object.keys(def.properties).sort(), Object.keys({ ...ITEM_SHAPES[shape].required, ...ITEM_SHAPES[shape].optional }).sort(), `${shape}.properties`);
    assert.equal(def.additionalProperties, false, shape);
  }
});

test('ajv rejects every structural mutation the validator rejects, so the two agree', () => {
  const cases = [
    (s) => { s.version = 2; },
    (s) => { s.bogus = true; },
    (s) => { s.name = ''; },
    (s) => { delete s.name; },
    (s) => { s.requirement = []; },
    (s) => { s.states = []; },
    (s) => { s.states[0].colour = 'red'; },
    (s) => { s.states[0].initial = 'yes'; },
    (s) => { s.events[0].req = []; },
    (s) => { s.events[0].req = ['s1', 's1']; },
    (s) => { s.transitions[0].guard = ' spaced '; },
    (s) => { delete s.transitions[0].from; },
    (s) => { s.functions[0].name = 'verify credentials'; },
    (s) => { delete s.functions[0].postcondition; },
    (s) => { delete s.functions[1].output; },
    (s) => { s.functions[1].input = '  '; },
    (s) => { s.outOfScope[0].reason = ''; },
    (s) => { s.requirement[1] = 'a bare string'; },
    (s) => { s.ext = []; },
    (s) => { s.types[0].name = 'not an identifier'; },
    (s) => { delete s.types[0].definition; },
    (s) => { s.types = {}; },
  ];
  for (const mutate of cases) {
    const spec = example();
    mutate(spec);
    assert.equal(validateMachineSpec(spec).status, 'failed', `validator accepted ${JSON.stringify(spec).slice(0, 160)}`);
    assert.equal(ajvValidate(spec), false, `ajv accepted ${JSON.stringify(spec).slice(0, 160)}`);
  }
  // And both accept the optional fields when present and well-formed.
  const rich = example();
  rich.ext = { drafter: 'a person' };
  rich.transitions[0].description = 'The visitor presses Sign in.';
  assert.equal(validateMachineSpec(rich).status, 'passed');
  assert.equal(ajvValidate(rich), true, JSON.stringify(ajvValidate.errors));
});

// ---------------------------------------------------------------------------
// 4. CLI

test('construct research spec: text and json output, exit codes, usage', () => {
  const ok = run(['research', 'spec', 'packages/core/research/examples/machine-spec.v1.example.json']);
  assert.equal(ok.status, EXIT_CODES.OK, ok.stderr);
  assert.match(ok.stdout, /^✓ machine-spec\.v1 packages\/core\/research\/examples\/machine-spec\.v1\.example\.json passed/);
  assert.match(ok.stdout, /\[tool: produced the read-only report above\] \[llm: 0 calls\]/);

  const bad = run(['research', 'spec', 'fixtures/machine-spec/unreachable-state.json']);
  assert.equal(bad.status, EXIT_CODES.VIOLATIONS);
  assert.match(bad.stdout, /❌ SPEC-007 \[machine-spec\]\n  fixtures\/machine-spec\/unreachable-state\.json at states\[5\]\n  State "passwordReset" cannot be reached/);
  assert.match(bad.stdout, /1 problem\(s\) in fixtures\/machine-spec\/unreachable-state\.json/);

  const json = run(['research', 'spec', 'fixtures/machine-spec/uncovered-sentence.json', '--format', 'json']);
  assert.equal(json.status, EXIT_CODES.VIOLATIONS);
  const parsed = JSON.parse(json.stdout); // pure JSON: no attribution line after it
  assert.equal(parsed.status, 'failed');
  assert.equal(parsed.file, 'fixtures/machine-spec/uncovered-sentence.json');
  assert.deepEqual(parsed.violations.map((v) => [v.rule, v.path]), [['SPEC-010', 'requirement[5]']]);
  assert.deepEqual(Object.keys(parsed.violations[0]), ['rule', 'module', 'severity', 'file', 'path', 'message', 'why', 'expected']);

  const passJson = run(['research', 'spec', 'packages/core/research/examples/machine-spec.v1.example.json', '--format', 'json']);
  assert.equal(passJson.status, EXIT_CODES.OK);
  assert.equal(JSON.parse(passJson.stdout).status, 'passed');

  assert.equal(run(['research', 'spec']).status, EXIT_CODES.USAGE_ERROR);
  assert.equal(run(['research', 'spec', 'a.json', 'b.json']).status, EXIT_CODES.USAGE_ERROR);
  assert.equal(run(['research', 'spec', 'a.json', '--format', 'yaml']).status, EXIT_CODES.USAGE_ERROR);
  const missing = run(['research', 'spec', 'fixtures/machine-spec/does-not-exist.json']);
  assert.equal(missing.status, EXIT_CODES.USAGE_ERROR);
  assert.match(missing.stderr, /Could not read the spec "fixtures\/machine-spec\/does-not-exist\.json"/);
  const notJson = run(['research', 'spec', 'README.md']);
  assert.equal(notJson.status, EXIT_CODES.USAGE_ERROR);
  assert.match(notJson.stderr, /Could not read the spec "README\.md"/);
});
