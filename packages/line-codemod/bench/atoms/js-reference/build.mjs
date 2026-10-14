// Generates the JS reference input: one small exported function per entry of reference.json (built-ins and
// Web APIs), one file per reference section, in input/. Syntax entries are hand-written in input/syntax.mjs.
// Also writes map.json (entry key -> file and function), which the coverage test reads.
//
//   node bench/atoms/js-reference/build.mjs
//
// Deterministic: the same reference.json always gives the same files.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { entries } = JSON.parse(readFileSync(join(here, 'reference.json'), 'utf8'));
const outDir = join(here, 'input');
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (f.startsWith('ref-')) rmSync(join(outDir, f));

const TYPED = ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float16Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array'];
const BIG = new Set(['BigInt64Array', 'BigUint64Array']);

// ---- Receivers: one ready instance per section, for prototype, property and protocol entries ----
// setup: statements before the call; expr: the instance; async: the setup awaits; close: cleanup.
const iter = (expr) => ({ expr });
const R = {
  String: { expr: `'Hello, World'` },
  Array: { expr: `[3, 1, 2]` },
  ReadonlyArray: { expr: `Object.freeze([3, 1, 2])` },
  ConcatArray: { expr: `[3, 1, 2]` },
  ArrayLike: { expr: `{ length: 2, 0: 'a', 1: 'b' }` },
  ArrayBuffer: { expr: `new ArrayBuffer(8, { maxByteLength: 16 })` },
  SharedArrayBuffer: { expr: `new SharedArrayBuffer(8, { maxByteLength: 16 })` },
  DataView: { expr: `new DataView(new ArrayBuffer(16))` },
  Date: { expr: `new Date(Date.UTC(2026, 9, 14, 12, 30, 15, 250))` },
  Map: { expr: `new Map([['a', 1], ['b', 2]])` },
  ReadonlyMap: { expr: `new Map([['a', 1], ['b', 2]])` },
  Set: { expr: `new Set([1, 2, 3])` },
  ReadonlySet: { expr: `new Set([1, 2, 3])` },
  ReadonlySetLike: { expr: `new Set([1, 2, 3])` },
  WeakMap: { setup: `const key = {};`, expr: `new WeakMap([[key, 1]])` },
  WeakSet: { setup: `const key = {};`, expr: `new WeakSet([key])` },
  WeakRef: { setup: `const key = {};`, expr: `new WeakRef(key)` },
  FinalizationRegistry: { expr: `new FinalizationRegistry(() => {})` },
  RegExp: { expr: `/(?<word>\\w+)/dg` },
  Promise: { expr: `Promise.resolve(1)` },
  PromiseLike: { expr: `Promise.resolve(1)` },
  Number: { expr: `12.345` },
  BigInt: { expr: `123n` },
  Boolean: { expr: `true` },
  Symbol: { expr: `Symbol('tag')` },
  Object: { expr: `{ a: 1 }` },
  Function: { setup: `function add(a, b) { return a + b; }`, expr: `add` },
  CallableFunction: { setup: `function add(a, b) { return a + b; }`, expr: `add` },
  NewableFunction: { setup: `function Point(x, y) { this.x = x; this.y = y; }`, expr: `Point` },
  Error: { expr: `new Error('boom', { cause: 'root' })` },
  AggregateError: { expr: `new AggregateError([new Error('a')], 'many')` },
  Iterator: { expr: `[1, 2, 3].values()` },
  ArrayIterator: { expr: `[1, 2, 3].values()` },
  MapIterator: { expr: `new Map([['a', 1]]).entries()` },
  SetIterator: { expr: `new Set([1, 2]).values()` },
  StringIterator: { expr: `'abc'[Symbol.iterator]()` },
  RegExpStringIterator: { expr: `'a1b2'.matchAll(/\\d/g)` },
  IterableIterator: { expr: `[1, 2, 3].values()` },
  Iterable: { expr: `[1, 2, 3]` },
  IteratorReturnResult: { expr: `[].values().next()` },
  IteratorYieldResult: { expr: `[1].values().next()` },
  Generator: { setup: `function* count() { yield 1; yield 2; }`, expr: `count()` },
  AsyncGenerator: { setup: `async function* count() { yield 1; yield 2; }`, expr: `count()` },
  AsyncIterator: { setup: `async function* count() { yield 1; yield 2; }`, expr: `count()` },
  AsyncIterableIterator: { setup: `async function* count() { yield 1; yield 2; }`, expr: `count()` },
  AsyncIterable: { setup: `async function* count() { yield 1; yield 2; }`, expr: `count()` },
  AsyncIteratorObject: { setup: `async function* count() { yield 1; yield 2; }`, expr: `count()` },
  GeneratorFunction: { expr: `function* numbers() { yield 1; }` },
  AsyncGeneratorFunction: { expr: `async function* numbers() { yield 1; }` },
  GeneratorFunctionConstructor: { expr: `Object.getPrototypeOf(function* () {}).constructor` },
  AsyncGeneratorFunctionConstructor: { expr: `Object.getPrototypeOf(async function* () {}).constructor` },
  IArguments: { setup: `function collect() { return arguments; }`, expr: `collect(1, 2, 3)` },
  RegExpMatchArray: { expr: `'hello world'.match(/(?<word>\\w+)/d)` },
  RegExpExecArray: { expr: `/(?<word>\\w+)/d.exec('hello world')` },
  TemplateStringsArray: { setup: `const tag = (strings) => strings;`, expr: 'tag`a${1}b`' },
  // Web
  AbortController: { expr: `new AbortController()` },
  AbortSignal: { expr: `AbortSignal.abort('stop')` },
  Blob: { expr: `new Blob(['hello'], { type: 'text/plain' })` },
  BroadcastChannel: { expr: `new BroadcastChannel('reference')`, close: 'close' },
  ByteLengthQueuingStrategy: { expr: `new ByteLengthQueuingStrategy({ highWaterMark: 16 })` },
  CloseEvent: { expr: `new CloseEvent('close', { code: 1000, reason: 'done', wasClean: true })` },
  CompressionStream: { expr: `new CompressionStream('gzip')` },
  CountQueuingStrategy: { expr: `new CountQueuingStrategy({ highWaterMark: 1 })` },
  Crypto: { expr: `crypto` },
  CryptoKey: { async: true, setup: `const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, true, ['sign', 'verify']);`, expr: `key` },
  CustomEvent: { expr: `new CustomEvent('ping', { detail: 1 })` },
  DOMException: { expr: `new DOMException('stopped', 'AbortError')` },
  DecompressionStream: { expr: `new DecompressionStream('gzip')` },
  Event: { expr: `new Event('ping', { bubbles: true, cancelable: true })` },
  EventTarget: { expr: `new EventTarget()` },
  File: { expr: `new File(['hello'], 'note.txt', { type: 'text/plain', lastModified: 0 })` },
  FormData: { setup: `const form = new FormData();\n  form.append('a', '1');`, expr: `form` },
  Headers: { expr: `new Headers({ 'content-type': 'text/plain' })` },
  MessageChannel: { setup: `const channel = new MessageChannel();`, expr: `channel`, closeWith: `channel.port1.close();\n    channel.port2.close();` },
  MessageEvent: { expr: `new MessageEvent('message', { data: 1 })` },
  MessagePort: { setup: `const channel = new MessageChannel();`, expr: `channel.port1`, closeWith: `channel.port1.close();\n    channel.port2.close();` },
  Navigator: { expr: `navigator` },
  Performance: { expr: `performance` },
  PerformanceEntry: { expr: `performance.mark('reference')` },
  PerformanceMark: { expr: `performance.mark('reference')` },
  PerformanceMeasure: { expr: `performance.measure('reference')` },
  PerformanceObserver: { expr: `new PerformanceObserver(() => {})`, close: 'disconnect' },
  PerformanceObserverEntryList: { async: true, setup: `const list = await new Promise((resolve) => {\n    const observer = new PerformanceObserver((entries) => { observer.disconnect(); resolve(entries); });\n    observer.observe({ type: 'mark' });\n    performance.mark('observed');\n  });`, expr: `list` },
  // Node records no resource timings (checked on Node 24: fetch adds none), so these members stay unreachable.
  PerformanceResourceTiming: { expr: `performance.getEntriesByType('resource')[0]` },
  ReadableByteStreamController: { setup: `let controller;\n  new ReadableStream({ type: 'bytes', start(c) { controller = c; } });`, expr: `controller` },
  ReadableStream: { expr: `new ReadableStream({ start(c) { c.enqueue('a'); c.close(); } })` },
  ReadableStreamBYOBReader: { expr: `new ReadableStream({ type: 'bytes', start(c) { c.enqueue(new Uint8Array([1, 2])); c.close(); } }).getReader({ mode: 'byob' })` },
  ReadableStreamBYOBRequest: { async: true, setup: `let request;\n  const stream = new ReadableStream({ type: 'bytes', pull(c) { request = c.byobRequest; request.view[0] = 7; request.respond(1); } });\n  await stream.getReader({ mode: 'byob' }).read(new Uint8Array(4));`, expr: `request` },
  ReadableStreamDefaultController: { setup: `let controller;\n  new ReadableStream({ start(c) { controller = c; } });`, expr: `controller` },
  ReadableStreamDefaultReader: { expr: `new ReadableStream({ start(c) { c.enqueue('a'); c.close(); } }).getReader()` },
  Request: { expr: `new Request('https://example.com/a?b=1', { method: 'POST', body: 'hi', headers: { 'x-a': '1' } })` },
  Response: { expr: `new Response('hello', { status: 201, statusText: 'Created', headers: { 'x-a': '1' } })` },
  SubtleCrypto: { expr: `crypto.subtle` },
  TextDecoder: { expr: `new TextDecoder('utf-8', { fatal: false })` },
  TextDecoderStream: { expr: `new TextDecoderStream()` },
  TextEncoder: { expr: `new TextEncoder()` },
  TextEncoderStream: { expr: `new TextEncoderStream()` },
  TransformStream: { expr: `new TransformStream()` },
  TransformStreamDefaultController: { setup: `let controller;\n  new TransformStream({ start(c) { controller = c; } });`, expr: `controller` },
  URL: { expr: `new URL('https://user:pw@example.com:8080/path/page?q=1&r=2#top')` },
  URLSearchParams: { expr: `new URLSearchParams('a=1&b=2&a=3')` },
  WebSocket: { expr: `new WebSocket('ws://127.0.0.1:9')`, close: 'close' },
  WritableStream: { expr: `new WritableStream()` },
  WritableStreamDefaultController: { setup: `let controller;\n  new WritableStream({ start(c) { controller = c; } });`, expr: `controller` },
  WritableStreamDefaultWriter: { expr: `new WritableStream().getWriter()` },
};
for (const name of TYPED) R[name] = { expr: BIG.has(name) ? `new ${name}([3n, 1n, 2n])` : `new ${name}([3, 1, 2])` };
for (const e of ['EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError']) R[e] = { expr: `new ${e}('boom')` };
const INTL = {
  Collator: `new Intl.Collator('en')`, DateTimeFormat: `new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' })`,
  DisplayNames: `new Intl.DisplayNames('en', { type: 'region' })`, ListFormat: `new Intl.ListFormat('en', { type: 'conjunction' })`,
  Locale: `new Intl.Locale('en-Latn-US', { calendar: 'gregory', hourCycle: 'h23' })`, NumberFormat: `new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' })`,
  PluralRules: `new Intl.PluralRules('en-US')`, RelativeTimeFormat: `new Intl.RelativeTimeFormat('en', { numeric: 'auto' })`,
  Segmenter: `new Intl.Segmenter('en', { granularity: 'word' })`,
};

// Entries whose call needs a real setup no type rule can give (keys, byte streams, a closed writer).
const hmac = `const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, true, ['sign', 'verify']);`;
const aes = `const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, true, ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']);`;
const iv = `const iv = new Uint8Array(12);`;
const data = `const data = new TextEncoder().encode('hello');`;
const pbkdf2 = `const base = await crypto.subtle.importKey('raw', new TextEncoder().encode('secret'), 'PBKDF2', false, ['deriveBits', 'deriveKey']);\n  const params = { name: 'PBKDF2', salt: new Uint8Array(8), iterations: 1000, hash: 'SHA-256' };`;
const byob = `let request;\n  const stream = new ReadableStream({ type: 'bytes', pull(c) { request = c.byobRequest; } });\n  const reader = stream.getReader({ mode: 'byob' });\n  const read = reader.read(new Uint8Array(4));\n  await new Promise((resolve) => setTimeout(resolve, 0));`;
const OVERRIDES = {
  // These open a channel or a timer: each closes what it opens so the run can end.
  'new BroadcastChannel': { lines: [`const channel = new BroadcastChannel('reference');`, 'channel.close();', 'return channel.name;'] },
  'new MessageChannel': { lines: ['const channel = new MessageChannel();', 'channel.port1.close();', 'channel.port2.close();', 'return [typeof channel.port1, typeof channel.port2];'] },
  'setInterval()': { lines: ['const timer = setInterval(() => {}, 1000);', 'clearInterval(timer);', 'return typeof timer;'] },
  'setTimeout()': { lines: ['const timer = setTimeout(() => {}, 1000);', 'clearTimeout(timer);', 'return typeof timer;'] },
  'SharedArrayBuffer.prototype.grow': { lines: ['const target = new SharedArrayBuffer(8, { maxByteLength: 16 });', 'target.grow(12);', 'return target.byteLength;'] },
  'ReadableStreamBYOBRequest.prototype.view': { async: true, lines: [byob, 'return request.view;'] },
  'Performance.prototype.measure': { nondeterministic: true, lines: [`performance.mark('measure-start');`, `return performance.measure('reference', 'measure-start');`] },
  'ReadableStreamBYOBRequest.prototype.respond': { async: true, lines: [byob, 'request.view[0] = 7;', 'request.respond(1);', 'return (await read).value;'] },
  'ReadableStreamBYOBRequest.prototype.respondWithNewView': { async: true, lines: [byob, 'const view = new Uint8Array(request.view.buffer, 0, 2);', 'view.set([7, 8]);', 'request.respondWithNewView(view);', 'return (await read).value;'] },
  'WritableStreamDefaultWriter.prototype.closed': { async: true, lines: ['const writer = new WritableStream().getWriter();', 'await writer.close();', 'return writer.closed;'] },
  'SubtleCrypto.prototype.digest': { async: true, lines: [data, `return crypto.subtle.digest('SHA-256', data);`] },
  'SubtleCrypto.prototype.encrypt': { async: true, nondeterministic: true, lines: [aes, iv, data, `return crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);`] },
  'SubtleCrypto.prototype.decrypt': { async: true, lines: [aes, iv, data, `const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);`, `return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, sealed));`] },
  'SubtleCrypto.prototype.sign': { async: true, nondeterministic: true, lines: [hmac, data, `return crypto.subtle.sign('HMAC', key, data);`] },
  'SubtleCrypto.prototype.verify': { async: true, lines: [hmac, data, `const signature = await crypto.subtle.sign('HMAC', key, data);`, `return crypto.subtle.verify('HMAC', key, signature, data);`] },
  'SubtleCrypto.prototype.deriveBits': { async: true, lines: [pbkdf2, 'return crypto.subtle.deriveBits(params, base, 128);'] },
  'SubtleCrypto.prototype.deriveKey': { async: true, lines: [pbkdf2, `const key = await crypto.subtle.deriveKey(params, base, { name: 'AES-GCM', length: 128 }, true, ['encrypt']);`, 'return key.algorithm;'] },
  'SubtleCrypto.prototype.exportKey': { async: true, nondeterministic: true, lines: [hmac, `return crypto.subtle.exportKey('jwk', key);`] },
  'SubtleCrypto.prototype.exportKey #2': { async: true, nondeterministic: true, lines: [hmac, `return crypto.subtle.exportKey('raw', key);`] },
  'SubtleCrypto.prototype.exportKey #3': { async: true, nondeterministic: true, lines: [hmac, `const format = 'raw';`, 'return crypto.subtle.exportKey(format, key);'] },
  'SubtleCrypto.prototype.generateKey': { async: true, lines: [`const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);`, 'return pair.publicKey.algorithm;'] },
  'SubtleCrypto.prototype.generateKey #2': { async: true, lines: [`const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);`, 'return pair.privateKey.algorithm;'] },
  'SubtleCrypto.prototype.generateKey #3': { async: true, lines: [`const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);`, 'return key.algorithm;'] },
  'SubtleCrypto.prototype.generateKey #4': { async: true, lines: [hmac, 'return key.algorithm;'] },
  'SubtleCrypto.prototype.importKey': { async: true, lines: [`const key = await crypto.subtle.importKey('jwk', { kty: 'oct', k: 'c2VjcmV0', alg: 'HS256' }, { name: 'HMAC', hash: 'SHA-256' }, true, ['sign']);`, 'return key.algorithm;'] },
  'SubtleCrypto.prototype.importKey #2': { async: true, lines: [`const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('secret'), { name: 'HMAC', hash: 'SHA-256' }, true, ['sign']);`, 'return key.algorithm;'] },
  'SubtleCrypto.prototype.wrapKey': { async: true, nondeterministic: true, lines: [aes, hmac.replace('const key', 'const inner'), iv, `return crypto.subtle.wrapKey('raw', inner, key, { name: 'AES-GCM', iv });`] },
  'SubtleCrypto.prototype.unwrapKey': { async: true, lines: [aes, hmac.replace('const key', 'const inner'), iv, `const wrapped = await crypto.subtle.wrapKey('raw', inner, key, { name: 'AES-GCM', iv });`, `const back = await crypto.subtle.unwrapKey('raw', wrapped, key, { name: 'AES-GCM', iv }, { name: 'HMAC', hash: 'SHA-256' }, true, ['sign']);`, 'return back.algorithm;'] },
};

// Element kind of a receiver, for callbacks and values: 'number', 'bigint', 'string' or 'any'.
function elementOf(section) {
  if (BIG.has(section)) return 'bigint';
  if (TYPED.includes(section) || /^(Array|ReadonlyArray|ConcatArray|Set|ReadonlySet|Iterator|ArrayIterator|SetIterator|IterableIterator|Iterable)$/.test(section)) return 'number';
  if (section === 'String' || section === 'StringIterator' || section === 'ArrayLike') return 'string';
  return 'any';
}

// ---- Values for parameters ----
const NUMBER_BY_NAME = {
  maxLength: 16, targetLength: 16, index: 1, start: 1, begin: 1, fromIndex: 1, byteOffset: 0, offset: 0, pos: 1, position: 1, end: 2, length: 4, byteLength: 4,
  maxByteLength: 16, newLength: 12, radix: 16, fractionDigits: 2, digits: 2, precision: 3, year: 2026, month: 9, date: 14,
  hours: 12, min: 30, minutes: 30, sec: 15, seconds: 15, ms: 250, time: 1792000000000, count: 2, depth: 1, bits: 8,
  target: 0, value: 2, x: 0.5, y: 0.25, code: 65, codes: 65, codePoint: 9731, timeout: 0, limit: 2, highWaterMark: 1, delay: 0,
  typedArray: 0, expectedValue: 0, replacementValue: 5, desiredSize: 1, bytesWritten: 1, status: 200,
};
const STRING_BY_NAME = {
  separator: `', '`, searchString: `'World'`, searchValue: `'World'`, pattern: `'World'`, replaceValue: `'There'`, replacement: `'There'`,
  fillString: `'*'`, padString: `'*'`, locales: `'en-US'`, locale: `'en-US'`, form: `'NFC'`, key: `'a'`, name: `'a'`, url: `'https://example.com/a'`,
  description: `'tag'`, message: `'boom'`, type: `'ping'`, label: `'reference'`, markName: `'reference'`, measureName: `'reference'`, encoding: `'utf-8'`,
  format: `'raw'`, flags: `'g'`, s: `'Hello, World'`, str: `'Hello, World'`, string: `'Hello, World'`, text: `'Hello, World'`, input: `'Hello, World'`,
  data: `'hello'`, uri: `'https://example.com/a b'`, encodedURI: `'https://example.com/a%20b'`, uriComponent: `'a b&c'`, encodedURIComponent: `'a%20b%26c'`,
  x: `'2026-10-14T12:00:00Z'`, value: `'1'`, reason: `'done'`, eventName: `'ping'`, property: `'a'`, propertyKey: `'a'`, mode: `'byob'`, region: `'US'`,
};
// Values that depend on which entry is being called, checked before the general rules below.
function specific(t, n, ctx) {
  const m = ctx.member;
  const s = ctx.section;
  if (m === 'eval()') return `'1 + 2'`;
  if (m === 'atob()') return `'aGVsbG8='`;
  if (m === 'BigInt()') return '1234';
  if (s === 'JSON' && n === 'text') return `'{"a":1,"b":[1,2]}'`;
  if (s === 'Intl' && n === 'key') return `'currency'`;
  if (s === 'Intl' && n === 'code') return `'US'`;
  if (n === 'hint') return `'number'`;
  if (n === 'label' && /TextDecoder/.test(s)) return `'utf-8'`;
  if (n === 'code' && s === 'WebSocket') return '1000';
  if (n === 'status' && m.startsWith('Response.redirect')) return '302';
  if (n === 'argArray' || n === 'argumentsList' || n === 'args' && /Reflect|Function/.test(s)) return '[1, 2]';
  if (n === 'signals') return `[AbortSignal.abort('a')]`;
  if (n === 'ports' || n === 'transfer') return '[]';
  if (n === 'view' || n === 'dest') return 'new Uint8Array(4)';
  if (n === 'stream' && /BYOB/.test(s)) return `new ReadableStream({ type: 'bytes' })`;
  if (n === 'stream' && /Writable/.test(s)) return 'new WritableStream()';
  if (n === 'stream') return 'new ReadableStream()';
  if (n === 'options' && m.startsWith('Intl.DisplayNames')) return `{ type: 'region' }`;
  if (n === 'event' || t === 'Event') return `new Event('ping')`;
  if (n === 'startOrMeasureOptions') return '{ start: 0 }';
  if (n === 'array' && /Crypto/.test(s)) return 'new Uint8Array(4)';
  if (n === 'values' && s === 'Promise') return '[Promise.resolve(1), 2]';
  if (/^new /.test(t) || (n === 'target' && m.startsWith('Reflect.construct'))) return 'class Point { constructor(x) { this.x = x; } }';
  if (n === 'newTarget') return 'class Point { constructor(x) { this.x = x; } }';
  if (/raw:/.test(t)) return `{ raw: ['a', 'b'] }`;
  if (/PropertyDescriptorMap/.test(t)) return `{ a: { value: 1, enumerable: true } }`;
  if (/Iterable<string>|readonly string\[\] \| string|string \| readonly string\[\]/.test(t) && !/^locales?$/.test(n)) return `['red', 'green', 'blue']`;
  if (/^locales?$/.test(n) || /LocalesArgument|readonly string\[\]/.test(t)) return `'en-US'`;
  if (/Time/.test(m) && /DateTimeFormatOptions/.test(t)) return `{ timeStyle: 'short', timeZone: 'UTC' }`;
  if (/^Weak/.test(s)) {
    if (/\[|Iterable|readonly/.test(t)) return s === 'WeakMap' ? `[[{}, 1]]` : '[{}]';
    if (/^(T|K|WeakKey|object)$/.test(t) && n !== 'value' && n !== 'heldValue') return '{}';
    if (n === 'target' || n === 'key' || n === 'unregisterToken' || (n === 'value' && s === 'WeakSet')) return '{}';
  }
  if (/readonly \[|Iterable<readonly|\[K, V\]|\[PropertyKey/.test(t) || (n === 'entries' && /Object|Map/.test(s))) return `[['a', 1], ['b', 2]]`;
  if (/^(o|obj|object|target|receiver|proto)$/.test(n) && /^(T|any|object|U)$/.test(t) && /Object|Reflect|Proxy/.test(s)) return '{ a: 1 }';
  if (n === 'handler' && /Proxy/.test(s)) return `{ get: (target, key) => (key in target ? target[key] : 'missing') }`;
  if (/^(TArrayBuffer|ArrayBufferLike|ArrayBuffer)$/.test(t) && n === 'buffer') return 'new ArrayBuffer(64)';
  if (s === 'Atomics' && /BigInt64Array/.test(t)) return 'new BigInt64Array(new SharedArrayBuffer(16))';
  if (s === 'Atomics' && /Int32Array|Int8Array/.test(t)) return 'new Int32Array(new SharedArrayBuffer(16))';
  if (s === 'Atomics' && t === 'bigint') return '3n';
  if (/^(Uint8Array)/.test(t)) return 'new Uint8Array(8)';
  if (n === 'callback' && /PerformanceObserver/.test(s)) return '() => {}';
  if (n === 'options' && m === 'PerformanceObserver.prototype.observe') return `{ type: 'mark' }`;
  return null;
}

function value(p, ctx) {
  const t = p.type.replace(/\s+/g, ' ').trim();
  const n = p.name;
  const sp = specific(t, n, ctx);
  if (sp !== null) return sp;
  if (/=>/.test(t) && !/^\{/.test(t)) return callback(t, n, ctx);
  if (ctx.section === 'Math' || ctx.section === 'Atomics' || ctx.section === 'DataView') {
    if (/^number$/.test(t) && n === 'value') return ctx.section === 'DataView' ? '7' : '2';
  }
  if (t === 'number' || t === 'number | undefined') return String(NUMBER_BY_NAME[n] ?? 2);
  if (t === 'bigint') return n === 'int' || n === 'value' ? '300n' : '7n';
  if (t === 'boolean' || /^boolean \|/.test(t)) return n === 'littleEndian' ? 'true' : 'true';
  if (t === 'string' || t === 'string | undefined') return STRING_BY_NAME[n] ?? `'a'`;
  if (/^(string \| string\[\]|LocalesArgument|Intl\.LocalesArgument|UnicodeBCP47LocaleIdentifier)/.test(t)) return `'en-US'`;
  if (/^string \| RegExp|RegExp/.test(t)) return `/o/g`;
  if (/^string \| URL|URL \| string|RequestInfo/.test(t)) return `'https://example.com/a'`;
  if (/^string \| symbol$|^PropertyKey$/.test(t)) return `'a'`;
  if (/ErrorOptions/.test(t)) return `{ cause: 'root' }`;
  if (/NumberFormatOptions/.test(t)) return `{ style: 'currency', currency: 'EUR' }`;
  if (/DateTimeFormatOptions/.test(t)) return `{ dateStyle: 'medium', timeZone: 'UTC' }`;
  if (/CollatorOptions/.test(t)) return `{ sensitivity: 'base' }`;
  if (/AddEventListenerOptions/.test(t)) return `{ once: true }`;
  if (/EventListenerOptions/.test(t)) return `{ capture: false }`;
  if (/EventListener/.test(t)) return `() => {}`;
  if (/ReadonlySetLike/.test(t)) return `new Set([2, 3, 4])`;
  if (/BufferSource|ArrayBufferView|AllowSharedBufferSource/.test(t)) return `new Uint8Array([104, 105])`;
  if (/^TArrayBuffer$|^ArrayBufferLike$|^ArrayBuffer$/.test(t)) return `new ArrayBuffer(8)`;
  if (/BigInt64Array|BigUint64Array/.test(t)) return ctx.element === 'bigint' ? `[7n, 8n]` : `new Int32Array(4)`;
  if (/Int8Array|Int32Array/.test(t)) return `new Int32Array(new SharedArrayBuffer(16))`;
  if (/^(ArrayLike<number>|Iterable<number>|number\[\])/.test(t)) return ctx.element === 'bigint' ? `[7n, 8n]` : `[7, 8]`;
  if (/^(ArrayLike|Iterable|ReadonlyArray|ConcatArray)<|\[\]$|^T\[\]$/.test(t)) return ctx.element === 'bigint' ? `[7n, 8n]` : ctx.element === 'string' ? `['x', 'y']` : `[7, 8]`;
  if (/CryptoKey/.test(t)) { ctx.needsKey = true; return 'key'; }
  if (/AlgorithmIdentifier|Algorithm/.test(t)) return `{ name: 'HMAC', hash: 'SHA-256' }`;
  if (/KeyUsage/.test(t)) return `['sign', 'verify']`;
  if (/^object \| null$/.test(t)) return 'null';
  if (/^object$|^Record|^\{/.test(t)) return `{ a: 1 }`;
  if (/^Function$/.test(t)) return `function add(a, b) { return a + b; }`;
  if (/^(any|unknown|T|U|K|V|A|S|R|T1|T2|this)$/.test(t)) return ctx.element === 'bigint' ? '9n' : ctx.element === 'string' ? `'x'` : ctx.section.includes('Map') && n === 'key' ? `'a'` : '9';
  if (/^any\[\]$/.test(t)) return `[1, 2]`;
  if (/ProxyHandler/.test(t)) return `{ get: (target, key) => (key in target ? target[key] : 'missing') }`;
  if (/PropertyDescriptor/.test(t)) return `{ value: 1, writable: true, enumerable: true, configurable: true }`;
  if (/Iterable|Array/.test(t)) return `[7, 8]`;
  if (/Promise/.test(t)) return `Promise.resolve(1)`;
  if (/Blob/.test(t)) return `new Blob(['hello'])`;
  if (/HeadersInit/.test(t)) return `{ 'x-a': '1' }`;
  if (/BodyInit/.test(t)) return `'hello'`;
  if (/^(number \| bigint \| StringNumericLiteral|number \| bigint|bigint \| boolean \| number \| string)$/.test(t)) return '1234.5';
  if (/^(string \| number|number \| string|string \| number \| boolean)$/.test(t)) return ctx.section === 'Intl' ? '3' : `'1'`;
  if (/^(Date \| number \| bigint|Date \| number|number \| string \| Date)$/.test(t)) return `new Date(Date.UTC(2026, 9, 14))`;
  if (/^readonly T\[\] \| null$|^readonly \(readonly \[K, V\]\)\[\] \| null$/.test(t)) return ctx.section.includes('Map') ? `[['a', 1]]` : `[1, 2]`;
  if (/^(WeakKey|object \| symbol)$/.test(t)) return `{}`;
  if (t === 'symbol') return `Symbol('tag')`;
  if (/^number \| null$/.test(t)) return '1';
  if (/TimerHandler|VoidFunction/.test(t)) return `() => {}`;
  if (/RelativeTimeFormatUnit/.test(t)) return `'day'`;
  if (/CompressionFormat/.test(t)) return `'gzip'`;
  if (/DurationFormatUnit/.test(t)) return `{ hours: 1, minutes: 30 }`;
  if (/QueuingStrategy/.test(t)) return `{ highWaterMark: 1 }`;
  if (/^WritableStream</.test(t)) return `new WritableStream()`;
  if (/ReadableWritablePair/.test(t)) return `new TransformStream()`;
  if (/URLSearchParams|string\[\]\[\]/.test(t)) return `'a=1&b=2'`;
  if (/UnderlyingByteSource|UnderlyingDefaultSource|UnderlyingSource/.test(t)) return `{ start(c) { c.enqueue('a'); c.close(); } }`;
  if (/UnderlyingSink/.test(t)) return `{ write() {} }`;
  if (/Transformer/.test(t)) return `{ transform(chunk, c) { c.enqueue(chunk); } }`;
  if (/KeyGenParams/.test(t)) return `{ name: 'HMAC', hash: 'SHA-256' }`;
  if (/ShareData/.test(t)) return `{ title: 'reference' }`;
  if (/VibratePattern/.test(t)) return '100';
  if (/^(W|R|D|TReturn|TNext|TYield|O|P|I|E|X)$/.test(t)) return '9';
  if (/\| null$/.test(t)) return 'null';
  if (/Init$|Options$|Dictionary$|Bag$|Params$/.test(t)) return `{}`;
  return `undefined /* ${t} */`;
}

function callback(t, name, ctx) {
  const params = (/^\(?\s*\(([^)]*)\)/.exec(t)?.[1] ?? '').split(',').map((s) => s.trim().split(/[:?]/)[0].trim()).filter(Boolean);
  const ret = t.slice(t.lastIndexOf('=>') + 2).trim();
  const el = ctx.element;
  const num = el === 'bigint' ? 'n' : '';
  if (/^(resolve|onfulfilled)$/.test(params[0]) || name === 'executor') return `(resolve) => resolve(1)`;
  if (name === 'onfulfilled') return `(value) => value + 1`;
  if (name === 'onrejected') return `(reason) => String(reason)`;
  if (name === 'onfinally') return `() => {}`;
  if (params[0] === 'previousValue' || params[0] === 'accumulator' || name === 'reducer') return `(sum, value) => sum + value`;
  if (params.length === 2 && /^(a|left|first|x)$/.test(params[0]) && /number/.test(ret)) {
    if (el === 'string') return `(a, b) => a.localeCompare(b)`;
    return el === 'bigint' ? `(a, b) => (a < b ? -1 : a > b ? 1 : 0)` : `(a, b) => a - b`;
  }
  if (/boolean|is |unknown/.test(ret) && /predicate|callbackfn|filter/.test(name)) {
    if (el === 'string') return `(value) => value !== 'a'`;
    return el === 'any' ? `(value) => Boolean(value)` : `(value) => value > 1${num}`;
  }
  if (/void/.test(ret)) return `(value) => { seen.push(value); }`;
  if (name === 'callback' && /flatMap/.test(ctx.member)) return `(value) => [value, value]`;
  if (/flatMap/.test(ctx.member)) return `(value) => [value, value]`;
  if (/mapfn|callbackfn|callback|selector/.test(name)) {
    if (el === 'string') return `(value) => value.toUpperCase()`;
    return el === 'any' ? `(value) => [value]` : `(value) => value * 2${num}`;
  }
  if (name === 'keySelector' || name === 'callbackfn') return `(value) => (value > 1 ? 'big' : 'small')`;
  if (name === 'reviver') return `(key, value) => (typeof value === 'number' ? value * 10 : value)`;
  if (name === 'replacer') return `(key, value) => (typeof value === 'number' ? value * 10 : value)`;
  if (name === 'cleanupCallback') return `() => {}`;
  return `(...args) => args.length`;
}

// ---- Entry -> function ----
const ident = (key) => key.replace(/^new /, 'new_').replace(/\[Symbol\.(\w+)\]/g, 'Symbol_$1').replace(/\[index\]/, 'index')
  .replace(/\(\)/g, '_call').replace(/ #(\d+)/, '_$1').replace(/[^A-Za-z0-9_$]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, '_$1');

const NONDETERMINISTIC = /^(Math\.random|Date\.now|Date\(\)|new Date( #2)?$|Event\.prototype\.timeStamp|Error\.prototype\.stack|URL\.createObjectURL|set(Timeout|Interval)\(\)|performance\.|crypto\.(randomUUID|getRandomValues)|Crypto\.prototype\.(randomUUID|getRandomValues)|Performance\.prototype|PerformanceEntry|PerformanceMark|PerformanceMeasure|PerformanceResourceTiming|Date\.prototype\.(getTimezoneOffset|toLocale|toString|toTimeString)|navigator\.|Navigator|WeakRef|FinalizationRegistry|SubtleCrypto\.prototype\.(generateKey|sign|encrypt)|CryptoKey)/;

function access(name) {
  if (name.startsWith('[')) return name; // [Symbol.iterator]
  if (/^\d+$/.test(name)) return `[${name}]`;
  if (name === '[index]') return '[0]';
  return /^[A-Za-z_$][\w$]*$/.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
}

function body(e) {
  const ctx = { section: e.section, element: elementOf(e.section), member: e.key, needsKey: false };
  const args = (e.params ?? []).filter((p) => p.name !== 'thisArg' && !p.rest).map((p) => value(p, ctx));
  const rest = (e.params ?? []).find((p) => p.rest);
  if (rest) args.push(...(/bigint/.test(rest.type) || ctx.element === 'bigint' ? ['1n', '2n'] : /number/.test(rest.type) ? ['1', '2'] : /string/.test(rest.type) ? [`'a'`, `'b'`] : ['1', '2']));
  const call = `(${args.join(', ')})`;
  const lines = [];
  let expr;
  let receiver = null;
  const member = e.key.replace(/ #\d+$/, '');

  if (OVERRIDES[e.key]) {
    const o = OVERRIDES[e.key];
    return { lines: o.lines, async: Boolean(o.async), nondeterministic: NONDETERMINISTIC.test(e.key) || Boolean(o.nondeterministic) };
  }
  if (e.kind === 'protocol' && /#(new|\(\))$/.test(e.id) && R[e.section]) {
    // GeneratorFunction#new / #(): the constructor reached through a generator function.
    const ctor = `(Object.getPrototypeOf(${e.section.startsWith('Async') ? 'async function* () {}' : 'function* () {}'}).constructor)`;
    const call2 = `('a', 'yield a')`;
    return { lines: [`return ${e.id.endsWith('#new') ? 'new ' : ''}${ctor}${call2};`], async: false, nondeterministic: false };
  }
  if (e.kind === 'type') {
    const typeName = e.id.replace('#', '.').split('.').slice(0, e.id.includes('#') ? -1 : undefined).join('.');
    const prop = e.id.includes('#') ? e.id.split('#')[1] : null;
    const jsdoc = prop ? e.id.split('#')[0] : e.id;
    lines.push(`/** @type {${jsdoc}} */`);
    const propText = prop === '[index]' ? 'key' : /^[A-Za-z_$][\w$]*$/.test(prop ?? '') ? prop : `[${(prop ?? '').replace(/^\[|\]$/g, '')}]`;
    lines.push(prop ? `const value = { ${propText}: ${typeSample(prop)} };` : `const value = ${typeSample(typeName)};`);
    expr = 'value';
  } else if (e.kind === 'function') {
    expr = `${e.id.replace('()', '')}${call}`;
  } else if (e.kind === 'construct' || e.kind === 'call') {
    const owner = e.id.replace(/^new /, '').replace(/\(\)$/, '');
    const ctor = owner === 'GeneratorFunctionConstructor' ? 'Object.getPrototypeOf(function* () {}).constructor' : owner;
    expr = e.kind === 'construct' ? `new ${ctor}${call}` : `${ctor}${call}`;
  } else if (e.kind === 'class') {
    expr = INTL[e.id.replace(/^Intl\./, '')] ?? `new ${e.id}('en-US')`;
  } else if (e.kind === 'static' || e.kind === 'static-property') {
    // `Array.[Symbol.species]` -> Array + [Symbol.species]; `Intl.NumberFormat.supportedLocalesOf` -> last dot.
    const cut = member.includes('.[') ? member.indexOf('.[') : member.lastIndexOf('.');
    const owner = cut > 0 ? member.slice(0, cut) : e.section;
    const name = cut > 0 ? member.slice(cut + 1) : member;
    expr = e.kind === 'static' ? `${owner}${access(name)}${call}` : `${owner}${access(name)}`;
  } else {
    // method, property, index, protocol: needs a receiver.
    let rname = e.section;
    let name;
    if (e.section === 'Intl') {
      const [, cls, mem] = /^Intl\.(\w+)\.prototype\.(.*)$/.exec(member) ?? [];
      receiver = { expr: INTL[cls] ?? `new Intl.${cls}('en-US')` };
      name = mem;
    } else {
      name = member.includes('.prototype.') ? member.split('.prototype.')[1] : member.split('#')[1];
      receiver = R[rname] ?? { expr: `undefined /* no receiver for ${rname} */` };
    }
    if (receiver.setup) lines.push(receiver.setup);
    lines.push(`const target = ${receiver.expr};`);
    const isMethod = e.kind === 'method' || (e.kind === 'protocol' && e.params !== undefined && guessCallable(e));
    expr = isMethod ? `target${access(name)}${call}` : `target${access(name)}`;
    if (name === '[index]') expr = 'target[0]';
  }
  const async = receiver?.async || ctx.needsKey || /PerformanceObserverEntryList|PerformanceResourceTiming|ReadableStreamBYOBRequest/.test(e.section);
  if (ctx.needsKey && !receiver?.async) lines.unshift(`const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, true, ['sign', 'verify']);`);
  const usesSeen = expr.includes('seen.push');
  if (usesSeen) lines.unshift('const seen = [];');
  const result = usesSeen ? [`${expr};`, 'return seen;'] : [`return ${expr};`];
  const closer = receiver?.closeWith ?? (receiver?.close ? `target.${receiver.close}();` : null);
  if (closer) {
    lines.push('try {', ...result.map((l) => `  ${l}`), '} finally {', `  ${closer}`, '}');
  } else lines.push(...result);
  return { lines, async, nondeterministic: NONDETERMINISTIC.test(e.key) };
}

// Protocol members with parameters are methods; ones without are properties unless the name says otherwise.
function guessCallable(e) {
  const name = e.id.split('#')[1] ?? '';
  if (e.params.length) return true;
  return /^(next|return|throw|toString|toLocaleString|valueOf|entries|keys|values|reverse|toReversed|toSorted|flat|\[Symbol\.(iterator|asyncIterator)\])$/.test(name);
}

function typeSample(name) {
  const samples = { style: `'currency'`, currency: `'EUR'`, currencyDisplay: `'symbol'`, unit: `'kilometer'`, unitDisplay: `'short'`, notation: `'compact'`,
    compactDisplay: `'short'`, localeMatcher: `'best fit'`, numberingSystem: `'latn'`, useGrouping: 'true', minimumIntegerDigits: '2',
    minimumFractionDigits: '1', maximumFractionDigits: '2', minimumSignificantDigits: '1', maximumSignificantDigits: '3', value: '1',
    writable: 'true', enumerable: 'true', configurable: 'true', get: '() => 1', set: '(v) => {}', cause: `'root'`, type: `'json'`, with: `{ type: 'json' }`,
    status: `'fulfilled'`, reason: `'why'`, promise: 'Promise.resolve(1)', resolve: '() => {}', reject: '() => {}' };
  return samples[name] ?? (/Options|Init|Descriptor|Registry|Attributes|Assertions|Map$/.test(name) ? '{}' : /Part$/.test(name) ? `{ type: 'literal', value: 'a' }` : `'a'`);
}

// ---- Write one file per section ----
const bySection = new Map();
for (const e of entries.filter((x) => x.layer !== 'syntax')) {
  if (!bySection.has(e.section)) bySection.set(e.section, []);
  bySection.get(e.section).push(e);
}
const map = {};
const meta = {};
// Lower-case sections (crypto, navigator, performance) are the global instances; a suffix keeps their files apart
// from Crypto, Navigator and Performance on case-insensitive file systems.
const fileOf = (section) => `ref-${section.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}${/^[a-z]/.test(section) && section !== 'globalThis' ? '-global' : ''}.mjs`;
for (const [section, list] of [...bySection].sort((a, b) => a[0].localeCompare(b[0]))) {
  const file = fileOf(section);
  const used = new Set();
  const parts = [`// GENERATED by build.mjs from reference.json: the "${section}" section of the JavaScript reference (${list[0].layer === 'web' ? 'Web API' : 'ECMAScript'}).`, `// One function per entry. Do not edit; change build.mjs and rebuild.`, ''];
  for (const e of list) {
    let fn = ident(e.key);
    while (used.has(fn)) fn += '_';
    used.add(fn);
    const b = body(e);
    map[e.key] = { file, fn };
    meta[e.key] = { async: b.async, nondeterministic: b.nondeterministic };
    const sig = e.params?.length ? `(${e.params.map((p) => `${p.rest ? '...' : ''}${p.name}${p.optional ? '?' : ''}: ${p.type.replace(/\s+/g, ' ')}`).join(', ')})` : '';
    parts.push(`/** ${e.key}${sig ? ` ${sig}` : ''} */`);
    parts.push(`export ${b.async ? 'async ' : ''}function ${fn}() {`);
    for (const l of b.lines) parts.push(`  ${l}`);
    parts.push('}', '');
  }
  writeFileSync(join(outDir, file), parts.join('\n'));
}
// Syntax entries are hand-written in input/syntax.mjs (and input/sloppy.cjs for `with`), one syntax_<entry> function each.
const syntaxFn = (id) => `syntax_${id.replace(/yield\*/, 'yield star').replace(/export \*/, 'export star').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
for (const s of entries.filter((x) => x.layer === 'syntax')) {
  map[s.key] = { file: s.id === 'with (sloppy mode)' ? 'sloppy.cjs' : 'syntax.mjs', fn: syntaxFn(s.id) };
  meta[s.key] = { async: false, nondeterministic: false };
}
writeFileSync(join(here, 'map.json'), JSON.stringify({ $comment: 'GENERATED by build.mjs: reference entry -> input file and function.', map, meta }, null, 1) + '\n');
console.log(`${Object.keys(map).length} entries, ${bySection.size} files in input/`);
