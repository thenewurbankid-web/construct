// Convert, check, repair: toAtoms() with every result run against the original.
//
//   const converter = await createCheckedConverter({ compiled, bundle })
//   converter.convert(code, { kind, types, runs, seed, paramTypes })
//     -> { ...toAtoms result, check, rejected, decisions }
//   converter.alone(atom, form) -> the form run on its own (bench/atoms/diagnose.js)
//   converter.checkPair(...)     -> the equivalence check itself, on the same sandbox
//
// 1. Convert and run both versions (bench/atoms/equivalence.js). When they behave
//    differently, take rewrites back one at a time until they agree. Each one taken
//    back is listed in `rejected` with the input that showed the difference and what
//    each version did, and a `diagnosis` (bench/atoms/diagnose.js): whether the atom,
//    the kind of value, or the transform is at fault, and what to change.
// 2. Where several atoms fit and no type says which (`a + b` is plus or join,
//    `x.slice(1)` is a list or a text), try each one and keep the one that works:
//    the code still behaves the same, the atom actually ran, and every value it was
//    given is of the kind the atom is declared for. `decisions` lists what was tried.
//    A place the inputs never reach, or reach with both kinds, stays as it was.
//
//   checkedCorpus({ runs }) -> { summary, functions }     (CLI: node bench/atoms/checked.js)
const fs = require('fs');
const path = require('path');
const { toAtoms } = require('../../atoms-transform');
const { createSandbox, typesOfSource } = require('./equivalence');
const { createDiagnoser, typesOfRuntime } = require('./diagnose');
const { snapshotRuntime, catalogFor, bundleRuntime } = require('./runtime');

// runtimeTypes: the runtime's own type names (typesOfRuntime(dir)), for the diagnosis probes
async function createCheckedConverter({ compiled, bundle, runtimeTypes = new Map() }) {
  const sandbox = await createSandbox({ bundle });
  const atomKinds = Object.fromEntries([...compiled.atoms].map(([name, info]) => [name, info.firstKinds || ['any']]));
  const diagnose = createDiagnoser({ compiled, sandbox, types: runtimeTypes });

  function convert(code, { kind = 'function', types = new Map(), runs = 25, seed = 1, typeHint = null, paramTypes = null } = {}) {
    const skip = new Set();
    const choices = {};
    const attempt = (extraSkip, extraChoice) => {
      const out = toAtoms(code, {
        catalog: compiled,
        kind,
        typeHint,
        skip: extraSkip ? new Set([...skip, extraSkip]) : skip,
        choices: extraChoice ? { ...choices, ...extraChoice } : choices,
      });
      const res = out.converted
        ? sandbox.checkPair({ original: code, converted: out.body, importDecl: out.importDecl, kind, types, runs, seed, atomKinds, paramTypes })
        : { status: 'same', compared: 0, exercised: 0, mismatchCount: 0, atomCalls: {} };
      return { out, res };
    };

    let cur = attempt();
    const rejected = [];
    const decisions = [];
    if (cur.res.status === 'not-runnable') return { ...cur.out, check: { status: 'unchecked', why: cur.res.why }, rejected, decisions };

    // 1. take back the rewrites that change behaviour
    while (cur.res.status === 'different') {
      const sites = cur.out.sites.filter((s) => !skip.has(s.id));
      if (!sites.length) break;
      let best = null;
      for (const site of sites) {
        const tried = attempt(site.id);
        if (tried.res.status === 'not-runnable') continue;
        if (!best || tried.res.mismatchCount < best.tried.res.mismatchCount) best = { site, tried };
        if (tried.res.status === 'same') break;
      }
      // no single rewrite accounts for it and none helps: leave the function as it was
      if (!best || best.tried.res.mismatchCount >= cur.res.mismatchCount) {
        sites.forEach((s) => skip.add(s.id));
        rejected.push({ atom: null, form: 'every rewrite', why: 'no single rewrite accounts for the difference', evidence: cur.res.mismatches[0], diagnosis: diagnose(null, cur.res.mismatches[0]) });
        cur = attempt();
        break;
      }
      skip.add(best.site.id);
      rejected.push({ atom: best.site.atom, form: best.site.form, start: best.site.start, end: best.site.end, source: code.slice(best.site.start, best.site.end), evidence: cur.res.mismatches[0], diagnosis: diagnose(best.site, cur.res.mismatches[0]) });
      cur = best.tried;
    }

    // 2. where several atoms fit, try each and keep the one that works
    const settled = new Set();
    for (;;) {
      const open = cur.out.ambiguous.find((a) => !settled.has(a.id));
      if (!open) break;
      settled.add(open.id);
      const before = cur.res.atomCalls || {};
      const tried = open.alternatives.map((atom) => {
        const t = attempt(null, { [open.id]: atom });
        const now = (t.res.atomCalls || {})[atom] || { calls: 0, wrongKind: 0, unknown: 0 };
        const was = before[atom] || { calls: 0, wrongKind: 0, unknown: 0 };
        const ran = now.calls - was.calls - (now.unknown - was.unknown);
        const wrongKind = now.wrongKind - was.wrongKind;
        return { atom, t, status: t.res.status, ran, wrongKind, works: t.res.status === 'same' && ran > 0 && wrongKind === 0 };
      });
      const working = tried.filter((x) => x.works);
      const decision = { form: open.form, start: open.start, end: open.end, source: code.slice(open.start, open.end), tried: tried.map(({ atom, status, ran, wrongKind, works }) => ({ atom, status, ran, wrongKind, works })) };
      if (working.length) {
        choices[open.id] = working[0].atom;
        cur = working[0].t;
        decision.chosen = working[0].atom;
        if (working.length > 1) decision.note = 'more than one works; the first in catalog order was kept';
      } else {
        decision.chosen = null;
        decision.note = tried.every((x) => x.ran <= 0) ? 'no input reached it with a real value' : tried.some((x) => x.status === 'different') ? 'the candidates changed behaviour' : 'it receives more than one kind of value';
      }
      decisions.push(decision);
    }

    const { status, compared, exercised, mismatchCount } = cur.res;
    return { ...cur.out, check: { status, runs, compared, exercised, mismatchCount }, rejected, decisions };
  }

  return { convert, alone: diagnose.alone, checkPair: sandbox.checkPair, dispose: () => sandbox.dispose() };
}

async function checkedCorpus({ runs = 25, only = null } = {}) {
  const { loadCorpus } = require('../corpus');
  const snap = snapshotRuntime();
  const { compiled } = catalogFor(snap.dir, snap.sha);
  const converter = await createCheckedConverter({ compiled, bundle: bundleRuntime(snap.dir), runtimeTypes: typesOfRuntime(snap.dir) });
  const corpus = loadCorpus();
  // parameters typed only by their context get the checker's types (bench/atoms/checker-types.js)
  const checker = require('./checker-types').createCheckerTypes();
  const sources = new Map(corpus.sources.map((s) => [s.file, s.src]));
  const envs = new Map();
  const typesFor = (file) => {
    if (!envs.has(file)) envs.set(file, typesOfSource(sources.get(file) || ''));
    return envs.get(file);
  };
  const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
  const functions = [];
  try {
    for (const f of corpus.functions) {
      if (f.jsx || (only && !only.test(f.name))) continue;
      const plain = toAtoms(f.code, { catalog: compiled, kind: f.kind });
      const res = converter.convert(f.code, { kind: f.kind, types: typesFor(f.file), runs, seed: hash(f.name), paramTypes: checker.paramTypes(f.file, f.code) });
      functions.push({
        name: f.name,
        file: path.basename(f.file),
        status: res.check.status,
        why: res.check.why,
        convertedUnchecked: plain.converted,
        converted: res.converted,
        ambiguousBefore: plain.ambiguous.length,
        decisions: res.decisions,
        rejected: res.rejected,
        body: res.body,
      });
    }
  } finally {
    converter.dispose();
  }
  const sum = (fn) => functions.reduce((n, x) => n + fn(x), 0);
  const summary = {
    runtime: snap.sha.slice(0, 7),
    functions: functions.length,
    same: functions.filter((x) => x.status === 'same').length,
    different: functions.filter((x) => x.status === 'different').length,
    unchecked: functions.filter((x) => x.status === 'unchecked').length,
    conversionsWithoutCheck: sum((x) => x.convertedUnchecked),
    conversionsWithCheck: sum((x) => x.converted),
    rewritesTakenBack: sum((x) => x.rejected.length),
    takenBackByCause: functions.flatMap((x) => x.rejected).reduce((n, r) => ({ ...n, [r.diagnosis.cause]: (n[r.diagnosis.cause] || 0) + 1 }), {}),
    ambiguousPlaces: sum((x) => x.decisions.length),
    ambiguousResolved: sum((x) => x.decisions.filter((d) => d.chosen).length),
  };
  return { summary, functions };
}

if (require.main === module) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
  const only = arg('--only', null);
  checkedCorpus({ runs: Number(arg('--runs', 25)), only: only ? new RegExp(only) : null }).then((res) => {
    if (!only) fs.writeFileSync(arg('--out', path.join(__dirname, '..', 'results', 'atoms-checked.json')), `${JSON.stringify(res, null, 1)}\n`);
    console.log(JSON.stringify(res.summary, null, 1));
    const chosen = {};
    const left = {};
    for (const f of res.functions) {
      for (const d of f.decisions) {
        if (d.chosen) chosen[`${d.form} -> ${d.chosen}`] = (chosen[`${d.form} -> ${d.chosen}`] || 0) + 1;
        else left[`${d.form}: ${d.note}`] = (left[`${d.form}: ${d.note}`] || 0) + 1;
      }
      for (const r of f.rejected) {
        console.log(`\nTAKEN BACK in ${f.name} (${f.file}): ${r.atom || r.form}  \`${(r.source || '').replace(/\s+/g, ' ').slice(0, 80)}\``);
        if (r.evidence) console.log(`  input ${r.evidence.input.slice(0, 120)}\n  original  ${r.evidence.original.out.slice(0, 120)}\n  converted ${r.evidence.converted.out.slice(0, 120)}`);
        console.log(`  cause     ${r.diagnosis.cause}: ${r.diagnosis.why}\n  fix       ${r.diagnosis.fix}`);
        if (r.diagnosis.probe) console.log(`  alone     ${r.diagnosis.probe.code}\n            input ${r.diagnosis.probe.input.slice(0, 100)}: ${r.diagnosis.probe.original.slice(0, 60)} / ${r.diagnosis.probe.converted.slice(0, 60)}`);
      }
    }
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${String(n).padStart(3)}  ${k}`).join('\n');
    console.log(`\nresolved by trying each:\n${top(chosen)}\n\nleft as they were:\n${top(left)}`);
  });
}

module.exports = { createCheckedConverter, checkedCorpus };
