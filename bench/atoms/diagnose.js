// Why a rewrite was taken back, and what to change so it is not taken back again.
//
//   const diagnose = createDiagnoser({ compiled, sandbox })
//   diagnose(site, evidence) -> { cause, why, fix, probe? }
//   diagnose.alone(atom, form) -> is the form right on its own? (see alone below)
//
// The check (bench/atoms/checked.js) says which rewrite changed behaviour. To say why,
// the atom's own catalog form is run with nothing around it: `function probe(a, b) {
// return a === b; }` against the same function converted by the same transform. Three
// times: every argument of the type the atom declares for it (Smith's own type names
// resolved), then the first argument of any kind, then every argument of any kind.
// Where that differs, the atom is also called directly, its arguments placed by the
// catalog's parameter names and not by the transform, to tell the two apart.
//
//   atom       the form alone already differs on the declared kinds: the catalog claims a
//              form the atom does not do. Fix the catalog entry or the atom.
//   mutation   as above, and the difference is a value left changed by one side only:
//              the built-in changes what it is given, the atom does not (or the reverse).
//   kind       the form alone agrees on the declared types and differs on others: the
//              atom is right, this place gives it a kind of value it is not for, in the
//              first argument (the one the transform looks at) or in another.
//   transform  the form alone agrees on everything, or differs only when the transform
//              writes the call and not when the atom is called directly: the difference
//              comes from how the rewrite was put together. Fix atoms-transform.js.
//   unknown    the form could not be run alone (a statement rewrite, several rewrites
//              that only differ together, a probe no input gets through).
const fs = require('fs');
const path = require('path');
const { toAtoms } = require('../../atoms-transform');
const { typesOfSource } = require('./equivalence');

const KIND_TYPES = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  list: 'unknown[]',
  set: 'Set<unknown>',
  map: 'Map<unknown, unknown>',
  date: 'Date',
  function: '() => unknown',
  'text-or-list': 'string | unknown[]',
  collection: 'Set<unknown> | Map<unknown, unknown>',
};

const tick = (s) => `\`${s}\``;

// The type names the runtime declares (Lazy<T>, Visit<T, R>, SortOrder<T> ...), generic ones
// included: a probe argument typed with one is generated as what the name stands for.
function typesOfRuntime(dir) {
  const env = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
        for (const [name, node] of typesOfSource(fs.readFileSync(full, 'utf8'), { generic: true })) if (!env.has(name)) env.set(name, node);
      }
    }
  };
  walk(path.join(dir, 'src'));
  return env;
}

// The decision alone, from what the probes and the original evidence show.
//   declared: every argument of its declared type; open: the first of any kind;
//   loose: every argument of any kind. Each null (not run) or
//   { status, exercised, mismatches, direct? }, where direct is the same probe with the
//   atom called directly, or null where it cannot be.
// `from` in the answer says which probe the input shown comes from.
function classifyCause({ atom, form, kinds = ['any'], evidence = null, declared = null, open = null, loose = null }) {
  const differs = (r) => r && r.status === 'different';
  const blind = (r) => !r || r.status === 'not-runnable' || (r.status === 'same' && !r.exercised);
  // a write to a value only one side makes is a mutation too, whichever way it showed
  const writes = (m) => m.differs === 'arguments afterwards'
    || (m.differs === 'trace' && /^(set|delete) /.test(m.original.traceAt || '') !== /^(set|delete) /.test(m.converted.traceAt || ''));
  const seen = (r) => {
    const m = r.mismatches.find(writes) || r.mismatches[0];
    return { differs: m.differs, mutation: writes(m), input: m.input, original: m.original.out, converted: m.converted.out };
  };

  const from = differs(declared) ? 'declared' : differs(open) ? 'open' : differs(loose) ? 'loose' : null;
  const faulty = { declared, open, loose }[from];
  if (faulty && faulty.direct && faulty.direct.status === 'same' && faulty.direct.exercised) {
    const { mutation, ...shown } = seen(faulty);
    return {
      cause: 'transform',
      why: `${atom} called directly does what ${tick(form)} does; the call the transform writes for it does not`,
      fix: 'a fault in atoms-transform.js for this form: the probe shown is the test case',
      shown,
      from,
    };
  }
  if (from === 'declared' || (from && !declared)) {
    const { mutation, ...shown } = seen(faulty);
    if (mutation) {
      return {
        cause: 'mutation',
        why: `${tick(form)} and ${atom} leave their arguments different: one changes the value it is given, the other returns a changed copy`,
        fix: `mark the catalog entry for ${atom} as replacing a mutation (replacesMutation), or take ${tick(form)} out of its forms`,
        shown,
        from,
      };
    }
    const threw = (s) => /^(throws|rejects)/.test(s);
    const how = threw(shown.original) && !threw(shown.converted) ? `${atom} accepts a value ${tick(form)} fails on`
      : !threw(shown.original) && threw(shown.converted) ? `${atom} fails on a value ${tick(form)} accepts`
        : shown.differs === 'trace' ? `${atom} makes other calls to the value than ${tick(form)} does`
          : `${atom} gives another result than ${tick(form)}`;
    return {
      cause: 'atom',
      why: `${how}, with every argument of the type it declares and nothing else around it`,
      fix: `take ${tick(form)} out of the catalog forms of ${atom}, or change ${atom} in the runtime to match it; the input shown is the test case`,
      shown,
      from,
    };
  }
  if (from === 'open') {
    return {
      cause: 'kind',
      why: `${atom} does what ${tick(form)} does for ${kinds.join(' or ')}, and not for the other kinds of value this place can receive`,
      fix: `do not let the transform choose ${atom} where the kind is not known: give this place a type, or list it as ambiguous so the check decides`,
      shown: (({ mutation, ...rest }) => rest)(seen(open)),
      from,
    };
  }
  if (from === 'loose') {
    return {
      cause: 'kind',
      why: `${atom} does what ${tick(form)} does when every argument is of the type it declares; here an argument after the first can be of another kind, and the transform only looks at the first`,
      fix: `give this place types, or have the transform check the kinds of ${atom}'s other arguments too`,
      shown: (({ mutation, ...rest }) => rest)(seen(loose)),
      from,
    };
  }
  if ([declared, open, loose].every(blind)) {
    const r = loose || open || declared;
    return {
      cause: 'unknown',
      why: r && r.status === 'not-runnable' ? `${tick(form)} could not be run on its own: ${r.why}` : `no input got through ${tick(form)} on its own, so it shows nothing`,
      fix: 'compare the two versions by hand on the input shown',
    };
  }
  const where = !evidence ? 'the rewrite differs only in this place'
    : evidence.differs === 'trace' ? 'the calls to the outside come in another order or number, so something is evaluated early, late or twice'
      : evidence.differs === 'arguments afterwards' ? 'an argument is left changed that the original leaves alone, or the reverse'
        : 'the values reach the atom wrongly: another order, one missing, or `this` lost';
  return {
    cause: 'transform',
    why: `${atom} does what ${tick(form)} does on its own; here ${where}`,
    fix: 'a fault in atoms-transform.js for this shape: add the source as a test case there',
  };
}

function createDiagnoser({ compiled, sandbox, types = new Map(), runs = 40 }) {
  const atomKinds = Object.fromEntries([...compiled.atoms].map(([name, info]) => [name, info.firstKinds || ['any']]));
  const memo = new Map();

  // the form by itself, converted by the transform to the atom in question;
  // typeOf(placeholder) -> the TS type it is written with
  function probe(p, typeOf) {
    const code = `function probe(${p.placeholders.map((n) => `${n}: ${typeOf(n)}`).join(', ')}) { return ${p.form}; }`;
    let out;
    try {
      out = toAtoms(code, { catalog: compiled, kind: 'function' });
      const open = out.ambiguous.find((a) => a.alternatives.includes(p.atom));
      if (open) out = toAtoms(code, { catalog: compiled, kind: 'function', choices: { [open.id]: p.atom } });
    } catch (e) {
      return { status: 'not-runnable', why: `transform threw: ${e.message}` };
    }
    if (!out.sites.some((s) => s.atom === p.atom)) return { status: 'not-runnable', why: `the transform does not rewrite it to ${p.atom} on its own` };
    const res = sandbox.checkPair({ original: code, converted: out.body, importDecl: out.importDecl, types, runs, atomKinds });
    if (res.status !== 'different') return { code, ...res };
    const args = directArgs(p);
    const direct = args && sandbox.checkPair({
      original: code,
      converted: code.replace(/\{ return .*; \}$/, () => `{ return __atom(${args.join(', ')}); }`),
      importDecl: `import { ${p.atom} as __atom } from 'smith';`,
      types,
      runs,
    });
    return { code, written: out.body.replace(/\s+/g, ' ').trim(), ...res, direct: direct || null };
  }

  // the atom's arguments as the catalog names them: each placeholder goes to the parameter
  // of the same name, or by position where the form uses other names
  function directArgs(p) {
    const params = p.info.params;
    if (p.vars.length || (params && params.some((q) => q.rest))) return null;
    const named = params && p.placeholders.every((nm) => params.some((q) => q.name === nm));
    const order = named ? params.map((q) => q.name) : [...p.placeholders];
    while (order.length && !p.placeholders.includes(order[order.length - 1])) order.pop();
    return order.map((nm) => (!p.placeholders.includes(nm) ? 'undefined' : p.lazy.has(nm) ? `() => ${nm}` : nm));
  }

  function forPattern(p) {
    const kinds = p.info.firstKinds || ['any'];
    const params = p.info.params || [];
    const first = params.length && p.placeholders.includes(params[0].name) ? params[0].name : p.placeholders[0];
    // the type the atom declares for a placeholder; for the first without one, its kinds
    const fromKinds = kinds.includes('any') || kinds.some((k) => !KIND_TYPES[k]) ? 'unknown' : kinds.map((k) => KIND_TYPES[k]).join(' | ');
    const declaredType = (n) => {
      const q = params.find((x) => x.name === n);
      return q && q.type ? q.type : n === first ? fromKinds : 'unknown';
    };
    const declared = probe(p, declaredType);
    const open = declaredType(first) === 'unknown' ? null : probe(p, (n) => (n === first ? 'unknown' : declaredType(n)));
    const typedLater = p.placeholders.some((n) => n !== first && declaredType(n) !== 'unknown');
    const loose = typedLater ? probe(p, () => 'unknown') : null;
    return { kinds, declared, open, loose };
  }

  // every catalog form of this atom with this shape, each run alone (memoised: the
  // diagnosis and the sweep below ask for the same forms)
  function triedFor(atom, form) {
    const key = `${atom}:${form}`;
    if (!memo.has(key)) memo.set(key, compiled.patterns.filter((p) => p.atom === atom && p.key === form && !p.constant).map((p) => ({ p, ...forPattern(p) })));
    return memo.get(key);
  }

  // The form alone with every argument of its declared type, whether or not the function
  // around it was the same: later code can hide a wrong atom (a `trimmed` that only trims
  // the start passes every corpus function). Differing here is the atom's fault, or the
  // call the transform writes, never the place's.
  //   -> { status: 'same' } | { status: 'unchecked', why } | { status: 'different', cause, why, fix, probe }
  function alone(atom, form) {
    const tried = triedFor(atom, form);
    const bad = tried.find((x) => x.declared.status === 'different');
    if (bad) {
      const { shown, from, ...verdict } = classifyCause({ atom, form: bad.p.form, kinds: bad.kinds, declared: bad.declared });
      return { status: 'different', ...verdict, probe: { code: bad.declared.code, ...shown } };
    }
    if (tried.some((x) => x.declared.status === 'same' && x.declared.exercised)) return { status: 'same' };
    const r = tried[0] && tried[0].declared;
    return { status: 'unchecked', why: !r ? `${atom} has no catalog form of the shape ${form}` : r.status === 'not-runnable' ? r.why : 'no input got through it on its own' };
  }

  function diagnose(site, evidence) {
    if (!site || !site.atom) {
      return {
        cause: 'unknown',
        why: site ? `a ${site.form} rewrite is built by the transform, not taken from one catalog form, so it cannot be run on its own` : 'no single rewrite accounts for the difference: at least two only differ together',
        fix: 'compare the two versions by hand on the input shown',
      };
    }
    // several forms of one atom can share a shape: the one that differs is the one to report
    const tried = triedFor(site.atom, site.form);
    const hit = tried.find((x) => [x.declared, x.open, x.loose].some((r) => r && r.status === 'different')) || tried[0] || null;
    if (!hit) return { cause: 'unknown', why: `${site.atom} has no catalog form of the shape ${site.form} to run on its own`, fix: 'compare the two versions by hand on the input shown' };
    const { shown, from, ...verdict } = classifyCause({ atom: site.atom, form: hit.p.form, kinds: hit.kinds, evidence, declared: hit.declared, open: hit.open, loose: hit.loose });
    const ran = from && hit[from];
    return shown ? { ...verdict, probe: { code: ran.code, ...(verdict.cause === 'transform' ? { written: ran.written } : {}), ...shown } } : verdict;
  }

  return Object.assign(diagnose, { alone });
}

module.exports = { createDiagnoser, classifyCause, typesOfRuntime };
