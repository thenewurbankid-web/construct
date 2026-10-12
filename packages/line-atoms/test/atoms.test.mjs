// The atom catalog: every atom folder is complete (descriptor, implementation, test kit), the package exports each
// atom, the survey's licences are permissive and its patterns name real atoms, and matchAtoms routes requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAtoms, getAtom, matchAtoms, atomImport, words, ATOMS_DIR, ATOM_ROLES, toSmithEntry, assertAtom } from '../index.mjs';
import { createMockAtoms } from '../mock.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const survey = JSON.parse(fs.readFileSync(path.join(ROOT, 'survey.json'), 'utf8'));
const PERMISSIVE = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC']);

test('every atom folder has a valid descriptor, an implementation exporting its machine, and its test kit', async () => {
  const atoms = listAtoms();
  assert.ok(atoms.length >= 6);
  for (const a of atoms) {
    const dir = path.join(ATOMS_DIR, a.id);
    assert.ok(fs.existsSync(path.join(dir, 'index.ts')), `${a.id}: index.ts`);
    assert.ok(fs.existsSync(path.join(dir, a.testKit.file)), `${a.id}: test kit ${a.testKit.file}`);
    assert.match(a.testKit.file, /\.test\.ts$/, `${a.id}: the test kit is a node test file`);
    const mod = await import(path.join(dir, 'index.ts'));
    assert.equal(mod.machine?.id, a.id, `${a.id}: index.ts exports machine with its id`);
    assert.equal(typeof mod[a.name], 'function', `${a.id}: index.ts exports its entry function ${a.name}`);
    for (const c of a.composes) assert.ok(getAtom(c), `${a.id} composes ${c}, which exists`);
    assert.ok(fs.readFileSync(path.join(dir, a.testKit.file), 'utf8').includes('kit.assertComplete()'), `${a.id}: the test kit checks its coverage`);
  }
});

test('the package exports every atom by id, and nothing that is not an atom folder', () => {
  const exported = Object.keys(pkg.exports).filter((k) => pkg.exports[k].startsWith('./atoms/')).map((k) => k.slice(2)).sort();
  assert.deepEqual(exported, listAtoms().map((a) => a.id));
  for (const a of listAtoms()) assert.equal(pkg.exports[`./${a.id}`], `./atoms/${a.id}/index.ts`);
  assert.equal(atomImport('filter-sort'), '@line/atoms/filter-sort');
});

test('every role has at most one atom, and every atom role is a known role', () => {
  const roles = listAtoms().map((a) => a.role);
  assert.equal(new Set(roles).size, roles.length);
  for (const r of roles) assert.ok(Object.hasOwn(ATOM_ROLES, r));
});

test('the survey: permissive licences only, descriptors only, and every atom traced to a surveyed pattern', () => {
  for (const lib of survey.libraries) assert.ok(PERMISSIVE.has(lib.license), `${lib.id} is ${lib.license}`);
  for (const [id, lic] of Object.entries(survey.licences)) assert.ok(PERMISSIVE.has(lic), `${id} is ${lic}`);
  const ids = new Set(listAtoms().map((a) => a.id));
  for (const p of survey.patterns) if (p.atom !== null) assert.ok(ids.has(p.atom), `survey pattern ${p.id} names atom ${p.atom}`);
  for (const a of listAtoms()) assert.ok(survey.patterns.some((p) => p.atom === a.id && p.role === a.role), `atom ${a.id} comes from a surveyed pattern`);
  assert.doesNotMatch(JSON.stringify(survey), /\breturn\b|\bfunction\s*\(|=>\s*\{/, 'the survey holds descriptors, not code');
});

test('toSmithEntry keeps Smith\'s registry fields', () => {
  const e = toSmithEntry(getAtom('filter-sort'), { n: 3 });
  assert.deepEqual(Object.keys(e), ['id', 'name', 'kind', 'code', 'english', 'line']);
  assert.equal(e.id, 'function:filterSort:3');
  assert.equal(e.kind, 'function');
});

test('assertAtom names the first broken rule', () => {
  const good = structuredClone(getAtom('filter-sort'));
  assert.throws(() => assertAtom({ ...good, role: 'list.unknown' }), /role "list.unknown"/);
  assert.throws(() => assertAtom({ ...good, initial: 'nowhere' }), /initial is one of the states/);
  assert.throws(() => assertAtom({ ...good, transitions: [...good.transitions, { from: 'filtered', event: 'NOPE', to: 'filtered' }] }), /event "NOPE"/);
  assert.throws(() => assertAtom({ ...good, english: 'lower case' }), /english/);
  assert.throws(() => assertAtom({ ...good, signals: [{ id: 's', all: ['('], sentence: 'Bad pattern here.' }] }), /regular expression/);
  assert.throws(() => assertAtom({ ...good, composes: ['filter-sort'] }), /composes/);
});

test('matchAtoms routes requests to atoms, and nothing for an unrelated request', () => {
  assert.equal(matchAtoms('add a paginated list')[0].id, 'paginated-query');
  assert.equal(matchAtoms('Add a paginated list of orders')[0].import, '@line/atoms/paginated-query');
  assert.equal(matchAtoms('add a wizard')[0].id, 'multi-step-flow');
  assert.equal(matchAtoms('filter the list by category')[0].id, 'filter-sort');
  assert.equal(matchAtoms('validate the form before submitting')[0].id, 'validated-submit');
  assert.equal(matchAtoms('split the list into pages')[0].id, 'client-pagination');
  assert.equal(matchAtoms('add infinite scroll to the feed')[0].id, 'infinite-list');
  assert.equal(matchAtoms('export the orders table to csv')[0].id, 'csv-export');
  assert.equal(matchAtoms('only admins can do this')[0].id, 'permission-check');
  assert.equal(matchAtoms('add undo and redo')[0].id, 'undo-history');
  assert.equal(matchAtoms('filter by date range')[0].id, 'date-range');
  assert.equal(matchAtoms('poll the job status until done')[0].id, 'polling');
  assert.deepEqual(matchAtoms('rename the header'), []);
  assert.deepEqual(matchAtoms(''), []);
  for (const m of matchAtoms('add a paginated list')) assert.match(m.sentence, /^Use the .+\.$/);
  assert.deepEqual(words('Paginated Lists, sorting!'), ['paginate', 'lists', 'sort']);
});

test('the mock keeps the catalog contract and records requests', () => {
  const mock = createMockAtoms([getAtom('filter-sort')]);
  assert.equal(mock.matchAtoms('please add a filter')[0].id, 'filter-sort');
  assert.deepEqual(mock.calls, ['please add a filter']);
  assert.equal(mock.getAtom('nope'), null);
  assert.throws(() => createMockAtoms([{ v: 1 }]), /Atom contract/);
});
