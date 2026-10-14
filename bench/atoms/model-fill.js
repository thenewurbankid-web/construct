// A small local model rewrites what the transform leaves untranslated; the checks decide
// what stays (training-data/MODEL-GAPS.md, step 3). Nothing here writes to the dataset.
//
//   fillFunction(fn, { model, converter, compiled, atoms, checker, types, runs, seed })
//     -> { status: 'accepted' | 'rejected' | 'nothing to fill', why?, before, after?, code? }
//
// The model gets the function as the transform left it, the parts still untranslated with
// the transform's reason, and a short list of atoms that could cover them (atoms whose JS
// form uses the same method or operator, plus the atoms already used). It answers with the
// whole function. Its answer is kept only when every constraint holds, checked in order:
//   parses        it is one function of the same kind, with the same parameters
//   names         every function it calls is a catalog atom or a name the original uses
//   fewer gaps    toAtoms over the answer leaves fewer untranslated parts (not counting
//                 syntax untranslated by design) than over the original
//   same          the equivalence check against the ORIGINAL is `same`, with the checker's
//                 parameter types, and at least half the runs exercised
//   reached       every atom call the model wrote that was not in what it was given ran with
//                 a real value of the kind the atom is declared for: `same` says nothing about
//                 code no input gets to. Those calls are imported under their own name
//                 (`plus as plus__new`) so they are counted apart from the rest.
//
// CLI: node bench/atoms/model-fill.js [--model qwen2.5-coder:1.5b] [--runs 40]
//   runs every corpus function the dataset drops as `untranslated`;
//   writes bench/results/model-fill-<model>.json
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const { toAtoms } = require('../../atoms-transform');
const { BY_DESIGN } = require('./dataset');

const PARSE_OPTS = { sourceType: 'module', plugins: ['typescript', 'jsx'] };
const LOOPS = new Set(['ForStatement', 'ForOfStatement', 'ForInStatement', 'WhileStatement', 'DoWhileStatement']);
const byDesign = (u) => BY_DESIGN.includes(u.type) || (LOOPS.has(u.type) && /\bbreak\b/.test(u.reason || ''));
const gaps = (out) => out.untranslated.filter((u) => !byDesign(u));

function parseFunction(code, kind) {
  const wrapped = kind === 'method' ? `class __W__ {\n${code}\n}` : code;
  const ast = parser.parse(wrapped, PARSE_OPTS);
  const first = ast.program.body[0];
  const fn = kind === 'method' ? first && first.body.body[0] : first && first.type === 'ExportNamedDeclaration' ? first.declaration : first;
  if (!fn || !fn.params || ast.program.body.length !== 1) throw new Error('not one function');
  return { ast, fn };
}

// every name called as a plain function: `when(...)`, not `x.when(...)`
function calledNames(ast) {
  const names = new Set();
  const walk = (n) => {
    if (!n || typeof n.type !== 'string') return;
    if ((n.type === 'CallExpression' || n.type === 'NewExpression') && n.callee.type === 'Identifier') names.add(n.callee.name);
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'start' || k === 'end') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === 'string') walk(v);
    }
  };
  walk(ast.program);
  return names;
}

// atom calls in `code` that `isNew(text)` says the model wrote: the callee's offsets in the
// wrapped source (a method is wrapped in a class to parse)
function newCalls(code, kind, compiled, known, isNew) {
  const wrapped = kind === 'method' ? `class __W__ {\n${code}\n}` : code;
  const ast = parser.parse(wrapped, PARSE_OPTS);
  const sites = [];
  const walk = (n) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && compiled.atoms.has(n.callee.name) && !known.has(n.callee.name) && isNew(wrapped.slice(n.start, n.end))) {
      sites.push({ atom: n.callee.name, start: n.callee.start, end: n.callee.end });
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'start' || k === 'end') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === 'string') walk(v);
    }
  };
  walk(ast.program);
  return { wrapped, sites };
}

const identifiersIn = (code) => new Set(code.match(/[A-Za-z_$][\w$]*/g) || []);

// atoms whose JS form uses the method or operator of a gap, for the prompt
function shortlist(gapList, atoms, used, max = 24) {
  const keys = new Set();
  for (const g of gapList) {
    const m = /\.(\w+)\(\)/.exec(g.form) || /^\w+Expression (\S+)/.exec(g.form);
    if (m) keys.add(m[1]);
    if (/IfStatement/.test(g.type)) ['if', '?'].forEach((k) => keys.add(k));
    if (LOOPS.has(g.type)) ['for', 'while'].forEach((k) => keys.add(k));
  }
  const hit = (a) => (a.js || []).some((form) => [...keys].some((k) => (/^\w+$/.test(k) ? new RegExp(`\\b${k}\\b`).test(form) : form.includes(k))));
  const picked = atoms.filter((a) => used.has(a.atom) || hit(a));
  return picked.slice(0, max);
}

function promptFor({ code, gapList, list }) {
  return `Rewrite this TypeScript function using the atom functions listed below.
Atoms are plain functions; they never change their arguments. Keep the same name and parameters
and keep exactly what the function does. Do not define helpers. Answer with only the function in
one \`\`\`ts block.

\`\`\`ts
${code}
\`\`\`

Parts still to rewrite:
${gapList.map((g) => `- \`${g.source.replace(/\s+/g, ' ').slice(0, 100)}\` (${g.form}${g.reason ? `: ${g.reason}` : ''})`).join('\n')}

Atoms you may use (name(params) - what it reads as - the JS it replaces):
${list.map((a) => `- ${a.atom}(${a.params.join(', ')}) - ${a.reads || ''} - ${(a.js || []).join(' | ')}`).join('\n')}`;
}

async function ask({ model, prompt, url = 'http://localhost:11434/api/generate' }) {
  const res = await fetch(url, { method: 'POST', body: JSON.stringify({ model, prompt, stream: false, think: false, options: { temperature: 0, num_ctx: 8192 } }) }).then((x) => x.json());
  if (res.error) throw new Error(res.error);
  const text = res.response || '';
  const m = /```(?:ts|typescript|js|javascript)?\n([\s\S]*?)```/.exec(text);
  return (m ? m[1] : text).trim();
}

// ask: the model call, replaceable (tests pass canned answers)
async function fillFunction(fn, { model, converter, compiled, atoms, checker, types, runs = 40, seed = 1, ask: askModel = ask }) {
  const paramTypes = checker.paramTypes(fn.file, fn.code);
  const res = converter.convert(fn.code, { kind: fn.kind, types, runs, seed, paramTypes });
  const before = gaps(res).map((g) => ({ ...g, source: fn.code.slice(g.start, g.end) }));
  if (!before.length) return { status: 'nothing to fill' };
  const used = new Set(Object.keys(res.atoms));
  const list = shortlist(before, atoms, used).map((a) => ({ ...a, params: ((compiled.atoms.get(a.atom) || {}).params || []).map((p) => `${p.name}${p.optional ? '?' : ''}`) }));
  const startCode = res.converted ? `${res.body}` : fn.code;
  const reject = (why, extra = {}) => ({ status: 'rejected', why, before: before.length, ...extra });

  let answer;
  try {
    answer = await askModel({ model, prompt: promptFor({ code: startCode, gapList: before, list }) });
  } catch (e) {
    return reject(`model: ${e.message}`);
  }
  // a method answered as a function declaration is the same method
  if (fn.kind === 'method') answer = answer.replace(/^(export\s+)?(async\s+)?function\s+/, (m, ex, as) => as || '');
  // 1. parses, one function of the same kind with the same parameters
  let parsed;
  try {
    parsed = parseFunction(answer, fn.kind);
  } catch (e) {
    return reject(`parses: ${e.message.split('\n')[0]}`, { code: answer });
  }
  const paramsOf = (f) => f.params.map((p) => (p.type === 'Identifier' ? p.name : p.type)).join(',');
  if (paramsOf(parsed.fn) !== paramsOf(parseFunction(fn.code, fn.kind).fn)) return reject('parses: other parameters', { code: answer });
  // 2. calls only atoms and the original's own names
  // the original's names, and the transform's renamings in what the model was given
  const known = new Set([...identifiersIn(fn.code), ...[...identifiersIn(startCode)].filter((n) => !compiled.atoms.has(n))]);
  const invented = [...calledNames(parsed.ast)].filter((n) => !compiled.atoms.has(n) && !known.has(n));
  if (invented.length) return reject(`names: ${invented.join(', ')}`, { code: answer });
  // 3. fewer gaps than the transform leaves
  let after;
  try {
    after = toAtoms(answer, { catalog: compiled, kind: fn.kind });
  } catch (e) {
    return reject(`fewer gaps: transform threw: ${e.message}`, { code: answer });
  }
  const left = gaps(after);
  if (left.length >= before.length) return reject(`fewer gaps: ${left.length} left of ${before.length}`, { code: answer });
  // 4. behaves as the original
  const final = after.converted ? after.body : answer;
  const called = [...calledNames(parseFunction(final, fn.kind).ast)].filter((n) => compiled.atoms.has(n) && !known.has(n));
  // the model's own calls: atom calls whose text is not in what it was given
  const flat = (t) => t.replace(/\s+/g, '');
  const given = flat(startCode);
  // a call is the model's when its text occurs more often than in what it was given
  const seen = new Map();
  const occurrences = (t) => given.split(t).length - 1;
  const { wrapped, sites } = newCalls(final, fn.kind, compiled, known, (text) => {
    const t = flat(text);
    seen.set(t, (seen.get(t) || 0) + 1);
    return seen.get(t) > occurrences(t);
  });
  let marked = wrapped;
  for (const c of [...sites].sort((a, b) => b.start - a.start)) marked = `${marked.slice(0, c.start)}${c.atom}__new${marked.slice(c.end)}`;
  if (fn.kind === 'method') marked = marked.replace(/^class __W__ \{\n/, '').replace(/\n\}$/, '');
  const fresh = [...new Set(sites.map((c) => c.atom))];
  const binds = [...called.map((n) => n), ...fresh.map((n) => `${n} as ${n}__new`)];
  const importDecl = binds.length ? `import { ${binds.sort().join(', ')} } from 'smith';` : '';
  const atomKinds = Object.fromEntries(called.map((n) => [n, compiled.atoms.get(n).firstKinds || ['any']]));
  const check = converter.checkPair({ original: fn.code, converted: marked, importDecl, kind: fn.kind, types, runs, seed, paramTypes, atomKinds, countLocals: true });
  if (check.status !== 'same') return reject(`same: ${check.status}${check.why ? ` (${check.why})` : ''}`, { code: final, evidence: (check.mismatches || [])[0] || null });
  if (check.exercised * 2 < runs) return reject(`same: only ${check.exercised} of ${runs} runs exercised`, { code: final });
  // 5. every call the model wrote ran with a real value of its kind
  const stats = (n) => (check.atomCalls || {})[`${n}__new`] || { calls: 0, unknown: 0, wrongKind: 0 };
  const unreached = fresh.filter((n) => stats(n).calls - stats(n).unknown <= 0);
  if (unreached.length) return reject(`reached: no input gets to the model's ${unreached.join(', ')} with a real value`, { code: final });
  const wrong = fresh.filter((n) => stats(n).wrongKind > 0);
  if (wrong.length) return reject(`reached: the model's ${wrong.join(', ')} given a kind of value it is not for`, { code: final });
  return { status: 'accepted', added: fresh, before: before.length, after: left.length, code: final, atoms: called };
}

if (require.main === module) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
  const model = arg('--model', 'qwen2.5-coder:1.5b');
  const runs = Number(arg('--runs', 40));
  (async () => {
    const { createCheckedConverter } = require('./checked');
    const { typesOfSource } = require('./equivalence');
    const { typesOfRuntime } = require('./diagnose');
    const { snapshotRuntime, catalogFor, bundleRuntime } = require('./runtime');
    const { createCheckerTypes } = require('./checker-types');
    const { loadCorpus } = require('../corpus');
    const snap = snapshotRuntime();
    const { catalog, compiled } = catalogFor(snap.dir, snap.sha);
    const converter = await createCheckedConverter({ compiled, bundle: bundleRuntime(snap.dir), runtimeTypes: typesOfRuntime(snap.dir) });
    const checker = createCheckerTypes();
    const corpus = loadCorpus();
    const base = corpus.roots.length ? path.dirname(corpus.roots[0]) : '';
    const summary = require('../../training-data/corpus-atoms.summary.json');
    const wanted = summary.dropped.filter((d) => d.reason === 'untranslated');
    const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
    const rows = [];
    try {
      for (const d of wanted) {
        const fn = corpus.functions.find((f) => f.name === d.name && path.relative(base, f.file) === d.file && !f.jsx);
        if (!fn) continue;
        const src = (corpus.sources.find((s) => s.file === fn.file) || {}).src || '';
        const t = Date.now();
        const out = await fillFunction(fn, { model, converter, compiled, atoms: catalog.atoms || catalog, checker, types: typesOfSource(src), runs, seed: hash(fn.name) });
        rows.push({ name: d.name, file: d.file, gaps: d.detail, ms: Date.now() - t, ...out });
        console.log(`${out.status.padEnd(9)} ${d.name.padEnd(18)} ${(out.why || (out.status === 'accepted' ? `${out.before} -> ${out.after} gaps` : '')).slice(0, 90)}`);
      }
    } finally {
      converter.dispose();
    }
    const count = (s) => rows.filter((r) => r.status === s).length;
    const byWhy = rows.filter((r) => r.why).reduce((n, r) => { const k = r.why.split(':')[0]; return { ...n, [k]: (n[k] || 0) + 1 }; }, {});
    const result = { model, runs, functions: rows.length, accepted: count('accepted'), rejected: count('rejected'), rejectedAt: byWhy, rows };
    fs.writeFileSync(path.join(__dirname, '..', 'results', `model-fill-${model.replace(/[^\w.-]+/g, '_')}.json`), `${JSON.stringify(result, null, 1)}\n`);
    console.log(`\n${model}: ${result.accepted} accepted, ${result.rejected} rejected of ${rows.length}`, byWhy);
  })();
}

module.exports = { fillFunction, shortlist, promptFor, parseFunction, calledNames };
