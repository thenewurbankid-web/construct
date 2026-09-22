// Ticket 7.3 -- JSON state graph -> XState v5 workflow AST generator.
//
// Compiles a plain JSON state-machine descriptor into a strongly typed
// XState v5 `setup({...}).createMachine({...})` file, entirely
// deterministically (no LLM). The dynamic, arbitrary-shaped parts of the
// output -- the context interface's members, the event union type, the
// runtime context default-value object, and the recursive `states` object
// (including guarded and array-form transitions) -- are built as real
// TypeScript compiler API AST nodes (`ts.factory`) and printed via
// `ts.createPrinter()`, per the epic's reconciliation notes: this is
// genuine AST *synthesis* from arbitrary input, the class of work the
// compiler API is for (not ts-morph, not a templating library). The
// never-varying wrapper around it (the `import { setup } from 'xstate'`
// line, the `setup(...).createMachine(...)` call shape, the exported
// const) stays a plain template string, matching src/generators.mjs's own
// style for boilerplate that needs no real synthesis.
import path from 'node:path';
import { ts, printNode as print } from '../../packages/ast/index.mjs';
import { loadConfig } from '../../src/config.mjs';
import { write } from '../../src/fs.mjs';
import { selfCheck, pascalCase } from '../../src/generators.mjs';
import { ConstructError, EXIT_CODES } from '../../src/diagnostics.mjs';

const { factory } = ts;
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
function usageError(message) {
  return new ConstructError(message, { exitCode: EXIT_CODES.USAGE_ERROR });
}

function propName(key) {
  return IDENT_RE.test(key) ? factory.createIdentifier(key) : factory.createStringLiteral(key);
}

/** Parse a standalone TS type string (e.g. "number", "string | null") into
 * a real ts.TypeNode via the compiler API's own parser -- so a hand-authored
 * type string in the descriptor prints back out exactly as valid TS,
 * whatever its shape, instead of being pasted in as unchecked text. */
function parseTypeString(typeStr) {
  const sf = ts.createSourceFile('t.ts', `type T = ${typeStr};`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const alias = sf.statements.find((s) => ts.isTypeAliasDeclaration(s));
  if (!alias) throw usageError(`Invalid TypeScript type string in context field: "${typeStr}"`);
  return alias.type;
}

function jsValueToLiteral(v) {
  if (v === null) return factory.createNull();
  if (typeof v === 'string') return factory.createStringLiteral(v);
  if (typeof v === 'boolean') return v ? factory.createTrue() : factory.createFalse();
  if (typeof v === 'number') {
    return v < 0
      ? factory.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, factory.createNumericLiteral(Math.abs(v)))
      : factory.createNumericLiteral(v);
  }
  if (Array.isArray(v)) return factory.createArrayLiteralExpression(v.map(jsValueToLiteral), false);
  if (typeof v === 'object') {
    return factory.createObjectLiteralExpression(
      Object.entries(v).map(([k, val]) => factory.createPropertyAssignment(propName(k), jsValueToLiteral(val))),
      false,
    );
  }
  throw usageError(`Unsupported context default value: ${JSON.stringify(v)}`);
}

// ---- descriptor validation --------------------------------------------

/** Throws a clear, actionable ConstructError for a malformed descriptor
 * rather than letting a cryptic factory-API TypeError surface instead. */
function validateDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw usageError('Workflow descriptor must be a JSON object.');
  }
  if (!descriptor.states || typeof descriptor.states !== 'object' || !Object.keys(descriptor.states).length) {
    throw usageError('Workflow descriptor must declare a non-empty "states" object.');
  }
  if (typeof descriptor.initial !== 'string' || !descriptor.initial) {
    throw usageError('Workflow descriptor must declare an "initial" state name.');
  }
  if (!(descriptor.initial in descriptor.states)) {
    throw usageError(`Workflow descriptor's "initial" state "${descriptor.initial}" is not one of its declared states: ${Object.keys(descriptor.states).join(', ')}.`);
  }
  if (descriptor.context !== undefined && (typeof descriptor.context !== 'object' || Array.isArray(descriptor.context))) {
    throw usageError('Workflow descriptor\'s "context" (if given) must be an object mapping field name -> {type, default}.');
  }
}

// ---- event extraction ---------------------------------------------------

/** Normalize a single `on.EVENT` transition value to `{target, guard?}` --
 * accepts a bare target string (shorthand) or the full object form. */
function normalizeTransition(t) {
  if (typeof t === 'string') return { target: t };
  if (!t || typeof t !== 'object' || typeof t.target !== 'string') {
    throw usageError(`Invalid transition target: ${JSON.stringify(t)} (expected a state-name string, or an object with a "target" string).`);
  }
  return t.guard ? { target: t.target, guard: t.guard } : { target: t.target };
}

/** Every distinct event name referenced across all states' `on` maps, in
 * first-appearance order (Object.entries preserves insertion order). */
export function extractEventNames(statesJson) {
  const seen = new Set();
  for (const state of Object.values(statesJson)) {
    for (const eventName of Object.keys(state.on || {})) seen.add(eventName);
  }
  return [...seen];
}

/** Shape `events` (a list of event name strings) into the Context Envelope
 * (schemas/envelope.v1.json) `events: [{type, payload}]` array, for
 * downstream consumers such as Ticket 7.4's controller binder. */
export function eventsToEnvelope(eventNames) {
  return eventNames.map((type) => ({ type, payload: {} }));
}

// ---- AST synthesis (the data-shaped, arbitrary-depth parts) -------------

function buildTransitionValue(transition) {
  const t = normalizeTransition(transition);
  if (t.guard) {
    return factory.createObjectLiteralExpression(
      [
        factory.createPropertyAssignment('target', factory.createStringLiteral(t.target)),
        factory.createPropertyAssignment('guard', factory.createStringLiteral(t.guard)),
      ],
      false,
    );
  }
  return factory.createStringLiteral(t.target);
}

function buildOnValue(transitionOrArray) {
  if (Array.isArray(transitionOrArray)) {
    return factory.createArrayLiteralExpression(transitionOrArray.map(buildTransitionValue), true);
  }
  return buildTransitionValue(transitionOrArray);
}

/** Recursively builds one state's object literal: `{ type?: 'final', on?: {...} }`. */
function buildStateLiteral(stateJson) {
  const props = [];
  if (stateJson.type === 'final') props.push(factory.createPropertyAssignment('type', factory.createStringLiteral('final')));
  const onEntries = Object.entries(stateJson.on || {});
  if (onEntries.length) {
    props.push(
      factory.createPropertyAssignment(
        'on',
        factory.createObjectLiteralExpression(
          onEntries.map(([eventName, transition]) => factory.createPropertyAssignment(propName(eventName), buildOnValue(transition))),
          true,
        ),
      ),
    );
  }
  return factory.createObjectLiteralExpression(props, true);
}

function buildStatesObjectLiteral(statesJson) {
  return factory.createObjectLiteralExpression(
    Object.entries(statesJson).map(([name, def]) => factory.createPropertyAssignment(propName(name), buildStateLiteral(def))),
    true,
  );
}

function buildContextInterfaceMembers(contextJson) {
  return Object.entries(contextJson).map(([field, def]) =>
    factory.createPropertySignature(undefined, propName(field), undefined, parseTypeString(def.type)),
  );
}

function buildContextDefaultsLiteral(contextJson) {
  return factory.createObjectLiteralExpression(
    Object.entries(contextJson).map(([field, def]) => factory.createPropertyAssignment(propName(field), jsValueToLiteral(def.default))),
    false,
  );
}

function buildEventUnionType(eventNames) {
  const members = eventNames.map((name) =>
    factory.createTypeLiteralNode([
      factory.createPropertySignature(undefined, factory.createIdentifier('type'), undefined, factory.createLiteralTypeNode(factory.createStringLiteral(name))),
    ]),
  );
  // A machine with no events at all still needs a valid (if unusable) event type.
  return members.length ? factory.createUnionTypeNode(members) : factory.createTypeLiteralNode([]);
}

/**
 * Compile a JSON state-graph descriptor into an XState v5 workflow source
 * file. Pure -- no filesystem access.
 *
 * @param {object} descriptor - `{id?, initial, context?: {field: {type, default}}, states: {...}}`.
 * @param {{name: string}} opts - `name` is the already-capitalized layer base name (e.g. "Checkout").
 * @returns {{source: string, events: string[], contextFields: string[]}}
 */
export function compileWorkflow(descriptor, { name }) {
  validateDescriptor(descriptor);
  const contextJson = descriptor.context || {};
  const events = extractEventNames(descriptor.states);
  const contextFields = Object.keys(contextJson);

  const contextTypeName = `${name}Context`;
  const eventTypeName = `${name}Event`;

  const contextInterfaceText = contextFields.length
    ? print(factory.createInterfaceDeclaration(
        [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
        contextTypeName,
        undefined,
        undefined,
        buildContextInterfaceMembers(contextJson),
      ))
    : `export type ${contextTypeName} = Record<string, never>;`;

  const eventUnionText = print(
    factory.createTypeAliasDeclaration(
      [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      eventTypeName,
      undefined,
      buildEventUnionType(events),
    ),
  );

  const statesText = print(buildStatesObjectLiteral(descriptor.states));
  const contextDefaultsText = contextFields.length ? print(buildContextDefaultsLiteral(contextJson)) : null;
  const machineId = descriptor.id || name.toLowerCase();

  const source = [
    `import { setup } from 'xstate';`,
    '',
    contextInterfaceText,
    '',
    eventUnionText,
    '',
    `export const ${name}Workflow = setup({`,
    `  types: {} as {`,
    `    context: ${contextTypeName};`,
    `    events: ${eventTypeName};`,
    `  },`,
    `}).createMachine({`,
    `  id: '${machineId}',`,
    `  initial: '${descriptor.initial}',`,
    ...(contextDefaultsText ? [`  context: ${contextDefaultsText},`] : []),
    `  states: ${statesText},`,
    `});`,
    '',
  ].join('\n');

  return { source, events, contextFields };
}

/**
 * Ingest a JSON state-graph descriptor as feature `feature`'s `<name>`
 * workflow: writes `features/<feature>/workflows/<Name>Workflow.tsx`, then
 * re-validates via generators.mjs's shared selfCheck.
 *
 * @param {string} root Project root.
 * @param {string} name Workflow name (turned into a valid identifier).
 * @param {string} feature Feature that owns the workflow.
 * @param {object} descriptor JSON state-graph descriptor.
 * @returns {{file:string, events:string[], contextFields:string[]}} The written file and what it exposes.
 */
export function generateWorkflow(root, name, feature, descriptor) {
  const config = loadConfig(root);
  // #216: same identifier handling as the layer generators; throws before any write.
  const cap = pascalCase(name, 'Workflow');
  const { source, events, contextFields } = compileWorkflow(descriptor, { name: cap });

  const dir = path.join(root, config.features?.root || 'features', feature, 'workflows');
  const file = path.join(dir, `${cap}Workflow.tsx`);
  write(file, source);
  selfCheck(root, [file]);

  return { file, events, contextFields };
}
