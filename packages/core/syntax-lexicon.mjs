// The syntax lexicon: how the language's own constructs read in our English —
// operators, statements, declarations, types. Same pattern as the call
// lexicon (js-lexicon.mjs): a table keyed by what the code is (here the
// TypeScript SyntaxKind; there the callee), whose values are built from the
// grammar primitives (grammar.mjs), so verbs still conjugate and negate.
//
// A construct with no key is a grammar gap, by definition — grammar-eval.mjs
// reports it by kind name, which is what keeps the system closed.
//
// Values are describers: (node, d) => string, where `d` is the translator's
// toolkit (prose.mjs): d.expr(node) for a value, d.body(node) for a block's
// sentences, d.func(node) for a function, d.type(node) for a type, d.name(node)
// for an identifier in backticks.
import { ts } from '../../packages/ast/index.mjs';
import { verb, BE, joinEnglishList } from './grammar.mjs';

const K = ts.SyntaxKind;
const EQUAL = verb('equal');

/** @typedef {{expr: (n: any) => string, body: (n: any) => string, func: (n: any) => string, type: (n: any) => string, name: (n: any) => string, text: (n: any) => string, quote: (raw: string) => string}} Toolkit */
/** @typedef {(node: any, d: Toolkit) => string} Describer */

// ---- binary operators -------------------------------------------------------

/** A comparison reads as a clause with its own negation:
 * "`a` is greater than `b`" / "`a` is not greater than `b`". */
const comparison = (v, complement = '') => ({
  says: (l, r) => [l, v.thirdPerson, complement, r].filter(Boolean).join(' '),
  negated: (l, r) => [l, v.negated, complement, r].filter(Boolean).join(' '),
});

/** Binary operators keyed by operator token. `says` reads the expression;
 * `negated`, where present, reads its negation (for `!(a > b)`). */
export const BINARY = Object.freeze({
  [K.AmpersandAmpersandToken]: { says: (l, r) => `${l} and ${r}` },
  [K.BarBarToken]: { says: (l, r) => `${l} or ${r}` },
  [K.QuestionQuestionToken]: { says: (l, r) => `${l} or, if that is null/undefined, ${r}` },
  [K.EqualsEqualsEqualsToken]: comparison(EQUAL),
  [K.EqualsEqualsToken]: comparison(EQUAL),
  [K.ExclamationEqualsEqualsToken]: { says: comparison(EQUAL).negated, negated: comparison(EQUAL).says },
  [K.ExclamationEqualsToken]: { says: comparison(EQUAL).negated, negated: comparison(EQUAL).says },
  [K.GreaterThanToken]: comparison(BE, 'greater than'),
  [K.LessThanToken]: comparison(BE, 'less than'),
  [K.GreaterThanEqualsToken]: comparison(BE, 'at least'),
  [K.LessThanEqualsToken]: comparison(BE, 'at most'),
  [K.InstanceOfKeyword]: comparison(BE, 'an instance of'),
  [K.InKeyword]: { says: (l, r) => `${r} has the key ${l}`, negated: (l, r) => `${r} does not have the key ${l}` },
  [K.PlusToken]: { says: (l, r) => `${l} plus ${r}` },
  [K.MinusToken]: { says: (l, r) => `${l} minus ${r}` },
  [K.AsteriskToken]: { says: (l, r) => `${l} times ${r}` },
  [K.SlashToken]: { says: (l, r) => `${l} divided by ${r}` },
  [K.PercentToken]: { says: (l, r) => `the remainder of ${l} divided by ${r}` },
  [K.AsteriskAsteriskToken]: { says: (l, r) => `${l} to the power of ${r}` },
  [K.AmpersandToken]: { says: (l, r) => `the bits of ${l} also set in ${r}` },
  [K.BarToken]: { says: (l, r) => `the bits set in ${l} or ${r}` },
  [K.CommaToken]: { says: (l, r) => `${l}, then ${r}` },
  [K.EqualsToken]: { says: (l, r) => `${r} (kept as ${l})` }, // an assignment used as a value: `if (m = re.exec(s))`
});

/** Compound assignments keyed by operator token, read as statements. */
export const ASSIGNMENT = Object.freeze({
  [K.EqualsToken]: (l, r) => `Sets ${l} to ${r}.`,
  [K.PlusEqualsToken]: (l, r) => `Adds ${r} to ${l}.`,
  [K.MinusEqualsToken]: (l, r) => `Subtracts ${r} from ${l}.`,
  [K.AsteriskEqualsToken]: (l, r) => `Multiplies ${l} by ${r}.`,
  [K.SlashEqualsToken]: (l, r) => `Divides ${l} by ${r}.`,
  [K.QuestionQuestionEqualsToken]: (l, r) => `Sets ${l} to ${r} if it is null/undefined.`,
  [K.BarBarEqualsToken]: (l, r) => `Sets ${l} to ${r} if it is not already set.`,
  [K.AmpersandAmpersandEqualsToken]: (l, r) => `Sets ${l} to ${r} if it is already set.`,
});

/** Prefix and postfix unary operators keyed by operator token. `statement`
 * reads it on its own line; `value` reads it inside an expression. */
export const UNARY = Object.freeze({
  [K.PlusPlusToken]: { statement: (x) => `Increases ${x} by one.`, value: (x) => `${x}, increased by one` },
  [K.MinusMinusToken]: { statement: (x) => `Decreases ${x} by one.`, value: (x) => `${x}, decreased by one` },
  [K.MinusToken]: { value: (x) => `the negative of ${x}` },
  [K.PlusToken]: { value: (x) => `the number value of ${x}` },
  [K.TildeToken]: { value: (x) => `the bitwise inverse of ${x}` },
});

// ---- expressions ----------------------------------------------------------

/** Template text as English: the fixed text in quotes, the inserted values
 * described — "the text made from 'Hello ', `name`, and '!'". */
function templateText(node, d) {
  const pieces = [];
  if (node.head.text) pieces.push(d.quote(node.head.text));
  for (const span of node.templateSpans) {
    pieces.push(d.expr(span.expression));
    if (span.literal.text) pieces.push(d.quote(span.literal.text));
  }
  return pieces.length === 1 ? `the text of ${pieces[0]}` : `the text made from ${joinEnglishList(pieces)}`;
}

/** Expression kinds the core translator doesn't already handle. */
export const EXPRESSIONS = Object.freeze({
  [K.RegularExpressionLiteral]: (n) => (n.text.includes('`') ? `the pattern \`\` ${n.text} \`\`` : `the pattern \`${n.text}\``),
  [K.NoSubstitutionTemplateLiteral]: (n, d) => (n.text === '' ? 'an empty string' : `the text ${d.quote(n.text)}`),
  [K.TemplateExpression]: templateText,
  [K.SpreadElement]: (n, d) => `everything in ${d.expr(n.expression)}`,
  [K.NonNullExpression]: (n, d) => d.expr(n.expression),
  [K.AsExpression]: (n, d) => d.expr(n.expression), // types aren't behavior
  [K.SatisfiesExpression]: (n, d) => d.expr(n.expression),
  [K.TypeAssertionExpression]: (n, d) => d.expr(n.expression),
  [K.ThisKeyword]: () => 'this object',
  [K.SuperKeyword]: () => 'the parent class',
  [K.FunctionExpression]: (n, d) => d.func(n),
  [K.VoidExpression]: (n, d) => `nothing (after evaluating ${d.expr(n.expression)})`,
  [K.DeleteExpression]: (n, d) => `the result of removing ${d.expr(n.expression)}`,
  [K.PostfixUnaryExpression]: (n, d) => UNARY[n.operator]?.value(d.expr(n.operand)) ?? null,
  [K.PrefixUnaryExpression]: (n, d) => UNARY[n.operator]?.value(d.expr(n.operand)) ?? null,
  [K.BigIntLiteral]: (n) => `the number ${n.text.replace(/n$/, '')}`,
  [K.ClassExpression]: (n, d) => `a class${n.name ? ` ${d.name(n.name)}` : ''}`,
  [K.ArrayBindingPattern]: (n, d) => joinEnglishList(n.elements.map((e) => (e.name ? d.name(e.name) : '_'))),
});

// ---- statements -----------------------------------------------------------

const loopVariable = (init, d) => (ts.isVariableDeclarationList(init) ? joinEnglishList(init.declarations.map((x) => d.name(x.name))) : d.expr(init));

/** Statement kinds the core translator doesn't already handle. */
export const STATEMENTS = Object.freeze({
  [K.ForOfStatement]: (n, d) => `For each ${loopVariable(n.initializer, d)} in ${d.expr(n.expression)}: ${d.body(n.statement)}`,
  [K.ForInStatement]: (n, d) => `For each key ${loopVariable(n.initializer, d)} of ${d.expr(n.expression)}: ${d.body(n.statement)}`,
  [K.ForStatement]: (n, d) => {
    const parts = [];
    if (n.initializer) parts.push(`starting with ${ts.isVariableDeclarationList(n.initializer) ? joinEnglishList(n.initializer.declarations.map((x) => `${d.name(x.name)} at ${x.initializer ? d.expr(x.initializer) : 'nothing'}`)) : d.expr(n.initializer)}`);
    if (n.condition) parts.push(`while ${d.expr(n.condition)}`);
    const step = n.incrementor ? ` Then, each time: ${d.body(n.incrementor)}` : '';
    return `Repeats${parts.length ? `, ${parts.join(', ')}` : ' forever'}: ${d.body(n.statement)}${step}`;
  },
  [K.WhileStatement]: (n, d) => `While ${d.expr(n.expression)}: ${d.body(n.statement)}`,
  [K.DoStatement]: (n, d) => `Repeats, at least once and then while ${d.expr(n.expression)}: ${d.body(n.statement)}`,
  [K.TryStatement]: (n, d) => {
    let out = `Tries: ${d.body(n.tryBlock)}`;
    if (n.catchClause) {
      const v = n.catchClause.variableDeclaration;
      out += ` If that fails${v ? ` with ${d.name(v.name)}` : ''}: ${d.body(n.catchClause.block)}`;
    }
    if (n.finallyBlock) out += ` Either way, finally: ${d.body(n.finallyBlock)}`;
    return out;
  },
  [K.SwitchStatement]: (n, d) => {
    const subject = d.expr(n.expression);
    const cases = n.caseBlock.clauses.map((c) => {
      const body = c.statements.map((s) => d.body(s)).filter(Boolean).join(' ') || 'Does nothing.';
      return ts.isDefaultClause(c) ? `Otherwise: ${body}` : `If it is ${d.expr(c.expression)}: ${body}`;
    });
    return `Depending on ${subject}: ${cases.join(' ')}`;
  },
  [K.BreakStatement]: () => 'Stops here.',
  [K.ContinueStatement]: () => 'Skips to the next round.',
  [K.Block]: (n, d) => d.body(n),
  [K.EmptyStatement]: () => '',
  [K.LabeledStatement]: (n, d) => d.body(n.statement),
  [K.DebuggerStatement]: () => 'Pauses for the debugger.',
  [K.FunctionDeclaration]: (n, d) => `Defines ${n.name ? d.name(n.name) : 'a function'} as ${d.func(n)}.`,
  [K.ClassDeclaration]: (n, d) => describeClass(n, d),
  [K.TypeAliasDeclaration]: (n, d) => `Defines the type ${d.name(n.name)} as ${d.type(n.type)}.`,
  [K.InterfaceDeclaration]: (n, d) => describeInterface(n, d),
  [K.EnumDeclaration]: (n, d) => `Defines the choices ${d.name(n.name)}: ${joinEnglishList(n.members.map((m) => d.name(m.name)))}.`,
  [K.ExportDeclaration]: (n, d) => describeReExport(n, d),
  [K.ExportAssignment]: (n, d) => `Exports ${d.expr(n.expression)} as the default.`,
  [K.ImportDeclaration]: (n) => `Uses '${n.moduleSpecifier.text}'.`,
  [K.ModuleDeclaration]: (n, d) => `Declares the module ${n.name ? d.name(n.name) : ''}.`,
});

function describeClass(n, d) {
  const name = n.name ? ` ${d.name(n.name)}` : '';
  const base = n.heritageClauses?.find((h) => h.token === K.ExtendsKeyword)?.types[0];
  const methods = n.members.filter((m) => ts.isMethodDeclaration(m) && m.name).map((m) => d.name(m.name));
  const fields = n.members.filter((m) => ts.isPropertyDeclaration(m) && m.name).map((m) => d.name(m.name));
  const has = [];
  if (fields.length) has.push(`the field${fields.length === 1 ? '' : 's'} ${joinEnglishList(fields)}`);
  if (methods.length) has.push(`the method${methods.length === 1 ? '' : 's'} ${joinEnglishList(methods)}`);
  return `Defines a class${name}${base ? `, based on ${d.name(base.expression)},` : ''}${has.length ? ` with ${joinEnglishList(has)}` : ''}.`;
}

function describeInterface(n, d) {
  const base = n.heritageClauses?.[0]?.types.map((t) => d.name(t.expression));
  const members = memberList(n.members, d);
  return `Defines the shape ${d.name(n.name)}${base?.length ? `, extending ${joinEnglishList(base)},` : ''} as ${members}.`;
}

function describeReExport(n, d) {
  const from = n.moduleSpecifier ? ` from '${n.moduleSpecifier.text}'` : '';
  if (!n.exportClause) return `Re-exports everything${from}.`;
  if (ts.isNamespaceExport(n.exportClause)) return `Re-exports everything${from} as ${d.name(n.exportClause.name)}.`;
  const names = n.exportClause.elements.map((e) => (e.propertyName ? `${d.name(e.propertyName)} as ${d.name(e.name)}` : d.name(e.name)));
  return `${from ? 'Re-exports' : 'Exports'} ${joinEnglishList(names)}${from}.`;
}

// ---- types ----------------------------------------------------------------

function memberList(members, d) {
  const fields = members
    .filter((m) => m.name)
    .map((m) => `${d.name(m.name)}${m.questionToken ? ' (optional)' : ''}${m.type ? ` as ${d.type(m.type)}` : ''}`);
  return fields.length ? `an object with ${joinEnglishList(fields)}` : 'an empty object';
}

/** Type kinds keyed by SyntaxKind: types read as what a value looks like. */
export const TYPES = Object.freeze({
  [K.StringKeyword]: () => 'text',
  [K.NumberKeyword]: () => 'a number',
  [K.BooleanKeyword]: () => 'true or false',
  [K.BigIntKeyword]: () => 'a big number',
  [K.AnyKeyword]: () => 'anything',
  [K.UnknownKeyword]: () => 'anything',
  [K.VoidKeyword]: () => 'nothing',
  [K.UndefinedKeyword]: () => 'undefined',
  [K.NullKeyword]: () => 'null',
  [K.NeverKeyword]: () => 'nothing, ever',
  [K.ObjectKeyword]: () => 'an object',
  [K.SymbolKeyword]: () => 'a symbol',
  [K.LiteralType]: (n, d) => (n.literal.kind === K.NullKeyword ? 'null' : ts.isStringLiteral(n.literal) ? `'${n.literal.text}'` : d.expr(n.literal)),
  [K.TypeReference]: (n, d) => {
    const args = n.typeArguments?.map((t) => d.type(t));
    return `${d.name(n.typeName)}${args?.length ? ` of ${joinEnglishList(args)}` : ''}`;
  },
  [K.ArrayType]: (n, d) => `a list of ${d.type(n.elementType)}`,
  [K.TupleType]: (n, d) => `a pair-like list of ${joinEnglishList(n.elements.map((e) => d.type(e)))}`,
  [K.UnionType]: (n, d) => `one of ${joinEnglishList(n.types.map((t) => d.type(t))).replace(/, and ([^,]*)$/, ', or $1').replace(/^([^,]*) and /, '$1 or ')}`,
  [K.IntersectionType]: (n, d) => `all of ${joinEnglishList(n.types.map((t) => d.type(t)))} at once`,
  [K.TypeLiteral]: (n, d) => memberList(n.members, d),
  [K.FunctionType]: (n, d) => `a function${n.parameters.length ? ` taking ${joinEnglishList(n.parameters.map((p) => d.name(p.name)))}` : ''} that returns ${d.type(n.type)}`,
  [K.ParenthesizedType]: (n, d) => d.type(n.type),
  [K.TypeOperator]: (n, d) => (n.operator === K.KeyOfKeyword ? `a key of ${d.type(n.type)}` : n.operator === K.ReadonlyKeyword ? `${d.type(n.type)}, read-only` : d.type(n.type)),
  [K.IndexedAccessType]: (n, d) => `the ${d.type(n.indexType)} part of ${d.type(n.objectType)}`,
  [K.TypeQuery]: (n, d) => `the type of ${d.name(n.exprName)}`,
  [K.MappedType]: () => 'an object mapped key by key',
  [K.ConditionalType]: (n, d) => `${d.type(n.trueType)} when ${d.type(n.checkType)} fits ${d.type(n.extendsType)}, otherwise ${d.type(n.falseType)}`,
  [K.TemplateLiteralType]: () => 'text of a fixed pattern',
  [K.ThisType]: () => 'this object',
  [K.ImportType]: (n) => `a type from '${n.argument.literal?.text ?? ''}'`,
  [K.TypePredicate]: (n, d) => `whether ${d.name(n.parameterName)} is ${n.type ? d.type(n.type) : 'true'}`,
});

/**
 * Looks a node up in one of the tables; null when its kind has no key (a gap).
 * @param {Readonly<Record<number, Describer>>} table The table.
 * @param {any} node The syntax node.
 * @param {Toolkit} d The translator's toolkit.
 * @returns {string | null} The English, or null.
 */
export function lookup(table, node, d) {
  const describer = table[node.kind];
  return describer ? describer(node, d) : null;
}
