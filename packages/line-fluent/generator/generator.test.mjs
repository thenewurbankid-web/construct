import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockModel } from '../pilot/runner/mock-model.mjs';
import {
  approvedEntry, approveProposal, CATALOG_PATH, candidatesFor, findEntry, generate, proposalName, writeProposal, NAMING_PATH,
} from './generator.mjs';
import { runCli } from './cli.mjs';

const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8')).atoms;
const FLAT_MAP = 'Array.prototype.flatMap';

// Text after the prefill `{"entry": "<id>", "decision": "`.
const rest = (fields) => {
  const answer = {
    atom: 'flatMapped', existing: null, kind: 'copy', sentence: 'clones().list(xs).and().flattens()',
    js: 'xs.flatMap(f)', params: [['xs', 'list'], ['f', 'fn']], parts: null, reason: null, ...fields,
  };
  const { decision = 'new-atom', ...ordered } = answer;
  return `${decision}", ${JSON.stringify(ordered).slice(1)}`;
};

const scratch = () => mkdtempSync(join(tmpdir(), 't5-1-'));
const tempCatalog = (dir) => {
  const file = join(dir, 'catalog.json');
  copyFileSync(CATALOG_PATH, file);
  return file;
};
const tempApproved = (dir, atoms = []) => {
  const file = join(dir, 'approved.json');
  writeFileSync(file, JSON.stringify({ atoms }));
  return file;
};
const sink = () => {
  const out = { text: '', write: (s) => { out.text += s; } };
  return out;
};

test('findEntry takes a unique key first, then the first entry with the id', () => {
  assert.equal(findEntry('new Array #2').key, 'new Array #2');
  assert.equal(findEntry('new Array').key, 'new Array');
  assert.equal(findEntry(FLAT_MAP).section, 'Array');
  assert.equal(findEntry('Nope.nothing'), null);
});

test('candidatesFor ranks the best match first and handles constructors outside Array', () => {
  const includes = candidatesFor(findEntry('Array.prototype.includes'), catalog).map((c) => c.atom);
  assert.equal(includes[0], 'hasItem');
  assert.ok(includes.includes('hasText'));
  const date = candidatesFor(findEntry('new Date'), catalog);
  assert.ok(date.length > 0 && date.every((c) => c.js.some((js) => js.includes('new Date('))));
});

test('the default rules-only model reuses a candidate with a sentence, else answers not-expressible', async () => {
  const reuse = (await generate('Array.prototype.includes', { catalog, now: () => 'T' })).proposal;
  assert.equal(reuse.model, 'rules');
  assert.equal(reuse.answer.decision, 'existing');
  assert.equal(reuse.answer.existing, 'hasItem');
  assert.equal(reuse.answer.kind, 'question');
  assert.equal(reuse.gate.pass, true);
  assert.equal(reuse.adds, false);
  assert.equal(reuse.catalogEntry, null);

  const none = (await generate(FLAT_MAP, { catalog })).proposal;
  assert.equal(none.answer.decision, 'not-expressible');
  assert.equal(none.gate.pass, true);
  assert.equal(none.adds, false);
});

test('a mock new-atom answer passes the gate and carries the approved.json entry and a catalog preview', async () => {
  const model = mockModel({ [FLAT_MAP]: rest({}) });
  const { proposal } = await generate(FLAT_MAP, { model, modelName: 'mock', catalog, now: () => 'T' });
  assert.equal(proposal.status, 'pending');
  assert.equal(proposal.model, 'mock');
  assert.equal(proposal.createdAt, 'T');
  assert.deepEqual(proposal.candidates, ['flatMapEach']);
  assert.equal(proposal.gate.pass, true);
  assert.equal(proposal.adds, true);
  assert.deepEqual(proposal.approvedEntry, {
    atom: 'flatMapped', entry: FLAT_MAP, fluent: 'clones().list(xs).and().flattens()', js: 'xs.flatMap(f)',
    params: [['xs', 'list'], ['f', 'fn']], kind: 'copy',
  });
  const { atom, module, reads, js, pure, mutates, generated, verified } = proposal.catalogEntry;
  assert.deepEqual(
    { atom, module, reads, js, pure, mutates, generated, verified },
    { atom: 'flatMapped', module: 'generated/approved', reads: 'clones list xs and flattens', js: ['xs.flatMap(f)'], pure: true, mutates: false, generated: true, verified: true },
  );
});

test('a refused answer is retried with the refusal; a still-refused answer adds nothing', async () => {
  const bad = rest({ sentence: 'clones().list(xs).and().flatens()' });
  const fixed = await generate(FLAT_MAP, { model: mockModel({ [FLAT_MAP]: [bad, rest({})] }), catalog });
  assert.equal(fixed.proposal.tries, 2);
  assert.equal(fixed.proposal.gate.pass, true);

  const refused = (await generate(FLAT_MAP, { model: mockModel({ [FLAT_MAP]: bad }), catalog, maxRetries: 1 })).proposal;
  assert.equal(refused.tries, 2);
  assert.equal(refused.gate.pass, false);
  assert.equal(refused.gate.checks.grammar, 'fail');
  assert.equal(refused.adds, false);
  assert.equal(refused.catalogEntry, null);
});

test('an answer naming an atom the catalog or approved.json already has adds nothing', async () => {
  const { proposal } = await generate(FLAT_MAP, { model: mockModel({ [FLAT_MAP]: rest({ atom: 'flattened' }) }), catalog });
  assert.equal(proposal.gate.pass, true);
  assert.equal(proposal.adds, false);
  assert.match(proposal.note, /already has an atom named flattened/);
  const again = await generate(FLAT_MAP, { model: mockModel({ [FLAT_MAP]: rest({}) }), catalog, approved: [{ atom: 'flatMapped' }] });
  assert.equal(again.proposal.adds, false);
});

test('an answer gen-atoms could not emit (bad param name) adds nothing', async () => {
  const { proposal } = await generate(FLAT_MAP, { model: mockModel({ [FLAT_MAP]: rest({ params: [['x s', 'list']] }) }), catalog });
  assert.equal(proposal.gate.pass, true);
  assert.equal(proposal.adds, false);
  assert.match(proposal.note, /identifier names/);
});

test('approvedEntry keeps molecule parts and is null for answers that add no atom', () => {
  const entry = findEntry(FLAT_MAP);
  const base = { decision: 'new-atom', atom: 'x', sentence: 's()', js: 'j', params: [], kind: 'copy', parts: null };
  assert.equal(approvedEntry(base, { entry }).parts, undefined);
  assert.deepEqual(approvedEntry({ ...base, decision: 'molecule', parts: ['a', 'b'] }, { entry }).parts, ['a', 'b']);
  assert.equal(approvedEntry({ ...base, decision: 'existing' }, { entry }), null);
  assert.equal(approvedEntry({ ...base, decision: 'not-expressible' }, { entry }), null);
});

test('generate writes nothing; approve appends one atom to approved.json and marks the proposal approved, once', async () => {
  const dir = scratch();
  try {
    const catalogFile = tempCatalog(dir);
    const approvedFile = tempApproved(dir);
    const before = readFileSync(catalogFile, 'utf8');
    const { proposal } = await generate(FLAT_MAP, { model: mockModel({ [FLAT_MAP]: rest({}) }), catalog });
    assert.equal(readFileSync(catalogFile, 'utf8'), before);
    const file = writeProposal(proposal, join(dir, 'proposals'));
    assert.equal(file, join(dir, 'proposals', 'Array-prototype-flatMap.json'));
    assert.equal(readFileSync(catalogFile, 'utf8'), before);

    const naming = join(dir, 'naming.json');
    copyFileSync(NAMING_PATH, naming);
    const approved = approveProposal(file, { approved: approvedFile, catalog: catalogFile, naming, now: () => 'A' });
    assert.deepEqual(approved.newVerbs, [], 'flattens is a known verb; naming.json is left alone');
    assert.equal(readFileSync(naming, 'utf8'), readFileSync(NAMING_PATH, 'utf8'));
    assert.equal(approved.status, 'approved');
    assert.equal(approved.approvedAt, 'A');
    assert.equal(readFileSync(catalogFile, 'utf8'), before);
    const atoms = JSON.parse(readFileSync(approvedFile, 'utf8')).atoms;
    assert.deepEqual(atoms, [{ ...proposal.approvedEntry, approvedAt: 'A' }]);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).status, 'approved');

    assert.throws(() => approveProposal(file, { approved: approvedFile, catalog: catalogFile }), /is approved, not pending/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('approve adds a new verb to naming.json, sorted, and leaves the rest of the file as it was', () => {
  const dir = scratch();
  try {
    const naming = join(dir, 'naming.json');
    copyFileSync(NAMING_PATH, naming);
    const approvedEntry = { atom: 'putsAtTo', entry: 'Map.prototype.set', fluent: 'map(m).puts().at(key).to(value)', js: 'm.set(key, value)', params: [['m', 'map'], ['key', 'prim'], ['value', 'prim']], kind: 'in-place' };
    const file = join(dir, 'p.json');
    writeFileSync(file, JSON.stringify({ status: 'pending', entry: 'Map.prototype.set', gate: { pass: true }, answer: { decision: 'new-atom' }, approvedEntry }));
    const done = approveProposal(file, { approved: tempApproved(dir), catalog: tempCatalog(dir), naming, now: () => 'A' });
    assert.deepEqual(done.newVerbs, ['puts']);
    const before = readFileSync(NAMING_PATH, 'utf8');
    const after = readFileSync(naming, 'utf8');
    const verbs = JSON.parse(after).grammar.verbs;
    assert.deepEqual(verbs, [...JSON.parse(before).grammar.verbs, 'puts'].sort());
    assert.equal(after.replace('\n      "puts",', ''), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('approve refuses gate failures, reuse answers and taken atom ids without writing approved.json', async () => {
  const dir = scratch();
  try {
    const catalogFile = tempCatalog(dir);
    const approvedFile = tempApproved(dir, [{ atom: 'flatMapped', entry: 'x', fluent: 'f()', js: 'x', params: [], kind: 'value' }]);
    const before = readFileSync(approvedFile, 'utf8');
    const opts = { approved: approvedFile, catalog: catalogFile };
    const save = async (id, model) => writeProposal((await generate(id, { model, catalog })).proposal, join(dir, id));
    const refused = await save(FLAT_MAP, mockModel({ [FLAT_MAP]: rest({ sentence: 'clones().list(xs).and().flatens()' }) }));
    assert.throws(() => approveProposal(refused, opts), /did not pass the gate: The word `flatens`/);
    const reuse = await save('Array.prototype.includes');
    assert.throws(() => approveProposal(reuse, opts), /is existing; it adds no atom/);
    const taken = await save(FLAT_MAP, mockModel({ [FLAT_MAP]: rest({ atom: 'flattened' }) }));
    assert.throws(() => approveProposal(taken, opts), /already has an atom named flattened/);
    // Generated before flatMapped was approved, so the proposal itself looks free; approve re-checks approved.json.
    const late = await save(FLAT_MAP, mockModel({ [FLAT_MAP]: rest({}) }));
    assert.throws(() => approveProposal(late, opts), /name collision/);
    assert.equal(readFileSync(approvedFile, 'utf8'), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('proposalName turns a key into a file name', () => {
  assert.equal(proposalName('new Array #2'), 'new-Array-2.json');
  assert.equal(proposalName('Array.prototype.[Symbol.iterator]'), 'Array-prototype-Symbol-iterator.json');
});

test('cli: generate with --fixtures writes a pending proposal, approve writes approved.json', async () => {
  const dir = scratch();
  try {
    const catalogFile = tempCatalog(dir);
    const approvedFile = tempApproved(dir);
    const fixtures = join(dir, 'fixtures.json');
    writeFileSync(fixtures, JSON.stringify({ [FLAT_MAP]: rest({}) }));
    const out = sink();
    const err = sink();
    const code = await runCli(['generate', FLAT_MAP, '--fixtures', fixtures, '--out', join(dir, 'p')], { stdout: out, stderr: err, catalogPath: catalogFile, approvedPath: approvedFile });
    assert.equal(code, 0, err.text);
    assert.match(out.text, /new-atom \(passed the gate, 1 try\)/);
    const file = join(dir, 'p', 'Array-prototype-flatMap.json');
    assert.match(out.text, new RegExp(`Approve with: approve ${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).model, 'mock');

    const approveOut = sink();
    assert.equal(await runCli(['approve', file, '--approved', approvedFile, '--catalog', catalogFile], { stdout: approveOut, stderr: err }), 0, err.text);
    assert.match(approveOut.text, /Approved flatMapped for Array.prototype.flatMap; added to .*approved\.json/);
    assert.match(approveOut.text, /Rebuild the catalog with: node .*gen-atoms\.mjs/);
    assert.equal(JSON.parse(readFileSync(approvedFile, 'utf8')).atoms.at(-1).atom, 'flatMapped');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cli: the real model is used only with --real, through the injected fetch', async () => {
  const dir = scratch();
  try {
    const calls = [];
    const fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ response: rest({}), prompt_eval_count: 10, eval_count: 5 }) };
    };
    const out = sink();
    const err = sink();
    assert.equal(await runCli(['generate', FLAT_MAP, '--out', join(dir, 'a')], { stdout: out, stderr: err, fetch }), 0, err.text);
    assert.equal(calls.length, 0);

    assert.equal(await runCli(['generate', FLAT_MAP, '--real', '--model', 'm1', '--url', 'http://local.test/gen', '--out', join(dir, 'b')], { stdout: out, stderr: err, fetch }), 0, err.text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://local.test/gen');
    assert.equal(calls[0].body.model, 'm1');
    assert.equal(calls[0].body.format, undefined);
    assert.equal(JSON.parse(readFileSync(join(dir, 'b', 'Array-prototype-flatMap.json'), 'utf8')).model, 'real:m1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cli: usage and input errors exit 1 and write no proposal', async () => {
  const dir = scratch();
  try {
    const run = async (args) => {
      const err = sink();
      const code = await runCli(args, { stdout: sink(), stderr: err });
      return { code, err: err.text };
    };
    assert.match((await run([])).err, /Usage:/);
    assert.match((await run(['generate', FLAT_MAP, '--bogus'])).err, /Unknown option --bogus/);
    assert.match((await run(['generate', FLAT_MAP, '--real', '--fixtures', 'f.json', '--out', dir])).err, /either --real or --fixtures/);
    assert.match((await run(['generate', 'Nope.nothing', '--out', dir])).err, /No reference entry/);
    assert.equal((await run(['generate', FLAT_MAP, '--retries', '-1', '--out', dir])).code, 1);
    assert.equal(existsSync(dir) ? readdirSync(dir).length : 0, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
