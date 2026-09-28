// #547 (Block 2 of #542's framework) -- availableActions(block, state, catalog, projectCtx): the legal
// action menu at any level, derived from the layer graph's canImport plus a rule catalog, never a
// hand-listed menu per screen. Pages editor is the first real consumer (Palette + Wrap-with + Auto-
// extract); processActionCatalog proves the same function is genuinely level-agnostic.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { availableActions, pageActionCatalog, processActionCatalog } from '../packages/engine/availableActions.mjs';
import { buildPalette, buildWrapSuggestions, findWrapHit } from '../packages/engine/palette.mjs';
import { extractExpression } from '../packages/core/extractExpression.mjs';
import { createFeature } from '../packages/core/generators.mjs';
import { DEFAULT_LAYERS } from '../packages/core/config.mjs';
import { PROCESS_EVENTS } from '../packages/engine/processMachine.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

test('canImport half: one action per edge, in graph order, none for a layer outside the graph', () => {
  const actions = availableActions({ layer: 'page' }, null, {}, {});
  assert.deepEqual(actions, [
    { id: 'import.component', kind: 'mechanical', label: 'Import a component', enabled: true },
    { id: 'import.types', kind: 'mechanical', label: 'Import a types', enabled: true },
  ]);
  assert.deepEqual(availableActions({ layer: 'unknown-layer' }, null, {}, {}), []);
});

test('canImport half is level-agnostic: every DEFAULT_LAYERS key gets its own menu for free', () => {
  for (const [layer, def] of Object.entries(DEFAULT_LAYERS)) {
    const actions = availableActions({ layer }, null, {}, {});
    assert.deepEqual(actions.map((a) => a.id), def.canImport.map((t) => `import.${t}`));
  }
});

test('canImport half honors a custom layer graph via projectCtx.layers (e.g. react-spa)', () => {
  const layers = { route: { pattern: 'src/App.tsx', canImport: ['controller'] } };
  const actions = availableActions({ layer: 'route' }, null, {}, { layers });
  assert.deepEqual(actions, [{ id: 'import.controller', kind: 'mechanical', label: 'Import a controller', enabled: true }]);
});

test('rule-catalog half: not offered when appliesTo is false, disabled with {rule, why} when disabledBecause fires', () => {
  const catalog = {
    domain: [
      { id: 'skipped', kind: 'mechanical', label: 'Never shown', appliesTo: () => false },
      { id: 'blocked', kind: 'mechanical', label: 'Blocked', rule: 'DOMAIN-002', disabledBecause: () => 'Would read impure global state.' },
      { id: 'free-to-go', kind: 'mechanical', label: 'Free to go' },
    ],
  };
  const actions = availableActions({ layer: 'domain' }, {}, catalog, {});
  const ids = actions.map((a) => a.id);
  assert.ok(!ids.includes('skipped'));
  const blocked = actions.find((a) => a.id === 'blocked');
  assert.equal(blocked.enabled, false);
  assert.deepEqual(blocked.disabledBecause, { rule: 'DOMAIN-002', why: 'Would read impure global state.' });
  const free = actions.find((a) => a.id === 'free-to-go');
  assert.equal(free.enabled, true);
  assert.equal('disabledBecause' in free, false);
});

test('rule-catalog half receives block/state/projectCtx exactly as given, and defaults kind to mechanical', () => {
  let seen = null;
  const catalog = {
    page: [{
      id: 'x',
      label: 'X',
      appliesTo: (block, state, ctx) => { seen = { block, state, ctx }; return true; },
    }],
  };
  const block = { layer: 'page', path: 'features/cart/pages/Cart.tsx' };
  const state = { some: 'fact' };
  const ctx = { root: '/tmp/project' };
  const [action] = availableActions(block, state, catalog, ctx);
  assert.equal(action.kind, 'mechanical');
  assert.deepEqual(seen, { block, state, ctx });
});

function project() {
  const dir = makeTempDir('construct-available-actions-');
  createFeature(dir, 'cpo');
  const pageFile = path.join(dir, 'features', 'cpo', 'pages', 'CpoHome.tsx');
  fs.writeFileSync(pageFile, `export default function CpoHome(props: { items: string[]; loggedIn: boolean }) {
  return (
    <div className="home">
      <ul>
        {props.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {props.loggedIn ? <span>Welcome</span> : <span>Guest</span>}
    </div>
  );
}
`);
  return { dir, pageFile };
}

test('Pages editor: real Palette entries are offered, enabled, one per named unit', () => {
  const { dir } = project();
  const palette = buildPalette(dir, 'cpo');
  assert.equal(palette.ok, true);
  fs.mkdirSync(path.join(dir, 'features/cpo/components'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features/cpo/components/PriceTag.tsx'), `export function PriceTag() { return null; }\n`);
  const paletteWithComponent = buildPalette(dir, 'cpo');
  const actions = availableActions({ layer: 'page' }, null, { page: pageActionCatalog(paletteWithComponent) }, {});
  const importAction = actions.find((a) => a.id === 'import.components.PriceTag');
  assert.ok(importAction);
  assert.equal(importAction.enabled, true);
});

test('Pages editor: a structurally-mismatched Wrap-with suggestion is disabled with PAGE-008 and the real reason', () => {
  const { dir, pageFile } = project();
  // Extract the loop into an Expression, leaving the conditional flagged -- so a "wrap the conditional
  // with the loop-shaped Expression" suggestion is a genuine not-a-fit, not a stubbed one.
  const loopResult = extractExpression(dir, pageFile);
  const source = fs.readFileSync(pageFile, 'utf8');
  const palette = buildPalette(dir, 'cpo');
  const hit = findWrapHit(source);
  assert.equal(hit.kind, 'conditional');
  const wrapSuggestions = buildWrapSuggestions(dir, source, [hit.node.range[0], hit.node.range[1]], palette);

  const actions = availableActions(
    { layer: 'page', path: 'features/cpo/pages/CpoHome.tsx' },
    null,
    { page: pageActionCatalog(palette, wrapSuggestions) },
    {},
  );

  const autoExtract = actions.find((a) => a.id === 'auto-extract');
  assert.ok(autoExtract);
  assert.equal(autoExtract.enabled, true);

  const wrapAction = actions.find((a) => a.id === `wrap.${loopResult.expression.name}`);
  assert.ok(wrapAction);
  assert.equal(wrapAction.enabled, false);
  assert.equal(wrapAction.disabledBecause.rule, 'PAGE-008');
  assert.match(wrapAction.disabledBecause.why, /loop/);
});

test('Pages editor: no flagged selection means no Wrap-with/Auto-extract candidates, only Palette imports', () => {
  const { dir } = project();
  const palette = buildPalette(dir, 'cpo');
  const actions = availableActions({ layer: 'page' }, null, { page: pageActionCatalog(palette) }, {});
  assert.ok(!actions.some((a) => a.id === 'auto-extract'));
  assert.ok(!actions.some((a) => a.id.startsWith('wrap.')));
});

test('process lifecycle: a second, unrelated level reusing the same availableActions() function', () => {
  const catalog = { process: processActionCatalog() };
  const queued = availableActions({ layer: 'process' }, { statePath: 'queued', context: {} }, catalog, {});
  assert.deepEqual(queued.map((a) => a.id), [...PROCESS_EVENTS]);
  const start = queued.find((a) => a.id === 'START');
  assert.equal(start.enabled, true);
  const resumeWhileQueued = queued.find((a) => a.id === 'RESUME');
  assert.equal(resumeWhileQueued.enabled, false);
  assert.equal(resumeWhileQueued.disabledBecause.rule, 'process.lifecycle');
  assert.match(resumeWhileQueued.disabledBecause.why, /queued/);

  const paused = availableActions({ layer: 'process' }, { statePath: 'paused', context: {} }, catalog, {});
  assert.equal(paused.find((a) => a.id === 'RESUME').enabled, true);
  assert.equal(paused.find((a) => a.id === 'CANCEL').enabled, true);
  assert.equal(paused.find((a) => a.id === 'START').enabled, false);
});
