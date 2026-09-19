import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ConstructError } from '../src/diagnostics.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import {
  CANONICAL_LAYERS,
  mergeLayers,
  validateGraph,
  loadLayerGraph,
  canImport,
} from '../src/architecture-graph.mjs';

test('validateGraph accepts the canonical default graph', () => {
  assert.equal(validateGraph(CANONICAL_LAYERS), true);
});

test('canImport reflects DEFAULT_LAYERS edges', () => {
  assert.equal(canImport(CANONICAL_LAYERS, 'controller', 'workflow'), true);
  assert.equal(canImport(CANONICAL_LAYERS, 'page', 'service'), false);
  assert.equal(canImport(CANONICAL_LAYERS, 'component', 'component'), true); // same-layer always allowed
});

test('mergeLayers additively extends a base layer via addCanImport', () => {
  const merged = mergeLayers(CANONICAL_LAYERS, { hook: { addCanImport: ['controller'] } });
  assert.ok(merged.hook.canImport.includes('controller'));
  assert.ok(merged.hook.canImport.includes('workflow')); // original edges preserved
});

test('mergeLayers introduces a wholly new layer', () => {
  const merged = mergeLayers(CANONICAL_LAYERS, { analytics: { pattern: 'features/*/analytics/**', canImport: ['domain', 'types'] } });
  assert.ok(merged.analytics);
  assert.deepEqual(merged.analytics.canImport, ['domain', 'types']);
});

test('validateGraph throws a ConstructError naming an edge to a nonexistent layer', () => {
  const bad = mergeLayers(CANONICAL_LAYERS, { workflow: { canImport: ['nonexistent'] } });
  assert.throws(() => validateGraph(bad), (err) => {
    assert.ok(err instanceof ConstructError);
    assert.match(err.message, /workflow -> nonexistent/);
    return true;
  });
});

test('validateGraph throws a ConstructError naming a cycle', () => {
  const bad = mergeLayers(CANONICAL_LAYERS, {
    foo: { pattern: 'features/*/foo/**', canImport: ['bar'] },
    bar: { pattern: 'features/*/bar/**', canImport: ['foo'] },
  });
  assert.throws(() => validateGraph(bad), (err) => {
    assert.ok(err instanceof ConstructError);
    assert.match(err.message, /cycle detected/);
    assert.match(err.message, /foo -> bar -> foo/);
    return true;
  });
});

test('validateGraph allows a same-layer self-edge without flagging a cycle', () => {
  // component -> component is part of DEFAULT_LAYERS and must not be a cycle.
  assert.ok(CANONICAL_LAYERS.component.canImport.includes('component'));
  assert.equal(validateGraph(CANONICAL_LAYERS), true);
});

test('loadLayerGraph returns the canonical graph when no architecture.yml exists', () => {
  const dir = makeTempDir('construct-graph-');
  const graph = loadLayerGraph(dir);
  assert.deepEqual(graph.route.canImport, CANONICAL_LAYERS.route.canImport);
});

test('loadLayerGraph merges a project-level `layers:` override from architecture.yml', () => {
  const dir = makeTempDir('construct-graph-');
  // hook -> page introduces no cycle (page only reaches component/types).
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'layers:\n  hook:\n    addCanImport: [page]\n');
  const graph = loadLayerGraph(dir);
  assert.ok(graph.hook.canImport.includes('page'));
  assert.ok(graph.hook.canImport.includes('workflow')); // original edges preserved
});

test('loadLayerGraph throws a ConstructError on a malformed custom graph', () => {
  const dir = makeTempDir('construct-graph-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'layers:\n  page:\n    canImport: [ghost]\n');
  assert.throws(() => loadLayerGraph(dir), (err) => {
    assert.ok(err instanceof ConstructError);
    assert.match(err.message, /page -> ghost/);
    return true;
  });
});

test('loadLayerGraph picks the react-spa route pattern (src/App.tsx) when project.framework is react-spa', () => {
  const dir = makeTempDir('construct-graph-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'project:\n  framework: react-spa\n');
  const graph = loadLayerGraph(dir);
  assert.equal(graph.route.pattern, 'src/App.tsx');
  assert.deepEqual(graph.route.canImport, CANONICAL_LAYERS.route.canImport);
  // Every other layer is unaffected by the framework switch.
  assert.deepEqual(graph.controller, CANONICAL_LAYERS.controller);
});

test('loadLayerGraph still honors a `layers:` override on top of the react-spa base', () => {
  const dir = makeTempDir('construct-graph-');
  fs.writeFileSync(
    dir + '/architecture.yml',
    'project:\n  framework: react-spa\nlayers:\n  hook:\n    addCanImport: [page]\n',
  );
  const graph = loadLayerGraph(dir);
  assert.equal(graph.route.pattern, 'src/App.tsx');
  assert.ok(graph.hook.canImport.includes('page'));
  assert.ok(graph.hook.canImport.includes('workflow'));
});

test('loadLayerGraph throws a clear ConstructError for an unknown project.framework', () => {
  const dir = makeTempDir('construct-graph-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'project:\n  framework: sveltekit\n');
  assert.throws(() => loadLayerGraph(dir), (err) => {
    assert.ok(err instanceof ConstructError);
    assert.match(err.message, /Unknown project\.framework 'sveltekit'/);
    return true;
  });
});
