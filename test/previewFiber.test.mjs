import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installPreviewFiberBridge,
  previewFiberBridgeScript,
  resolveFiberSelection,
  parseStackFrames,
  pickSourceFrame,
  applySourceMap,
  decodeMappings,
  toProjectPath,
  PREVIEW_FIBER_PROTOCOL,
} from '../packages/engine/previewFiber.mjs';

const ROOT = '/home/dev/workspace/storefront';
const PARENT = 'http://127.0.0.1:3000';

// --- a window the bridge can be installed into ------------------------------

function fakeWindow({ parentOrigin = PARENT } = {}) {
  const doc = {};
  const win = { __origin: parentOrigin };
  const posted = [];
  win.document = {
    handlers: {},
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    removeEventListener(type, fn) { this.handlers[type] = (this.handlers[type] || []).filter((f) => f !== fn); },
  };
  win.handlers = {};
  win.addEventListener = (type, fn) => { (win.handlers[type] ||= []).push(fn); };
  win.removeEventListener = (type, fn) => { win.handlers[type] = (win.handlers[type] || []).filter((f) => f !== fn); };
  win.parent = { postMessage: (m, origin) => posted.push({ m, origin }) };
  return { win, doc, posted, fire: (type, event) => (win.document.handlers[type] || []).forEach((f) => f(event)), message: (event) => (win.handlers.message || []).forEach((f) => f(event)) };
}

/** A DOM-element-shaped object carrying a React-19-shaped fiber. */
function fakeElement({ tag = 'button', fiber = null, annotation = null, parent = null } = {}) {
  const el = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    style: {},
    parentElement: parent,
    children: [],
    getAttribute: (name) => (name === 'data-cx-src' ? annotation : null),
    closest(sel) { return sel === '[data-cx-src]' && annotation ? this : null; },
  };
  if (fiber) el['__reactFiber$abc123'] = fiber;
  return el;
}

const Card = function Card() {};
const LoginPage = function LoginPage() {};

function fiberChain() {
  const page = { type: LoginPage, return: null, memoizedProps: {}, _debugStack: { stack: 'Error: react-stack-top-frame\n    at react-stack-bottom-frame (http://127.0.0.1:5173/node_modules/.vite/deps/react-dom_client.js:1:2)\n    at App (http://127.0.0.1:5173/src/main.tsx:9:20)' } };
  const card = { type: Card, return: page, memoizedProps: { title: 'Sign in' }, _debugStack: { stack: 'Error: react-stack-top-frame\n    at jsxDEV (http://127.0.0.1:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js:5:1)\n    at LoginPage (http://127.0.0.1:5173/src/pages/LoginPage.tsx:14:11)' } };
  const host = {
    type: 'button',
    return: card,
    memoizedProps: { className: 'primary', disabled: false, onClick: () => {}, user: { token: 'secret' }, children: 'Go' },
    _debugStack: { stack: 'Error: react-stack-top-frame\n    at jsxDEV (http://127.0.0.1:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js:5:1)\n    at Card (http://127.0.0.1:5173/src/components/Card.tsx:22:7)' },
  };
  return { host, card, page };
}

// --- the bridge -------------------------------------------------------------

test('bridge installs once, only when embedded, and only with a nonce + parent origin', () => {
  const a = fakeWindow();
  assert.equal(installPreviewFiberBridge(a.win, { nonce: 'n1', parentOrigin: PARENT }), true);
  assert.equal(installPreviewFiberBridge(a.win, { nonce: 'n1', parentOrigin: PARENT }), false, 'idempotent');

  const b = fakeWindow();
  assert.equal(installPreviewFiberBridge(b.win, { parentOrigin: PARENT }), false, 'no nonce');
  assert.equal(installPreviewFiberBridge(b.win, { nonce: 'n' }), false, 'no parent origin');

  const top = fakeWindow();
  top.win.parent = top.win;
  assert.equal(installPreviewFiberBridge(top.win, { nonce: 'n', parentOrigin: PARENT }), false, 'not embedded');
});

test('bridge announces itself with the nonce, the protocol and an explicit target origin (never "*")', () => {
  const { win, posted } = fakeWindow();
  installPreviewFiberBridge(win, { nonce: 'n1', parentOrigin: PARENT });
  assert.equal(posted.length, 1);
  assert.equal(posted[0].origin, PARENT);
  assert.equal(posted[0].m.type, 'construct:preview:hello');
  assert.equal(posted[0].m.nonce, 'n1');
  assert.equal(posted[0].m.protocol, PREVIEW_FIBER_PROTOCOL);
  assert.ok(!posted.some((p) => p.origin === '*'));
});

test('bridge installs a devtools hook stub only when nothing else claimed it', () => {
  const { win } = fakeWindow();
  installPreviewFiberBridge(win, { nonce: 'n', parentOrigin: PARENT });
  assert.equal(typeof win.__REACT_DEVTOOLS_GLOBAL_HOOK__.inject, 'function');
  assert.equal(win.__REACT_DEVTOOLS_GLOBAL_HOOK__.supportsFiber, true);

  const other = fakeWindow();
  const real = { renderers: new Map(), mine: true };
  other.win.__REACT_DEVTOOLS_GLOBAL_HOOK__ = real;
  installPreviewFiberBridge(other.win, { nonce: 'n', parentOrigin: PARENT });
  assert.equal(other.win.__REACT_DEVTOOLS_GLOBAL_HOOK__, real, 'a real DevTools install is never overwritten');
});

test('Alt+click selects even with Pick off; a plain click is left to the app', () => {
  const { win, posted, fire } = fakeWindow();
  installPreviewFiberBridge(win, { nonce: 'n', parentOrigin: PARENT });
  const { host } = fiberChain();
  const el = fakeElement({ fiber: host });

  let prevented = 0;
  fire('click', { target: el, altKey: false, preventDefault: () => prevented++, stopPropagation() {} });
  assert.equal(posted.filter((p) => p.m.type === 'construct:preview:select').length, 0);
  assert.equal(prevented, 0, 'the app keeps its own clicks');

  fire('click', { target: el, altKey: true, preventDefault: () => prevented++, stopPropagation() {} });
  const selects = posted.filter((p) => p.m.type === 'construct:preview:select');
  assert.equal(selects.length, 1);
  assert.equal(prevented, 1);
  assert.equal(selects[0].m.selection.componentName, 'Card', 'the nearest component owner, not the host tag');
  assert.equal(selects[0].m.selection.tag, 'button');
});

test('Pick mode is turned on by the parent and makes plain clicks select; Esc leaves it', () => {
  const { win, posted, fire, message } = fakeWindow();
  installPreviewFiberBridge(win, { nonce: 'n', parentOrigin: PARENT });
  const el = fakeElement({ fiber: fiberChain().host });

  message({ origin: PARENT, source: win.parent, data: { type: 'construct:preview:mode', nonce: 'n', pick: true } });
  fire('click', { target: el, altKey: false, preventDefault() {}, stopPropagation() {} });
  assert.equal(posted.filter((p) => p.m.type === 'construct:preview:select').length, 1);

  fire('keydown', { key: 'Escape' });
  fire('click', { target: el, altKey: false, preventDefault() {}, stopPropagation() {} });
  assert.equal(posted.filter((p) => p.m.type === 'construct:preview:select').length, 1, 'Esc left Pick mode');
});

test('inbound messages are ignored unless the origin, the source and the nonce all match', () => {
  const { win, fire, message, posted } = fakeWindow();
  installPreviewFiberBridge(win, { nonce: 'n', parentOrigin: PARENT });
  const el = fakeElement({ fiber: fiberChain().host });
  const on = (over) => message({ origin: PARENT, source: win.parent, data: { type: 'construct:preview:mode', nonce: 'n', pick: true }, ...over });

  on({ origin: 'http://evil.example' });
  on({ source: {} });
  on({ data: { type: 'construct:preview:mode', nonce: 'wrong', pick: true } });
  fire('click', { target: el, altKey: false, preventDefault() {}, stopPropagation() {} });
  assert.equal(posted.filter((p) => p.m.type === 'construct:preview:select').length, 0, 'Pick never turned on');
});

test('the payload carries prop names and primitives only — never objects, functions or children', () => {
  const { win, posted, fire } = fakeWindow();
  installPreviewFiberBridge(win, { nonce: 'n', parentOrigin: PARENT });
  fire('click', { target: fakeElement({ fiber: fiberChain().host }), altKey: true, preventDefault() {}, stopPropagation() {} });
  const props = posted.find((p) => p.m.type === 'construct:preview:select').m.selection.props;
  const byName = Object.fromEntries(props.map((p) => [p.name, p]));
  assert.deepEqual(byName.className, { name: 'className', type: 'string', value: 'primary' });
  assert.deepEqual(byName.disabled, { name: 'disabled', type: 'boolean', value: 'false' });
  assert.equal(byName.onClick.value, null, 'a function is named, never serialised');
  assert.equal(byName.user.value, null, 'an object graph is named, never serialised');
  assert.ok(!('children' in byName), 'children is never sent');
  assert.ok(!JSON.stringify(props).includes('secret'));
});

test('the payload carries the component ancestor chain and a DOM path, capped', () => {
  const { win, posted, fire } = fakeWindow();
  installPreviewFiberBridge(win, { nonce: 'n', parentOrigin: PARENT });
  const grandparent = fakeElement({ tag: 'main' });
  const parent = fakeElement({ tag: 'div', parent: grandparent });
  grandparent.children = [parent];
  const el = fakeElement({ fiber: fiberChain().host, parent });
  parent.children = [fakeElement({ tag: 'span' }), el];

  fire('click', { target: el, altKey: true, preventDefault() {}, stopPropagation() {} });
  const selection = posted.find((p) => p.m.type === 'construct:preview:select').m.selection;
  assert.deepEqual(selection.ancestors.map((a) => a.componentName), ['Card', 'LoginPage']);
  assert.deepEqual(selection.domPath, [{ tag: 'main', index: 0 }, { tag: 'div', index: 0 }, { tag: 'button', index: 1 }]);
  assert.equal(selection.react.hasDebugStack, true);
  assert.equal(selection.react.hasDebugSource, false);
});

test('an element with no fiber reports an error instead of guessing', () => {
  const { win, posted, fire } = fakeWindow();
  installPreviewFiberBridge(win, { nonce: 'n', parentOrigin: PARENT });
  fire('click', { target: fakeElement({}), altKey: true, preventDefault() { throw new Error('must not prevent'); }, stopPropagation() {} });
  assert.equal(posted.at(-1).m.type, 'construct:preview:error');
  assert.equal(posted.at(-1).m.reason, 'no-fiber');
});

test('hover outlines only in Pick mode, and restores the element style when the pointer leaves', () => {
  const { win, fire, message } = fakeWindow();
  installPreviewFiberBridge(win, { nonce: 'n', parentOrigin: PARENT });
  const el = fakeElement({ fiber: fiberChain().host });
  el.style.outline = '1px dotted red';

  fire('mouseover', { target: el });
  assert.equal(el.style.outline, '1px dotted red', 'quiet by default: no outline until Pick is on');

  message({ origin: PARENT, source: win.parent, data: { type: 'construct:preview:mode', nonce: 'n', pick: true } });
  fire('mouseover', { target: el });
  assert.equal(el.style.outline, '2px solid #7c5cff');
  fire('mouseout', { target: el, relatedTarget: fakeElement({}) });
  assert.equal(el.style.outline, '2px solid #7c5cff', 'a move inside the page keeps it');
  fire('mouseout', { target: el, relatedTarget: null });
  assert.equal(el.style.outline, '1px dotted red', 'left the frame: the page is exactly as it was');
});

test('highlight addresses a previous selection by id — no selector is ever evaluated in the page', () => {
  const { win, posted, fire, message } = fakeWindow();
  installPreviewFiberBridge(win, { nonce: 'n', parentOrigin: PARENT });
  const el = fakeElement({ fiber: fiberChain().host });
  fire('click', { target: el, altKey: true, preventDefault() {}, stopPropagation() {} });
  const { id } = posted.find((p) => p.m.type === 'construct:preview:select').m.selection;

  message({ origin: PARENT, source: win.parent, data: { type: 'construct:preview:highlight', nonce: 'n', id } });
  assert.equal(el.style.outline, '2px solid #7c5cff');
  message({ origin: PARENT, source: win.parent, data: { type: 'construct:preview:highlight', nonce: 'n', id: 999 } });
  assert.equal(el.style.outline, '', 'an unknown id highlights nothing');
});

test('detach removes every listener and leaves the page clean', () => {
  const { win, posted, fire, message } = fakeWindow();
  installPreviewFiberBridge(win, { nonce: 'n', parentOrigin: PARENT });
  message({ origin: PARENT, source: win.parent, data: { type: 'construct:preview:detach', nonce: 'n' } });
  const before = posted.length;
  fire('click', { target: fakeElement({ fiber: fiberChain().host }), altKey: true, preventDefault() {}, stopPropagation() {} });
  assert.equal(posted.length, before);
  assert.equal(win.document.handlers.click.length, 0);
  assert.equal(win.handlers.message.length, 0);
});

test('an oversized payload degrades in a fixed order and says what it dropped', () => {
  // Measured on a real Next.js dev build: 32 ancestors x a 4 KB stack is far
  // over the 64 KB total, and dropping the selection entirely is the worst
  // possible answer.
  const { win, posted, fire } = fakeWindow();
  installPreviewFiberBridge(win, { nonce: 'n', parentOrigin: PARENT });
  const bigStack = { stack: `Error\n${'    at Thing (http://127.0.0.1:3851/_next/static/chunks/app/page.js:1:1)\n'.repeat(60)}` };
  let top = { type: function Root() {}, return: null, memoizedProps: {}, _debugStack: bigStack };
  for (let i = 0; i < 30; i++) top = { type: function Wrapper() {}, return: top, memoizedProps: {}, _debugStack: bigStack };
  const host = { type: 'button', return: top, memoizedProps: { className: 'x' }, _debugStack: bigStack };

  fire('click', { target: fakeElement({ fiber: host }), altKey: true, preventDefault() {}, stopPropagation() {} });
  const last = posted.at(-1).m;
  assert.equal(last.type, 'construct:preview:select', 'the selection still arrives');
  assert.ok(JSON.stringify(last).length <= 65536, 'within the total cap');
  assert.deepEqual(last.selection.truncated, ['ancestor-stacks'], 'and it names what it dropped');
  assert.ok(last.selection.stack, 'the selected element keeps its own stack — that is the one that resolves');
  assert.ok(last.selection.ancestors.every((a) => a.stack === null));
});

test('the generated script is self-contained, embeds its options as data and cannot break out of <script>', () => {
  const script = previewFiberBridgeScript({ nonce: 'n1', parentOrigin: PARENT });
  assert.ok(!script.includes('</script'), 'no raw </script');
  assert.ok(!/\beval\s*\(/.test(script), 'the bridge never evaluates a string');
  assert.throws(() => previewFiberBridgeScript({ nonce: 'n' }), /parentOrigin/);

  const hostile = previewFiberBridgeScript({ nonce: '</script><img onerror=1>', parentOrigin: PARENT });
  assert.ok(!hostile.includes('</script>'));

  const { win, posted } = fakeWindow();
  new Function('window', script.replace('(window,', '(arguments[0],'))(win);
  assert.equal(posted[0].m.type, 'construct:preview:hello');
  assert.equal(posted[0].m.nonce, 'n1');
});

// --- stack parsing ----------------------------------------------------------

test('stack frames are parsed from V8 and from SpiderMonkey/JSC formats', () => {
  const v8 = [
    'Error: react-stack-top-frame',
    '    at react-stack-bottom-frame (http://127.0.0.1:5173/node_modules/.vite/deps/chunk-X.js:16455:20)',
    '    at Card (http://127.0.0.1:5173/src/components/Card.tsx?t=1758000000000:22:7)',
    '    at renderWithHooks (webpack-internal:///(app-pages-browser)/./node_modules/react-dom/x.js:1:2)',
  ].join('\n');
  const frames = parseStackFrames(v8);
  assert.deepEqual(frames.map((f) => [f.url, f.line, f.column]), [
    ['http://127.0.0.1:5173/node_modules/.vite/deps/chunk-X.js', 16455, 20],
    ['http://127.0.0.1:5173/src/components/Card.tsx?t=1758000000000', 22, 7],
    ['webpack-internal:///(app-pages-browser)/./node_modules/react-dom/x.js', 1, 2],
  ]);
  assert.equal(pickSourceFrame(frames).url, 'http://127.0.0.1:5173/src/components/Card.tsx?t=1758000000000');

  const spider = 'Card@http://127.0.0.1:5173/src/components/Card.tsx:22:7\n@http://127.0.0.1:5173/src/main.tsx:9:1';
  assert.deepEqual(parseStackFrames(spider).map((f) => f.line), [22, 9]);
  assert.equal(parseStackFrames(undefined).length, 0);
  assert.equal(pickSourceFrame([]), null);
});

// --- containment ------------------------------------------------------------

test('containment: every shape of source reference resolves inside the project, or not at all', () => {
  const ctx = { projectRoot: ROOT };
  const cases = [
    [`${ROOT}/src/App.tsx`, 'src/App.tsx'],
    [`${ROOT}/src/App.tsx?t=1758`, 'src/App.tsx'],
    ['http://127.0.0.1:5173/src/App.tsx?t=1758', 'src/App.tsx'],
    [`http://127.0.0.1:5173/@fs${ROOT}/src/App.tsx`, 'src/App.tsx'],
    ['webpack-internal:///(app-pages-browser)/./app/page.tsx', 'app/page.tsx'],
    ['webpack://_N_E/./app/page.tsx', 'app/page.tsx'],
    ['turbopack://[project]/app/page.tsx', 'app/page.tsx'],
    ['./src/App.tsx', 'src/App.tsx'],
    [`file://${ROOT}/src/App.tsx`, 'src/App.tsx'],
    ['src\\App.tsx', 'src/App.tsx'],
    ['http://127.0.0.1:5173/src/deep/../App.tsx', 'src/App.tsx'],
  ];
  for (const [input, expected] of cases) assert.equal(toProjectPath(input, ctx), expected, input);

  const refused = [
    '/etc/passwd',                       // a filesystem path outside the root is never re-read as project-relative
    '/src/App.tsx',                      // ditto: a bare absolute path is a file path, not a URL path
    '../../../etc/passwd',               // traversal
    '/home/dev/workspace/other/App.tsx', // a sibling project
    `${ROOT}/../other/App.tsx`,
    'http://127.0.0.1:5173/../../etc/passwd',
    'node_modules/react/index.js',
    `${ROOT}/node_modules/react/index.js`,
    'C:/Windows/system32/x.tsx',
    '',
    null,
  ];
  for (const input of refused) assert.equal(toProjectPath(input, ctx), null, String(input));
  assert.throws(() => toProjectPath('a.tsx', {}), /projectRoot/);
});

test('containment: a dev server serving a subdirectory resolves URL paths under it', () => {
  const ctx = { projectRoot: ROOT, servedFrom: 'apps/web' };
  assert.equal(toProjectPath('http://127.0.0.1:5173/src/App.tsx', ctx), 'apps/web/src/App.tsx');
  assert.equal(toProjectPath(`${ROOT}/apps/web/src/App.tsx`, ctx), 'apps/web/src/App.tsx', 'a filesystem path is already complete');
  assert.equal(toProjectPath('http://127.0.0.1:5173/../../../etc/passwd', ctx), null);
});

// --- source maps ------------------------------------------------------------

test('source map decoding: VLQ segments and nearest-mapping lookup', () => {
  // generated line 1: col 0 -> source 0, line 1 (0-based 0), col 0
  //                   col 4 -> source 0, line 5 (0-based 4), col 2
  const map = { version: 3, sources: ['src/App.tsx'], names: [], mappings: 'AAAA,IAIE' };
  assert.deepEqual(decodeMappings(map.mappings)[0].map((s) => [s.generatedColumn, s.sourceLine, s.sourceColumn]), [[0, 0, 0], [4, 4, 2]]);
  assert.deepEqual(applySourceMap(map, 1, 1), { source: 'src/App.tsx', line: 1, column: 1, name: null });
  assert.deepEqual(applySourceMap(map, 1, 9), { source: 'src/App.tsx', line: 5, column: 3, name: null });
  assert.equal(applySourceMap(map, 2, 1), null, 'no mapping on that generated line');
  assert.equal(applySourceMap({ sections: [] }, 1, 1), null, 'index maps are reported as unmapped, never guessed');
  assert.equal(applySourceMap(null, 1, 1), null);
  assert.deepEqual(applySourceMap({ ...map, sourceRoot: '/root/' }, 1, 1).source, '/root/src/App.tsx');
});

// --- the resolver -----------------------------------------------------------

const selectionWith = (over) => ({
  protocol: PREVIEW_FIBER_PROTOCOL,
  id: 1,
  tag: 'button',
  componentName: 'Card',
  annotation: null,
  debugSource: null,
  stack: null,
  ancestors: [],
  props: [],
  domPath: [{ tag: 'div', index: 0 }],
  react: { version: '19.3.0', hasDebugSource: false, hasDebugStack: true },
  ...over,
});

test('tier 1 (annotation): the v1 data-cx-src path still wins when the target opted in', () => {
  const r = resolveFiberSelection({ selection: selectionWith({ annotation: 'src/components/Card.tsx:22:7' }) }, { projectRoot: ROOT });
  assert.deepEqual([r.ok, r.tier, r.confidence, r.file, r.line, r.column], [true, 'annotation', 'exact', 'src/components/Card.tsx', 22, 7]);
});

test('tier 2 (_debugSource): React 16-18 dev builds resolve exactly', () => {
  const r = resolveFiberSelection(selectionWith({ debugSource: { fileName: `${ROOT}/src/components/Card.tsx`, lineNumber: 22, columnNumber: 7 } }), { projectRoot: ROOT });
  assert.deepEqual([r.ok, r.tier, r.confidence, r.file, r.line], [true, 'debug-source', 'exact', 'src/components/Card.tsx', 22]);
});

test('tier 3 (_debugStack + source map): React 19 resolves to the original position', () => {
  const stack = 'Error: react-stack-top-frame\n    at jsxDEV (http://127.0.0.1:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js:5:1)\n    at Card (http://127.0.0.1:5173/src/components/Card.tsx?t=1758:3:5)';
  const map = { version: 3, sources: ['src/components/Card.tsx'], names: [], mappings: ';;AAAA,IAIE' };
  const r = resolveFiberSelection(selectionWith({ stack }), { projectRoot: ROOT, sourceMaps: { 'http://127.0.0.1:5173/src/components/Card.tsx': map } });
  // generated 3:5 -> the segment at generated column 4 of that line -> source 5:3
  assert.deepEqual([r.ok, r.tier, r.confidence, r.file, r.line, r.column], [true, 'stack', 'mapped', 'src/components/Card.tsx', 5, 3]);
});

test('tier 3: a map`s relative `sources` are resolved against the map URL, not the project root', () => {
  // esbuild/Vite write "../src/App.tsx" in a map served from /dist/: relative to
  // the map, not an escape. The map may also be handed over as { map, url }.
  const stack = 'Error\n    at App (http://127.0.0.1:3852/dist/main.js:3:5)';
  const map = { version: 3, sources: ['../src/App.tsx'], names: [], mappings: ';;AAAA' };
  const context = { projectRoot: ROOT, sourceMaps: { 'http://127.0.0.1:3852/dist/main.js': { map, url: 'http://127.0.0.1:3852/dist/main.js.map' } } };
  const r = resolveFiberSelection(selectionWith({ stack }), context);
  assert.deepEqual([r.ok, r.confidence, r.file, r.line], [true, 'mapped', 'src/App.tsx', 1]);

  // A map that climbs past the served root stays contained: URL resolution
  // collapses it to a project-relative path, never one outside the project.
  const climbing = { version: 3, sources: ['../../../../etc/passwd'], names: [], mappings: ';;AAAA' };
  const contained = resolveFiberSelection(selectionWith({ stack }), { projectRoot: ROOT, sourceMaps: { 'http://127.0.0.1:3852/dist/main.js': climbing } });
  assert.ok(!contained.file || (!contained.file.startsWith('/') && !contained.file.includes('..')), contained.file);

  // An absolute foreign path in a map is refused outright.
  const foreign = { version: 3, sources: ['/etc/passwd'], names: [], mappings: ';;AAAA' };
  const bad = resolveFiberSelection(selectionWith({ stack }), { projectRoot: ROOT, sourceMaps: { 'http://127.0.0.1:3852/dist/main.js': foreign } });
  assert.deepEqual([bad.ok, bad.file, bad.reason], [false, null, 'outside-project']);
});

test('tier 3 without a source map: the file is reported, the transformed line is NOT', () => {
  const stack = 'Error\n    at jsxDEV (http://127.0.0.1:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js:5:1)\n    at Card (http://127.0.0.1:5173/src/components/Card.tsx?t=1758:99:5)';
  const r = resolveFiberSelection(selectionWith({ stack }), { projectRoot: ROOT });
  assert.deepEqual([r.ok, r.tier, r.confidence, r.file, r.line, r.reason], [true, 'stack', 'file-only', 'src/components/Card.tsx', null, 'unmapped-position']);
});

test('a frame outside the project (a bundle chunk) degrades to tier 4, it does not name a foreign file', () => {
  const stack = 'Error\n    at jsxDEV (webpack-internal:///./node_modules/react/x.js:1:1)\n    at Page (http://127.0.0.1:3000/_next/static/chunks/main-app.js:4200:19)';
  const r = resolveFiberSelection(selectionWith({ stack, componentName: 'Page', ancestors: [{ componentName: 'Layout', debugSource: null, stack: null }] }), { projectRoot: ROOT });
  assert.deepEqual([r.ok, r.tier, r.file, r.componentName, r.reason], [false, 'component', null, 'Page', 'unmapped']);
  assert.deepEqual(r.ancestors.map((a) => a.componentName), ['Layout']);
});

test('containment is enforced on the resolved result, not only on the raw input', () => {
  const outside = resolveFiberSelection(selectionWith({ debugSource: { fileName: '/etc/passwd', lineNumber: 1, columnNumber: 1 } }), { projectRoot: ROOT });
  assert.deepEqual([outside.ok, outside.file, outside.reason], [false, null, 'outside-project']);

  const mapped = { version: 3, sources: [`${ROOT}/../other-project/App.tsx`], names: [], mappings: 'AAAA' };
  const stack = 'Error\n    at Card (http://127.0.0.1:5173/src/components/Card.tsx:1:1)';
  const r = resolveFiberSelection(selectionWith({ stack }), { projectRoot: ROOT, sourceMaps: { 'http://127.0.0.1:5173/src/components/Card.tsx': mapped } });
  assert.deepEqual([r.ok, r.file, r.reason], [false, null, 'outside-project']);

  // A map that climbs above the served root is collapsed by URL resolution,
  // so the worst it can name is a (non-existent) file inside the project.
  const climbing = { version: 3, sources: ['../../../../etc/passwd'], names: [], mappings: 'AAAA' };
  const c = resolveFiberSelection(selectionWith({ stack }), { projectRoot: ROOT, sourceMaps: { 'http://127.0.0.1:5173/src/components/Card.tsx': climbing } });
  assert.ok(!c.file || (!c.file.startsWith('/') && !c.file.includes('..')), c.file);
});

test('the ladder falls through: a broken annotation does not stop _debugSource from resolving', () => {
  const r = resolveFiberSelection(selectionWith({
    annotation: '/etc/passwd:1:1',
    debugSource: { fileName: `${ROOT}/src/components/Card.tsx`, lineNumber: 4, columnNumber: 2 },
  }), { projectRoot: ROOT });
  assert.deepEqual([r.ok, r.tier, r.file, r.line], [true, 'debug-source', 'src/components/Card.tsx', 4]);
});

test('ancestors are resolved with the same ladder, nearest owner first', () => {
  const ancestors = [
    { componentName: 'Card', debugSource: { fileName: `${ROOT}/src/pages/LoginPage.tsx`, lineNumber: 14, columnNumber: 11 }, stack: null },
    { componentName: 'LoginPage', debugSource: null, stack: 'Error\n    at App (http://127.0.0.1:5173/src/main.tsx:9:20)' },
    { componentName: 'Providers', debugSource: null, stack: null },
  ];
  const r = resolveFiberSelection(selectionWith({ annotation: 'src/components/Card.tsx:22:7', ancestors }), { projectRoot: ROOT });
  assert.deepEqual(r.ancestors, [
    { componentName: 'Card', file: 'src/pages/LoginPage.tsx', line: 14, column: 11, tier: 'debug-source' },
    { componentName: 'LoginPage', file: 'src/main.tsx', line: null, column: null, tier: 'stack' },
    { componentName: 'Providers', file: null, line: null, column: null, tier: null },
  ]);
});

test('a production build is named as such instead of resolving to nothing in particular', () => {
  const r = resolveFiberSelection(selectionWith({ componentName: 'a', react: { version: '19.3.0', hasDebugSource: false, hasDebugStack: false }, ancestors: [{ componentName: 'r' }] }), { projectRoot: ROOT });
  assert.deepEqual([r.ok, r.reason, r.tier], [false, 'minified', 'component']);
});

test('a payload from another protocol version, or no payload at all, is refused', () => {
  assert.equal(resolveFiberSelection({ selection: selectionWith({ protocol: 'construct-preview/99' }) }, { projectRoot: ROOT }).reason, 'protocol-mismatch');
  assert.equal(resolveFiberSelection(null, { projectRoot: ROOT }).reason, 'invalid-payload');
  assert.equal(resolveFiberSelection('nope', { projectRoot: ROOT }).reason, 'invalid-payload');
  assert.throws(() => resolveFiberSelection(selectionWith({}), {}), /projectRoot/);
});

test('the resolver is pure: the same payload resolves identically, and the payload is not mutated', () => {
  const selection = selectionWith({ annotation: 'src/components/Card.tsx:22:7', ancestors: [{ componentName: 'X', debugSource: null, stack: null }] });
  const frozen = JSON.stringify(selection);
  const a = resolveFiberSelection(selection, { projectRoot: ROOT });
  const b = resolveFiberSelection(selection, { projectRoot: ROOT });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(selection), frozen);
});
