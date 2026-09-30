// #716 (Part of #715, Page->ViewModel Phase 1) -- resolvePageComponents loops the existing
// per-node analysis blocks (parseJsxTree, buildScopeLinks, describeComponent,
// classifyProjectFile) across a WHOLE page. Real files on a temp project, the real
// worker/parser (same style as test/propLinks.test.mjs); no mocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { resolvePageComponents } from '../packages/engine/pageComponents.mjs';

// Layer-graph-aware paths: DEFAULT_LAYERS classifies `features/*/pages/**` as 'page' and
// `features/*/components/**` as 'component' (packages/core/config.mjs).
const FILES = {
  'features/shop/components/Card.tsx': `type Props = { title: string; count?: number };
export function Card({ title, count = 0 }: Props) {
  return <div>{title}{count}</div>;
}
`,
  // Nested two levels deep on the page (div > section > Banner) -- proves the walk covers every
  // element found anywhere in the tree, not just the page's single outer root.
  'features/shop/components/Banner.tsx': `type Props = { text: string };
export function Banner({ text }: Props) {
  return <p>{text}</p>;
}
`,
  'features/shop/pages/Home.tsx': `import { Card } from '../components/Card';
import { Banner } from '../components/Banner';
import { Button } from '@ui/button';

export function Home({ items, extra, show }) {
  return (
    <div>
      <Card title="Hi" />
      <Button label="Click" />
      {show && (
        <section>
          <Banner text="Nested" />
        </section>
      )}
      {items.map((item) => (
        <Card key={item.id} title={item.title} {...extra} />
      ))}
    </div>
  );
}
`,
};

function project() {
  const root = makeTempDir('construct-pagecomponents-');
  for (const [rel, text] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}
const root = project();
const PAGE = 'features/shop/pages/Home.tsx';

async function homeComponents() {
  const r = await resolvePageComponents(root, PAGE);
  assert.equal(r.ok, true);
  return r;
}

test('a resolvable local component: resolved file, layer, doc-derived declared props, bound status', async () => {
  const r = await homeComponents();
  const cards = r.components.filter((c) => c.tag === 'Card');
  assert.ok(cards.length >= 1, 'at least one Card node expected');
  const first = cards[0];
  assert.equal(first.resolvedFile, 'features/shop/components/Card.tsx');
  assert.equal(first.layer, 'component');
  const propNames = first.declaredProps.map((p) => p.name).sort();
  assert.deepEqual(propNames, ['count', 'title']);
  assert.deepEqual(first.boundProps, ['title']);
  assert.equal(first.childPropsResolved, true);
});

test('an unresolvable bare-import component still appears, never silently dropped', async () => {
  const r = await homeComponents();
  const button = r.components.find((c) => c.tag === 'Button');
  assert.ok(button, 'Button node must be present even though @ui/button cannot be resolved');
  assert.equal(button.resolvedFile, null);
  assert.equal(button.layer, null);
  assert.deepEqual(button.declaredProps, []);
  assert.equal(button.childPropsResolved, false);
  assert.deepEqual(button.boundProps, []);
  assert.deepEqual(button.unboundProps, []);
});

test('a spread prop: the spread-covered prop is neither bound nor unbound, the explicitly-passed prop is bound', async () => {
  const r = await homeComponents();
  const cards = r.components.filter((c) => c.tag === 'Card');
  const spreadCard = cards.find((c) => c.boundProps.includes('title') && !c.unboundProps.includes('count') && c.declaredProps.some((p) => p.name === 'count'));
  assert.ok(spreadCard, 'the .map()-rendered Card (with {...extra}) should be found');
  assert.deepEqual(spreadCard.boundProps, ['title']);
  assert.ok(!spreadCard.unboundProps.includes('count'), '"count" is possibly covered by the spread, so it must not be flagged unbound');
});

test('a nested (non-root) custom component, two levels inside a conditional, is included', async () => {
  const r = await homeComponents();
  const banner = r.components.find((c) => c.tag === 'Banner');
  assert.ok(banner, 'Banner (div > section > Banner) must be found by walking byId, not just roots');
  assert.equal(banner.resolvedFile, 'features/shop/components/Banner.tsx');
  assert.equal(banner.layer, 'component');
  assert.deepEqual(banner.boundProps, ['text']);
});

test('two nodes for the same tag resolve independently: shared declared-props doc, independent bound/unbound status', async () => {
  const r = await homeComponents();
  const cards = r.components.filter((c) => c.tag === 'Card');
  assert.equal(cards.length, 2, 'the plain Card and the .map()-rendered Card');
  for (const c of cards) {
    assert.equal(c.resolvedFile, 'features/shop/components/Card.tsx');
    assert.deepEqual(c.declaredProps.map((p) => p.name).sort(), ['count', 'title']);
  }
  const plain = cards.find((c) => c.unboundProps.includes('count'));
  const spread = cards.find((c) => !c.unboundProps.includes('count'));
  assert.ok(plain, 'the plain <Card title="Hi" /> never passes "count", so it is unbound there');
  assert.ok(spread, 'the spread-covered Card must not report "count" as unbound');
  assert.notEqual(plain.nodeId, spread.nodeId);
});

test('never throws: an out-of-root path fails with OUTSIDE_ROOT', async () => {
  const r = await resolvePageComponents(root, '../outside.tsx');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'OUTSIDE_ROOT');
});

test('never throws: a missing file fails with NOT_FOUND', async () => {
  const r = await resolvePageComponents(root, 'features/shop/pages/DoesNotExist.tsx');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NOT_FOUND');
});

test('never throws: a syntax error fails with PARSE_ERROR', async () => {
  const dir = makeTempDir('construct-pagecomponents-bad-');
  fs.writeFileSync(path.join(dir, 'Bad.tsx'), 'export function Bad( { return <i/>; \nconst = ;');
  const r = await resolvePageComponents(dir, 'Bad.tsx');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PARSE_ERROR');
});

test('a page with no custom components returns an empty, ok list', async () => {
  const dir = makeTempDir('construct-pagecomponents-empty-');
  fs.writeFileSync(path.join(dir, 'Plain.tsx'), 'export function Plain() { return <div><span>hi</span></div>; }\n');
  const r = await resolvePageComponents(dir, 'Plain.tsx');
  assert.equal(r.ok, true);
  assert.deepEqual(r.components, []);
});
