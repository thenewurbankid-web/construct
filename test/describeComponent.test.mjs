// #434: `describeComponent` documents one component file with react-docgen behind our own interface.
// Real files in a temp project, the real worker thread, the real parser: no mocks except the timeout case.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { describeComponent } from '../src/engine/describeComponent.mjs';
import { describeSource, typeText } from '../src/engine/describeDocgen.mjs';

const FILES = {
  'features/a/components/Fn.tsx': `type P = { /** the total */ total: number; label?: string; onStart: () => void };
/** A view of the total. */
export function Fn({ total, label = 'x', onStart }: P) { return <button onClick={onStart}>{label}{total}</button>; }
`,
  'features/a/components/Arrow.jsx': `import React from 'react';
import PropTypes from 'prop-types';
export const Arrow = ({ title }) => <h1>{title}</h1>;
Arrow.propTypes = { /** Heading text */ title: PropTypes.string.isRequired, dense: PropTypes.bool };
`,
  'features/a/components/Klass.tsx': `import React from 'react';
export default class Klass extends React.Component<{ q?: number; kind: 'a' | 'b' }> {
  static defaultProps = { q: 3 };
  render() { return null; }
}
`,
  'features/a/components/Fwd.tsx': `import React from 'react';
export const Fwd = React.forwardRef<HTMLDivElement, { tone: string }>((props, ref) => <div ref={ref}>{props.tone}</div>);
`,
  'features/a/components/Broken.tsx': 'export function Broken( { return <div/>; \n const = ;',
  'features/a/domain/rules.ts': 'export const total = (a: number, b: number) => a + b;\n',
  'features/a/components/Huge.tsx': `export function Huge() { return <div/>; }\n${'// filler\n'.repeat(40000)}`,
};

function project() {
  const root = makeTempDir('construct-describe-');
  for (const [rel, text] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}
const root = project();
const propOf = (r, name) => r.components[0].props.find((p) => p.name === name);

test('a function component with TS props: names, types, required, defaults, descriptions', async () => {
  const r = await describeComponent(root, 'features/a/components/Fn.tsx');
  assert.equal(r.ok, true);
  assert.equal(r.path, 'features/a/components/Fn.tsx');
  assert.equal(r.components.length, 1);
  assert.equal(r.components[0].name, 'Fn');
  assert.equal(r.components[0].description, 'A view of the total.');
  assert.deepEqual(propOf(r, 'total'), { name: 'total', type: 'number', required: true, default: null, description: 'the total' });
  assert.deepEqual(propOf(r, 'label'), { name: 'label', type: 'string', required: false, default: "'x'", description: '' });
  assert.equal(propOf(r, 'onStart').type, '() => void');
});

test('an arrow component in a .jsx file with PropTypes', async () => {
  const r = await describeComponent(root, 'features/a/components/Arrow.jsx');
  assert.equal(r.ok, true);
  assert.equal(r.components[0].name, 'Arrow');
  assert.deepEqual(propOf(r, 'title'), { name: 'title', type: 'string', required: true, default: null, description: 'Heading text' });
  assert.equal(propOf(r, 'dense').type, 'bool');
});

test('a class component: union types and defaultProps', async () => {
  const r = await describeComponent(root, 'features/a/components/Klass.tsx');
  assert.equal(r.ok, true);
  assert.equal(propOf(r, 'q').default, '3');
  assert.equal(propOf(r, 'q').required, false);
  assert.equal(propOf(r, 'kind').type.replace(/\s/g, ''), "'a'|'b'");
});

test('forwardRef with an inline props type', async () => {
  const r = await describeComponent(root, 'features/a/components/Fwd.tsx');
  assert.equal(r.ok, true);
  assert.equal(r.components[0].name, 'Fwd');
  assert.equal(propOf(r, 'tone').type, 'string');
  assert.equal(propOf(r, 'tone').required, true);
});

test('a file that parses but has no component is the graceful "no docs" answer, not an error', async () => {
  const r = await describeComponent(root, 'features/a/domain/rules.ts');
  assert.deepEqual(r, { ok: true, components: [], path: 'features/a/domain/rules.ts' });
});

test('a syntax error is { ok:false, PARSE_ERROR } and never throws', async () => {
  const r = await describeComponent(root, 'features/a/components/Broken.tsx');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PARSE_ERROR');
  assert.match(r.error, /could not be parsed/);
});

test('a huge file is refused before it is read into the parser', async () => {
  const r = await describeComponent(root, 'features/a/components/Huge.tsx');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'TOO_LARGE');
  assert.equal((await describeComponent(root, 'features/a/components/Huge.tsx', { maxBytes: 10_000_000 })).ok, true);
});

test('the parse is cut off after the timeout (worker terminated)', async () => {
  const r = await describeComponent(root, 'features/a/components/Fn.tsx', { timeoutMs: 1 });
  // 1 ms is shorter than a worker can start: the answer is TIMEOUT, and the process is not left waiting.
  assert.equal(r.ok, false);
  assert.equal(r.code, 'TIMEOUT');
});

test('paths that leave the project, are not source, or do not exist are refused with a code', async () => {
  const outside = makeTempDir('construct-describe-out-');
  fs.writeFileSync(path.join(outside, 'Secret.tsx'), 'export const S = () => <i/>;');
  fs.symlinkSync(path.join(outside, 'Secret.tsx'), path.join(root, 'features/a/components/Link.tsx'));
  for (const rel of ['../x.tsx', '/etc/passwd', 'features/a/components/../../../x.tsx', 'a\0b.tsx', '', undefined, 42]) {
    assert.equal((await describeComponent(root, rel)).code, 'OUTSIDE_ROOT', String(rel));
  }
  assert.equal((await describeComponent(root, 'features/a/components/Link.tsx')).code, 'OUTSIDE_ROOT');
  assert.equal((await describeComponent(root, 'features/a/components/Fn.css')).code, 'NOT_SOURCE');
  assert.equal((await describeComponent(root, 'features/a/components/Nope.tsx')).code, 'NOT_FOUND');
  assert.equal((await describeComponent(root, 'features/a/components')).code, 'NOT_SOURCE');
});

test('the engine is swappable and can be switched off', async () => {
  const fake = () => ({ ok: true, components: [{ name: 'Fake', description: '', props: [] }] });
  const r = await describeComponent(root, 'features/a/components/Fn.tsx', { describe: fake });
  assert.equal(r.components[0].name, 'Fake');
  assert.equal((await describeComponent(root, 'features/a/components/Fn.tsx', { engine: 'none' })).code, 'DISABLED');
});

test('describeSource is deterministic and typeText is total over odd type nodes', () => {
  const a = describeSource(FILES['features/a/components/Fn.tsx'], 'Fn.tsx');
  assert.deepEqual(a, describeSource(FILES['features/a/components/Fn.tsx'], 'Fn.tsx'));
  assert.equal(typeText(null), '');
  assert.equal(typeText({ name: 'Array', elements: [{ name: 'string' }] }), 'Array<string>');
  assert.equal(typeText({ name: 'union', elements: [{ name: 'literal', value: "'a'" }, { name: 'number' }] }), "'a' | number");
  let deep = { name: 'x' };
  for (let i = 0; i < 50; i++) deep = { name: 'Array', elements: [deep] };
  assert.equal(typeof typeText(deep), 'string');
});
