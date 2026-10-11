// Constrained-output grammar for a future local model (owner 2026-10-11): generated from the plan registry (tool names,
// argument names and types) and the expression language, so a model's output always parses, names only real tools and
// holds only slots (never a project's names). Two forms of the same grammar:
//   grammar/route.schema.json   JSON Schema of one drafted route {intent, steps, expect} (Ollama `format`, Ajv)
//   grammar/route.gbnf          GBNF of the same (llama.cpp --grammar-file)
// A model never drafts all routes (the enumerator does); it fills one route or a hole in one, under this grammar.
//   node packages/engine/line/drafter/grammar.mjs --write   regenerate both files (a test checks they are current)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXPR_OPS } from './contract.mjs';

/** A string that is a slot ref, optionally after a kind prefix: "<F1>", "<C1.file>", "components/<C1.name>". */
export const SLOT_STRING = '^([a-z]+/)?<[A-Z][0-9]+(\\.[a-zA-Z][a-zA-Z0-9]*)?>$';
const KINDS = ['components', 'pages', 'workflows', 'fixtures'];

/** Argument shapes of the expression ops (MIRROR of the expression contract; replace on merge). */
export const EXPR_ARGS = Object.freeze({
  fileExists: 'slot', libraryHas: 'slot', findingGone: 'slot', noNewFindings: 'true',
  fileContains: { path: 'slot', text: 'slot' },
  itemExists: { feature: 'slot', kind: 'kind', name: 'slot' },
  itemBasedOn: { feature: 'slot', kind: 'kind', name: 'slot', libraryId: 'slot' },
  propIs: { file: 'slot', nodeId: 'slot', prop: 'slot', value: 'scalar' },
});

/**
 * The argument types of one registry tool, found by probing its schema with sample values (the registry exposes
 * `fields` and `safeParse`, not types): 'slot' (a non-empty string), 'enum:<a|b>' or 'scalar'; a field the schema
 * accepts without is marked optional ('?' suffix).
 * @param {{fields?: string[], safeParse: (v: unknown) => {success: boolean}}} schema
 * @returns {Record<string, string>}
 */
export function probeArgTypes(schema) {
  const fields = schema.fields ?? [];
  const probes = ['x', 1, true, 'string', 'number', 'boolean', 'expression'];
  const ok = (args) => schema.safeParse(args).success;
  // A base that parses: the first combination of probes (fields are few).
  let base = null;
  const walk = (i, acc) => {
    if (base) return;
    if (i === fields.length) { if (ok(acc)) base = { ...acc }; return; }
    for (const p of probes) walk(i + 1, { ...acc, [fields[i]]: p });
  };
  walk(0, {});
  if (!base) return Object.fromEntries(fields.map((f) => [f, 'slot']));
  const out = {};
  for (const f of fields) {
    const passes = probes.filter((p) => ok({ ...base, [f]: p }));
    if (passes.includes(1) && passes.includes(true) && passes.includes('x')) out[f] = 'scalar';
    else if (passes.includes('x')) out[f] = 'slot';
    else out[f] = `enum:${passes.filter((p) => typeof p === 'string').join('|')}`;
    const { [f]: _drop, ...without } = base;
    if (ok(without)) out[f] += '?';
  }
  return out;
}

const slotSchema = { type: 'string', pattern: SLOT_STRING };
const typeSchema = (t0) => { const t = t0.replace(/[?]$/, ''); return (t === 'slot' ? slotSchema : t === 'kind' ? { enum: KINDS } : t === 'true' ? { const: true } : t === 'scalar' ? { anyOf: [slotSchema, { type: 'number' }, { type: 'boolean' }] } : { enum: t.slice(5).split('|') }); };

/**
 * The JSON Schema of one drafted route, from the registry's change tools, the intent catalog and the expression ops.
 * @param {{name: string, kind: string, schema: any}[]} tools  registry.list() (write tools are the ones a route may call)
 * @param {string[]} intents  Catalog ids that have a template.
 * @returns {object}
 */
export function routeSchema(tools, intents) {
  const steps = tools.filter((t) => t.kind === 'write' && t.name !== 'line.leaveAsIs').map((t) => {
    const types = probeArgTypes(t.schema);
    return {
      type: 'object', additionalProperties: false, required: ['tool', 'args'],
      properties: { tool: { const: t.name }, args: { type: 'object', additionalProperties: false, required: Object.keys(types).filter((k) => !types[k].endsWith('?')), properties: Object.fromEntries(Object.entries(types).map(([k, v]) => [k, typeSchema(v)])) } },
    };
  });
  const exprs = Object.keys(EXPR_OPS).map((op) => {
    const a = EXPR_ARGS[op];
    const value = op === 'all' || op === 'any' ? { type: 'array', minItems: 1, items: { $ref: '#/$defs/expr' } } : op === 'not' ? { $ref: '#/$defs/expr' } : typeof a === 'string' ? typeSchema(a) : { type: 'object', additionalProperties: false, required: Object.keys(a), properties: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeSchema(v)])) };
    return { type: 'object', additionalProperties: false, required: [op], properties: { [op]: value } };
  });
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://line.dev/schemas/drafter-route.json',
    title: 'One drafted Line route (slot form)',
    description: 'Generated by packages/engine/line/drafter/grammar.mjs from the plan registry and the expression language; do not edit.',
    type: 'object', additionalProperties: false, required: ['intent', 'steps', 'expect'],
    properties: {
      intent: { enum: [...intents].sort() },
      steps: { type: 'array', minItems: 1, maxItems: 10, items: { oneOf: steps } },
      expect: { type: 'array', minItems: 1, maxItems: 12, items: { $ref: '#/$defs/expr' } },
    },
    $defs: { expr: { oneOf: exprs } },
  };
}

const lit = (s) => JSON.stringify(JSON.stringify(s));
const ruleName = (s) => s.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();

/**
 * The GBNF form of a route schema (fixed key order, no extra whitespace inside strings).
 * @param {any} schema  routeSchema(...)
 * @returns {string}
 */
export function routeGbnf(schema) {
  const rules = [];
  const field = (k, v) => `${lit(k)} ws ":" ws ${v}`;
  const obj = (pairs) => (pairs.length ? `"{" ws ${pairs.join(' ws "," ws ')} ws "}"` : '"{" ws "}"');
  const valueRule = (s) => {
    if (s.pattern) return 'slotstr';
    if (s.enum) return `( ${s.enum.map(lit).join(' | ')} )`;
    if (s.const !== undefined) return lit(s.const);
    if (s.anyOf) return 'scalar';
    return 'slotstr';
  };
  rules.push(`root ::= ${obj([field('intent', 'intent'), field('steps', 'steps'), field('expect', 'exprs')])}`);
  rules.push(`intent ::= ${schema.properties.intent.enum.map(lit).join(' | ')}`);
  const stepNames = schema.properties.steps.items.oneOf.map((st) => {
    const name = `step-${ruleName(st.properties.tool.const)}`;
    // Optional arguments are left out of the GBNF: a drafted step never needs them.
    const args = Object.entries(st.properties.args.properties).filter(([k]) => st.properties.args.required.includes(k)).map(([k, v]) => field(k, valueRule(v)));
    rules.push(`${name} ::= ${obj([field('tool', lit(st.properties.tool.const)), field('args', obj(args))])}`);
    return name;
  });
  rules.push(`step ::= ${stepNames.join(' | ')}`);
  rules.push('steps ::= "[" ws step ( ws "," ws step )* ws "]"');
  const exprNames = schema.$defs.expr.oneOf.map((e) => {
    const [op] = Object.keys(e.properties);
    const v = e.properties[op];
    const name = `expr-${ruleName(op)}`;
    const body = v.$ref ? 'expr' : v.type === 'array' ? 'exprs' : v.type === 'object' ? obj(Object.entries(v.properties).map(([k, x]) => field(k, valueRule(x)))) : valueRule(v);
    rules.push(`${name} ::= ${obj([field(op, body)])}`);
    return name;
  });
  rules.push(`expr ::= ${exprNames.join(' | ')}`);
  rules.push('exprs ::= "[" ws expr ( ws "," ws expr )* ws "]"');
  rules.push('slotstr ::= "\\"" ( [a-z]+ "/" )? "<" [A-Z] [0-9]+ ( "." [a-zA-Z] [a-zA-Z0-9]* )? ">" "\\""');
  rules.push('scalar ::= slotstr | "-"? [0-9]+ ( "." [0-9]+ )? | "true" | "false"');
  rules.push('ws ::= [ \\t\\n]*');
  return `# Generated by packages/engine/line/drafter/grammar.mjs from the plan registry and the expression language; do not edit.\n${rules.join('\n')}\n`;
}

/**
 * Both grammar files' contents for the Line registry (the default tools of planTools.mjs).
 * @returns {Promise<{schema: string, gbnf: string}>}
 */
export async function generateGrammar() {
  const { lineTools } = await import('../planTools.mjs');
  const { buildIntentCatalog } = await import('./contract.mjs');
  const tools = lineTools({ root: '.' });
  const intents = buildIntentCatalog(tools.map((t) => t.name)).filter((e) => e.templates.length).map((e) => e.id);
  const schema = routeSchema(tools, intents);
  return { schema: `${JSON.stringify(schema, null, 2)}\n`, gbnf: routeGbnf(schema) };
}

export const GRAMMAR_FILES = Object.freeze({ schema: new URL('./grammar/route.schema.json', import.meta.url), gbnf: new URL('./grammar/route.gbnf', import.meta.url) });

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes('--write')) {
  const g = await generateGrammar();
  fs.mkdirSync(new URL('./grammar/', import.meta.url), { recursive: true });
  fs.writeFileSync(GRAMMAR_FILES.schema, g.schema);
  fs.writeFileSync(GRAMMAR_FILES.gbnf, g.gbnf);
  console.log('wrote packages/engine/line/drafter/grammar/route.schema.json and route.gbnf');
}
