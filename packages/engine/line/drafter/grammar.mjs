// Constrained-output grammar for a future local model (owner 2026-10-11): generated from the plan registry (tool names,
// argument names and types) and Line's expression language (its named checks), so a model's output always parses, names only real tools and
// holds only slots (never a project's names). Two forms of the same grammar:
//   grammar/route.schema.json   JSON Schema of one drafted route {intent, steps, expect} (Ollama `format`, Ajv)
//   grammar/route.gbnf          GBNF of the same (llama.cpp --grammar-file)
// A model never drafts all routes (the enumerator does); it fills one route or a hole in one, under this grammar.
//   node packages/engine/line/drafter/grammar.mjs --write   regenerate both files (a test checks they are current)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXPR_CHECKS } from '../contract.mjs';

/** A string that is a slot ref, optionally after a kind prefix: "<F1>", "<C1.file>", "components/<C1.name>". */
export const SLOT_STRING = '^((components|pages|workflows|fixtures|expressions)/)?<[A-Z][0-9]{1,3}(\\.[a-zA-Z][a-zA-Z0-9]{0,15})?>$';
/** A feature item id in slot form: an item slot ("<C1>") or "<F1>/<kind>/<N1>". */
export const ITEM_STRING = '^(<[A-Z][0-9]{1,3}>/(components|pages|workflows|fixtures|expressions)/)?<[A-Z][0-9]{1,3}(\\.[a-zA-Z][a-zA-Z0-9]{0,15})?>$';
const KINDS = ['components', 'pages', 'workflows', 'fixtures', 'expressions'];

/**
 * The expressions a drafted route may hold: Line's named checks (../contract.mjs EXPR_CHECKS) in the argument shapes
 * the drafter writes them (slot refs only), plus and / or / not. A list of types is a fixed-length tuple.
 */
export const EXPR_ARGS = Object.freeze({
  hasItem: 'item', hasLibrary: 'slot', basedOn: ['item', 'slot'], fileExists: 'slot', fileContains: ['slot', 'slot'],
  propIs: { file: 'slot', nodeId: 'slot', prop: 'slot', value: 'scalar' }, noNewFindings: 'true', noFinding: { key: 'slot' },
  and: 'exprs', or: 'exprs', not: 'expr',
});
for (const op of Object.keys(EXPR_ARGS)) if (!['and', 'or', 'not'].includes(op) && !Object.hasOwn(EXPR_CHECKS, op)) throw new Error(`${op} is not a named check of Line's expression language`);

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
  /** @type {Record<string, string>} */
  const out = {};
  for (const f of fields) {
    const passes = probes.filter((p) => ok({ ...base, [f]: p }));
    if (passes.includes(1) && passes.includes(true) && passes.includes('x')) out[f] = 'scalar';
    else if (passes.includes('x')) out[f] = 'slot';
    else out[f] = `enum:${passes.filter((p) => typeof p === 'string').join('|')}`;
    const { [f]: _drop, ...without } = /** @type {any} */ (base);
    if (ok(without)) out[f] += '?';
  }
  return out;
}

const slotSchema = { type: 'string', pattern: SLOT_STRING };
const itemSchema = { type: 'string', pattern: ITEM_STRING };
const typeSchema = (t0) => { const t = t0.replace(/[?]$/, ''); return (t === 'slot' ? slotSchema : t === 'item' ? itemSchema : t === 'kind' ? { enum: KINDS } : t === 'true' ? { const: true } : t === 'scalar' ? { anyOf: [slotSchema, { type: 'number' }, { type: 'boolean' }] } : { enum: t.slice(5).split('|') }); };

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
  const exprs = Object.entries(EXPR_ARGS).map(([op, a]) => {
    const value = a === 'exprs' ? { type: 'array', minItems: 1, items: { $ref: '#/$defs/expr' } } : a === 'expr' ? { $ref: '#/$defs/expr' }
      : typeof a === 'string' ? typeSchema(a)
        : Array.isArray(a) ? { type: 'array', minItems: a.length, maxItems: a.length, prefixItems: a.map(typeSchema), items: false }
          : { type: 'object', additionalProperties: false, required: Object.keys(a), properties: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeSchema(v)])) };
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
    if (s.pattern === ITEM_STRING) return 'itemstr';
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
  // Bounded like the schema (maxItems), so a small model cannot loop forever inside a list.
  rules.push(`steps ::= "[" ws step ( ws "," ws step ){0,${schema.properties.steps.maxItems - 1}} ws "]"`);
  const exprNames = schema.$defs.expr.oneOf.map((e) => {
    const [op] = Object.keys(e.properties);
    const v = e.properties[op];
    const name = `expr-${ruleName(op)}`;
    const body = v.$ref ? 'expr' : v.type === 'array' && v.prefixItems ? `"[" ws ${v.prefixItems.map(valueRule).join(' ws "," ws ')} ws "]"` : v.type === 'array' ? 'exprs' : v.type === 'object' ? obj(Object.entries(v.properties).map(([k, x]) => field(k, valueRule(x)))) : valueRule(v);
    rules.push(`${name} ::= ${obj([field(op, body)])}`);
    return name;
  });
  rules.push(`expr ::= ${exprNames.join(' | ')}`);
  rules.push(`exprs ::= "[" ws expr ( ws "," ws expr ){0,${schema.properties.expect.maxItems - 1}} ws "]"`);
  // Bounded everywhere (a kind prefix from the closed list, short slot ids and fields), so decoding always ends.
  rules.push(`slotstr ::= "\\"" ( ( ${KINDS.map((k) => `"${k}"`).join(' | ')} ) "/" )? "<" [A-Z] [0-9]{1,3} ( "." [a-zA-Z] [a-zA-Z0-9]{0,15} )? ">" "\\""`);
  rules.push(`itemstr ::= "\\"" ( "<" [A-Z] [0-9]{1,3} ">" "/" ( ${KINDS.map((k) => `"${k}"`).join(' | ')} ) "/" )? "<" [A-Z] [0-9]{1,3} ( "." [a-zA-Z] [a-zA-Z0-9]{0,15} )? ">" "\\""`);
  rules.push('scalar ::= slotstr | "-"? [0-9]{1,9} ( "." [0-9]{1,6} )? | "true" | "false"');
  rules.push('ws ::= [ \\t\\n]{0,8}');
  return `# Generated by packages/engine/line/drafter/grammar.mjs from the plan registry and the expression language; do not edit.\n${rules.join('\n')}\n`;
}

/**
 * Both grammar files' contents for the Line registry (the default tools of planTools.mjs).
 * @returns {Promise<{schema: string, gbnf: string}>}
 */
export async function generateGrammar() {
  const { createLinePlanRegistry } = await import('../planTools.mjs');
  const { buildIntentCatalog } = await import('./contract.mjs');
  // Every line.* tool of the one registry (ci2's line.import.fix included), not the construct.* commands.
  const tools = createLinePlanRegistry({ root: '.' }).list().filter((t) => t.name.startsWith('line.'));
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
