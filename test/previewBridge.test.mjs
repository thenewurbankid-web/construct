import test from 'node:test';
import assert from 'node:assert/strict';
import { installPreviewBridge, previewBridgeScript } from '../packages/engine/previewBridge.mjs';
import { transformForPreview } from '../packages/engine/previewVitePlugin.mjs';

function fakeWindow() {
  const listeners = {};
  const posted = [];
  const win = {
    document: { addEventListener: (t, fn) => { listeners[t] = fn; } },
    parent: { postMessage: (m, o) => posted.push([m, o]) },
  };
  return { win, listeners, posted };
}
const el = (src, style = {}) => ({ style, getAttribute: () => src, closest() { return this; } });

test('click on an annotated element posts its src to the parent and suppresses the click', () => {
  const { win, listeners, posted } = fakeWindow();
  assert.equal(installPreviewBridge(win), true);
  let prevented = 0;
  listeners.click({ target: el('a.tsx:3:5'), preventDefault: () => prevented++, stopPropagation() {} });
  assert.deepEqual(posted, [[{ type: 'construct:select', src: 'a.tsx:3:5' }, '*']]);
  assert.equal(prevented, 1);
});

test('hover outline is cleared when the pointer leaves the iframe (null relatedTarget), not on internal moves', () => {
  const { win, listeners } = fakeWindow();
  installPreviewBridge(win);
  const a = el('a.tsx:1:1', { outline: '1px solid red' });
  listeners.mouseover({ target: a });
  assert.equal(a.style.outline, '2px solid #7c5cff');
  listeners.mouseout({ target: a, relatedTarget: el('b.tsx:1:1') });
  assert.equal(a.style.outline, '2px solid #7c5cff');
  listeners.mouseout({ target: a, relatedTarget: null });
  assert.equal(a.style.outline, '1px solid red');
  listeners.mouseover({ target: a });
  listeners.mouseleave({ target: a, relatedTarget: null });
  assert.equal(a.style.outline, '1px solid red');
});

test('click on an unannotated element does nothing', () => {
  const { win, listeners, posted } = fakeWindow();
  installPreviewBridge(win);
  listeners.click({ target: { closest: () => null }, preventDefault() { throw new Error('no'); }, stopPropagation() {} });
  assert.equal(posted.length, 0);
});

test('installs once, and not when not embedded (parent === window)', () => {
  const { win } = fakeWindow();
  assert.equal(installPreviewBridge(win), true);
  assert.equal(installPreviewBridge(win), false);
  const top = fakeWindow().win;
  top.parent = top;
  assert.equal(installPreviewBridge(top), false);
});

test('serialised script is self-contained and evaluates', () => {
  const { win, listeners } = fakeWindow();
  new Function('window', previewBridgeScript().replace('(window)', '(window)'))(win);
  assert.ok(listeners.click);
});

test('vite transform annotates tsx/jsx with root-relative paths, skips others and syntax errors', () => {
  const r = transformForPreview('export default () => <div/>;', '/root/src/A.tsx?x=1', '/root');
  assert.match(r.code, /data-cx-src="src\/A\.tsx:1:22"/);
  assert.equal(transformForPreview('<div/>', '/root/node_modules/x/A.tsx', '/root'), null);
  assert.equal(transformForPreview('x', '/root/a.ts', '/root'), null);
  assert.equal(transformForPreview('<div', '/root/a.tsx', '/root'), null);
});
