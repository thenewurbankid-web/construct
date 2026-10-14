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
