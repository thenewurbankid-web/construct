// #576 / #584 (R1) -- machine-spec.v1: the checked breakdown of an English
// requirement into states, events, guarded transitions and typed functions.
//
// `validateMachineSpec(spec)` is the deterministic gate between the one fuzzy
// step (a person, a form or a model drafting the spec) and everything
// generated from it (R2: the state union, the XState machine, the typed
// function stubs and their tests). It runs two passes:
//
//   1. structure -- the shape documented in machine-spec.v1.schema.json
//      (every unknown/missing/mistyped field is SPEC-001, except a function
//      without an `input`/`output` type, which is SPEC-008 so the reason is
//      named, not buried in a schema message);
//   2. meaning -- only when the structure is sound: duplicate ids, exactly
//      one initial state, transitions to unknown states/events, ambiguous
//      duplicate transitions, states unreachable from `initial` (a graph
//      walk), `req` links to sentences that do not exist, sentences neither
//      covered by any `req` nor listed under `outOfScope` (or both), and
//      final states with a way out, and type strings that do not parse (SPEC-013) or
//      name a type nothing declares (SPEC-014, so the generated code compiles).
//
// Every failure is a violation shaped like `construct validate --format
// json`'s (`rule`, `module`, `severity`, `file`, `message`, `why`,
// `expected`) plus `path`, the dotted location inside the spec
// (`transitions[2].to`), so a Cockpit table or a model retry loop can point
// at the exact item. The result is `{ status: 'passed'|'failed', file,
// counts, violations }`.
//
// No JSON-Schema engine (ajv) at runtime, same as packages/engine/envelope.mjs
// and packages/core/plan.mjs: the schema file is the documentation of record
// and the contract handed to a drafting model; this module enforces the same
// requirements by hand and test/machineSpec.test.mjs asserts, with ajv, that
// the two stay in lockstep (the schema's `required` arrays are read directly,
// never hand-copied). That keeps @line/construct-core dependency-free and the
// bundled CLI (#525) free of runtime file lookups.

import ts from 'typescript';

export const MACHINE_SPEC_VERSION = 1;
export const MACHINE_SPEC_MODULE = 'machine-spec';

/** Every rule this validator can fire, with its one-line meaning. Stable: a
 * code is never reused for a different check. */
export const SPEC_RULES = Object.freeze({
  'SPEC-001': 'The spec does not have the machine-spec.v1 shape.',
  'SPEC-002': 'An id is used twice in the same list.',
  'SPEC-003': 'Exactly one state must be marked initial.',
  'SPEC-004': 'A transition names a state that does not exist.',
  'SPEC-005': 'A transition names an event that does not exist.',
  'SPEC-006': 'Two transitions leave the same state on the same event with the same guard.',
  'SPEC-007': 'A state cannot be reached from the initial state.',
  'SPEC-008': 'A function is missing its input or output type.',
  'SPEC-009': 'A req link points at a sentence that is not in the requirement.',
  'SPEC-010': 'A requirement sentence is neither covered by any item nor marked out of scope.',
  'SPEC-011': 'A sentence is marked out of scope but an item still claims it.',
  'SPEC-012': 'A final state has an outgoing transition.',
  'SPEC-013': 'A type string is not a valid TypeScript type.',
  'SPEC-014': 'A type string names a type that is neither built in nor declared under types.',
});

const WHY = {
  'SPEC-001': 'Only a spec with the documented shape can be turned into a machine; anything else is guesswork.',
  'SPEC-002': 'Generated code keys states, events and functions by id; a duplicate would silently overwrite the other.',
  'SPEC-003': 'The machine has to start somewhere, and in one place, or reachability cannot be decided.',
  'SPEC-004': 'The generated machine would point at a state that does not exist and never take that transition.',
  'SPEC-005': 'An event no one can send is a transition that can never happen; declare it or fix the name.',
  'SPEC-006': 'The machine cannot tell which of the two to take; the second would be dead.',
  'SPEC-007': 'A state nothing leads to is either a missing transition or a state the requirement never asked for.',
  'SPEC-008': 'Untyped functions cannot get typed stubs or tests; the type is the contract the test checks.',
  'SPEC-009': 'Traceability is only real when every link resolves; a broken link hides an uncovered sentence.',
  'SPEC-010': 'A sentence that produced nothing was either forgotten or should be declared out of scope with a reason.',
  'SPEC-011': 'A sentence is either implemented or deliberately not; claiming both means one of them is wrong.',
  'SPEC-012': 'A final state stops the machine; a transition out of it can never fire.',
  'SPEC-013': 'A type that does not parse cannot become a typed stub, an event payload or a test.',
  'SPEC-014': 'A name nothing declares would fail tsc in the generated code; declare it under "types" or write its shape inline.',
};

// ---- structural shape (mirrors machine-spec.v1.schema.json) -----------------

const ID_RE = /^\S(.*\S)?$/;
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Field kinds the structural pass understands; each maps to one schema definition. */
const KIND_CHECK = {
  id: (v) => typeof v === 'string' && ID_RE.test(v),
  text: (v) => typeof v === 'string' && v.length > 0,
  string: (v) => typeof v === 'string',
  boolean: (v) => typeof v === 'boolean',
  typeString: (v) => typeof v === 'string' && /\S/.test(v),
  identifier: (v) => typeof v === 'string' && IDENT_RE.test(v),
  req: (v) => Array.isArray(v) && v.length > 0 && v.every((s) => KIND_CHECK.id(s)) && new Set(v).size === v.length,
};
const KIND_EXPECTED = {
  id: 'a non-empty string without leading or trailing whitespace',
  text: 'a non-empty string',
  string: 'a string',
  boolean: 'true or false',
  typeString: 'a TypeScript type as a non-empty string (e.g. "void", "Promise<Session | null>")',
  identifier: 'a valid TypeScript identifier',
  req: 'a non-empty array of distinct sentence ids',
};

/** The per-item field tables. Exported so the test can assert them against the
 * schema's own `required` and `properties` keys. */
export const ITEM_SHAPES = Object.freeze({
  sentence: { required: { id: 'id', text: 'text' }, optional: {} },
  outOfScopeEntry: { required: { req: 'id', reason: 'text' }, optional: {} },
  state: { required: { id: 'id', req: 'req' }, optional: { initial: 'boolean', final: 'boolean', description: 'string' } },
  event: { required: { id: 'id', req: 'req' }, optional: { payload: 'typeString', description: 'string' } },
  typeDecl: { required: { name: 'identifier', definition: 'typeString' }, optional: { description: 'string' } },
  transition: { required: { from: 'id', to: 'id', event: 'id', req: 'req' }, optional: { id: 'id', guard: 'id', description: 'string' } },
  function: {
    required: { name: 'identifier', input: 'typeString', output: 'typeString', precondition: 'text', postcondition: 'text', req: 'req' },
    optional: { description: 'string' },
  },
});

/** Top-level lists and the item shape each holds, in schema order. */
export const LIST_FIELDS = Object.freeze({
  requirement: { shape: 'sentence', minItems: 1 },
  outOfScope: { shape: 'outOfScopeEntry', minItems: 0 },
  states: { shape: 'state', minItems: 1 },
  events: { shape: 'event', minItems: 0 },
  transitions: { shape: 'transition', minItems: 0 },
  functions: { shape: 'function', minItems: 0 },
  types: { shape: 'typeDecl', minItems: 0 },
});
export const TOP_LEVEL_REQUIRED = Object.freeze(['version', 'name', 'requirement', 'states', 'events', 'transitions', 'functions']);
export const TOP_LEVEL_FIELDS = Object.freeze(['version', 'name', 'feature', 'requirement', 'outOfScope', 'states', 'events', 'transitions', 'functions', 'types', 'ext']);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

class Report {
  constructor(file) {
    this.file = file;
    this.violations = [];
  }

  add(rule, at, message, expected = []) {
    this.violations.push({ rule, module: MACHINE_SPEC_MODULE, severity: 'error', file: this.file, path: at, message, why: WHY[rule], expected });
  }

  has(rule) {
    return this.violations.some((v) => v.rule === rule);
  }
}

function checkItem(report, item, at, shapeName) {
  const shape = ITEM_SHAPES[shapeName];
  if (!isPlainObject(item)) {
    report.add('SPEC-001', at, `${at} must be an object.`, [`an object with ${Object.keys(shape.required).join(', ')}`]);
    return;
  }
  const known = { ...shape.required, ...shape.optional };
  for (const key of Object.keys(item)) {
    if (!(key in known)) report.add('SPEC-001', `${at}.${key}`, `Unknown field "${key}" on a ${shapeName}.`, Object.keys(known));
  }
  for (const [key, kind] of Object.entries(known)) {
    const required = key in shape.required;
    const present = key in item;
    if (!present && !required) continue;
    const ok = present && KIND_CHECK[kind](item[key]);
    if (ok) continue;
    const typeSlot = shapeName === 'function' && (key === 'input' || key === 'output');
    const rule = typeSlot ? 'SPEC-008' : 'SPEC-001';
    const label = shapeName === 'function' ? item.name : item.id;
    const who = typeof label === 'string' && label && key !== 'name' && key !== 'id' ? ` (${shapeName} "${label}")` : '';
    const message = present
      ? `"${key}" must be ${KIND_EXPECTED[kind]}${who}; got ${JSON.stringify(item[key])}.`
      : `Missing required field "${key}"${who}.`;
    report.add(rule, `${at}.${key}`, message, [KIND_EXPECTED[kind]]);
  }
}

function checkStructure(report, spec) {
  if (!isPlainObject(spec)) {
    report.add('SPEC-001', '', 'Spec must be a JSON object.', ['a machine-spec.v1 object']);
    return;
  }
  for (const key of Object.keys(spec)) {
    if (!TOP_LEVEL_FIELDS.includes(key)) report.add('SPEC-001', key, `Unknown top-level field "${key}".`, [...TOP_LEVEL_FIELDS]);
  }
  for (const key of TOP_LEVEL_REQUIRED) {
    if (!(key in spec)) report.add('SPEC-001', key, `Missing required field "${key}".`, [key]);
  }
  if ('version' in spec && spec.version !== MACHINE_SPEC_VERSION) {
    report.add('SPEC-001', 'version', `"version" must be ${MACHINE_SPEC_VERSION} (got ${JSON.stringify(spec.version)}).`, [String(MACHINE_SPEC_VERSION)]);
  }
  if ('name' in spec && !KIND_CHECK.text(spec.name)) report.add('SPEC-001', 'name', '"name" must be a non-empty string.', [KIND_EXPECTED.text]);
  if ('feature' in spec && !KIND_CHECK.text(spec.feature)) report.add('SPEC-001', 'feature', '"feature" must be a non-empty string.', [KIND_EXPECTED.text]);
  if ('ext' in spec && !isPlainObject(spec.ext)) report.add('SPEC-001', 'ext', '"ext" must be an object (free-form, ignored by validators).', ['an object']);
  for (const [field, { shape, minItems }] of Object.entries(LIST_FIELDS)) {
    if (!(field in spec)) continue;
    const list = spec[field];
    if (!Array.isArray(list)) {
      report.add('SPEC-001', field, `"${field}" must be an array of ${shape} objects.`, [`an array of ${shape} objects`]);
      continue;
    }
    if (list.length < minItems) report.add('SPEC-001', field, `"${field}" must have at least ${minItems} item(s).`, [`${minItems}+ ${shape} object(s)`]);
    list.forEach((item, i) => checkItem(report, item, `${field}[${i}]`, shape));
  }
}

// ---- meaning ------------------------------------------------------------------

function checkDuplicates(report, field, list, key, label) {
  const seen = new Map();
  list.forEach((item, i) => {
    const id = item[key];
    if (id === undefined) return;
    if (seen.has(id)) report.add('SPEC-002', `${field}[${i}].${key}`, `${label} "${id}" is declared twice (first at ${field}[${seen.get(id)}]).`, ['a unique id']);
    else seen.set(id, i);
  });
}

function checkMeaning(report, spec) {
  const { requirement, states, events, transitions, functions } = spec;
  const outOfScope = spec.outOfScope ?? [];

  checkDuplicates(report, 'requirement', requirement, 'id', 'Sentence');
  checkDuplicates(report, 'states', states, 'id', 'State');
  checkDuplicates(report, 'events', events, 'id', 'Event');
  checkDuplicates(report, 'transitions', transitions, 'id', 'Transition');
  checkDuplicates(report, 'functions', functions, 'name', 'Function');
  checkDuplicates(report, 'outOfScope', outOfScope, 'req', 'Out-of-scope sentence');
  checkDuplicates(report, 'types', spec.types ?? [], 'name', 'Type');

  const stateIds = states.map((s) => s.id);
  const stateSet = new Set(stateIds);
  const eventIds = events.map((e) => e.id);
  const eventSet = new Set(eventIds);
  const finalSet = new Set(states.filter((s) => s.final === true).map((s) => s.id));

  const initials = states.map((s, i) => ({ s, i })).filter(({ s }) => s.initial === true);
  if (initials.length === 0) report.add('SPEC-003', 'states', 'No state is marked initial.', ['exactly one state with "initial": true']);
  else if (initials.length > 1) {
    report.add('SPEC-003', 'states', `${initials.length} states are marked initial: ${initials.map(({ s }) => `"${s.id}"`).join(', ')}.`, ['exactly one state with "initial": true']);
  }

  const seenEdges = new Map();
  transitions.forEach((t, i) => {
    const at = `transitions[${i}]`;
    for (const end of ['from', 'to']) {
      if (!stateSet.has(t[end])) report.add('SPEC-004', `${at}.${end}`, `Transition ${describeTransition(t)} names unknown state "${t[end]}" as "${end}".`, stateIds);
    }
    if (!eventSet.has(t.event)) report.add('SPEC-005', `${at}.event`, `Transition ${describeTransition(t)} names unknown event "${t.event}".`, eventIds);
    const edge = JSON.stringify([t.from, t.event, t.guard ?? null]);
    if (seenEdges.has(edge)) {
      const guard = t.guard ? ` with guard "${t.guard}"` : ' without a guard';
      report.add('SPEC-006', at, `Transition ${describeTransition(t)} duplicates transitions[${seenEdges.get(edge)}]: same "from" and "event"${guard}.`, ['a different guard, or one transition']);
    } else seenEdges.set(edge, i);
    if (finalSet.has(t.from)) {
      report.add('SPEC-012', `${at}.from`, `Transition ${describeTransition(t)} leaves final state "${t.from}".`, ['no transitions out of a final state, or "final": false']);
    }
  });

  if (initials.length === 1) {
    const reachable = new Set([initials[0].s.id]);
    const queue = [initials[0].s.id];
    while (queue.length) {
      const from = queue.shift();
      for (const t of transitions) {
        if (t.from === from && stateSet.has(t.to) && !reachable.has(t.to)) {
          reachable.add(t.to);
          queue.push(t.to);
        }
      }
    }
    states.forEach((s, i) => {
      if (!reachable.has(s.id)) report.add('SPEC-007', `states[${i}]`, `State "${s.id}" cannot be reached from the initial state "${initials[0].s.id}".`, ['a transition into it from a reachable state']);
    });
  }

  const sentenceIds = new Set(requirement.map((s) => s.id));
  const covered = new Map();
  const claim = (field, i, item, label) => {
    for (const [j, r] of item.req.entries()) {
      if (!sentenceIds.has(r)) report.add('SPEC-009', `${field}[${i}].req[${j}]`, `${label} "${item.name ?? item.id ?? describeTransition(item)}" links to unknown sentence "${r}".`, [...sentenceIds]);
      else if (!covered.has(r)) covered.set(r, `${field}[${i}]`);
    }
  };
  states.forEach((s, i) => claim('states', i, s, 'State'));
  events.forEach((e, i) => claim('events', i, e, 'Event'));
  transitions.forEach((t, i) => claim('transitions', i, t, 'Transition'));
  functions.forEach((f, i) => claim('functions', i, f, 'Function'));

  const excluded = new Set();
  outOfScope.forEach((o, i) => {
    if (!sentenceIds.has(o.req)) report.add('SPEC-009', `outOfScope[${i}].req`, `outOfScope links to unknown sentence "${o.req}".`, [...sentenceIds]);
    else {
      excluded.add(o.req);
      if (covered.has(o.req)) report.add('SPEC-011', `outOfScope[${i}]`, `Sentence "${o.req}" is out of scope but ${covered.get(o.req)} claims it.`, ['remove the outOfScope entry, or the req link']);
    }
  });
  requirement.forEach((s, i) => {
    if (!covered.has(s.id) && !excluded.has(s.id)) {
      report.add('SPEC-010', `requirement[${i}]`, `Sentence "${s.id}" (${quote(s.text)}) is not covered by any state, event, transition or function, and is not listed under outOfScope.`, ['a req link from some item', 'an outOfScope entry with a reason']);
    }
  });

  checkTypeStrings(report, spec);

  return { sentences: requirement.length, covered: covered.size, outOfScope: excluded.size, states: states.length, events: events.length, transitions: transitions.length, functions: functions.length };
}

// ---- type strings (SPEC-013, SPEC-014) -------------------------------------------

/** The global types a type string may name without declaring them: the utility types and the small
 * set of platform classes a UI function realistically takes or returns. A closed list on purpose --
 * a name outside it (and outside `types`) would not compile in the generated project, so it is
 * refused now, with the fix named, instead of failing later in tsc. */
export const BUILT_IN_TYPES = Object.freeze([
  'Array', 'ReadonlyArray', 'Record', 'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'Exclude', 'Extract',
  'NonNullable', 'Awaited', 'ReturnType', 'Parameters', 'InstanceType', 'Promise', 'PromiseLike', 'Map', 'Set',
  'ReadonlyMap', 'ReadonlySet', 'WeakMap', 'WeakSet', 'Date', 'Error', 'RegExp', 'URL', 'URLSearchParams',
  'File', 'Blob', 'FormData', 'Headers', 'Request', 'Response', 'AbortSignal', 'ArrayBuffer', 'Uint8Array',
  'Iterable', 'AsyncIterable', 'Uppercase', 'Lowercase', 'Capitalize', 'Uncapitalize',
]);

/** Parse a type string; exported so the generator asks the same question the validator did. Returns `{ error }` when it is not a valid TypeScript type, else `{ names }`, the
 * root identifier of every type reference in it (`A.B` counts as `A`), in first-seen order. */
export function typeReferences(typeStr) {
  const source = `type T = ${typeStr};`;
  const { diagnostics } = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.Latest } });
  if (diagnostics?.length) return { error: ts.flattenDiagnosticMessageText(diagnostics[0].messageText, ' ') };
  const sf = ts.createSourceFile('t.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const alias = sf.statements[0];
  if (sf.statements.length !== 1 || !alias || !ts.isTypeAliasDeclaration(alias)) return { error: 'not a single type expression' };
  const names = new Set();
  const root = (n) => (ts.isIdentifier(n) ? n.text : root(n.left));
  const walk = (node) => {
    if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node)) {
      names.add(ts.isTypeReferenceNode(node) ? root(node.typeName) : root(node.expression));
    }
    ts.forEachChild(node, walk);
  };
  walk(alias.type);
  return { names: [...names] };
}

/** Names of the declared `types`, and for each function/event/type the type strings to check. */
function checkTypeStrings(report, spec) {
  const declared = (spec.types ?? []).map((t) => t.name);
  const known = new Set([...BUILT_IN_TYPES, ...declared]);
  const slots = [];
  (spec.types ?? []).forEach((t, i) => slots.push([`types[${i}].definition`, t.definition, `Type "${t.name}"`]));
  spec.events.forEach((e, i) => { if (e.payload !== undefined) slots.push([`events[${i}].payload`, e.payload, `Event "${e.id}"`]); });
  spec.functions.forEach((f, i) => {
    slots.push([`functions[${i}].input`, f.input, `Function "${f.name}" input`]);
    slots.push([`functions[${i}].output`, f.output, `Function "${f.name}" output`]);
  });
  for (const [at, typeStr, label] of slots) {
    if (!KIND_CHECK.typeString(typeStr)) continue; // missing or blank: already reported (SPEC-008 / SPEC-001), not a second time
    const found = typeReferences(typeStr);
    if (found.error) {
      report.add('SPEC-013', at, `${label} is not a valid TypeScript type: ${JSON.stringify(typeStr)} (${found.error}).`, ['a TypeScript type, e.g. "{ id: string }" or "Promise<void>"']);
      continue;
    }
    for (const name of found.names) {
      if (!known.has(name)) {
        report.add('SPEC-014', at, `${label} names the type "${name}", which is not built in and not declared under "types".`, [`a { "name": "${name}", "definition": "..." } entry under types`, 'the shape written inline']);
      }
    }
  }
}

function describeTransition(t) {
  return `${t.id ? `"${t.id}" ` : ''}${JSON.stringify(t.from)} --${JSON.stringify(t.event)}${t.guard ? ` [${t.guard}]` : ''}--> ${JSON.stringify(t.to)}`;
}

function quote(text) {
  const s = String(text);
  return JSON.stringify(s.length > 60 ? `${s.slice(0, 57)}...` : s);
}

/**
 * Check a parsed machine-spec.v1 object: structure first, then meaning (only when the structure is sound).
 * Never throws for a bad spec; every problem comes back as a violation so the drafting side (a person or
 * a model retry loop) sees all of them at once.
 *
 * @param {any} spec The parsed spec (any JSON value; non-objects fail with SPEC-001).
 * @param {{file?: string}} [options] `file` is only echoed into each violation and the result.
 * @returns {{status: 'passed'|'failed', file: string, counts: object|null, violations: object[]}}
 *   `counts` is null when the structure was too broken to measure.
 *
 * @example
 * const r = validateMachineSpec(JSON.parse(fs.readFileSync('spec.json', 'utf8')), { file: 'spec.json' });
 * if (r.status === 'failed') console.log(r.violations.map((v) => `${v.rule} at ${v.path}: ${v.message}`));
 */
export function validateMachineSpec(spec, { file = '<spec>' } = {}) {
  const report = new Report(file);
  checkStructure(report, spec);
  const counts = report.has('SPEC-001') ? null : checkMeaning(report, spec);
  return { status: report.violations.length ? 'failed' : 'passed', file, counts, violations: report.violations };
}

/**
 * Render a validation result as text (one block per violation, `construct validate` style) or as the
 * result's JSON.
 *
 * @param {{status: string, file: string, counts: object|null, violations: object[]}} result From `validateMachineSpec`.
 * @param {{format?: 'text'|'json'}} [options]
 * @returns {string}
 */
export function renderMachineSpecReport(result, { format = 'text' } = {}) {
  if (format === 'json') return JSON.stringify(result, null, 2);
  if (result.status === 'passed') {
    const c = result.counts;
    return `✓ machine-spec.v1 ${result.file} passed — ${c.sentences} sentence(s): ${c.covered} covered, ${c.outOfScope} out of scope; ${c.states} state(s), ${c.events} event(s), ${c.transitions} transition(s), ${c.functions} function(s)`;
  }
  const blocks = result.violations.map((v) => {
    const lines = [`❌ ${v.rule} [${v.module}]`, `  ${v.file}${v.path ? ` at ${v.path}` : ''}`, `  ${v.message}`, `  Why: ${v.why}`];
    if (v.expected?.length) lines.push(`  Expected: ${v.expected.join(' or ')}`);
    return lines.join('\n');
  });
  blocks.push(`${result.violations.length} problem(s) in ${result.file} — fix them and run again; nothing is generated from a spec that fails.`);
  return blocks.join('\n\n');
}
