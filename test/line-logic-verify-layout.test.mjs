// Line logic verification step 5: layout fakes generated from lib.dom.d.ts (logicVerify/libDom.mjs, layoutFakeGen.mjs,
// layoutDom.mjs, layoutClock.mjs, layoutMedia.mjs, layoutRun.mjs). The planted layout-threshold acceptance is in
// test/line-logic-verify-planted.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { libDomInterface, valueKindOf } from '../packages/engine/line/logicVerify/libDom.mjs';
import { createLayoutFakeGenerator, checkAgainstLibDom, NotFakedError, MAKE_TYPES } from '../packages/engine/line/logicVerify/layoutFakeGen.mjs';
import { createFakeClock, FRAME_MS } from '../packages/engine/line/logicVerify/layoutClock.mjs';
import { parseMediaQuery, matchesMedia } from '../packages/engine/line/logicVerify/layoutMedia.mjs';
import { mergePools, layoutCases, layoutBase, LARGE, MAX_CASES, LAYOUT_EVENTS } from '../packages/engine/line/logicVerify/layoutFakes.mjs';
import { layoutReaders, runLayoutCases, verifyLayoutPair } from '../packages/engine/line/logicVerify/layoutRun.mjs';
import { diffLocation } from '../packages/engine/line/logicVerify/canonical.mjs';
import { FAKE_ENV } from '../packages/engine/line/logicVerify/fakes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gen = createLayoutFakeGenerator();
const ev = (event, target) => /** @type {any} */ (LAYOUT_EVENTS.find((e) => e.event === event && e.target === target));

// ---- lib.dom.d.ts ------------------------------------------------------------------------------------------------

test('libDom: members come from the real lib.dom.d.ts with their declared types', () => {
  const w = libDomInterface('Window');
  assert.equal(w.get('innerWidth')?.type, 'number');
  assert.equal(w.get('matchMedia')?.method, true);
  assert.equal(valueKindOf(/** @type {any} */ (libDomInterface('IntersectionObserverEntry').get('rootBounds'))), 'DOMRect|null');
  assert.equal(valueKindOf(/** @type {any} */ (libDomInterface('ResizeObserverEntry').get('borderBoxSize'))), 'ResizeObserverSize[]');
  assert.deepEqual(libDomInterface('Document').get('visibilityState')?.literals, ['hidden', 'visible']);
  assert.ok(libDomInterface('HTMLElement').has('clientWidth'), 'inherited Element members are included');
  assert.throws(() => libDomInterface('NoSuchInterface'), /declares no interface NoSuchInterface/);
});

test('generator: every LAYOUT_FAKE_TYPES member matches its lib.dom.d.ts type', () => {
  assert.deepEqual(checkAgainstLibDom(), { 'Document.visibilityState': ['hidden', 'visible'] });
  assert.deepEqual(gen.closed, checkAgainstLibDom());
  for (const t of MAKE_TYPES) assert.doesNotThrow(() => gen.make(t, { reads: {} }), t);
});

// ---- each fake type ----------------------------------------------------------------------------------------------

test('fake DOMRect: edges follow x, y, width and height; toJSON as in lib.dom', () => {
  const r = gen.make('DOMRect', { reads: { 'DOMRect.x': 10, 'DOMRect.y': 20, 'DOMRect.width': 30, 'DOMRect.height': -5 } });
  assert.deepEqual([r.left, r.top, r.right, r.bottom], [10, 15, 40, 20]);
  assert.deepEqual(r.toJSON(), { x: 10, y: 20, width: 30, height: -5, top: 15, right: 40, bottom: 20, left: 10 });
  assert.equal(Object.prototype.toString.call(r), '[object DOMRect]');
});

test('fake HTMLElement: offset, scroll and client sizes; getBoundingClientRect; scrollTop is writable', () => {
  const el = gen.make('HTMLElement', { reads: { 'HTMLElement.offsetWidth': 320, 'Element.scrollTop': 40, 'Element.clientHeight': 200 } });
  assert.deepEqual([el.offsetWidth, el.offsetHeight, el.scrollTop, el.clientHeight, el.scrollHeight], [320, 100, 40, 200, 100]);
  assert.equal(el.getBoundingClientRect().width, 320);
  el.scrollTop = 90;
  assert.equal(el.scrollTop, 90);
  const boxed = gen.make('Element', { reads: { 'DOMRect.width': 77 } });
  assert.equal(boxed.getBoundingClientRect().width, 77);
});

test('fake Window and Document: the case value, else the neutral base', () => {
  const w = gen.make('Window', { reads: { 'Window.innerWidth': 640 } });
  assert.deepEqual([w.innerWidth, w.innerHeight, w.devicePixelRatio, w.scrollY], [640, 768, 1, 0]);
  const d = gen.make('Document', { reads: { 'Document.visibilityState': 'hidden' } });
  assert.equal(d.visibilityState, 'hidden');
  assert.equal(gen.make('Document').visibilityState, 'visible');
});

test('fake IntersectionObserverEntry: ratio, isIntersecting, rects, rootBounds, time and target', () => {
  const target = gen.make('HTMLElement');
  const e = gen.make('IntersectionObserverEntry', { reads: { 'IntersectionObserverEntry.intersectionRatio': 0.25, 'DOMRect.height': 200 } }, { target, time: 32 });
  assert.equal(e.intersectionRatio, 0.25);
  assert.equal(e.isIntersecting, true);
  assert.equal(e.intersectionRect.height, 50);
  assert.deepEqual([e.rootBounds.width, e.rootBounds.height], [1024, 768]);
  assert.equal(e.time, 32);
  assert.equal(e.target, target);
  const off = gen.make('IntersectionObserverEntry', { reads: { 'IntersectionObserverEntry.intersectionRatio': 0, 'IntersectionObserverEntry.rootBounds': null } });
  assert.equal(off.isIntersecting, false);
  assert.equal(off.rootBounds, null);
});

test('fake ResizeObserverEntry and ResizeObserverSize: content rect and box sizes, device pixels by devicePixelRatio', () => {
  const e = gen.make('ResizeObserverEntry', { reads: { 'ResizeObserverSize.inlineSize': 300, 'ResizeObserverSize.blockSize': 150, 'Window.devicePixelRatio': 2 } });
  assert.deepEqual([e.contentRect.width, e.contentRect.height], [300, 150]);
  assert.equal(e.borderBoxSize[0].inlineSize, 300);
  assert.equal(e.contentBoxSize[0].blockSize, 150);
  assert.deepEqual([e.devicePixelContentBoxSize[0].inlineSize, e.devicePixelContentBoxSize[0].blockSize], [600, 300]);
  assert.equal(gen.make('ResizeObserverSize').inlineSize, 100);
});

test('fake MediaQueryList: matches is the query evaluated against the fake width, unless the case sets it', () => {
  assert.equal(gen.make('MediaQueryList', { reads: { 'Window.innerWidth': 640 } }, { media: '(max-width: 767px)' }).matches, true);
  assert.equal(gen.make('MediaQueryList', { reads: { 'Window.innerWidth': 768 } }, { media: '(max-width: 767px)' }).matches, false);
  assert.equal(gen.make('MediaQueryList', { reads: { 'MediaQueryList.matches': true } }, { media: '(min-width: 99999px)' }).matches, true);
  assert.equal(gen.make('MediaQueryList', {}, { media: '(min-width: 1px)' }).media, '(min-width: 1px)');
});

test('fake events: UIEvent, Event, MouseEvent, PointerEvent and MediaQueryListEvent', () => {
  const p = gen.make('PointerEvent', { reads: { 'MouseEvent.clientX': 12, 'PointerEvent.pointerType': 'touch' } }, { type: 'pointerdown' });
  assert.deepEqual([p.type, p.clientX, p.clientY, p.pointerType, p.isPrimary, p.defaultPrevented], ['pointerdown', 12, 0, 'touch', true, false]);
  p.preventDefault();
  assert.equal(p.defaultPrevented, true);
  assert.equal(gen.make('MouseEvent', { reads: { 'MouseEvent.button': 2 } }).button, 2);
  assert.throws(() => gen.make('MouseEvent').pointerType, NotFakedError);
  assert.equal(gen.make('UIEvent', {}, { type: 'resize' }).detail, 0);
  const m = gen.make('MediaQueryListEvent', { reads: { 'MediaQueryList.matches': true } }, { media: '(min-width: 1px)' });
  assert.deepEqual([m.matches, m.media], [true, '(min-width: 1px)']);
  assert.throws(() => gen.make('Location'), /make one of/);
});

// ---- "not faked" -------------------------------------------------------------------------------------------------

test('not faked: reading or setting an unbacked member throws, naming it and whether lib.dom.d.ts declares it', () => {
  const w = gen.make('Window');
  assert.throws(() => w.alert, (e) => e instanceof NotFakedError && e.member === 'Window.alert' && /declares it on Window, but the layout fakes do not back it/.test(e.message));
  assert.throws(() => gen.make('DOMRect').area, { name: 'NotFakedError', message: 'DOMRect.area is not faked: lib.dom.d.ts declares no area on DOMRect.' });
  assert.throws(() => { gen.make('HTMLElement').innerHTML = 'x'; }, /HTMLElement\.innerHTML is not faked: lib\.dom\.d\.ts declares it on HTMLElement.*cannot be set/);
  assert.equal('alert' in w, false);
  assert.equal('innerWidth' in w, true);
  // runtime probes and Object.prototype read through, so await, JSON and shapeOf work on a fake
  assert.equal(w.then, undefined);
  assert.equal(typeof w.hasOwnProperty, 'function');
  assert.equal(JSON.stringify(gen.make('ResizeObserverSize')), '{"inlineSize":100,"blockSize":100}');
});

// ---- matchMedia --------------------------------------------------------------------------------------------------

test('matchMedia parsing: min/max, em, range syntax, and, comma lists, not, only, media types', () => {
  assert.deepEqual(parseMediaQuery('(min-width: 768px)'), [{ not: false, type: 'all', features: [{ name: 'width', op: '>=', value: 768 }] }]);
  assert.deepEqual(parseMediaQuery('only screen and (max-width: 40em) and (orientation: portrait)'), [{ not: false, type: 'screen', features: [{ name: 'width', op: '<=', value: 640 }, { name: 'orientation', op: '=', value: 'portrait' }] }]);
  assert.deepEqual(parseMediaQuery('(400px <= width < 800px)')[0].features, [{ name: 'width', op: '>=', value: 400 }, { name: 'width', op: '<', value: 800 }]);
  assert.deepEqual(parseMediaQuery('(width > 30rem)')[0].features, [{ name: 'width', op: '>', value: 480 }]);
  assert.deepEqual(parseMediaQuery('(1024px > height)')[0].features, [{ name: 'height', op: '<', value: 1024 }]);
  assert.equal(parseMediaQuery('print, (min-width: 1px)').length, 2);
  assert.equal(parseMediaQuery('not screen and (min-width: 1px)')[0].not, true);
});

test('matchMedia evaluation against the fake viewport, at the boundary', () => {
  const vp = (width, height = 768) => ({ width, height });
  assert.equal(matchesMedia('(max-width: 767px)', vp(767)), true);
  assert.equal(matchesMedia('(max-width: 767px)', vp(768)), false);
  assert.equal(matchesMedia('(min-width: 768px) and (max-width: 1023px)', vp(1024)), false);
  assert.equal(matchesMedia('(400px <= width < 800px)', vp(800)), false);
  assert.equal(matchesMedia('(400px <= width < 800px)', vp(400)), true);
  assert.equal(matchesMedia('print', vp(800)), false);
  assert.equal(matchesMedia('print, (min-width: 1px)', vp(800)), true);
  assert.equal(matchesMedia('not screen and (min-width: 1000px)', vp(800)), true);
  assert.equal(matchesMedia('(orientation: portrait)', vp(500, 900)), true);
  assert.equal(matchesMedia('(prefers-reduced-motion: reduce)', vp(800)), false);
  assert.equal(matchesMedia('(hover)', vp(800)), true);
  assert.equal(matchesMedia('', vp(800)), true);
});

test('matchMedia: an unmodelled feature is "not faked"; a bad length or type is a TypeError', () => {
  assert.throws(() => parseMediaQuery('(min-resolution: 2dppx)'), (e) => e instanceof NotFakedError && /\(min-resolution\) is not faked/.test(e.message));
  assert.throws(() => parseMediaQuery('(min-width: 10vw)'), /not px, em or rem/);
  assert.throws(() => parseMediaQuery('tv and (min-width: 1px)'), /unknown media type "tv"/);
});

// ---- the fake clock and the firing order -------------------------------------------------------------------------

test('fake clock: the characterizer time, nothing runs before advance, timers before a frame at the same time', () => {
  const clock = createFakeClock();
  assert.equal(clock.now(), Date.parse(FAKE_ENV.now));
  const log = [];
  clock.setTimeout(() => log.push('t16'), FRAME_MS);
  clock.setTimeout(() => log.push('t0'));
  clock.requestAnimationFrame((ts) => log.push(`raf@${ts}`));
  const iv = clock.setInterval(() => { log.push('iv'); if (log.filter((x) => x === 'iv').length === 2) clock.clearInterval(iv); }, 10);
  assert.deepEqual(log, []);
  clock.advance(5);
  assert.deepEqual(log, ['t0']);
  clock.runAll();
  assert.deepEqual(log, ['t0', 'iv', 't16', 'raf@16', 'iv']);
  assert.equal(clock.pending(), false);
  assert.throws(() => clock.setTimeout('code', 1), /functions only/);
  const loop = createFakeClock();
  const again = () => loop.requestAnimationFrame(again);
  again();
  assert.throws(() => loop.runAll(), /never ends/);
});

test('firing order under the fake clock: task, then resize -> media change -> rAF -> ResizeObserver -> IntersectionObserver', () => {
  const clock = createFakeClock();
  const dom = gen.dom(clock, { reads: { 'Window.innerWidth': 1024 } });
  const log = [];
  const el = dom.element({ reads: { 'Element.clientWidth': 300 } });
  dom.window.matchMedia('(max-width: 767px)').addEventListener('change', (e) => log.push(`media ${e.matches}`));
  dom.window.addEventListener('resize', () => log.push(`resize ${dom.window.innerWidth}`));
  el.addEventListener('pointerdown', (e) => log.push(`pointerdown ${e.clientX}`));
  new dom.IntersectionObserver((es) => log.push(`io-a ${es.map((e) => e.intersectionRatio)}`)).observe(el);
  const ro = new dom.ResizeObserver((es) => log.push(`ro ${es.map((e) => e.contentRect.width)}`));
  ro.observe(el);
  new dom.IntersectionObserver((es) => log.push(`io-b ${es.length}`)).observe(el);
  dom.window.requestAnimationFrame(() => log.push('raf'));
  gen.fire(dom, clock, ev('resize', 'window'), { reads: { 'Window.innerWidth': 640 } });
  gen.fire(dom, clock, ev('pointerdown', 'element'), { reads: { 'MouseEvent.clientX': 5 } });
  assert.deepEqual(log, [], 'nothing fires until the clock moves');
  clock.advance(FRAME_MS);
  assert.deepEqual(log, ['pointerdown 5', 'resize 640', 'media true', 'raf', 'ro 300', 'io-a 1', 'io-b 1']);
  // later entries: queued with the case's values, delivered at the next frame, in creation order
  log.length = 0;
  dom.intersect(el, { reads: { 'IntersectionObserverEntry.intersectionRatio': 0.5 } });
  dom.resize(el, { reads: { 'ResizeObserverSize.inlineSize': 480 } });
  clock.advance(FRAME_MS);
  assert.deepEqual(log, ['ro 480', 'io-a 0.5', 'io-b 1']);
  // unobserve and disconnect stop delivery; takeRecords drains the queue
  log.length = 0;
  ro.unobserve(el);
  dom.resize(el);
  clock.runAll();
  assert.deepEqual(log, []);
  assert.throws(() => gen.fire(dom, createFakeClock(), ev('resize', 'window'), { reads: {} }), /same pair/);
});

test('firing: window and element scroll, visibilitychange, once listeners, media change only on a flip', () => {
  const clock = createFakeClock();
  const dom = gen.dom(clock);
  const el = dom.element();
  const log = [];
  dom.window.addEventListener('scroll', () => log.push(`window scroll ${dom.window.scrollY}`), { once: true });
  el.addEventListener('scroll', () => log.push(`el scroll ${el.scrollTop}`));
  dom.document.addEventListener('visibilitychange', () => log.push(`visibility ${dom.document.visibilityState} ${dom.document.hidden}`));
  const mql = dom.window.matchMedia('(min-width: 1000px)');
  mql.addListener((e) => log.push(`media ${e.matches}`));
  gen.fire(dom, clock, ev('scroll', 'window'), { reads: { 'Window.scrollY': 300 } });
  gen.fire(dom, clock, ev('scroll', 'element'), { reads: { 'Element.scrollTop': 12 } });
  gen.fire(dom, clock, ev('visibilitychange', 'document'), { reads: { 'Document.visibilityState': 'hidden' } });
  gen.fire(dom, clock, ev('change', 'mediaQueryList'), { reads: { 'Window.innerWidth': 1200 } });
  clock.runAll();
  assert.deepEqual(log, ['visibility hidden true', 'window scroll 300', 'el scroll 12']);
  assert.equal(mql.matches, true);
  gen.fire(dom, clock, ev('change', 'mediaQueryList'), { reads: { 'Window.innerWidth': 900 } });
  gen.fire(dom, clock, ev('scroll', 'window'), { reads: { 'Window.scrollY': 0 } });
  clock.runAll();
  assert.deepEqual(log.slice(3), ['media false'], 'the once listener is gone; the media list flipped back');
  assert.equal(dom.document.documentElement.clientWidth, 900);
});

// ---- the value plan ----------------------------------------------------------------------------------------------

test('value plan: the mined literals of both sides, media-query breakpoints joining the viewport pools', () => {
  const before = { strings: ['(min-width: 48em)'], numbers: [768], byKey: { innerWidth: [768] } };
  const after = { strings: ['x'], numbers: [640], byKey: { innerWidth: [640] } };
  const pools = mergePools(before, after, null);
  assert.deepEqual(pools.byKey.innerWidth, [768, 640]);
  assert.deepEqual(pools.numbers, [640, 768]);
  assert.deepEqual(pools.byKey.outerWidth, [768]);
  assert.deepEqual(gen.values('Window', 'innerWidth', pools), [-1, 0, 639, 640, 641, 767, 768, 769, LARGE]);
  assert.deepEqual(gen.values('Document', 'visibilityState', pools), ['visible', 'hidden']);
  const cases = layoutCases(['Window.innerWidth', 'Document.hidden'], pools);
  assert.deepEqual(cases.map((c) => c.reads), [{ 'Document.hidden': false }, { 'Document.hidden': true }, ...[-1, 0, 639, 640, 641, 767, 768, 769, LARGE].map((v) => ({ 'Window.innerWidth': v }))]);
  assert.deepEqual(layoutCases(['Window.innerWidth'], pools), layoutCases(['Window.innerWidth'], pools), 'deterministic');
  assert.equal(layoutCases(['Window.innerWidth'], pools, { max: 3 }).length, 3);
  const lits = [10, 20, 30, 40, 50, 60, 70, 80];
  const wide = { strings: [], numbers: [], byKey: { innerWidth: lits, innerHeight: lits, scrollY: lits } };
  assert.equal(layoutCases(['Window.innerWidth', 'Window.innerHeight', 'Window.scrollY'], wide).length, MAX_CASES);
  assert.deepEqual([layoutBase('Window.innerWidth'), layoutBase('Window.scrollY'), layoutBase('Document.hidden'), layoutBase('PointerEvent.pointerType')], [1024, 0, false, 'mouse']);
});

// ---- the runner helper -------------------------------------------------------------------------------------------

test('layoutReaders: pure layout closures only, with their reads and parameter type', () => {
  const src = [
    'export function useLayout(onChange: (x: boolean) => void) {',
    '  const a = () => window.innerWidth < 768;',
    '  const b = (entry: IntersectionObserverEntry) => entry.isIntersecting && entry.boundingClientRect.top > 0;',
    '  const c = () => onChange(innerHeight > 500);',
    "  const d = () => matchMedia('(min-width: 1024px)').matches;",
    '  const e = (el: HTMLElement) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1;',
    "  const f = () => document.visibilityState === 'hidden';",
    '  return [a, b, c, d, e, f];',
    '}',
  ].join('\n');
  const { readers, impure } = layoutReaders(src, 'x.ts', 'useLayout');
  assert.equal(impure, 1);
  assert.deepEqual(readers.map((r) => [r.code.split(' =>')[0], r.reads, r.paramType]), [
    ['()', ['Window.innerWidth'], null],
    ['(entry: IntersectionObserverEntry)', ['DOMRect.top', 'IntersectionObserverEntry.isIntersecting'], 'IntersectionObserverEntry'],
    ['()', ['Window.innerWidth'], null],
    ['(el: HTMLElement)', ['Element.clientHeight', 'Element.scrollHeight', 'Element.scrollTop'], 'HTMLElement'],
    ['()', ['Document.visibilityState'], null],
  ]);
  assert.equal(readers[0].path.join('/'), 'useLayout/FunctionDeclaration.body/BlockStatement.body[0]/VariableDeclaration.declarations[0]/VariableDeclarator.init');
  assert.throws(() => layoutReaders(src, 'x.ts', 'nope'), /has no function nope/);
});

test('runLayoutCases: outputs as shapes plus primitive values; element and entry parameters; not-faked is recorded', () => {
  const cases = [{ reads: { 'Window.innerWidth': 767 } }, { reads: { 'Window.innerWidth': 768 } }];
  assert.deepEqual(runLayoutCases("() => matchMedia('(max-width: 767px)').matches", cases), [
    { reads: cases[0].reads, output: 'boolean', thrown: null, value: true },
    { reads: cases[1].reads, output: 'boolean', thrown: null, value: false },
  ]);
  const atEnd = runLayoutCases('(el: HTMLElement) => el.scrollTop + el.clientHeight >= el.scrollHeight + 1', [{ reads: { 'Element.scrollTop': 0 } }, { reads: { 'Element.scrollTop': 1 } }], { paramType: 'HTMLElement' });
  assert.deepEqual(atEnd.map((r) => r.value), [false, true]);
  const io = runLayoutCases('(e) => e.intersectionRatio >= 0.5', [{ reads: { 'IntersectionObserverEntry.intersectionRatio': 0.4 } }, { reads: { 'IntersectionObserverEntry.intersectionRatio': 0.5 } }], { paramType: 'IntersectionObserverEntry' });
  assert.deepEqual(io.map((r) => r.value), [false, true]);
  assert.deepEqual(runLayoutCases('() => ({ w: window.innerWidth })', [{ reads: {} }])[0], { reads: {}, output: '{w:number}', thrown: null });
  assert.deepEqual(runLayoutCases('() => window.screen.width', [{ reads: {} }])[0], { reads: {}, output: 'undefined', thrown: 'NotFakedError', notFaked: 'Window.screen' });
});

test('diffLocation on reader closures: a changed literal is named by its parent; a changed operator by the operator field', () => {
  const side = (src) => ({ node: layoutReaders(`function f() { const g = ${src}; }`, 'x.ts', 'f').readers[0].node, file: 'x.ts', prefix: ['f'] });
  assert.deepEqual(diffLocation(side('() => window.innerWidth < 768'), side('() => window.innerWidth < 640')), { astPath: 'f/ArrowFunctionExpression.body/BinaryExpression.right', file: 'x.ts', line: 1, column: 52 });
  assert.equal(diffLocation(side('() => window.innerWidth < 768'), side('() => window.innerWidth <= 768'))?.astPath.split('/').at(-1), 'BinaryExpression.operator');
  assert.equal(diffLocation(side('() => window.innerWidth < 768'), side('() => window.innerWidth < 768')), null);
});

test('verifyLayoutPair: the same code on both sides is not "changed"; the hook closures are named as pending', () => {
  const dir = path.join(ROOT, 'test/fixtures/logic-verify/layout-threshold/before');
  const unit = { fingerprint: 'a1f0000000000006', id: 'x', kind: /** @type {const} */ ('state'), file: 'src/layout/useIsCompact.ts', fn: 'useIsCompact', line: 4 };
  const r = verifyLayoutPair({ beforeRoot: dir, afterRoot: dir, unit });
  assert.equal(r.outcome, 'cant-tell');
  assert.match(String(r.reason), /2 layout-reading closure\(s\) close over component state and need the hook runner/);
});
