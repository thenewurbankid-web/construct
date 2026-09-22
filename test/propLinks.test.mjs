// #473 -- PROP-LINK: a component's declared props (react-docgen) cross-referenced against every
// real JSX call site of it in the project. Real files on a temp project, the real worker/parser
// (same style as test/describeComponent.test.mjs); no mocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { checkPropLinks, propLinkViolations } from '../packages/engine/propLinks.mjs';

const FILES = {
  'components/Heart.tsx': `type Props = { productId: string; onToggle: () => void; size?: string };
export function Heart({ productId, onToggle, size = 'md' }: Props) {
  return <button onClick={onToggle} data-size={size}>{productId}</button>;
}
`,
  // Passes productId only -- the required "onToggle" callback never arrives here.
  'pages/ShopHome.tsx': `import { Heart } from '../components/Heart';
export function ShopHome() {
  return <div><Heart productId="1" /></div>;
}
`,
  // Passes onToggle (required, satisfied) and size (optional, declared) but also an undeclared "extra" attribute.
  'pages/CartDrawer.tsx': `import { Heart } from '../components/Heart';
export function CartDrawer() {
  return <Heart productId="2" onToggle={() => {}} size="sm" extra="x" />;
}
`,
  // Spreads an unknown object -- can't be resolved statically, must not count either way.
  'pages/Wrapped.tsx': `import { Heart } from '../components/Heart';
export function Wrapped(props) {
  return <Heart {...props} />;
}
`,
  'components/Unused.tsx': `type Props = { required: string };
export function Unused({ required }: Props) { return <span>{required}</span>; }
`,
};

function project() {
  const root = makeTempDir('construct-proplinks-');
  for (const [rel, text] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}
const root = project();
const missingOf = (r, name) => r.components[0].missing.find((m) => m.prop === name);
const unknownOf = (r, name) => r.components[0].unknown.find((u) => u.prop === name);

test('a required prop that one call site never passes is "missing", with the exact call site named', async () => {
  const r = await checkPropLinks(root, 'components/Heart.tsx');
  assert.equal(r.ok, true);
  assert.equal(r.components[0].name, 'Heart');
  const onToggle = missingOf(r, 'onToggle');
  assert.ok(onToggle, 'onToggle should be flagged missing');
  assert.equal(onToggle.totalCallSites, 2); // Wrapped.tsx's spread call site is excluded
  assert.equal(onToggle.passedCallSites, 1); // CartDrawer passes it
  assert.deepEqual(onToggle.requiredCallSites, [{ file: 'pages/ShopHome.tsx', line: 3 }]);
});

test('a required prop passed at every checked call site is never flagged', async () => {
  const r = await checkPropLinks(root, 'components/Heart.tsx');
  assert.equal(missingOf(r, 'productId'), undefined);
});

test('an optional prop with a default value, never overridden at some call sites, is not a gap by itself', async () => {
  const r = await checkPropLinks(root, 'components/Heart.tsx');
  // "size" has a default and is optional; ShopHome never passes it -- must not be flagged missing.
  assert.equal(missingOf(r, 'size'), undefined);
});

test('an attribute a call site passes that the component never declares is "unknown"', async () => {
  const r = await checkPropLinks(root, 'components/Heart.tsx');
  const extra = unknownOf(r, 'extra');
  assert.ok(extra, 'extra should be flagged unknown');
  assert.deepEqual(extra.callSites, [{ file: 'pages/CartDrawer.tsx', line: 3 }]);
  // "size" is declared, so passing it is never flagged unknown even though it's optional.
  assert.equal(unknownOf(r, 'size'), undefined);
});

test('a call site that spreads props is excluded from both checks, and counted separately', async () => {
  const r = await checkPropLinks(root, 'components/Heart.tsx');
  assert.equal(r.components[0].callSiteCount, 3);
  assert.equal(r.components[0].notCheckedCallSites, 1);
});

test('a component with no call sites anywhere has nothing to flag', async () => {
  const r = await checkPropLinks(root, 'components/Unused.tsx');
  assert.equal(r.ok, true);
  assert.equal(r.components[0].callSiteCount, 0);
  assert.deepEqual(r.components[0].missing, []);
  assert.deepEqual(r.components[0].unknown, []);
});

test('a file describeComponent cannot describe (parse error) fails the same way, never throws', async () => {
  const dir = makeTempDir('construct-proplinks-bad-');
  fs.writeFileSync(path.join(dir, 'Bad.tsx'), 'export function Bad( { return <i/>; \nconst = ;');
  const r = await checkPropLinks(dir, 'Bad.tsx');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PARSE_ERROR');
});

test('propLinkViolations: one PROP-LINK finding per (prop, call site), at Info severity by default', async () => {
  const r = await checkPropLinks(root, 'components/Heart.tsx');
  const violations = r.components.flatMap((c) => propLinkViolations('components/Heart.tsx', c));
  assert.equal(violations.length, 2); // missing onToggle@ShopHome + unknown extra@CartDrawer
  for (const v of violations) {
    assert.equal(v.rule, 'PROP-LINK');
    assert.equal(v.module, 'architecture');
    assert.equal(v.severity, 'info');
    assert.equal(v.file, 'components/Heart.tsx');
  }
  const missingMsg = violations.find((v) => v.message.includes('onToggle'));
  assert.match(missingMsg.message, /never passed · 1 of 2 uses/);
  assert.match(missingMsg.message, /pages\/ShopHome\.tsx:3/);
  const unknownMsg = violations.find((v) => v.message.includes('extra'));
  assert.match(unknownMsg.message, /pages\/CartDrawer\.tsx:3/);
});

test('propLinkViolations: severity "off" reports nothing, same convention as every other rule', async () => {
  const r = await checkPropLinks(root, 'components/Heart.tsx');
  const violations = r.components.flatMap((c) => propLinkViolations('components/Heart.tsx', c, { severity: 'off' }));
  assert.deepEqual(violations, []);
});

test('describeComponent failures (e.g. the docgen engine switched off) pass through as ok:false', async () => {
  const r = await checkPropLinks(root, 'components/Heart.tsx', { describeOptions: { engine: 'none' } });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'DISABLED');
});
