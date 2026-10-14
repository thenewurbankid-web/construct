// Why a rewrite was taken back, and what to change so it is not taken back again.
//
//   const diagnose = createDiagnoser({ compiled, sandbox })
//   diagnose(site, evidence) -> { cause, why, fix, probe? }
//
// The check (bench/atoms/checked.js) says which rewrite changed behaviour. To say why,
// the atom's own catalog form is run with nothing around it: `function probe(a, b) {
// return a === b; }` against the same function converted by the same transform. Twice:
// once with the first value of the kinds the atom is declared for, once with any value.
// Where that differs, the atom is also called directly, its arguments placed by the
// catalog's parameter names and not by the transform, to tell the two apart.
//
//   atom       the form alone already differs on the declared kinds: the catalog claims a
//              form the atom does not do. Fix the catalog entry or the atom.
//   mutation   as above, and the difference is a value left changed by one side only:
//              the built-in changes what it is given, the atom does not (or the reverse).
//   kind       the form alone agrees on the declared kinds and differs on others: the
//              atom is right, this place gives it a kind of value it is not for.
//   transform  the form alone agrees on everything, or differs only when the transform
//              writes the call and not when the atom is called directly: the difference
//              comes from how the rewrite was put together. Fix atoms-transform.js.
//   unknown    the form could not be run alone (a statement rewrite, several rewrites
//              that only differ together, a probe no input gets through).
const { toAtoms } = require('../../atoms-transform');

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

// The decision alone, from what the two probes and the original evidence show.
//   declared / open: null (not run) or { status, exercised, mismatches, direct? }
//   direct: the same probe with the atom called directly, or null where it cannot be
function classifyCause({ atom, form, kinds = ['any'], evidence = null, declared = null, open = null }) {
  const differs = (r) => r && r.status === 'different';
  const blind = (r) => !r || r.status === 'not-runnable' || (r.status === 'same' && !r.exercised);
  // a write to a value only one side makes is a mutation too, whichever way it showed
  const writes = (m) => m.differs === 'arguments afterwards'
    || (m.differs === 'trace' && /^(set|delete) /.test(m.original.traceAt || '') !== /^(set|delete) /.test(m.converted.traceAt || ''));
  const seen = (r) => {
    const m = r.mismatches.find(writes) || r.mismatches[0];
    return { differs: m.differs, mutation: writes(m), input: m.input, original: m.original.out, converted: m.converted.out };
  };

  const faulty = differs(declared) ? declared : differs(open) ? open : null;
  if (faulty && faulty.direct && faulty.direct.status === 'same' && faulty.direct.exercised) {
    const { mutation, ...shown } = seen(faulty);
    return {
      cause: 'transform',
      why: `${atom} called directly does what ${tick(form)} does; the call the transform writes for it does not`,
      fix: 'a fault in atoms-transform.js for this form: the probe shown is the test case',
      shown,
    };
  }
  if (differs(declared) || (differs(open) && !declared)) {
    const { mutation, ...shown } = seen(differs(declared) ? declared : open);
    if (mutation) {
      return {
        cause: 'mutation',
        why: `${tick(form)} and ${atom} leave their arguments different: one changes the value it is given, the other returns a changed copy`,
        fix: `mark the catalog entry for ${atom} as replacing a mutation (replacesMutation), or take ${tick(form)} out of its forms`,
        shown,
      };
    }
    const threw = (s) => /^(throws|rejects)/.test(s);
    const how = threw(shown.original) && !threw(shown.converted) ? `${atom} accepts a value ${tick(form)} fails on`
      : !threw(shown.original) && threw(shown.converted) ? `${atom} fails on a value ${tick(form)} accepts`
        : shown.differs === 'trace' ? `${atom} makes other calls to the value than ${tick(form)} does`
          : `${atom} gives another result than ${tick(form)}`;
    return {
      cause: 'atom',
      why: `${how}, with nothing else around it`,
      fix: `take ${tick(form)} out of the catalog forms of ${atom}, or change ${atom} in the runtime to match it; the input shown is the test case`,
      shown,
    };
  }
  if (differs(open)) {
    return {
      cause: 'kind',
      why: `${atom} does what ${tick(form)} does for ${kinds.join(' or ')}, and not for the other kinds of value this place can receive`,
      fix: `do not let the transform choose ${atom} where the kind is not known: give this place a type, or list it as ambiguous so the check decides`,
      shown: (({ mutation, ...rest }) => rest)(seen(open)),
    };
  }
  if (blind(declared) && blind(open)) {
    const r = open || declared;
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

function createDiagnoser({ compiled, sandbox, runs = 40 }) {
  const atomKinds = Object.fromEntries([...compiled.atoms].map(([name, info]) => [name, info.firstKinds || ['any']]));
  const memo = new Map();

  // the form by itself, converted by the transform to the atom in question
  function probe(p, firstType) {
    const params = p.info.params;
    const first = params && params.length && p.placeholders.includes(params[0].name) ? params[0].name : p.placeholders[0];
    const code = `function probe(${p.placeholders.map((n) => `${n}: ${n === first ? firstType : 'unknown'}`).join(', ')}) { return ${p.form}; }`;
    let out;
    try {
      out = toAtoms(code, { catalog: compiled, kind: 'function' });
      const open = out.ambiguous.find((a) => a.alternatives.includes(p.atom));
      if (open) out = toAtoms(code, { catalog: compiled, kind: 'function', choices: { [open.id]: p.atom } });
    } catch (e) {
      return { status: 'not-runnable', why: `transform threw: ${e.message}` };
    }
    if (!out.sites.some((s) => s.atom === p.atom)) return { status: 'not-runnable', why: `the transform does not rewrite it to ${p.atom} on its own` };
    const res = sandbox.checkPair({ original: code, converted: out.body, importDecl: out.importDecl, runs, atomKinds });
    if (res.status !== 'different') return { code, ...res };
    const args = directArgs(p);
    const direct = args && sandbox.checkPair({
      original: code,
      converted: code.replace(/\{ return .*; \}$/, () => `{ return __atom(${args.join(', ')}); }`),
      importDecl: `import { ${p.atom} as __atom } from 'smith';`,
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
    const types = kinds.map((k) => KIND_TYPES[k]);
    const declared = kinds.includes('any') || types.some((x) => !x) ? null : probe(p, types.join(' | '));
    const open = probe(p, 'unknown');
    return { kinds, declared, open };
  }

  return function diagnose(site, evidence) {
    if (!site || !site.atom) {
      return {
        cause: 'unknown',
        why: site ? `a ${site.form} rewrite is built by the transform, not taken from one catalog form, so it cannot be run on its own` : 'no single rewrite accounts for the difference: at least two only differ together',
        fix: 'compare the two versions by hand on the input shown',
      };
    }
    const key = `${site.atom}:${site.form}`;
    if (!memo.has(key)) {
      const patterns = compiled.patterns.filter((p) => p.atom === site.atom && p.key === site.form && !p.constant);
      // several forms of one atom can share a shape: the one that differs is the one to report
      const tried = patterns.map((p) => ({ p, ...forPattern(p) }));
      memo.set(key, tried.find((x) => [x.declared, x.open].some((r) => r && r.status === 'different')) || tried[0] || null);
    }
    const hit = memo.get(key);
    if (!hit) return { cause: 'unknown', why: `${site.atom} has no catalog form of the shape ${site.form} to run on its own`, fix: 'compare the two versions by hand on the input shown' };
    const { shown, ...verdict } = classifyCause({ atom: site.atom, form: hit.p.form, kinds: hit.kinds, evidence, declared: hit.declared, open: hit.open });
    const ran = shown && (hit.declared && hit.declared.status === 'different' ? hit.declared : hit.open);
    return shown ? { ...verdict, probe: { code: ran.code, ...(verdict.cause === 'transform' ? { written: ran.written } : {}), ...shown } } : verdict;
  };
}

module.exports = { createDiagnoser, classifyCause };
