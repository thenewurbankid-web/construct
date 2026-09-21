// The resolver, run over payloads RECORDED FROM REAL DEV BUILDS (#443).
//
// Fixtures in test/fixtures/previewFiber/ are produced by
// test-utils/preview-fixtures/capture.mjs, which drives a real browser against
// a real dev server (see test-utils/preview-fixtures/README.md). Nothing here
// starts a framework: the capture is a deliberate, occasional step, and these
// tests stay fast and hermetic.
//
// Each fixture carries `capturedFrom`, so a recorded payload can never be
// mistaken for a hand-written one. If a fixture is missing (nobody has run the
// capture in this checkout), the test says so instead of silently passing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveFiberSelection, PREVIEW_FIBER_PROTOCOL } from '../src/engine/previewFiber.mjs';

const DIR = fileURLToPath(new URL('./fixtures/previewFiber/', import.meta.url));
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort() : [];

test('at least one payload recorded from a real dev build is checked in', { skip: files.length ? false : 'no recording in this checkout — see test-utils/preview-fixtures/README.md' }, () => {
  assert.ok(files.length > 0);
});

for (const fileName of files) {
  const record = JSON.parse(fs.readFileSync(path.join(DIR, fileName), 'utf8'));
  const label = `${fileName} (${record.capturedFrom?.url}, React ${record.capturedFrom?.reactVersion || 'unknown'})`;

  test(`recorded ${label}: the bridge installed and sent a well-formed selection`, () => {
    assert.equal(record.installed, true, 'the bridge installed itself in the real page');
    assert.ok(record.capturedFrom?.what?.includes('real dev build'), 'the fixture declares its provenance');
    const hello = record.messages.find((m) => m.type === 'construct:preview:hello');
    const select = record.messages.find((m) => m.type === 'construct:preview:select');
    assert.ok(hello, 'handshake sent');
    assert.equal(hello.protocol, PREVIEW_FIBER_PROTOCOL);
    assert.ok(select, 'Alt+click produced a selection');
    assert.equal(select.nonce, hello.nonce, 'every message carries the session nonce');
    assert.ok(select.selection.componentName, 'a real component name was read off the fiber');
    assert.ok(select.selection.ancestors.length > 0, 'the component ancestor chain was read off the fiber');
  });

  test(`recorded ${label}: nothing sensitive or unserialisable crosses the boundary`, () => {
    const select = record.messages.find((m) => m.type === 'construct:preview:select');
    for (const prop of select.selection.props) {
      assert.ok(['string', 'number', 'boolean'].includes(prop.type) || prop.value === null, `${prop.name} is named, not serialised`);
    }
    assert.ok(!select.selection.props.some((p) => p.name === 'children'));
    assert.ok(JSON.stringify(select).length <= 65536, 'within the payload cap');
  });

  test(`recorded ${label}: the resolver turns it into a contained project path or an honest reason`, () => {
    const select = record.messages.find((m) => m.type === 'construct:preview:select');
    const projectRoot = record.capturedFrom?.projectRoot || '/project';
    const resolved = resolveFiberSelection(select, { projectRoot, sourceMaps: record.sourceMaps || {} });

    if (resolved.ok) {
      assert.ok(resolved.file && !resolved.file.startsWith('/') && !resolved.file.includes('..'), `contained: ${resolved.file}`);
      assert.ok(['annotation', 'debug-source', 'stack'].includes(resolved.tier));
      assert.ok(['exact', 'mapped', 'file-only'].includes(resolved.confidence));
      if (resolved.confidence === 'file-only') assert.equal(resolved.line, null, 'a transformed line is never reported as a source line');
    } else {
      assert.equal(resolved.file, null);
      assert.ok(['no-evidence', 'unmapped', 'unmapped-position', 'outside-project', 'minified'].includes(resolved.reason), resolved.reason);
      assert.equal(resolved.tier, 'component', 'component identity still resolves, so the tree can select the node');
      assert.ok(resolved.componentName);
    }

    // Whatever the tier, the ancestor chain survives and stays contained.
    for (const ancestor of resolved.ancestors) {
      assert.ok(ancestor.componentName);
      if (ancestor.file) assert.ok(!ancestor.file.startsWith('/') && !ancestor.file.includes('..'), ancestor.file);
    }
  });

  test(`recorded ${label}: resolving is deterministic`, () => {
    const select = record.messages.find((m) => m.type === 'construct:preview:select');
    const context = { projectRoot: record.capturedFrom?.projectRoot || '/project', sourceMaps: record.sourceMaps || {} };
    assert.deepEqual(resolveFiberSelection(select, context), resolveFiberSelection(select, context));
  });
}
