// Facts compiler: Smith English is never handed to a model as is. It is compiled, with the LSP index, into the compact
// facts shape that won the context probe (bench/ecommerce/driver/context-probe.mjs's L / CL ledgers):
//
//   Facts so far (each with where it comes from):
//   - <what exists in scope, by stable id and signature> [source]
//   - <what is missing> [source]
//   - Use exactly: <names and types> [source]
//   Current step: <the one next step>
//   Last result: <the last refusal, with an example fix>
//
// Deterministic, no model. Smith's sentences are read for structure (the element a page renders and with what, where
// each prop of a library page ends up, early returns, which fixture a page reads); no Smith sentence is copied out.
//
//   buildIndex(root, {smith})   -> index    the project read once: moduleScope, quickInfo signatures, stub checks,
//                                           Smith steps, library components/pages/fixtures (smith is injectable)
//   compileFacts(input)         -> {text, facts, step, last, tokens}
//
// input: { index, target: {feature, file?, name?, contentHash?}, libraryPages?: string[], point, step, refusal?, fetch? }
//   step:    {kind: 'setCode', file, contentHash, point} | {kind: 'baseOn', feature, route, points: string[]}
//   refusal: {code, repeat, file, line, message, caret?, exampleFix, contentHash}
import fs from 'node:fs';
import path from 'node:path';
import { approxTokens } from './index.mjs';
import { ts } from './host.mjs';

export const FACTS_MAX_TOKENS = 1500;
const LOGIC = ['domains', 'services', 'usecases', 'expressions', 'hooks', 'controllers', 'providers', 'contracts'];

/** `<feature>/<kind>/<name>` for a file under features/<feature>/<kind>/, else `<rel>#<name>` (as lsp/smith.mjs). */
export function stableIdOf(rel, name) {
  const m = /^features\/([^/]+)\/([^/]+)\//.exec(rel);
  return m ? `${m[1]}/${m[2]}/${name}` : `${rel}#${name}`;
}

// ------------------------------------------------------------------------------------------ Smith steps -> structure
/** Smith's words for a camelCase name ("submitLabel" -> "submit label"). */
export const smithWords = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
/** A Smith value as code: 'x' -> "x", a's b -> a.b, a bare name stays. */
export function valueOf(v) {
  const s = v.trim();
  if (/^'[^']*'$/.test(s)) return `"${s.slice(1, -1)}"`;
  return `{${s.replace(/(\w+)'s (\w+)/g, '$1.$2')}}`;
}
/** `with a as v and b as w` -> [[a, v], [b, w]] (Smith splits camelCase attribute names; they are rejoined). */
export function attrsOf(withText) {
  if (!withText) return [];
  return withText.split(/ and (?=[\w -]+? as )/).map((p) => p.split(' as ')).filter((p) => p.length >= 2)
    .map(([k, ...v]) => [k.trim().replace(/ (\w)/g, (_, c) => c.toUpperCase()), valueOf(v.join(' as '))]);
}
const tagWith = (s) => /^shows an? <([\w.]+)>(?: with (.+?))?(?= containing |$)/.exec(s);
const elementCode = (tag, attrs) => `<${tag}${attrs.map(([k, v]) => ` ${k}=${v}`).join('')}>`;

/**
 * One function's Smith steps as structure: the element it returns (tag + attributes), the tags inside it, early
 * returns (condition + element), and the names its `Let` steps read.
 * @param {string[]} steps Smith's sentences after the title.
 */
export function stepsShape(steps) {
  const out = { renders: null, inside: [], early: [], reads: [] };
  for (const raw of steps) {
    const s = raw.replace(/\.$/, '');
    let m;
    if ((m = /^It returns (shows .+)$/.exec(s))) {
      const t = tagWith(m[1]);
      if (t) {
        out.renders = elementCode(t[1], attrsOf(t[2]));
        const rest = m[1].slice(t[0].length);
        out.inside = [...rest.matchAll(/<([\w.]+)>/g)].map((x) => x[1]);
      }
    } else if ((m = /^If not \((.+?)\), return (shows .+)$/.exec(s))) {
      const t = tagWith(m[2]);
      if (t) out.early.push({ when: `${m[1].replace(/(\w+)'s (\w+)/g, '$1.$2')} is missing`, renders: elementCode(t[1], attrsOf(t[2])) });
    } else if ((m = /^Let (.+?) be (.+)$/.exec(s))) {
      out.reads.push(...(m[2].match(/\b[a-z]\w*\b/gi) ?? []));
    }
  }
  return out;
}

/**
 * Where each prop of a library page ends up, from its Smith steps: `title in <h1>`, `toolbar in <div> when given`,
 * `children in a grid <div> when given`, `empty when children is missing`, `title as aria-label of <form>`.
 * @param {string[]} steps
 * @param {string[]} props
 */
export function propUses(steps, props) {
  const s = steps.join(' ');
  const otherwise = new Map([...s.matchAll(/if (\w[\w ]*?) then .*?, otherwise (\w[\w ]*?)(?=[,.]| and |$)/g)].map((m) => [m[2], m[1]]));
  const out = [];
  for (const p of props) {
    const w = smithWords(p);
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const at = new RegExp(`containing ${esc}(?=[ ,.]|$)`).exec(s);
    if (at) {
      const before = s.slice(0, at.index);
      const tags = [...before.matchAll(/<([\w.]+)>(?: with class name as '([^']*)')?/g)];
      const last = tags[tags.length - 1];
      const grid = last?.[2] && /\bgrid\b/.test(last[2]) && !/\bgap\b.*\bcols-\[/.test(last[2]) && /grid-cols-\d/.test(last[2]);
      const when = new RegExp(`if ${esc} then`).test(s) ? ' when given' : '';
      out.push(`${p} in ${grid ? 'a grid ' : ''}<${last?.[1] ?? '?'}>${when}`);
      continue;
    }
    if (otherwise.has(w)) { out.push(`${p} when ${otherwise.get(w).replace(/ (\w)/g, (_, c) => c.toUpperCase())} is missing`); continue; }
    const attr = new RegExp(`(?:with|and) ([\\w-]+(?: [\\w-]+)?) as ${esc}(?=[ ,.]|$)`).exec(s);
    if (attr) {
      const before = s.slice(0, attr.index);
      const tags = [...before.matchAll(/<([\w.]+)>/g)];
      out.push(`${p} as ${attr[1].replace(/ (\w)/g, (_, c) => c.toUpperCase())} of <${tags[tags.length - 1]?.[1] ?? '?'}>`);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ refusal wording
/** A TypeScript error in plain words (the shape the probe's winning refusal used); unknown errors stay as written. */
export function plainTypeError(message) {
  const m = /Argument of type '([^']+)' is not assignable to parameter of type '([^']+)'/.exec(message);
  if (m && /\bnull\b/.test(m[1]) && !/\bnull\b/.test(m[2])) return `it passes a value that can be null (${m[1]}) where only a ${m[2]} is allowed`;
  if (m) return `it passes a ${m[1]} where a ${m[2]} is needed`;
  const n = /Cannot find module '([^']+)'/.exec(message);
  if (n) return `it imports ${n[1]}, which does not exist`;
  const p = /Property '([^']+)' does not exist on type '([^']+)'/.exec(message);
  if (p) return `${p[2]} has no ${p[1]}`;
  return message.replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------------------------------------------- the index
const readText = (f) => fs.readFileSync(f, 'utf8');
const listDir = (d, re) => { try { return fs.readdirSync(d).filter((f) => re.test(f)).sort(); } catch { return []; } };
const typeOfValue = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const routeOf = (src) => /^\/\/ @line-route (\S+)/m.exec(src)?.[1] ?? null;

/**
 * Read a Line project once: features (moduleScope), each declared unit (stable id, base, route, quickInfo signature,
 * stub check, Smith steps), and the library (components, pages with signature + props type + Smith steps, fixtures
 * with row count and field types).
 * @param {string} root
 * @param {{smith: (code: string, kind: string) => Promise<string[]>, quickInfo?: Function, moduleScope?: Function, stubProblems?: Function, functionsOf?: (src: string, rel: string) => Map<string, {kind: string, code: string}>}} o
 */
export async function buildIndex(root, o) {
  const quickInfo = o.quickInfo ?? (await import('./index.mjs')).quickInfo;
  const moduleScope = o.moduleScope ?? (await import('../line/scope/moduleScope.mjs')).moduleScope;
  const stubProblems = o.stubProblems ?? (await import('../line/path/stubs.mjs')).stubProblems;
  const functionsIn = o.functionsOf ?? defaultFunctionsOf;
  const sig = (rel, name) => { const q = quickInfo(root, rel, name); return q?.ok ? q.type.replace(/\s+/g, ' ') : null; };
  const stepsOf = async (rel, name) => {
    const src = readText(path.join(root, rel));
    const fn = functionsIn(src, rel).get(name);
    return fn ? o.smith(fn.code, fn.kind) : [];
  };
  const features = [];
  const units = [];
  for (const f of listDir(path.join(root, 'features'), /^[^.]/)) {
    if (!fs.statSync(path.join(root, 'features', f)).isDirectory()) continue;
    const scope = moduleScope(root, f);
    const kinds = Object.keys(scope.declares);
    features.push({ name: f, spec: fs.existsSync(path.join(root, 'features', f, 'spec.md')), kinds, exports: scope.exports.map((e) => e.name), library: scope.imports.library.map((l) => l.id) });
    for (const [kind, items] of Object.entries(scope.declares)) {
      for (const it of items) {
        const src = readText(path.join(root, it.file));
        let stub = [];
        try { stub = stubProblems(src, it.name).map((p) => p.code).filter((c) => c !== 'NO_STUB'); } catch { stub = []; }
        units.push({ id: stableIdOf(it.file, it.name), feature: f, kind, name: it.name, file: it.file, base: it.base, route: routeOf(src), signature: sig(it.file, it.name), stub, steps: await stepsOf(it.file, it.name), logic: LOGIC.includes(kind) });
      }
    }
  }
  const lib = path.join(root, 'library');
  const pages = [];
  for (const file of listDir(path.join(lib, 'pages'), /\.tsx$/)) {
    const name = file.replace(/\.tsx$/, '');
    const rel = `library/pages/${file}`;
    pages.push({ id: `pages/${name}`, name, file: rel, signature: sig(rel, name), props: sig(rel, `${name}Props`), steps: await stepsOf(rel, name) });
  }
  const fixtures = listDir(path.join(lib, 'fixtures'), /\.json$/).map((file) => {
    let rows = null; let fields = [];
    try { const data = JSON.parse(readText(path.join(lib, 'fixtures', file))); if (Array.isArray(data)) { rows = data.length; fields = Object.entries(data[0] ?? {}).map(([k, v]) => `${k}: ${typeOfValue(v)}`); } } catch { /* unreadable fixture: no fields */ }
    return { stem: file.replace(/\.json$/, ''), file: `library/fixtures/${file}`, rows, fields };
  });
  return { features, units, library: { components: listDir(path.join(lib, 'components'), /\.tsx$/).map((f) => f.replace(/\.tsx$/, '')), pages, fixtures } };
}

/** Top-level function declarations of a TS/TSX source, as written (export dropped): what Smith reads. */
function defaultFunctionsOf(src, rel) {
  const out = new Map();
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, /\.tsx$/.test(rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  for (const st of sf.statements) if (ts.isFunctionDeclaration(st) && st.body && st.name) out.set(st.name.text, { kind: 'function', code: st.getText(sf).replace(/^export\s+(default\s+)?/, '') });
  return out;
}

// ------------------------------------------------------------------------------------------------- compile
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const relImport = (from, to) => { let r = path.posix.relative(path.posix.dirname(from), to).replace(/\.tsx?$/, ''); if (!r.startsWith('.')) r = `./${r}`; return r; };

/** One unit as a fact: where it lives, what it is based on and served at, what it renders (from Smith). */
function unitFact(u, index) {
  const sh = stepsShape(u.steps);
  const parts = [`${u.file} (${u.id})`];
  const meta = [];
  if (u.base) meta.push(`is based on ${u.base}`);
  if (u.route) meta.push(`served at ${u.route}`);
  const fixtures = index.library.fixtures.filter((x) => sh.reads.includes(x.stem)).map((x) => x.file);
  if (fixtures.length) meta.push(`reads ${list(fixtures)}`);
  if (sh.renders) {
    const inside = Object.entries(sh.inside.reduce((a, t) => ({ ...a, [t]: (a[t] ?? 0) + 1 }), {})).map(([t, n]) => `${n > 1 ? `${n} ` : ''}<${t}>`);
    meta.push(`renders ${sh.renders}${inside.length ? ` holding ${list(inside)}` : sh.early.length ? '' : ' with nothing else'}`);
  }
  for (const e of sh.early) meta.push(`renders ${e.renders} when ${e.when}`);
  if (u.stub.length) meta.push(`is a stub with ${u.stub.join(', ')}`);
  parts.push(list(meta));
  return `${parts.join(' ')}. [moduleScope; Smith ${u.file}]`;
}

/** The library page a page can be based on: signature, props type, and where each prop ends up (from Smith). */
function libraryPageFact(p) {
  const props = /\{([^}]*)\}/.exec(p.props ?? '')?.[1]?.split(';').map((x) => x.trim()).filter(Boolean) ?? [];
  const names = props.map((x) => x.replace(/\??:.*/, ''));
  const uses = propUses(p.steps, names);
  const shape = props.length ? `{${props.map((x) => { const [k, t] = x.split(/:\s*/); return k.endsWith('?') ? k : `${k}: ${t}`; }).join(', ')}}` : '';
  return `${p.name} (${p.id}) takes ${shape || '(no props)'}${uses.length ? `: ${uses.join(', ')}` : ''}. [quickInfo; Smith ${p.file}]`;
}

/**
 * Compile the facts. Pure: everything comes from `input` (buildIndex's output plus the task).
 * @param {{index: any, target: {feature: string, file?: string, name?: string}, libraryPages?: string[], step: any, refusal?: any, fetch?: boolean}} input
 */
export function compileFacts(input) {
  const { index, target, step, refusal } = input;
  const facts = [];
  const feats = index.features;
  // in scope
  const specd = feats.filter((f) => f.spec).map((f) => f.name);
  if (specd.length) facts.push(`Features ${list(specd)} exist, each with its spec.md. [ls features/*]`);
  for (const u of index.units.filter((x) => !x.logic)) facts.push(unitFact(u, index));
  // missing
  for (const f of feats.filter((x) => !x.kinds.length)) facts.push(`${f.name} has no page${f.spec ? ' yet; its spec.md is there' : ''}. [moduleScope ${f.name}]`);
  const logicKinds = new Set(feats.flatMap((f) => f.kinds.filter((k) => LOGIC.includes(k))));
  if (!logicKinds.size) facts.push('No feature has usecases, services or domains yet. [moduleScope features/*]');
  if (!feats.some((f) => f.exports.length)) facts.push('No feature exports anything (no features/<f>/index.ts). [moduleScope]');
  const ownFixture = index.library.fixtures.some((x) => x.stem === target.feature);
  if (!ownFixture) facts.push(`There is no ${target.feature} fixture; library/fixtures has only ${list(index.library.fixtures.map((x) => `${x.stem}.json`))}. [ls library/fixtures]`);
  // library
  const L = index.library;
  facts.push(`The library has components ${list(L.components)}; pages ${list(L.pages.map((p) => p.name))}; ${list(L.fixtures.map((x) => `${x.file} with ${x.rows} rows {${x.fields.join(', ')}}`))}. [ls library; quickInfo]`);
  const pages = input.libraryPages ? input.libraryPages.map((n) => L.pages.find((p) => p.name === n)).filter(Boolean) : L.pages;
  for (const p of pages) facts.push(libraryPageFact(p));
  // exact names and types
  const from = target.file ?? `features/${target.feature}/pages/X.tsx`;
  const use = pages.map((p) => `import { ${p.name} } from '${relImport(from, p.file)}'`);
  const fx = L.fixtures.map((x) => `import ${x.stem} from '${relImport(from, x.file)}'`);
  facts.push(`Use exactly: ${[...use, ...fx].join('; ')}. [quickInfo; resolved from ${from}]`);
  if (refusal) facts.push(refusalFact(refusal));
  return assembleFacts(facts, input);
}

/** The ledger line that points at the refusal below it. */
export const refusalFact = (refusal) => `Your last ${refusal.repeat} attempts at ${path.posix.basename(refusal.file)} were refused with the same type error (below). [steps refused]`;

/**
 * The winning shape around a list of facts: the facts block, the one next step, the last refusal with its example
 * fix, and (with fetch tools) the read_file hint. Shared by compileFacts and the 1.5b translator (gloss.mjs glossFacts).
 * @param {string[]} facts
 * @param {{index: any, step: any, refusal?: any, fetch?: boolean, libraryPages?: string[]}} input
 */
export function assembleFacts(facts, input) {
  const { index, step, refusal } = input;
  const order = input.libraryPages ?? index.library.pages.map((p) => p.name);
  const stepLine = step.kind === 'setCode'
    ? `Current step: ${step.point} Write it in ${step.file} with plan_add line.setCode (the whole file, contentHash ${step.contentHash}).`
    : `Current step: ${step.feature} has no page yet (its spec puts one at ${step.route}). Create it with plan_add line.baseOn {"libraryId": "pages/<${order.join('|')}>", "feature": "${step.feature}", "name": "<Name>"} on the library page that fits these points, then add its route:\n${step.points.map((x) => `- ${x}`).join('\n')}`;
  const last = refusal ? [
    `Last result: Refused (${refusal.code}, repeated ${refusal.repeat} times): line ${refusal.line} of ${refusal.file} does not type-check: ${plainTypeError(refusal.message)}.`,
    ...(refusal.caret ? [refusal.caret] : []),
    refusal.exampleFix,
    `Rule: send line.setCode with the whole file, line ${refusal.line} changed, and contentHash ${refusal.contentHash}; the same code again is refused.`,
  ].join('\n') : null;
  const text = [['Facts so far (each with where it comes from):', ...facts.map((f) => `- ${f}`)].join('\n'), stepLine, ...(last ? [last] : []), ...(input.fetch ? ['Read a file with read_file when you need its code.'] : [])].join('\n\n');
  return { text, facts, step: stepLine, last, tokens: approxTokens(text) };
}
