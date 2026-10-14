// atomicGate's checks on small sources (Smith stubbed: these tests are about the atomic shape, not the translation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atomicGate } from '../gate.mjs';

const smith = async () => ({ steps: ['It returns x.'], empty: null, all: [] });
const gate = (rel, source, fn, extra = {}) => atomicGate({ rel, source, fn, smith, ...extra });
const check = (g, name) => g.checks.find((c) => c.check === name);

test('connections: a dotted JSX tag is a component reference, a dotted value read is data', async () => {
  const source = `import React from 'react';
import * as SubframeCore from '@subframe/core';
import { SideNav } from './SideNav';
import { matomo } from './matomo';
export function Nav({ items, onPick }: { items: string[]; onPick: (a: string) => void }) {
  return (
    <SubframeCore.DropdownMenu.Root>
      <React.Fragment>
        {items.map((i) => <SideNav.NavItem key={i} onClick={() => onPick(i)}>{i}</SideNav.NavItem>)}
      </React.Fragment>
    </SubframeCore.DropdownMenu.Root>
  );
}
export function Track({ onPick }: { onPick: (a: string) => void }) {
  return <button onClick={() => onPick(matomo.ACTION_TYPES.VIEW)}>go</button>;
}
`;
  const nav = await gate('features/a/components/Nav.tsx', source, 'Nav');
  assert.equal(check(nav, 'connections').ok, true, check(nav, 'connections').line);
  const track = await gate('features/a/components/Nav.tsx', source, 'Track');
  assert.equal(check(track, 'connections').ok, false);
  assert.match(check(track, 'connections').line, /reads imported matomo as data/);
});

test('layers come from the profiles: domain/ (singular, Construct) and domains/ (Line) are pure and purity-checked', async () => {
  const { layerOf, folderLayers } = await import('../gate.mjs');
  assert.equal(layerOf('src/features/admin-navigation/domain/adminNavigation.ts'), 'domain');
  assert.equal(layerOf('features/book/domains/formatPages.ts'), 'domain');
  assert.deepEqual(['adapters', 'viewmodels', 'expressions', 'usecases'].map((f) => folderLayers()[f]), ['adapter', 'viewmodel', 'expression', 'workflow']);
  const src = 'export function stripLocale(path: string): string {\n  return path.replace(/^\\/[a-z]{2}(?=\\/|$)/, "");\n}\nexport function stamp(x: string): string {\n  localStorage.setItem("last", x);\n  return x;\n}\n';
  const rel = 'src/features/admin-navigation/domain/adminNavigation.ts';
  const pure = await gate(rel, src, 'stripLocale');
  assert.deepEqual([pure.layer, check(pure, 'purity').ok], ['domain', true]);
  const impure = await gate(rel, src, 'stamp');
  assert.equal(check(impure, 'purity').ok, false, check(impure, 'purity').line);
  const svc = await gate('src/features/admin-navigation/services/x.ts', src, 'stamp');
  assert.equal(check(svc, 'purity'), undefined, 'a service is not purity-checked');
});

test('one job as a whole: a hook whose work sits in nested callbacks fails with the breakdown; a small hook passes', async () => {
  const { wholeComplexity, UNIT_BUDGET_FACTOR, CONCERN_LIMIT } = await import('../gate.mjs');
  const branchy = (name, n) => `  const ${name} = (x: number) => {\n${Array.from({ length: n }, (_, i) => `    if (x === ${i}) track(${i});`).join('\n')}\n  };\n`;
  const source = `import { track } from '@/libs/analytics';
import { useRouter } from 'next/navigation';
import { useCrumbs } from '@/libs/breadcrumbs';
import { useProfile } from '@/hooks/useProfile';
import { pageOf } from '../domain/pages';
export function useFrame() {
  const router = useRouter();
  const crumbs = useCrumbs();
  const me = useProfile();
${branchy('onA', 6)}${branchy('onB', 5)}${branchy('onC', 4)}  const onScroll = () => { window.scrollTo(0, 0); };
  return { router, crumbs, me, onA, onB, onC, onScroll, page: pageOf(1) };
}
export function useSmall() {
  const router = useRouter();
  const go = (x: number) => { if (x > 0) router.push('/a'); };
  return { go };
}
`;
  const rel = 'src/features/frame/hooks/useFrame.ts';
  const w = wholeComplexity(source, 'useFrame');
  assert.equal(w.own, 1, 'alone, the hook body is trivial');
  assert.equal(w.whole, 1 + 6 + 5 + 4);
  const g = await gate(rel, source, 'useFrame');
  const one = check(g, 'one-job');
  assert.equal(one.ok, false);
  assert.match(one.line, new RegExp(`whole cyclomatic 16/${10 * UNIT_BUDGET_FACTOR} \\(hook 10 x 1\\.5: useFrame 1, onA 7, onB 6, onC 5, onScroll 1\\)`));
  assert.match(one.line, new RegExp(`concerns 5/${CONCERN_LIMIT} \\(next/navigation, @/libs/breadcrumbs, @/hooks/useProfile, @/libs/analytics, browser\\)`));
  assert.ok(!/domain\/pages/.test(one.line), 'the unit\'s own feature is not a concern');
  assert.ok(g.failed.includes('one-job'));
  assert.equal(check(await gate(rel, source, 'useSmall'), 'one-job').ok, true);
});

test('connections: a member name that matches an import (SubframeCore.DropdownMenu.Root, DropdownMenu imported) is not a read', async () => {
  const source = `import * as SubframeCore from '@subframe/core';
import { DropdownMenu } from './DropdownMenu';
export function Menu({ label }: { label: string }) {
  return (
    <SubframeCore.DropdownMenu.Root>
      <DropdownMenu><DropdownMenu.DropdownItem>{label}</DropdownMenu.DropdownItem></DropdownMenu>
    </SubframeCore.DropdownMenu.Root>
  );
}
`;
  const g = await gate('features/a/components/Menu.tsx', source, 'Menu');
  assert.equal(check(g, 'connections').ok, true, check(g, 'connections').line);
});
