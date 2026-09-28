import test from 'node:test';
import assert from 'node:assert/strict';

class FakeWindow extends EventTarget {
  addEventListener(type, listener) { super.addEventListener(type, listener); }
  removeEventListener(type, listener) { super.removeEventListener(type, listener); }
}

const withGlobalWindow = async (fn) => {
  const previous = globalThis.window;
  const win = new FakeWindow();
  globalThis.window = win;
  try {
    return await fn(win);
  } finally {
    globalThis.window = previous;
  }
};

// A real `MessageEvent` rejects any `source` that isn't a MessagePort/WindowProxy/ServiceWorker (WHATWG
// webidl), but the transport only ever reads `.origin`/`.source`/`.data` as plain properties — so a plain
// `Event` with those attached is enough here and avoids fighting that validation for a fake iframe window.
const post = (win, source, data, origin) => {
  const event = new Event('message');
  Object.assign(event, { data, origin, source });
  win.dispatchEvent(event);
};

test('createFiberPreviewSource dispatches select only for the right nonce, origin and frame', async () => {
  await withGlobalWindow(async (win) => {
    const { createFiberPreviewSource } = await import('./PreviewFiberSource.ts');
    const frame = {};
    const other = {};
    const source = createFiberPreviewSource('http://127.0.0.1:5555/', 'nonce-1', () => frame);
    const seen = [];
    source.onSelect((s) => seen.push(s));

    const good = { type: 'construct:preview:select', nonce: 'nonce-1', protocol: 'construct-preview/1', selection: { id: 1 } };
    post(win, frame, good, 'http://evil.example');
    post(win, other, good, 'http://127.0.0.1:5555');
    post(win, frame, { ...good, nonce: 'wrong' }, 'http://127.0.0.1:5555');
    post(win, frame, { ...good, protocol: 'other/1' }, 'http://127.0.0.1:5555');
    assert.deepEqual(seen, [], 'no accepted message yet: wrong origin, wrong frame, wrong nonce, wrong protocol');

    post(win, frame, good, 'http://127.0.0.1:5555');
    assert.deepEqual(seen, [{ id: 1 }], 'accepted once every check passes');
  });
});

test('createFiberPreviewSource routes hello/hover/error to their own handlers', async () => {
  await withGlobalWindow(async (win) => {
    const { createFiberPreviewSource } = await import('./PreviewFiberSource.ts');
    const frame = {};
    const source = createFiberPreviewSource('http://127.0.0.1:5555/', 'n', () => frame);
    const hellos = []; const hovers = []; const errors = []; const selects = [];
    source.onHello((c) => hellos.push(c));
    source.onHover((h) => hovers.push(h));
    source.onError((e) => errors.push(e));
    source.onSelect((s) => selects.push(s));

    const base = { nonce: 'n', protocol: 'construct-preview/1' };
    post(win, frame, { ...base, type: 'construct:preview:hello', capabilities: { pick: true, hover: true, highlight: true } }, 'http://127.0.0.1:5555');
    post(win, frame, { ...base, type: 'construct:preview:hover', componentName: 'Card', tag: 'div' }, 'http://127.0.0.1:5555');
    post(win, frame, { ...base, type: 'construct:preview:error', reason: 'no-fiber' }, 'http://127.0.0.1:5555');

    assert.deepEqual(hellos, [{ pick: true, hover: true, highlight: true }]);
    assert.deepEqual(hovers, [{ componentName: 'Card', tag: 'div' }]);
    assert.deepEqual(errors, [{ reason: 'no-fiber' }]);
    assert.deepEqual(selects, [], 'a hello/hover/error message never reaches the select handler');
  });
});

test('setPick, highlight and detach post the closed vocabulary with the session nonce', async () => {
  await withGlobalWindow(async () => {
    const { createFiberPreviewSource } = await import('./PreviewFiberSource.ts');
    const posted = [];
    const frame = { postMessage: (msg, origin) => posted.push({ msg, origin }) };
    const source = createFiberPreviewSource('http://127.0.0.1:5555/', 'n', () => frame);

    source.setPick(true);
    source.highlight(7);
    source.detach();

    assert.deepEqual(posted, [
      { msg: { type: 'construct:preview:mode', pick: true, nonce: 'n', protocol: 'construct-preview/1' }, origin: 'http://127.0.0.1:5555' },
      { msg: { type: 'construct:preview:highlight', id: 7, nonce: 'n', protocol: 'construct-preview/1' }, origin: 'http://127.0.0.1:5555' },
      { msg: { type: 'construct:preview:detach', nonce: 'n', protocol: 'construct-preview/1' }, origin: 'http://127.0.0.1:5555' },
    ]);
  });
});

test('a missing frame window drops outbound messages instead of throwing', async () => {
  await withGlobalWindow(async () => {
    const { createFiberPreviewSource } = await import('./PreviewFiberSource.ts');
    const source = createFiberPreviewSource('http://127.0.0.1:5555/', 'n', () => null);
    assert.doesNotThrow(() => source.setPick(true));
  });
});
