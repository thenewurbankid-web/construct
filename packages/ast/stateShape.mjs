// AST package: "bag of flags" state-shape detection (#573/#581) -- the shape STATE-001 flags in
// workflow and hook files: state typed (or initialised) as one object whose fields are several
// co-occurring status-style booleans (`loading`, `isError`, `ready`, ...) and/or a flag next to
// both an `error` and a `data`-style field, so the object can express states that cannot happen
// (`isLoading && isError`, `loading` with `data` and `error` all set). The fix is a discriminated
// union on one `status` field, which the suggestion below spells out concretely.
//
// Deliberately conservative (a heuristic, not a type checker):
//   - only real state-shape positions are read: an interface, a type alias whose type is an object
//     literal, the initial object (or inline type argument) of `useState`/`useReducer`, a top-level
//     const named like an initial state (`initialList`, `DEFAULT_STATE`), and an XState `context`
//     object/`{} as {...}` -- never a nested object type inside a function's parameter list, a
//     props type, a hook's returned object, a JSX attribute, etc.;
//   - a union type alias is never read (that IS the recommended form, even when its arms carry
//     literal `true`/`false` members);
//   - a field only counts as a flag when it is named like one AND is boolean-shaped (a `boolean`
//     annotation, a `true`/`false` literal type, a `true`/`false` initial value) -- `ready: Promise`
//     or `loading: 'yes' | 'no'` is not a flag; `error`/`err` counts as a flag only with an `is`/
//     `has` prefix or a boolean type, otherwise it is the error payload;
//   - one flag plus `data` is fine (a plain "loaded yet?" pair); two flags, or a flag plus an
//     `error` field plus a `data`-style field, is the violation. A `data`-style field is one of
//     the DATA_NAMES, or (#592) a nullable non-primitive slot of any name (`listing: X | null`,
//     `session: X | null`, `data?: X`) in a declared type -- never a primitive or key/scalar
//     (`notice: string | null`, `selectedId`), and never read from an untyped `null` initial value.
import { walkAst } from './walk.mjs';

/** Status-style flag names, matched after lower-casing and stripping an `is`/`has`/`was` prefix. */
const FLAG_STEMS = new Set([
  'loading', 'pending', 'fetching', 'success', 'succeeded', 'successful', 'failed', 'failure',
  'errored', 'ready', 'loaded', 'idle',
]);
/** Error-payload field names (after the same normalisation). */
const ERROR_NAMES = new Set(['error', 'err', 'errormessage', 'errors']);
/** Result-payload field names. */
const DATA_NAMES = new Set(['data', 'result', 'results', 'response', 'payload', 'value', 'items']);

/** Which `status` arm a flag stem stands for in the suggested union. */
const STATUS_OF_STEM = {
  loading: 'loading', pending: 'loading', fetching: 'loading',
  success: 'success', succeeded: 'success', successful: 'success', ready: 'success', loaded: 'success',
  failed: 'error', failure: 'error', errored: 'error', error: 'error', err: 'error',
  idle: 'idle',
};

const STATE_HOOKS = new Set(['useState', 'useReducer']);
/** A top-level `const` object whose name says it is an initial state (`initialList`, `DEFAULT_STATE`,
 * `emptyState`): read as a state shape even when nothing in the same file passes it to a hook
 * (a workflow file typically exports it for a hook elsewhere to `useReducer(reducer, initialX)`). */
const INITIAL_STATE_NAME = /^(initial|default|empty)|state$/i;

function keyName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  return null;
}

/** `{ stem, prefixed }` -- `isLoading` -> `{ stem: 'loading', prefixed: true }`. */
function normalise(name) {
  const m = /^(is|has|was)([A-Z_].*)$/.exec(name);
  if (m) return { stem: m[2].replace(/^_/, '').toLowerCase(), prefixed: true };
  return { stem: name.toLowerCase(), prefixed: false };
}

/** 'boolean' | 'other' | 'unknown' for a TS type node. */
function typeShape(t) {
  if (!t) return 'unknown';
  if (t.type === 'TSBooleanKeyword') return 'boolean';
  if (t.type === 'TSLiteralType') return t.literal?.type === 'Literal' && typeof t.literal.value === 'boolean' ? 'boolean' : 'other';
  if (t.type === 'TSUnionType') {
    const parts = t.types.filter((p) => p.type !== 'TSUndefinedKeyword' && p.type !== 'TSNullKeyword');
    if (!parts.length) return 'unknown';
    return parts.every((p) => typeShape(p) === 'boolean') ? 'boolean' : 'other';
  }
  return 'other';
}

/** 'boolean' | 'other' | 'unknown' for an object-literal property value. */
function valueShape(v) {
  if (!v) return 'unknown';
  if (v.type === 'Literal') return typeof v.value === 'boolean' ? 'boolean' : v.value === null ? 'unknown' : 'other';
  if (v.type === 'Identifier' && v.name === 'undefined') return 'unknown';
  return 'other';
}

/** Field names that are a key or a scalar, never "the result" (`selectedId: string | null`). */
const SCALAR_FIELD_NAME = /(id|ids|index|key|name|count)$/i;
const PRIMITIVE_TYPES = new Set(['TSStringKeyword', 'TSNumberKeyword', 'TSBooleanKeyword', 'TSBigIntKeyword', 'TSLiteralType']);

/**
 * True for a nullable (`X | null`, `X | undefined`, `x?: X`) field typed as something other than a
 * primitive: the shape of a result slot named after its domain (`listing`, `session`), which the
 * fixed DATA_NAMES list cannot know. Only consulted beside a flag AND an error field.
 */
function isNullablePayload(name, t, optional) {
  if (SCALAR_FIELD_NAME.test(name)) return false;
  if (!t) return optional === true;
  const isNullish = (p) => p.type === 'TSNullKeyword' || p.type === 'TSUndefinedKeyword';
  const parts = t.type === 'TSUnionType' ? t.types : [t];
  const rest = parts.filter((p) => !isNullish(p));
  const nullable = optional === true || rest.length < parts.length;
  return nullable && rest.length > 0 && !rest.some((p) => PRIMITIVE_TYPES.has(p.type));
}

/** Members of a TSTypeLiteral / TSInterfaceBody as `{ name, shape, typeText, payload }`. */
function typeMembers(members, source) {
  const out = [];
  for (const m of members) {
    if (m.type !== 'TSPropertySignature') continue;
    const name = keyName(m.key);
    if (!name || m.computed) continue;
    const t = m.typeAnnotation?.typeAnnotation;
    out.push({ name, shape: typeShape(t), typeText: t ? source.slice(t.range[0], t.range[1]) : null, payload: isNullablePayload(name, t, m.optional) });
  }
  return out;
}

/** Properties of an ObjectExpression as `{ name, shape, typeText: null }`; null when it spreads. */
function objectMembers(obj) {
  const out = [];
  for (const p of obj.properties) {
    if (p.type !== 'Property' || p.computed) continue;
    const name = keyName(p.key);
    if (!name) continue;
    // never a payload here: an untyped `null` could be any slot (`notice: null`, `busyId: null`), so
    // the domain-named widening reads declared types only, not initial values
    out.push({ name, shape: valueShape(p.value), typeText: null, payload: false });
  }
  return out;
}

/**
 * Classify one member list into the flags / error / data fields the heuristic cares about, or
 * `null` when the combination is allowed.
 *
 * @param {{name:string, shape:string, typeText:string|null}[]} members The shape's own fields.
 * @returns {{flags:string[], error:object|null, data:object|null}|null} The offending fields, or null.
 */
export function classifyStateFields(members) {
  const flags = [];
  let error = null;
  let data = null;
  let dataByShape = null;
  for (const m of members) {
    const { stem, prefixed } = normalise(m.name);
    const isErrorName = ERROR_NAMES.has(stem);
    // A flag must be boolean-shaped: `loaded: null` / `pending: null` in an initial object are
    // payload slots (`loaded: Machines | null`), not flags, exactly as `ready: Promise` is not.
    if (m.shape === 'boolean' && (FLAG_STEMS.has(stem) || (isErrorName && prefixed) || stem === 'error')) {
      flags.push(m.name);
    } else if (!error && isErrorName && !prefixed) {
      error = m;
    } else if (!data && DATA_NAMES.has(stem) && !prefixed) {
      data = m;
    } else if (!dataByShape && m.payload && !prefixed) {
      dataByShape = m;
    }
  }
  // #592: a domain-named result slot (`listing: DirListingView | null`, `session: Session | null`)
  // counts as the data field, but only when it completes a flag + error + payload trio; two
  // flags need no data field at all, and one flag plus a nullable slot alone stays fine.
  if (!data && error && flags.length === 1) data = dataByShape;
  if (flags.length >= 2 || (flags.length === 1 && error && data)) return { flags, error, data };
  return null;
}

/** The concrete discriminated-union rewrite the violation suggests, as compilable TypeScript. */
function unionSuggestion(typeName, hit) {
  // idle and loading always exist (every request-shaped state starts and waits); error/success
  // arms only when the shape carries an error/success flag or payload -- each arm then owns the
  // one payload field that exists in that state.
  const statuses = new Set(['idle', 'loading']);
  for (const f of hit.flags) statuses.add(STATUS_OF_STEM[normalise(f).stem] ?? 'loading');
  if (hit.error) statuses.add('error');
  if (hit.data) statuses.add('success');
  const stripNullish = (t) => t?.replace(/\s*\|\s*(null|undefined)\b/g, '').replace(/^(null|undefined)\s*\|\s*/, '').trim();
  const errorName = hit.error?.name ?? 'error';
  const errorType = stripNullish(hit.error?.typeText) || 'Error';
  const dataName = hit.data?.name ?? 'data';
  const dataType = stripNullish(hit.data?.typeText) || 'T';
  const arms = [];
  for (const s of ['idle', 'loading', 'error', 'success']) {
    if (!statuses.has(s)) continue;
    if (s === 'error') arms.push(`{ status: 'error'; ${errorName}: ${errorType} }`);
    else if (s === 'success') arms.push(`{ status: 'success'; ${dataName}: ${dataType} }`);
    else arms.push(`{ status: '${s}' }`);
  }
  return `type ${typeName} = ${arms.join(' | ')}`;
}

/**
 * Every "bag of flags" state shape in a parsed file (the shape STATE-001 flags), in source order.
 *
 * @param {object} ast A parsed Program (from `parseToAst`).
 * @param {string} source The same file's source text (for the type text of the fields it names).
 * @returns {{index:number, kind:string, name:string, typeName:string, fields:string[], flags:string[], suggestion:string, contradiction:string}[]}
 *   One entry per offending shape: `kind` is `interface` | `type` | `initial` (a top-level const
 *   named like an initial state) | `useState` | `useReducer` | `context`; `name` is the declared
 *   type/const name (`typeName` is what the suggested union is called); `fields` are the offending
 *   member names; `suggestion` is a compiling union rewrite.
 */
export function collectBagOfFlagsStates(ast, source) {
  const hits = [];
  const topLevelObjects = new Map(); // const NAME = { ... } (or `: Type = { ... }`), to resolve `useReducer(r, NAME)`
  for (const stmt of ast.body) {
    const decl = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
    if (decl?.type !== 'VariableDeclaration') continue;
    for (const d of decl.declarations) {
      if (d.id.type === 'Identifier' && d.init?.type === 'ObjectExpression') {
        topLevelObjects.set(d.id.name, { obj: d.init, typeRef: d.id.typeAnnotation?.typeAnnotation, node: d, initialByName: INITIAL_STATE_NAME.test(d.id.name) });
      }
    }
  }

  const report = (node, kind, typeName, members, name = typeName) => {
    const hit = classifyStateFields(members);
    if (!hit) return false;
    const fields = [...hit.flags, ...(hit.error ? [hit.error.name] : []), ...(hit.data ? [hit.data.name] : [])];
    const contradiction = hit.flags.length >= 2
      ? `${hit.flags.map((f) => '`' + f + '`').join(' and ')} can both be true at once`
      : `\`${hit.flags[0]}\`, \`${hit.error.name}\` and \`${hit.data.name}\` can all be set at once`;
    hits.push({ index: node.range[0], kind, name, typeName, fields, flags: hit.flags, contradiction, suggestion: unionSuggestion(typeName, hit) });
    return true;
  };

  // Same-file type references: a `useState<State>(...)` / `const initial: State = {...}` whose
  // State is declared here is covered by the declaration itself -- never reported twice.
  const declaredTypeNames = new Set();
  for (const stmt of ast.body) {
    const decl = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
    if (decl?.type === 'TSInterfaceDeclaration' || decl?.type === 'TSTypeAliasDeclaration') declaredTypeNames.add(decl.id.name);
  }
  const refersToDeclared = (t) => t?.type === 'TSTypeReference' && t.typeName?.type === 'Identifier' && declaredTypeNames.has(t.typeName.name);

  /** An object-shaped value: ObjectExpression, `{} as {...}`, `() => ({...})`, or a same-file const. */
  const objectShapeOf = (v) => {
    if (!v) return null;
    if (v.type === 'ObjectExpression') return { members: objectMembers(v), node: v, typed: false };
    if (v.type === 'TSAsExpression' || v.type === 'TSSatisfiesExpression') {
      const t = v.typeAnnotation;
      if (t?.type === 'TSTypeLiteral') return { members: typeMembers(t.members, source), node: v, typed: true };
      if (refersToDeclared(t)) return { covered: true };
      return objectShapeOf(v.expression);
    }
    if (v.type === 'ArrowFunctionExpression' && v.body?.type === 'ObjectExpression') return objectShapeOf(v.body);
    if (v.type === 'Identifier' && topLevelObjects.has(v.name)) {
      const { obj, typeRef, initialByName } = topLevelObjects.get(v.name);
      if (refersToDeclared(typeRef) || initialByName) return { covered: true }; // reported at its declaration, if at all
      return { members: objectMembers(obj), node: obj, typed: false };
    }
    return null;
  };

  // Initial-state consts by name (see INITIAL_STATE_NAME): the concrete evidence a workflow file
  // leaves when its state type lives in another file (`import type { ListState }` + `export const
  // initialList: ListState = { loaded: false, error: null, data: null }`).
  for (const [name, { obj, typeRef, node, initialByName }] of topLevelObjects) {
    if (!initialByName || refersToDeclared(typeRef)) continue;
    const typeName = typeRef?.type === 'TSTypeReference' && typeRef.typeName?.type === 'Identifier' ? typeRef.typeName.name : 'State';
    report(node, 'initial', typeName, objectMembers(obj), name);
  }

  walkAst(ast, {
    enter(node) {
      if (node.type === 'TSInterfaceDeclaration') {
        report(node, 'interface', node.id.name, typeMembers(node.body.body, source));
      } else if (node.type === 'TSTypeAliasDeclaration' && node.typeAnnotation?.type === 'TSTypeLiteral') {
        report(node, 'type', node.id.name, typeMembers(node.typeAnnotation.members, source));
      } else if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && STATE_HOOKS.has(node.callee.name)) {
        const kind = node.callee.name;
        const typeArg = node.typeArguments?.params?.[0];
        if (refersToDeclared(typeArg)) return; // covered by the declaration (reported there, or fine)
        if (typeArg?.type === 'TSTypeLiteral' && report(node, kind, 'State', typeMembers(typeArg.members, source))) return;
        const init = kind === 'useReducer' ? node.arguments[1] : node.arguments[0];
        const shape = objectShapeOf(init);
        if (shape && !shape.covered) report(node, kind, 'State', shape.members);
      } else if (node.type === 'Property' && !node.computed && keyName(node.key) === 'context') {
        const shape = objectShapeOf(node.value);
        if (shape && !shape.covered) report(node, 'context', 'Context', shape.members);
      }
    },
  });
  return hits.sort((a, b) => a.index - b.index);
}
