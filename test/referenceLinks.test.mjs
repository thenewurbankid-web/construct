import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectReferences, exportOrigin } from '../src/engine/referenceLinks.mjs';

const PAGE = `import { PriceCard } from '../components';
import Badge from '../components/Badge';
import * as Kit from '../components/Kit';
import { Tooltip } from 'ui-lib';
const Banner = cond ? A : B;
export default function Home() {
  const Lazy = load(() => import('./Lazy'));
  const x = import(path);
  return <div><PriceCard /><Badge /><Kit.Chip /><Tooltip /><Banner /><span /></div>;
}
`;

test('collectReferences: import bindings and JSX tags, with reasons for the unfollowable', () => {
  const refs = collectReferences(PAGE);
  const imports = refs.filter((r) => r.kind === 'import').map((r) => [r.name, r.specifier, r.imported]);
  assert.deepEqual(imports, [['PriceCard', '../components', 'PriceCard'], ['Badge', '../components/Badge', 'default'], ['Kit', '../components/Kit', '*'], ['Tooltip', 'ui-lib', 'Tooltip']]);
  const jsx = refs.filter((r) => r.kind === 'jsx');
  assert.deepEqual(jsx.map((r) => r.name), ['PriceCard', 'Badge', 'Kit', 'Tooltip', 'Banner']);
  assert.equal(jsx.find((r) => r.name === 'Banner').specifier, null);
  assert.match(jsx.find((r) => r.name === 'Banner').reason, /not imported/);
  const dyn = refs.filter((r) => r.kind === 'dynamic');
  assert.equal(dyn.length, 2);
  assert.ok(dyn.every((r) => r.reason && r.specifier === null));
  const pc = refs.find((r) => r.kind === 'import' && r.name === 'PriceCard');
  assert.equal(PAGE.slice(pc.start, pc.end), 'PriceCard');
  assert.equal(pc.line, 1);
});

test('exportOrigin: local, re-export, alias, default, star, missing', () => {
  const barrel = `export { PriceCard } from './PriceCard';
export { default as Badge } from './Badge';
export * as Kit from './Kit';
export * from './more';
import { X } from './X';
export { X };
export const K = 1;
export default function Main() {}
`;
  assert.deepEqual(exportOrigin(barrel, 'PriceCard'), { kind: 'reexport', source: './PriceCard', importedName: 'PriceCard' });
  assert.deepEqual(exportOrigin(barrel, 'Badge'), { kind: 'reexport', source: './Badge', importedName: 'default' });
  assert.deepEqual(exportOrigin(barrel, 'Kit'), { kind: 'reexport', source: './Kit', importedName: '*' });
  assert.deepEqual(exportOrigin(barrel, 'X'), { kind: 'reexport', source: './X', importedName: 'X' });
  assert.deepEqual(exportOrigin(barrel, 'K'), { kind: 'local' });
  assert.deepEqual(exportOrigin(barrel, 'default'), { kind: 'local' });
  assert.deepEqual(exportOrigin(barrel, 'Nope'), { kind: 'star', sources: ['./more'] });
  assert.equal(exportOrigin(`export const a = 1;`, 'b'), null);
  assert.deepEqual(exportOrigin(`export interface Props {}`, 'Props'), { kind: 'local' });
});
