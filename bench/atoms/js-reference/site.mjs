// Generates site/index.html: a browsable app of the full JavaScript reference. The examples are not copied in as
// text: the page imports the real modules from input/ (published next to it) and shows each function's own
// source, runs it in the browser on request, and compares the result with what Node returned (from run.mjs).
// Rebuild after list.mjs / build.mjs and the page follows.
//
//   node bench/atoms/js-reference/site.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAll } from './run.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const reference = JSON.parse(readFileSync(join(here, 'reference.json'), 'utf8'));
const { map, meta } = JSON.parse(readFileSync(join(here, 'map.json'), 'utf8'));

// Node's result as JavaScript-looking text.
function show(d, indent = '') {
  if (d === null) return 'null';
  if (typeof d === 'string') return JSON.stringify(d);
  if (typeof d !== 'object') return String(d);
  const next = indent + '  ';
  const list = (items, open, close) => (items.length === 0 ? `${open.trim()}${close.trim()}` : items.join(', ').length < 70 ? `${open}${items.join(', ')}${close}` : `${open}\n${items.map((x) => next + x).join(',\n')}\n${indent}${close}`);
  if (Array.isArray(d)) return list(d.map((x) => show(x, next)), '[', ']');
  const k = Object.keys(d);
  if (d.undefined) return 'undefined';
  if ('bigint' in d && k.length === 1) return `${d.bigint}n`;
  if ('number' in d && k.length === 1) return d.number;
  if ('symbol' in d && k.length === 1) return `Symbol(${d.symbol})`;
  if ('function' in d) return `[Function ${d.function}]`;
  if ('error' in d) return `${d.error}: ${d.message}${d.cause !== undefined ? ` { cause: ${show(d.cause)} }` : ''}`;
  if ('date' in d && k.length === 1) return `Date ${d.date}`;
  if ('regexp' in d) return d.regexp;
  if (Array.isArray(d.map) && k.length === 1) return list(d.map.map(([a, b]) => `${show(a)} => ${show(b, next)}`), 'Map {', '}');
  if (Array.isArray(d.set) && k.length === 1) return list(d.set.map((x) => show(x, next)), 'Set {', '}');
  if (Array.isArray(d.items) && 'iterator' in d) return list(d.items.map((x) => show(x, next)), `${d.iterator.slice(8, -1)} [`, ']');
  if (Array.isArray(d.asyncIterator)) return list(d.asyncIterator.map((x) => show(x, next)), 'async iterator [', ']');
  if ('promise' in d && k.length === 1) return 'Promise { <pending> }';
  if ('kind' in d && k.length === 1) return `(changes every run: ${d.kind})`;
  if (Array.isArray(d.array)) return `${show(d.array, indent)} ${show(d.props, indent)}`;
  if (k.length === 1 && /^[A-Z]/.test(k[0])) return `${k[0]} ${show(d[k[0]], indent)}`;
  return list(k.map((key) => `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}: ${show(d[key], next)}`), '{ ', ' }');
}

const results = await runAll();
const NOT_IN_NODE = /is not a function|^undefined$|Illegal constructor|Constructor cannot be called/;
const items = reference.entries.map((e) => {
  const where = map[e.key];
  const r = results[e.key];
  let status = 'syntax';
  let output = '';
  if (r?.ok !== undefined) { status = 'returns'; output = show(r.ok); }
  else if (r?.throws) {
    status = NOT_IN_NODE.test(r.throws.message ?? '') ? 'unavailable' : 'throws';
    output = r.throws.message ? `${r.throws.name}: ${r.throws.message}` : `throws ${r.throws.name}`;
  }
  const sig = e.params?.length ? `(${e.params.map((p) => `${p.rest ? '...' : ''}${p.name}${p.optional ? '?' : ''}`).join(', ')})` : '';
  return {
    k: e.key, s: e.section, l: e.layer, t: e.kind, g: sig, lib: e.lib?.replace(/^lib\.|\.d\.ts$/g, '') ?? '',
    f: where?.file ?? '', fn: where?.fn ?? '', r: r?.ok !== undefined ? r : r?.throws ? { throws: r.throws } : null,
    o: output, st: status, nd: Boolean(meta[e.key]?.nondeterministic),
    n: e.node ? JSON.stringify(e.node) : '',
  };
});

const count = (f) => items.filter(f).length;
const stats = {
  total: items.length, es: count((x) => x.l === 'es'), web: count((x) => x.l === 'web'), syntax: count((x) => x.l === 'syntax'),
  returns: count((x) => x.st === 'returns'), throws: count((x) => x.st === 'throws'), unavailable: count((x) => x.st === 'unavailable'),
  sections: new Set(items.map((x) => x.s)).size, node: process.version,
};
const data = JSON.stringify({ stats, items }).replace(/</g, '\\u003c');
const template = readFileSync(join(here, 'site.template.html'), 'utf8');
mkdirSync(join(here, 'site'), { recursive: true });
writeFileSync(join(here, 'site', 'index.html'), template.replace('__DATA__', () => data));
console.log(`site/index.html: ${stats.total} entries, ${stats.sections} sections, ${(data.length / 1024).toFixed(0)} KB of data`);
process.exit(0);
