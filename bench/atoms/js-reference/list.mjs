// Builds the full JavaScript reference checklist (reference.json): every built-in up to ES2025, read from
// TypeScript's lib files, plus the Web APIs that Node provides as globals (from lib.dom), plus syntax
// (syntax.json, hand-listed from the ECMAScript grammar). One entry per member signature, overloads kept.
//
//   node bench/atoms/js-reference/list.mjs [--lib <dir with lib.es2025.d.ts>]
//
// The ES2025 lib files ship with TypeScript 7 (smith-functional's install); TS_LIB_DIR or --lib overrides.
// Deterministic: sorted output, no network.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = dirname(fileURLToPath(import.meta.url));

const argLib = process.argv.indexOf('--lib');
const libDir = argLib > 0 ? process.argv[argLib + 1]
  : process.env.TS_LIB_DIR ?? join(process.env.HOME, 'Repositories/smith-functional/node_modules/@typescript/typescript-darwin-arm64/lib');
if (!existsSync(join(libDir, 'lib.es2025.d.ts'))) {
  console.error(`No lib.es2025.d.ts in ${libDir}. Pass --lib <dir> or set TS_LIB_DIR.`);
  process.exit(1);
}

const ES_FILE = /^lib\.es(5|20(1[5-9]|2[0-5]))(\.[a-z0-9]+)*\.d\.ts$/;
const esFiles = readdirSync(libDir).filter((f) => ES_FILE.test(f) && !f.endsWith('.full.d.ts')).sort();
// lib.dom ships with every TypeScript; the repo's own copy is used so the Web set doesn't move with TS 7.
const domFile = require.resolve('typescript/lib/lib.dom.d.ts');

function read(file) {
  const text = readFileSync(file, 'utf8');
  return { text, sf: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false) };
}

function nameOf(node, text) {
  if (!node) return '?';
  if (ts.isComputedPropertyName(node)) return text.slice(node.pos, node.end).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').trim();
  return node.text ?? text.slice(node.pos, node.end).trim();
}

function memberKind(m) {
  if (ts.isMethodSignature(m)) return 'method';
  if (ts.isPropertySignature(m)) return 'property';
  if (ts.isCallSignatureDeclaration(m)) return 'call';
  if (ts.isConstructSignatureDeclaration(m)) return 'construct';
  if (ts.isIndexSignatureDeclaration(m)) return 'index';
  if (ts.isGetAccessor(m)) return 'getter';
  if (ts.isSetAccessor(m)) return 'setter';
  return 'other';
}

function paramsOf(node, text) {
  return (node.parameters ?? []).map((p) => ({
    name: nameOf(p.name, text),
    type: p.type ? text.slice(p.type.pos, p.type.end).trim() : 'any',
    optional: Boolean(p.questionToken || p.initializer),
    rest: Boolean(p.dotDotDotToken),
  }));
}

// Collect declarations from a set of lib files.
function collect(files) {
  const interfaces = new Map(); // name -> [{name, kind, params, returns, lib}]
  const vars = new Map(); // global var name -> type text
  const functions = []; // declare function f()
  const namespaces = new Map(); // namespace -> [{name, kind, params, lib}]
  for (const file of files) {
    const { text, sf } = read(file);
    const lib = file.split('/').pop();
    const visit = (st, ns) => {
      if (ts.isInterfaceDeclaration(st)) {
        const key = ns ? `${ns}.${st.name.text}` : st.name.text;
        const list = interfaces.get(key) ?? [];
        for (const m of st.members) {
          const kind = memberKind(m);
          const name = kind === 'call' ? '()' : kind === 'construct' ? 'new' : kind === 'index' ? '[index]' : nameOf(m.name, text);
          list.push({ name, kind, params: kind === 'property' ? [] : paramsOf(m, text), lib });
        }
        interfaces.set(key, list);
        if (ns) namespaces.get(ns).push({ name: st.name.text, kind: 'interface', lib });
      } else if (ts.isFunctionDeclaration(st) && st.name) {
        const entry = { name: st.name.text, kind: 'function', params: paramsOf(st, text), lib };
        if (ns) namespaces.get(ns).push(entry);
        else functions.push(entry);
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          const type = d.type ? text.slice(d.type.pos, d.type.end).trim() : 'any';
          const name = nameOf(d.name, text);
          // `declare var URL: { prototype: URL; new(...): URL; canParse(...) }`: an inline constructor type.
          if (d.type && ts.isTypeLiteralNode(d.type)) {
            const key = `${ns ? `${ns}.` : ''}${name}$inline`;
            interfaces.set(key, d.type.members.map((m) => {
              const kind = memberKind(m);
              return { name: kind === 'call' ? '()' : kind === 'construct' ? 'new' : kind === 'index' ? '[index]' : nameOf(m.name, text), kind, params: kind === 'property' ? [] : paramsOf(m, text), lib };
            }));
            if (ns) namespaces.get(ns).push({ name, kind: 'var', type: key, lib });
            else vars.set(name, key);
          } else if (ns) namespaces.get(ns).push({ name, kind: 'var', type, lib });
          else vars.set(name, type);
        }
      } else if (ts.isTypeAliasDeclaration(st)) {
        if (ns) namespaces.get(ns).push({ name: st.name.text, kind: 'type', lib });
      } else if (ts.isModuleDeclaration(st) && st.body && ts.isModuleBlock(st.body) && st.name.text === 'global') {
        // `declare global { ... }` (lib.es2025.iterator): its declarations are top-level.
        for (const inner of st.body.statements) visit(inner, ns);
      } else if (ts.isModuleDeclaration(st) && st.body && ts.isModuleBlock(st.body)) {
        const name = st.name.text;
        if (!namespaces.has(name)) namespaces.set(name, []);
        for (const inner of st.body.statements) visit(inner, name);
      }
    };
    for (const st of sf.statements) visit(st, null);
  }
  return { interfaces, vars, functions, namespaces };
}

// `declare var X: XConstructor` or `declare var X: { new(...): X; ... }` both mean a runtime global X.
function constructorInterfaceOf(type) {
  const m = /^([A-Za-z0-9_.]+(\$inline)?)$/.exec(type);
  return m ? m[1] : null;
}

const entries = [];
const add = (e) => entries.push(e);
const INSTANCE_INTERFACE = { Iterator: 'IteratorObject' };

function addGlobalObject(group, varName, type, decl, layer) {
  const ctor = constructorInterfaceOf(type);
  const statics = ctor ? decl.interfaces.get(ctor) ?? [] : [];
  for (const m of statics) {
    if (m.name === 'prototype') continue;
    const kind = m.kind === 'construct' ? 'construct' : m.kind === 'call' ? 'call' : /property|getter|setter/.test(m.kind) ? 'static-property' : 'static';
    add({ id: kind === 'construct' ? `new ${varName}` : kind === 'call' ? `${varName}()` : `${varName}.${m.name}`, section: group, layer, kind, params: m.params, lib: m.lib });
  }
  // Instance side: the interface that shares the global's name, when it describes instances.
  // ES2025 Iterator's helpers are declared on IteratorObject, which Iterator extends.
  const instanceOf = INSTANCE_INTERFACE[varName] ?? varName;
  if (ctor && ctor !== varName) {
    for (const m of decl.interfaces.get(instanceOf) ?? []) {
      const kind = m.kind === 'property' || m.kind === 'getter' || m.kind === 'setter' ? 'property' : m.kind === 'index' ? 'index' : 'method';
      add({ id: `${varName}.prototype.${m.name}`, section: group, layer, kind, params: m.params, lib: m.lib });
    }
  }
}

// ---- ECMAScript built-ins (ES5 .. ES2025) ----
const es = collect(esFiles.map((f) => join(libDir, f)));
const esGlobalNames = [...es.vars.keys()].sort();
for (const name of esGlobalNames) addGlobalObject(name, name, es.vars.get(name), es, 'es');
for (const f of es.functions.sort((a, b) => a.name.localeCompare(b.name))) add({ id: `${f.name}()`, section: 'globalThis', layer: 'es', kind: 'function', params: f.params, lib: f.lib });
for (const [ns, list] of [...es.namespaces].sort()) {
  for (const m of list) {
    const kind = m.kind === 'function' ? 'static' : m.kind === 'var' ? 'class' : 'type';
    add({ id: `${ns}.${m.name}`, section: ns, layer: 'es', kind, params: m.params ?? [], lib: m.lib });
  }
  // Classes inside a namespace (Intl.NumberFormat ...): their instance members are runtime entries too.
  for (const m of list.filter((x) => x.kind === 'var')) {
    const ctorKey = m.type.includes('$inline') ? m.type : `${ns}.${m.type}`;
    for (const sm of es.interfaces.get(ctorKey) ?? []) {
      if (sm.name === 'prototype' || sm.kind === 'construct' || sm.kind === 'call') continue;
      add({ id: `${ns}.${m.name}.${sm.name}`, section: ns, layer: 'es', kind: sm.kind === 'property' ? 'static-property' : 'static', params: sm.params, lib: sm.lib });
    }
    for (const im of es.interfaces.get(`${ns}.${m.name}`) ?? []) {
      add({ id: `${ns}.${m.name}.prototype.${im.name}`, section: ns, layer: 'es', kind: /property|getter|setter/.test(im.kind) ? 'property' : 'method', params: im.params, lib: im.lib });
    }
  }
}
// Protocol interfaces with no global (Iterator, Generator, TypedArray-like ...): runtime objects reach them.
const covered = new Set([...esGlobalNames, ...esGlobalNames.map((n) => constructorInterfaceOf(es.vars.get(n)))]);
for (const [name, list] of [...es.interfaces].sort()) {
  if (covered.has(name) || name.includes('.') || Object.values(INSTANCE_INTERFACE).includes(name)) continue;
  const runtime = /^(Async)?(Generator|Iterator|IterableIterator|IteratorObject|ArrayIterator|MapIterator|SetIterator|StringIterator|RegExpStringIterator|Iterable|AsyncIterable|PromiseLike|ArrayLike|ThisType|ConcatArray|ReadonlyArray|ReadonlyMap|ReadonlySet|TemplateStringsArray|RegExpMatchArray|RegExpExecArray|IArguments|CallableFunction|NewableFunction|Disposable|AsyncDisposable)/.test(name);
  for (const m of list) add({ id: `${name}#${m.name}`, section: name, layer: 'es', kind: runtime ? 'protocol' : 'type', params: m.params, lib: m.lib });
}

// ---- Web APIs that Node provides as globals (from lib.dom) ----
const dom = collect([domFile]);
const nodeGlobals = new Set(Object.getOwnPropertyNames(globalThis));
const esNames = new Set(esGlobalNames);
const webNames = [...dom.vars.keys()].filter((n) => nodeGlobals.has(n) && !esNames.has(n)).sort();
for (const name of webNames) {
  const type = dom.vars.get(name);
  if (dom.interfaces.has(constructorInterfaceOf(type) ?? '')) addGlobalObject(name, name, type, dom, 'web');
  else add({ id: name, section: name, layer: 'web', kind: 'object', params: [], lib: 'lib.dom.d.ts' });
}
for (const f of dom.functions.filter((x) => nodeGlobals.has(x.name)).sort((a, b) => a.name.localeCompare(b.name))) {
  add({ id: `${f.name}()`, section: 'web globals', layer: 'web', kind: 'function', params: f.params, lib: 'lib.dom.d.ts' });
}

// ---- Syntax (hand-listed from the ECMAScript grammar) ----
const syntax = JSON.parse(readFileSync(join(here, 'syntax.json'), 'utf8'));
for (const s of syntax.entries) add({ id: s.id, section: `syntax: ${s.section}`, layer: 'syntax', kind: 'syntax', node: s.node, params: [], lib: 'ECMA-262' });

// Overloads keep one entry each; number them so every entry has a unique key.
const seen = new Map();
for (const e of entries) {
  const n = (seen.get(e.id) ?? 0) + 1;
  seen.set(e.id, n);
  e.key = n === 1 ? e.id : `${e.id} #${n}`;
}

const count = (f) => entries.filter(f).length;
const summary = {
  libFiles: esFiles,
  total: entries.length,
  byLayer: { es: count((e) => e.layer === 'es'), web: count((e) => e.layer === 'web'), syntax: count((e) => e.layer === 'syntax') },
  byKind: Object.fromEntries([...new Set(entries.map((e) => e.kind))].sort().map((k) => [k, count((e) => e.kind === k)])),
  webGlobals: webNames,
};
writeFileSync(join(here, 'reference.json'), JSON.stringify({ $comment: 'GENERATED by list.mjs. The full JavaScript reference checklist.', summary, entries }, null, 1) + '\n');
console.log(JSON.stringify(summary, (k, v) => (k === 'webGlobals' || k === 'libFiles' ? `${v.length} names` : v), 1));
