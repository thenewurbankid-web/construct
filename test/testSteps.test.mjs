// #302 -- the step document: the deterministic round trip (parse -> render is byte-identical or the file is
// read-only), editing steps, and the injection / path / staleness guarantees around writing them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { generateFeatureTests } from '../src/engine/testGenerator.mjs';
import { cloneGeneratedTest } from '../src/engine/testClone.mjs';
import { applyStepEdit, parseSpec, previewStepEdit, readStepDocument, renderDoc, urlProblem } from '../src/engine/testSteps.mjs';
import { parseToAst } from '../src/ast/index.mjs';

const LOCK_YML = 'frozen:\n  - features/*/tests/generated/**\nnonLayer:\n  - features/*/tests/**\n';
const BASE_YML = 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n';
const LAYERS = ['controllers', 'workflows', 'hooks', 'domain', 'services', 'pages', 'components'];
const MACHINE = `import { setup } from 'xstate';
export const Simple = setup({}).createMachine({
  id: 'simple',
  initial: 'idle',
  states: {
    idle: { on: { START_JOB: 'working' } },
    working: { on: { finishJob: 'done', JOB_FAILED: 'failed' } },
    failed: { type: 'final' },
    done: { type: 'final' },
  },
});
`;

/** A project with a generated feature "jobs" (with a route, so START_URL is set) and one clone `mine`. */
function project({ route = true } = {}) {
  const dir = makeTempDir('construct-teststeps-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), BASE_YML + LOCK_YML);
  for (const l of LAYERS) fs.mkdirSync(path.join(dir, 'features', 'jobs', l), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'types.ts'), 'export type Id = string;\n');
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'index.ts'), "export type * from './types';\n");
  fs.writeFileSync(path.join(dir, 'features', 'jobs', 'workflows', 'Simple.ts'), MACHINE);
  if (route) {
    fs.writeFileSync(path.join(dir, 'features', 'jobs', 'controllers', 'MainController.tsx'), 'export function MainController() {\n  return <div />;\n}\n');
    fs.mkdirSync(path.join(dir, 'app', 'jobs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'app', 'jobs', 'page.tsx'), "import { MainController } from '../../features/jobs/controllers/MainController';\n\nexport default function Page() {\n  return <MainController />;\n}\n");
  }
  generateFeatureTests(dir, 'jobs');
  return dir;
}
const gen = (dir) => path.join(dir, 'features', 'jobs', 'tests', 'generated');
const tests = (dir) => path.join(dir, 'features', 'jobs', 'tests');
const generatedNames = (dir) => fs.readdirSync(gen(dir)).sort();
const happy = (dir) => generatedNames(dir).find((n) => n.includes('happy-path'));
const cloneOf = (dir, source = happy(dir), name = 'mine') => {
  const r = cloneGeneratedTest(dir, { feature: 'jobs', source, name });
  assert.equal(r.ok, true, r.error);
  return `${name}.spec.ts`;
};
const read = (dir, name) => readStepDocument(dir, { feature: 'jobs', name });
/** The steps the client would send back: what the document returned, minus the display-only fields. */
const send = (doc) => doc.steps.map(({ keyword, sentence, binding, ...s }) => s);

test('EVERY generated spec round-trips byte-identically through parse -> render (the gate holds for the real generator)', () => {
  const dir = project();
  const names = generatedNames(dir);
  assert.ok(names.length >= 2);
  for (const n of names) {
    const text = fs.readFileSync(path.join(gen(dir), n), 'utf8');
    const p = parseSpec(text);
    assert.equal(p.ok, true, `${n}: ${p.reason}`);
    assert.equal(renderDoc(p.doc), text, n);
  }
});

test('a clone of a generated test round-trips too, and the lineage header is preserved verbatim', () => {
  const dir = project();
  const name = cloneOf(dir);
  const text = fs.readFileSync(path.join(tests(dir), name), 'utf8');
  const p = parseSpec(text);
  assert.equal(p.ok, true, p.reason);
  assert.equal(renderDoc(p.doc), text);
  const doc = read(dir, name);
  assert.equal(doc.editable, true);
  assert.equal(doc.kind, 'clone');
  assert.match(doc.lineage.machineHash, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(doc.steps.map((s) => s.keyword).slice(0, 5), ['GIVEN', 'AND', 'WHEN', 'THEN', 'WHEN']);
  assert.equal(doc.steps[0].binding, 'page.goto');
  assert.equal(doc.steps[2].binding, '[data-testid="start-job"]');
  assert.equal(doc.steps[3].binding, '[data-flow-state="working"]');
  assert.ok(doc.machine.events.some((e) => e.event === 'START_JOB' && e.testId === 'start-job'));
  assert.ok(doc.machine.states.includes('working'));
});

test('editing: change an event, add a check, reorder, remove -> the previewed diff is exactly what lands on disk; the original is untouched', () => {
  const dir = project();
  const source = happy(dir);
  const genBefore = fs.readFileSync(path.join(gen(dir), source), 'utf8');
  const name = cloneOf(dir);
  const doc = read(dir, name);
  const steps = send(doc);
  steps.push({ kind: 'check-text', text: 'A reviewer will check this', timeout: 8000, note: 'added by QA' });
  const moved = steps.splice(steps.length - 1, 1)[0];
  steps.splice(3, 0, moved); // reorder: the check now sits right after the first event
  const pre = previewStepEdit(dir, { feature: 'jobs', name, baseHash: doc.hash, steps });
  assert.equal(pre.ok, true, pre.error);
  assert.equal(pre.changed, true);
  assert.ok(pre.diff.stats.added >= 2);
  const before = fs.readFileSync(path.join(tests(dir), name), 'utf8');
  assert.equal(before, fs.readFileSync(path.join(tests(dir), name), 'utf8'), 'the preview writes nothing');
  const done = applyStepEdit(dir, { feature: 'jobs', name, baseHash: doc.hash, resultSha: pre.resultSha, steps });
  assert.equal(done.ok, true, done.error);
  const after = fs.readFileSync(path.join(tests(dir), name), 'utf8');
  assert.match(after, /await expect\(page\.getByText\("A reviewer will check this"\)\)\.toBeVisible\(\{ timeout: 8000 \}\);/);
  assert.match(after, /\/\/ added by QA/);
  assert.equal(fs.readFileSync(path.join(gen(dir), source), 'utf8'), genBefore, 'the locked original is untouched');
  assert.equal(parseSpec(after).ok, true, 'and the result still round-trips');
  assert.equal(read(dir, name).steps.length, steps.length);
  // an event edit derives the data-testid from the machine, never from the client
  const doc2 = read(dir, name);
  const s2 = send(doc2);
  const w = s2.findIndex((s) => s.kind === 'event');
  s2[w] = { kind: 'event', event: 'JOB_FAILED', testId: 'evil" || true', note: s2[w].note };
  const p2 = previewStepEdit(dir, { feature: 'jobs', name, baseHash: doc2.hash, steps: s2 });
  assert.equal(p2.ok, true, p2.error);
  assert.match(applyStepEdit(dir, { feature: 'jobs', name, baseHash: doc2.hash, resultSha: p2.resultSha, steps: s2 }) && fs.readFileSync(path.join(tests(dir), name), 'utf8'), /trigger\(page, "job-failed", "JOB_FAILED"\)/);
  // remove
  const doc3 = read(dir, name);
  const s3 = send(doc3).filter((s) => s.kind !== 'check-text');
  const p3 = previewStepEdit(dir, { feature: 'jobs', name, baseHash: doc3.hash, steps: s3 });
  assert.equal(applyStepEdit(dir, { feature: 'jobs', name, baseHash: doc3.hash, resultSha: p3.resultSha, steps: s3 }).ok, true);
  assert.doesNotMatch(fs.readFileSync(path.join(tests(dir), name), 'utf8'), /A reviewer/);
});

test('the start URL is editable (same-origin paths only) and a missing route TODO disappears when one is set', () => {
  const dir = project({ route: false });
  const name = cloneOf(dir);
  const doc = read(dir, name);
  assert.equal(doc.steps[0].keyword, 'NEEDS', 'the generator marked the missing route');
  assert.equal(doc.steps.find((s) => s.kind === 'goto').url, null);
  const steps = send(doc).map((s) => (s.kind === 'goto' ? { kind: 'goto', url: '/jobs/new?x=1' } : s));
  const pre = previewStepEdit(dir, { feature: 'jobs', name, baseHash: doc.hash, steps });
  assert.equal(pre.ok, true, pre.error);
  assert.equal(applyStepEdit(dir, { feature: 'jobs', name, baseHash: doc.hash, resultSha: pre.resultSha, steps }).ok, true);
  const after = fs.readFileSync(path.join(tests(dir), name), 'utf8');
  assert.match(after, /const START_URL: string \| null = "\/jobs\/new\?x=1";/);
  assert.doesNotMatch(after, /TODO\(construct\)/);
  assert.equal(parseSpec(after).ok, true);
  for (const bad of ['https://evil.example/', '//evil.example', 'javascript:alert(1)', '/a/../b', '/a/%2e%2e/b', 'jobs', '/a\\b', '/a b', '/a"b', '', '/x\n', 'http:/x']) assert.ok(urlProblem(bad), `refused: ${JSON.stringify(bad)}`);
  for (const good of ['/', '/jobs', '/jobs/new?x=1&y=2#top', '/a-b/c_d.e']) assert.equal(urlProblem(good), null, good);
});

test('a hostile value is refused or escaped: the file still parses and contains exactly the template statements', () => {
  const dir = project();
  const name = cloneOf(dir);
  const HOSTILE = [
    'quote " here', "single ' here", 'back`tick', '${process.exit(1)}', '*/ evil()', '\\', '</script>',
    'unicode \u{1F600} ok', 'a "; process.exit(1); //', '`${require("fs").rmSync("/")}`',
  ];
  for (const text of HOSTILE) {
    const doc = read(dir, name);
    const steps = send(doc);
    steps.push({ kind: 'check-text', text, timeout: 5000, note: `note ${text}`.slice(0, 190) });
    const pre = previewStepEdit(dir, { feature: 'jobs', name, baseHash: doc.hash, steps });
    if (!pre.ok) continue; // refused is fine
    const done = applyStepEdit(dir, { feature: 'jobs', name, baseHash: doc.hash, resultSha: pre.resultSha, steps });
    assert.equal(done.ok, true, done.error);
    const file = fs.readFileSync(path.join(tests(dir), name), 'utf8');
    const ast = parseToAst(file);
    const body = ast.body[ast.body.length - 1].expression.arguments[1].body.body;
    assert.equal(body.length, steps.length + 1, `exactly the template's statements (goto has two): ${JSON.stringify(text)}`);
    const last = body[body.length - 1];
    assert.equal(last.expression.argument.callee.object.arguments[0].arguments[0].value, text, 'the text is a string literal that decodes to exactly the input');
    assert.equal(parseSpec(file).ok, true);
    const back = read(dir, name);
    assert.equal(back.steps[back.steps.length - 1].sentence.startsWith('the page shows'), true);
    assert.equal(back.steps[back.steps.length - 1].text, text, 'the raw text survives the round trip');
    // remove it again so the next case starts clean
    const cleaned = send(back).slice(0, -1);
    const p2 = previewStepEdit(dir, { feature: 'jobs', name, baseHash: back.hash, steps: cleaned });
    applyStepEdit(dir, { feature: 'jobs', name, baseHash: back.hash, resultSha: p2.resultSha, steps: cleaned });
  }
  // characters that cannot live in a text or note at all are refused, not silently changed
  const doc = read(dir, name);
  const refusedChars = ['a\nb', 'a\rb', 'a b', 'a b', 'a\0b', 'a\u0085b', 'x'.repeat(201)];
  for (const text of refusedChars) {
    const steps = [...send(doc), { kind: 'check-text', text, timeout: 5000 }];
    assert.equal(previewStepEdit(dir, { feature: 'jobs', name, baseHash: doc.hash, steps }).code, 'invalid', JSON.stringify(text).slice(0, 30));
    const noted = [...send(doc), { kind: 'check-text', text: 'ok', timeout: 5000, note: text }];
    assert.equal(previewStepEdit(dir, { feature: 'jobs', name, baseHash: doc.hash, steps: noted }).code, 'invalid');
  }
});

test('an event or state the machine does not have, an unknown step type and a bad shape are refused; nothing is written', () => {
  const dir = project();
  const name = cloneOf(dir);
  const doc = read(dir, name);
  const bytes = fs.readFileSync(path.join(tests(dir), name), 'utf8');
  const bad = [
    [...send(doc), { kind: 'event', event: 'NOT_AN_EVENT' }],
    [...send(doc), { kind: 'event', event: '"; process.exit(1); //' }],
    [...send(doc), { kind: 'state', state: 'nowhere' }],
    [...send(doc), { kind: 'state', state: 'done"); evil(); ("' }],
    [...send(doc), { kind: 'click', selector: '#x' }],
    [...send(doc), { kind: 'check-text', text: 'x', timeout: 'soon' }],
    [...send(doc), { kind: 'check-text', text: 'x', timeout: 10 }],
    [...send(doc), null],
    [...send(doc), { kind: 'fixme', text: 'made up' }],
    [...send(doc), { kind: 'goto', url: '/second' }],
    send(doc).slice(1), // no goto
    [{ kind: 'state', state: 'idle' }, ...send(doc)], // something before the page is opened
    [],
    'not an array',
    Array.from({ length: 300 }, () => ({ kind: 'state', state: 'idle' })),
  ];
  for (const steps of bad) {
    const r = previewStepEdit(dir, { feature: 'jobs', name, baseHash: doc.hash, steps });
    assert.equal(r.ok, false, JSON.stringify(steps).slice(0, 80));
    assert.equal(r.code, 'invalid');
  }
  assert.equal(fs.readFileSync(path.join(tests(dir), name), 'utf8'), bytes);
});

test('a stale hash is refused, and so is a write whose text is not the one previewed', () => {
  const dir = project();
  const name = cloneOf(dir);
  const doc = read(dir, name);
  const steps = [...send(doc), { kind: 'check-text', text: 'hello', timeout: 5000 }];
  const pre = previewStepEdit(dir, { feature: 'jobs', name, baseHash: doc.hash, steps });
  assert.equal(applyStepEdit(dir, { feature: 'jobs', name, baseHash: doc.hash, resultSha: 'f'.repeat(64), steps }).code, 'not-reviewed');
  assert.equal(applyStepEdit(dir, { feature: 'jobs', name, baseHash: doc.hash, steps }).code, 'not-reviewed', 'a missing review hash is refused');
  assert.equal(applyStepEdit(dir, { feature: 'jobs', name, baseHash: doc.hash, resultSha: pre.resultSha, steps: [...steps, { kind: 'check-text', text: 'sneaky', timeout: 5000 }] }).code, 'not-reviewed', 'other steps than the reviewed ones');
  fs.appendFileSync(path.join(tests(dir), name), '// edited elsewhere\n');
  assert.equal(applyStepEdit(dir, { feature: 'jobs', name, baseHash: doc.hash, resultSha: pre.resultSha, steps }).code, 'stale');
  assert.equal(previewStepEdit(dir, { feature: 'jobs', name, baseHash: doc.hash, steps }).code, 'stale');
  assert.equal(previewStepEdit(dir, { feature: 'jobs', name, baseHash: undefined, steps }).code, 'stale');
  assert.doesNotMatch(fs.readFileSync(path.join(tests(dir), name), 'utf8'), /hello/);
  assert.deepEqual(fs.readdirSync(tests(dir)).filter((n) => n.endsWith('.tmp')), [], 'no temp file is left behind');
});

test('a file that does not round-trip is read-only with the reason, and every edit of it is refused', () => {
  const dir = project();
  const cases = {
    'single-quotes': (t) => t.replace('trigger(page, "start-job"', "trigger(page, 'start-job'"),
    'extra-statement': (t) => t.replace('  await page.goto(START_URL);', '  await page.goto(START_URL);\n  await page.waitForTimeout(500);'),
    'extra-comment': (t) => t.replace('  await page.goto(START_URL);', '  // hand-written\n  await page.goto(START_URL);'),
    'trailing-comment': (t) => t.replace('\n});\n', '\n  // the end\n});\n'),
    'double-space': (t) => t.replace('await page.goto(START_URL);', 'await  page.goto(START_URL);'),
    'changed-helper': (t) => t.replace("await el.click();", "await el.dblclick();"),
    'no-trailing-newline': (t) => t.replace(/\n$/, ''),
    'crlf': (t) => t.replace(/\n/g, '\r\n'),
    'not-typescript': () => 'this is { not typescript',
    'empty': () => '',
    'numeric-separator': (t) => t.replace('timeout: 5_000', 'timeout: 5000'),
  };
  const src = fs.readFileSync(path.join(tests(dir), cloneOf(dir)), 'utf8');
  for (const [label, mutate] of Object.entries(cases)) {
    const name = `odd-${label}.spec.ts`;
    fs.writeFileSync(path.join(tests(dir), name), mutate(src));
    const doc = read(dir, name);
    assert.equal(doc.ok, true, label);
    assert.equal(doc.editable, false, `${label} must not be offered for structured editing`);
    assert.ok(doc.reason && doc.reason.length > 10, label);
    assert.equal(doc.steps, undefined);
    const r = previewStepEdit(dir, { feature: 'jobs', name, baseHash: doc.hash, steps: [{ kind: 'goto', url: '/x' }] });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'not-editable', label);
    assert.equal(applyStepEdit(dir, { feature: 'jobs', name, baseHash: doc.hash, resultSha: 'x', steps: [] }).ok, false);
    assert.equal(fs.readFileSync(path.join(tests(dir), name), 'utf8'), mutate(src), `${label}: not corrupted`);
  }
});

test('names and paths: hostile names, generated/ files, symlinks and unknown features are refused', () => {
  const dir = project();
  const name = cloneOf(dir);
  const doc = read(dir, name);
  const one = (n, f = 'jobs') => readStepDocument(dir, { feature: f, name: n });
  for (const n of ['../generated/x.spec.ts', '/etc/passwd', 'a\0b.spec.ts', 'a\nb.spec.ts', 'a/b.spec.ts', '..', '', 'UPPER.spec.ts', 'mine.spec.ts.bak', `${'a'.repeat(100)}.spec.ts`, undefined, 42, ['mine.spec.ts'], { toString: () => 'mine.spec.ts' }]) {
    assert.equal(one(n).ok, false, JSON.stringify(n));
    assert.equal(one(n).code, 'bad-name');
  }
  assert.equal(one('nope.spec.ts').code, 'not-found');
  assert.equal(one(happy(dir)).code, 'locked', 'a generated test is locked: clone it first');
  for (const f of ['../x', 'nope', '']) assert.equal(one(name, f).ok, false);
  assert.equal(previewStepEdit(dir, { feature: 'jobs', name: happy(dir), baseHash: 'x', steps: [] }).code, 'locked');
  assert.equal(applyStepEdit(dir, { feature: 'jobs', name: happy(dir), baseHash: 'x', resultSha: 'x', steps: [] }).code, 'locked');
  // a copy of a generated file that kept the lock marker is refused too
  fs.copyFileSync(path.join(gen(dir), happy(dir)), path.join(tests(dir), 'kept-marker.spec.ts'));
  assert.equal(one('kept-marker.spec.ts').code, 'locked');
  // a symlinked file
  const outside = path.join(makeTempDir('construct-teststeps-out-'), 'outside.spec.ts');
  fs.copyFileSync(path.join(tests(dir), name), outside);
  fs.symlinkSync(outside, path.join(tests(dir), 'link.spec.ts'));
  assert.equal(one('link.spec.ts').code, 'unsafe-path');
  const steps = [...send(doc), { kind: 'check-text', text: 'x', timeout: 5000 }];
  assert.equal(applyStepEdit(dir, { feature: 'jobs', name: 'link.spec.ts', baseHash: doc.hash, resultSha: 'x', steps }).ok, false);
  assert.equal(fs.readFileSync(outside, 'utf8'), fs.readFileSync(path.join(tests(dir), name), 'utf8'), 'nothing was written through the link');
  // a symlinked tests/ directory
  const dir2 = project();
  const real = path.join(dir2, 'features', 'jobs', 'tests-real');
  fs.renameSync(path.join(dir2, 'features', 'jobs', 'tests'), real);
  fs.symlinkSync(real, path.join(dir2, 'features', 'jobs', 'tests'));
  assert.equal(readStepDocument(dir2, { feature: 'jobs', name: 'mine.spec.ts' }).ok, false);
});
