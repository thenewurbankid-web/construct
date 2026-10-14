#!/usr/bin/env node
// Deterministic atom generator.
//
// Reads TypeScript's own lib.es5 .. lib.es2023 declarations (via the TypeScript 7 compiler
// API, see lib-extract.mjs), enumerates every method / static / constructor of the built-ins
// listed in src/atoms/naming.json, and for each one either:
//   - points at the hand-written (curated) atom that covers it (curated names win),
//   - excludes it with a reason, or
//   - emits a typed wrapper atom into src/atoms/generated/<module>.ts.
// It then writes the single catalog (src/atoms/catalog.json) and a coverage report
// (src/atoms/coverage.json). No network, no model calls, stable output order.
//
//   node scripts/gen-atoms.mjs          write everything
//   node scripts/gen-atoms.mjs --check  fail if the committed output is stale
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractLib } from './lib-extract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const atomsDir = join(root, 'src/atoms');
const genDir = join(atomsDir, 'generated');
const checkOnly = process.argv.includes('--check');

const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const naming = readJson('src/atoms/naming.json');
// Lookups by member/method name must ignore Object.prototype (names like toString, hasOwnProperty).
for (const k of ['readsOverrides', 'renames', 'participles', 'overrides', 'aliases', 'impure', 'excludeMembers', 'propertyCovers', 'mutatorEquivalents']) {
  naming[k] = Object.assign(Object.create(null), naming[k]);
}
const curated = readJson('src/atoms/curated.json');
const lib = extractLib(root);

// ---------------------------------------------------------------- helpers
const lowerFirst = (s) => (s.startsWith('UTC') ? 'utc' + s.slice(3) : s ? s[0].toLowerCase() + s.slice(1) : s);
const upperFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const utcCase = (s) => s.replace(/UTC/g, 'Utc');
const words = (s) =>
  utcCase(s)
    .replace(/NaN/g, ' NaN ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
const fill = (template, noun) => template.replace(/\{Noun\}/g, noun).replace(/\{noun\}/g, lowerFirst(noun));
const tpName = (tp) => tp.match(/^[A-Za-z_$][\w$]*/)[0];
const article = (w) => (/^[AEIOU]/.test(w) ? 'an' : 'a');
const hasBoolPrefix = (name) => naming.booleanPrefixes.some((p) => new RegExp(`^${p}[A-Z]`).test(name));

function scan(text, onTop) {
  // Walks a type string, calling onTop(index) at depth 0; understands => so its > is not a closer.
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '=' && text[i + 1] === '>') {
      if (depth === 0 && onTop(i, '=>') === false) return;
      i++;
      continue;
    }
    if ('(<{['.includes(ch)) depth++;
    else if (')>}]'.includes(ch)) depth--;
    else if (depth === 0 && onTop(i, ch) === false) return;
  }
}
function splitUnion(text) {
  const parts = [];
  let start = 0;
  scan(text, (i, ch) => {
    if (ch === '|') {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  });
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}
function topArrow(text) {
  let at = -1;
  scan(text, (i, ch) => {
    if (ch === '=>') {
      at = i;
      return false;
    }
  });
  return at;
}
function stripParens(t) {
  let s = t.trim();
  while (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
      if (depth === 0 && i < s.length - 1) {
        wraps = false;
        break;
      }
    }
    if (!wraps) break;
    s = s.slice(1, -1).trim();
  }
  return s;
}

// Parameter type text -> a generator name the test harness understands, or null.
function typeGen(type, tps) {
  const t = stripParens(type);
  const alts = splitUnion(t).filter((a) => a !== 'undefined' && a !== 'null');
  if (alts.length > 1) {
    if (alts.every((a) => /^"[^"]*"$/.test(a))) return `const:${JSON.stringify(alts.map((a) => a.slice(1, -1)))}`;
    for (const a of alts) {
      const g = typeGen(a, tps);
      if (g) return g;
    }
    return null;
  }
  const s = stripParens(alts[0] ?? 'undefined');
  if (topArrow(s) >= 0) {
    const ret = stripParens(s.slice(topArrow(s) + 2));
    if (/\bis\b/.test(ret) || ret === 'unknown' || ret === 'boolean') return 'pred';
    if (ret === 'number') return 'cmp';
    if (ret === 'void') return 'fn';
    if (ret === 'string') return 'fntext';
    if (/ReadonlyArray<|\[\]/.test(ret)) return 'fnnested';
    const r = typeGen(ret, tps);
    return r === 'prim' ? 'fn' : null;
  }
  if (tps.includes(s) || s === 'any' || s === 'unknown') return 'prim';
  const simple = { string: 'text', number: 'num', boolean: 'bool', bigint: 'bigint', RegExp: 'regex', Date: 'date', PropertyKey: 'key', object: 'obj', '{}': 'obj', Object: 'obj' };
  if (simple[s]) return simple[s];
  let elem = null;
  const arr = s.match(/^(?:readonly\s+)?(.+)\[\]$/);
  const gen = s.match(/^(?:ReadonlyArray|Array|ArrayLike|Iterable|ConcatArray)<(.+)>$/);
  if (arr) elem = arr[1];
  else if (gen) elem = gen[1];
  if (elem !== null) {
    const e = typeGen(elem, tps);
    return { prim: 'list', text: 'texts', num: 'nums' }[e] ?? null;
  }
  return null;
}

// ---------------------------------------------------------------- collect members
const curatedById = new Map();
const curatedNames = new Set(curated.map((c) => c.atom));
for (const c of curated) for (const id of c.covers ?? []) curatedById.set(id, c.atom);

const members = [];
const groupBy = (list) => {
  const m = new Map();
  for (const x of list) {
    if (!m.has(x.name)) m.set(x.name, []);
    m.get(x.name).push(x);
  }
  return m;
};

for (const owner of naming.owners) {
  if (owner.globals) {
    for (const [name, sigs] of groupBy(lib.globals)) members.push({ id: name, owner, kind: 'global', method: name, sigs });
    continue;
  }
  const seen = new Set();
  for (const ifaceName of owner.instance ?? []) {
    const iface = lib.interfaces.get(ifaceName);
    if (!iface) throw new Error(`lib has no interface ${ifaceName}`);
    for (const [name, list] of groupBy(iface.members)) {
      if (seen.has(name)) continue;
      seen.add(name);
      const first = list[0];
      const base = { id: `${owner.id}#${name}`, owner, method: name, iface: ifaceName, ifaceTps: iface.typeParams };
      if (first.kind === 'property') members.push({ ...base, kind: first.computed ? 'protocol' : 'property', deprecated: first.deprecated });
      else if (first.kind === 'index') members.push({ ...base, id: `${owner.id}#[index]`, kind: 'index' });
      else if (first.computed) members.push({ ...base, kind: 'protocol' });
      else members.push({ ...base, kind: 'instance', sigs: list.filter((x) => x.kind === 'method') });
    }
  }
  if (owner.static) {
    const iface = lib.interfaces.get(owner.static);
    if (!iface) throw new Error(`lib has no interface ${owner.static}`);
    for (const [name, list] of groupBy(iface.members)) {
      const first = list[0];
      if (first.kind === 'construct') members.push({ id: `new ${owner.id}`, owner, kind: 'construct', method: 'new', sigs: list });
      else if (first.kind === 'call') members.push({ id: `${owner.id}()`, owner, kind: 'call', method: '()', sigs: list });
      else if (first.kind === 'property') members.push({ id: `${owner.id}.${name}`, owner, kind: first.computed ? 'protocol' : 'constant', method: name, deprecated: first.deprecated });
      else if (first.computed) members.push({ id: `${owner.id}.${name}`, owner, kind: 'protocol', method: name });
      else if (first.kind === 'method') members.push({ id: `${owner.id}.${name}`, owner, kind: 'static', method: name, sigs: list });
    }
  }
}
const byId = new Map(members.map((m) => [m.id, m]));
for (const c of curated) for (const id of c.covers ?? []) if (!byId.has(id)) throw new Error(`curated ${c.atom} covers unknown lib member ${id}`);

// ---------------------------------------------------------------- naming
function isMutator(m) {
  const o = m.owner;
  if (m.kind === 'instance') return (o.mutators ?? []).includes(m.method) || (o.inPlaceMutators ?? []).includes(m.method) || (o.setterMutators && /^set[A-Z]/.test(m.method));
  if (m.kind === 'static') return (o.staticMutators ?? []).includes(m.method);
  return false;
}
const isInPlace = (m) => m.kind === 'instance' && (m.owner.inPlaceMutators ?? []).includes(m.method);
const liveSigs = (m) => (m.sigs ?? []).filter((s) => !s.deprecated);
const returnsBoolean = (m) =>
  !isMutator(m) && liveSigs(m).length > 0 && liveSigs(m).every((s) => s.returns === 'boolean' || /^[\w$]+ is /.test(s.returns));

function ruleName(m) {
  const o = m.owner;
  const v = m.method;
  if (m.kind === 'construct' || m.kind === 'call') return o[m.kind] ?? null;
  if (m.kind === 'global') return v;
  const noun = m.kind === 'instance' ? o.noun : o.staticNoun;
  if (naming.renames[v] && !(v === 'get' && m.kind !== 'instance')) return fill(naming.renames[v], noun);
  if (isMutator(m) && naming.participles[v]) return naming.participles[v] + noun;
  if (isMutator(m) && /^set[A-Z]/.test(v)) return lowerFirst(noun) + 'With' + utcCase(v.slice(3));
  if (m.kind === 'static' && /^from[A-Z]/.test(v)) return lowerFirst(noun) + 'From' + v.slice(4);
  if (/^get[A-Z]/.test(v)) {
    const rest = lowerFirst(utcCase(v.slice(3)));
    return rest.endsWith('Of') ? rest + noun : rest + 'Of' + noun;
  }
  if (naming.dropTo.includes(v)) return lowerFirst(v.slice(2)) + noun;
  return v + noun;
}
function nameOf(m) {
  if (naming.overrides[m.id]) return naming.overrides[m.id];
  if (naming.aliases[m.id]) return nameOf(byId.get(naming.aliases[m.id]));
  let name = ruleName(m);
  if (name && returnsBoolean(m) && !hasBoolPrefix(name)) name = naming.booleanFallbackPrefix + upperFirst(name);
  return name;
}

// ---------------------------------------------------------------- classify
const decisions = []; // { member, status: covered|excluded|generated|alias, atom?, reason? }
for (const m of members) {
  const d = { member: m };
  if (m.kind === 'property') {
    const cover = naming.propertyCovers[m.id];
    Object.assign(d, cover ? { status: 'covered', atom: cover } : { status: 'excluded', reason: m.deprecated ? 'deprecated in the language' : `property read: use get(${m.owner.receiver ?? 'value'}, '${m.method}')` });
  } else if (m.kind === 'constant') {
    Object.assign(d, { status: 'excluded', reason: m.deprecated ? 'deprecated in the language' : 'constant or prototype: use the value directly (not an operation)' });
  } else if (m.kind === 'index') {
    Object.assign(d, { status: 'excluded', reason: 'index access: use at(list, index) / get(obj, key)' });
  } else if (m.kind === 'protocol') {
    Object.assign(d, { status: 'excluded', reason: 'protocol hook ([Symbol.…]): used by syntax (for…of, spread, instanceof, coercion), not called directly' });
  } else if (liveSigs(m).length === 0) {
    Object.assign(d, { status: 'excluded', reason: 'deprecated in the language' });
  } else if (naming.excludeMembers[m.id]) {
    Object.assign(d, { status: 'excluded', reason: naming.excludeMembers[m.id] });
  } else if (curatedById.has(m.id)) {
    Object.assign(d, { status: 'covered', atom: curatedById.get(m.id) });
  } else if (naming.mutatorEquivalents[m.id]) {
    const target = naming.mutatorEquivalents[m.id];
    Object.assign(d, { status: 'alias', target });
  } else if (naming.aliases[m.id]) {
    Object.assign(d, { status: 'alias', target: naming.aliases[m.id] });
  } else {
    const name = nameOf(m);
    if (!name) Object.assign(d, { status: 'excluded', reason: 'no atom name configured for this constructor form' });
    else Object.assign(d, { status: 'generated', atom: name });
  }
  decisions.push(d);
}
const decisionById = new Map(decisions.map((d) => [d.member.id, d]));
for (const d of decisions) {
  if (d.status !== 'alias') continue;
  const t = decisionById.get(d.target);
  if (!t || !t.atom) throw new Error(`${d.member.id} aliases ${d.target}, which has no atom`);
  d.status = t.status === 'covered' ? 'covered' : 'generated-alias';
  d.atom = t.atom;
}

// Collision check: a name may belong to exactly one atom.
const reserved = ['Chain', 'Organism', 'Comparable', 'Conditional', 'Subject', 'Clause', 'AndSubject', 'OrSubject', 'ifIt'];
const owners = new Map();
for (const n of [...reserved, ...curatedNames]) {
  if (owners.has(n)) throw new Error(`name collision: ${n} is defined twice by hand`);
  owners.set(n, 'hand-written');
}
const collisions = [];
for (const d of decisions) {
  if (d.status !== 'generated') continue;
  if (owners.has(d.atom)) collisions.push(`${d.atom}: ${d.member.id} vs ${owners.get(d.atom)}`);
  else owners.set(d.atom, d.member.id);
}
if (collisions.length) {
  console.error(`gen-atoms: ${collisions.length} name collision(s) -- add an override in src/atoms/naming.json:\n  ${collisions.join('\n  ')}`);
  process.exit(1);
}

// ---------------------------------------------------------------- emit
function signatureParts(m, sig) {
  const o = m.owner;
  const r = o.receiver;
  const params = sig.params.map((p) => ({ ...p }));
  let recvType = m.kind === 'instance' ? o.receiverTypes[m.iface] : null;
  if (params[0] && params[0].name === 'this') {
    const t = params.shift();
    if (m.kind === 'instance') recvType = t.type;
  }
  for (const p of params) if (p.name === r) p.name = `${r}Arg`;
  const mutator = isMutator(m) && !isInPlace(m);
  let ret = sig.returns;
  if (m.kind === 'instance' && mutator) {
    recvType = o.copyReceiverType ?? recvType;
    ret = o.copyReturnType ?? recvType;
  }
  const fixThis = (t) => (recvType ? t.replace(/\bthis\b/g, `(${recvType})`) : t);
  if (m.kind === 'instance') {
    if (/^this is /.test(ret)) ret = `${r} is ${ret.slice(8)}`;
    else ret = fixThis(ret);
  }
  const tps = [...(m.kind === 'instance' ? m.ifaceTps : []), ...sig.typeParams];
  const ptext = params.map((p) => `${p.rest ? '...' : ''}${p.name}${p.optional && !p.rest ? '?' : ''}: ${fixThis(p.type)}`);
  if (m.kind === 'instance') ptext.unshift(`${r}: ${recvType}`);
  return { tps, ptext, ret, params, recvType };
}

function bodyFor(m) {
  const o = m.owner;
  const r = o.receiver;
  const v = m.method;
  if (m.kind === 'instance') {
    if (isMutator(m) && !isInPlace(m)) return { mode: 'copy', code: `const copy: any = ${o.copy.replace('{r}', r)};\n  copy.${v}(...args);\n  return copy;`, copy: o.copy };
    if ((o.copyReceiver && Object.hasOwn(o.copyReceiver, v))) return { mode: 'copyReceiver', code: `return (${o.copyReceiver[v].replace('{r}', r)} as any).${v}(...args);`, copy: o.copyReceiver[v] };
    return { mode: isInPlace(m) ? 'inplace' : 'instance', code: `return (${r} as any).${v}(...args);` };
  }
  if (m.kind === 'static' && isMutator(m)) return { mode: 'staticCopy', code: `const copy: any = { ...args[0] };\n  (${o.id} as any).${v}(copy, ...args.slice(1));\n  return copy;` };
  if (m.kind === 'static') return { mode: 'static', code: `return (${o.id} as any).${v}(...args);` };
  if (m.kind === 'construct') return { mode: 'construct', code: `return new (${o.id} as any)(...args);` };
  if (m.kind === 'call') return { mode: 'call', code: `return (${o.id} as any)(...args);` };
  return { mode: 'global', code: `return (${v} as any)(...args);` };
}

function jsFor(m, paramNames) {
  const o = m.owner;
  const P = paramNames.join(', ');
  switch (m.kind) {
    case 'instance':
      return `${o.receiver}.${m.method}(${P})`;
    case 'static':
      return `${o.id}.${m.method}(${P})`;
    case 'construct':
      return `new ${o.id}(${P})`;
    case 'call':
      return `${o.id}(${P})`;
    default:
      return `${m.method}(${P})`;
  }
}

function readsFor(m, paramNames, mode) {
  const o = m.owner;
  const r = o.receiver;
  const P = paramNames.map((p) => p.replace(/^\.\.\./, '')).join(', ');
  const v = m.method;
  const withP = P ? ` ${P}` : '';
  if (m.kind === 'construct') return `a new ${o.id} from ${P || 'nothing'}`;
  if (m.kind === 'call') return `${P || 'nothing'} as ${article(o.id)} ${o.id}`;
  const bool = returnsBoolean(m);
  if (m.kind === 'instance') {
    if (bool) return `whether ${r} ${words(v)}${withP}`;
    if (mode === 'copy' && /^set[A-Z]/.test(v)) return `${r} with ${words(v.slice(3))} set to ${P}`;
    if (mode === 'copy') return `${r} after ${words(v)}${withP}, as a copy`;
    if (/^get[A-Z]/.test(v)) return `the ${words(v.slice(3))} of ${r}`;
    return `the ${words(v)}${withP} of ${r}`;
  }
  if (bool) return `whether ${P || 'it'} ${words(v)}`;
  if (mode === 'staticCopy') return `a copy of ${paramNames[0] ?? 'it'} after ${words(v)}`;
  return `the ${words(v)} of ${P || 'nothing'}`;
}

function deriveCheck(m, sigs, mode) {
  const o = m.owner;
  if (naming.impure[m.id] && /random|clock/.test(naming.impure[m.id])) return { unverified: `impure: ${naming.impure[m.id]}` };
  if (m.method === 'bind') return { unverified: 'returns a function, which cannot be compared for equivalence' };
  if (m.kind === 'instance' && !o.gen) return { unverified: `no generator for ${o.id} receivers` };
  let lastReason = 'no signature';
  for (const sig of sigs) {
    const { params } = signatureParts(m, sig);
    const tps = [...(m.kind === 'instance' ? m.ifaceTps : []), ...sig.typeParams].map(tpName);
    if (topArrow(stripParens(sig.returns)) >= 0) {
      lastReason = 'returns a function, which cannot be compared for equivalence';
      continue;
    }
    const out = [];
    let ok = true;
    for (const p of params) {
      const g = typeGen(p.type, tps);
      if (!g) {
        if (p.optional || p.rest) break;
        ok = false;
        lastReason = `no generator for parameter type \`${p.type}\``;
        break;
      }
      out.push({ name: p.name, gen: g, optional: p.optional, rest: p.rest });
    }
    if (!ok) continue;
    // A copy-then-mutate static (Object.freeze, defineProperty, ...) copies its first argument as an object.
    if (mode === 'staticCopy' && out[0]) out[0].gen = 'obj';
    const native = { kind: mode, owner: o.id, member: m.method };
    const { copy } = bodyFor(m);
    if (copy) native.copy = copy;
    return { check: { native, receiver: m.kind === 'instance' ? o.gen : undefined, params: out } };
  }
  return { unverified: lastReason };
}

const files = new Map(); // module -> [code]
const entries = [];
const header = '// GENERATED by scripts/gen-atoms.mjs from TypeScript\'s lib.es5 .. lib.es2023 -- do not edit.\n// Each atom wraps exactly one built-in; see src/atoms/catalog.json for its reading and checks.\n/* eslint-disable */\n';
for (const d of decisions) {
  if (d.status !== 'generated') continue;
  const m = d.member;
  const sigs = liveSigs(m);
  const { mode, code } = bodyFor(m);
  const first = signatureParts(m, sigs[0]);
  const paramNames = first.params.map((p) => (p.rest ? '...' : '') + p.name);
  const callNames = m.kind === 'instance' ? [m.owner.receiver, ...paramNames] : paramNames;
  const reads = naming.readsOverrides[m.id] ?? readsFor(m, paramNames, mode);
  const js = jsFor(m, paramNames);
  const impure = naming.impure[m.id];
  const notes = [];
  if (mode === 'copy') notes.push(`The built-in mutates ${m.owner.receiver}; this atom applies it to a copy and returns the copy (the original is untouched).`);
  if (mode === 'staticCopy') notes.push('The built-in mutates its first argument; this atom applies it to a shallow copy and returns the copy.');
  if (mode === 'copyReceiver') notes.push(`Runs on a copy of ${m.owner.receiver}, so its lastIndex never changes.`);
  if (mode === 'inplace') notes.push(`MUTATES ${m.owner.receiver}: ${m.owner.inPlaceReason}.`);
  if (impure) notes.push(`IMPURE: ${impure}.`);
  const doc = [`/**`, ` * ${d.atom}(${callNames.join(', ')}) reads "${reads}".`, ` * Generated wrapper: exactly \`${js}\`${mode === 'copy' ? ' on a copy' : ''}.`, ...notes.map((n) => ` * ${n}`), ` */`];
  const overloads = sigs.map((s) => {
    const p = signatureParts(m, s);
    return `export function ${d.atom}${p.tps.length ? `<${p.tps.join(', ')}>` : ''}(${p.ptext.join(', ')}): ${p.ret};`;
  });
  const impl = m.kind === 'instance' ? `export function ${d.atom}(${m.owner.receiver}: any, ...args: any[]): any {\n  ${code}\n}` : `export function ${d.atom}(...args: any[]): any {\n  ${code}\n}`;
  const mod = m.owner.module;
  if (!files.has(mod)) files.set(mod, []);
  files.get(mod).push(`${doc.join('\n')}\n${overloads.join('\n')}\n${impl}\n`);
  const verification = deriveCheck(m, sigs, mode);
  const covers = [m.id, ...decisions.filter((x) => x.status === 'generated-alias' && x.atom === d.atom).map((x) => x.member.id)];
  const entry = {
    atom: d.atom,
    module: `generated/${mod}`,
    reads,
    js: [js],
    pure: !impure && mode !== 'inplace',
    mutates: mode === 'inplace',
    generated: true,
    covers,
    verified: Boolean(verification.check),
  };
  if (impure) entry.impureReason = impure;
  if (mode === 'copy' || mode === 'staticCopy') entry.replacesMutation = m.id;
  if (verification.check) entry.check = verification.check;
  else entry.unverifiedReason = verification.unverified;
  if (notes.length) entry.note = notes.join(' ');
  entries.push(entry);
}

// Curated entries come first in the catalog; every curated atom is hand-verified by
// its own check sets or a dedicated test (verifiedBy), or carries an unverified reason.
const catalog = [];
for (const c of curated) catalog.push({ generated: false, ...c, verified: Boolean(c.check || c.verifiedBy) });
catalog.push(...entries);
const excluded = [];
for (const d of decisions) if (d.status === 'excluded') excluded.push({ atom: null, js: [d.member.id], module: d.member.owner.module, excluded: d.reason });
for (const [group, ex] of Object.entries(naming.excludeObjects)) excluded.push({ atom: null, js: [group], module: 'excluded', excluded: ex.reason });
for (const s of naming.syntax) excluded.push({ atom: null, js: [s.js], module: 'syntax', excluded: s.reason });

// Coverage per built-in object.
const coverage = [];
for (const owner of naming.owners) {
  const ds = decisions.filter((d) => d.member.owner === owner && d.member.kind !== 'constant' && d.member.kind !== 'property' && d.member.kind !== 'index');
  const gen = ds.filter((d) => d.status === 'generated');
  const unverified = gen.filter((d) => !entries.find((e) => e.atom === d.atom).verified).length;
  coverage.push({
    object: owner.id,
    operations: ds.length,
    curated: ds.filter((d) => d.status === 'covered').length,
    generated: gen.length + ds.filter((d) => d.status === 'generated-alias').length,
    excluded: ds.filter((d) => d.status === 'excluded').length,
    unverified,
    properties: decisions.filter((d) => d.member.owner === owner && (d.member.kind === 'constant' || d.member.kind === 'property')).length,
  });
}
for (const [group, ex] of Object.entries(naming.excludeObjects)) {
  let count = 0;
  for (const i of ex.interfaces ?? []) count += lib.interfaces.get(i)?.members.length ?? 0;
  if (ex.namespace) count += lib.namespaces.get(ex.namespace)?.length ?? 0;
  coverage.push({ object: group, operations: count, curated: 0, generated: 0, excluded: count, unverified: 0, properties: 0, reason: ex.reason });
}

const outputs = new Map();
const sortedModules = [...files.keys()].sort();
for (const mod of sortedModules) outputs.set(join(genDir, `${mod}.ts`), header + '\n' + files.get(mod).join('\n'));
outputs.set(join(genDir, 'index.ts'), header + sortedModules.map((m) => `export * from './${m}';`).join('\n') + '\n');
outputs.set(join(atomsDir, 'catalog.json'), JSON.stringify({ $comment: 'GENERATED by scripts/gen-atoms.mjs from curated.json + naming.json + the TypeScript es2023 lib. Single source of truth for JS -> atom mapping and plain-English readings.', libFiles: lib.files, atoms: catalog, excluded }, null, 1) + '\n');
outputs.set(join(atomsDir, 'coverage.json'), JSON.stringify(coverage, null, 1) + '\n');

if (checkOnly) {
  const stale = [...outputs].filter(([p, text]) => !existsSync(p) || readFileSync(p, 'utf8') !== text).map(([p]) => p);
  const extra = existsSync(genDir) ? readdirSync(genDir).filter((f) => !outputs.has(join(genDir, f))) : [];
  if (stale.length || extra.length) {
    console.error(`gen-atoms --check: stale output, run node scripts/gen-atoms.mjs\n  ${[...stale, ...extra].join('\n  ')}`);
    process.exit(1);
  }
  console.log('gen-atoms --check: up to date');
} else {
  if (existsSync(genDir)) rmSync(genDir, { recursive: true });
  mkdirSync(genDir, { recursive: true });
  for (const [p, text] of outputs) writeFileSync(p, text);
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad('object', 22)}${pad('ops', 6)}${pad('curated', 9)}${pad('generated', 11)}${pad('excluded', 10)}unverified`);
  for (const c of coverage) console.log(`${pad(c.object, 22)}${pad(c.operations, 6)}${pad(c.curated, 9)}${pad(c.generated, 11)}${pad(c.excluded, 10)}${c.unverified}`);
  console.log(`catalog: ${catalog.length} atoms (${curated.length} hand-written, ${entries.length} generated), ${excluded.length} excluded entries`);
}
