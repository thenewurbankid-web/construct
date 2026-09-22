// Deterministic, template-based code -> plain-English translator (no LLM).
//
// Parses each export's real implementation with the TypeScript compiler API
// (a proper AST, not regex/brace-scanning — the earlier hand-rolled scanner
// mis-split statements like `const { a, b } = f();` because it couldn't
// reliably tell an object/destructuring '{' from a block '{'; a real parser
// doesn't have that class of bug) and narrates the structure it finds:
// declarations, calls, control flow, and identifier names. That's precisely
// why naming matters: this generator's only signal is what things are
// called and how they're wired together. A well-named `startSession`/
// `username`/`isValid` reads as a well-named sentence; an anonymous
// `x`/`tmp`/`fn2` reads as a generic, uninformative one. Comments are never
// consulted here.
//
// Every function here is total: an unrecognized node shape falls back to a
// generic, still name-based description (the identifiers found in that
// subtree) rather than ever reprinting raw code.
import { ts, findNode, findAllNodes } from '../packages/ast/index.mjs';

// The AST belongs to whichever snippet describeImplementation is currently
// translating. Safe as module-level state: this module is synchronous and
// never reentrant (no describe* function calls back into
// describeImplementation mid-traversal).
let currentSourceFile = null;
function text(node) {
  return node.getText(currentSourceFile).trim();
}

/** Fallback when no structural recognizer applies: name the identifiers
 * actually present, rather than reprinting the code. */
function bareIdentifierPhrase(node) {
  const seen = new Set();
  for (const n of findAllNodes(node, (x) => ts.isIdentifier(x))) {
    if (n.parent && ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) continue; // skip `.b` in `a.b`
    seen.add(n.text);
  }
  const names = [...seen];
  return names.length ? `involving ${joinEnglishList(names.slice(0, 6).map((n) => `\`${n}\``))}` : 'with no named parts';
}

export function joinEnglishList(items) {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function capitalize(s) {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

// ---- calls: the highest-value special cases ----------------------------

function calleeText(callExpr) {
  return text(callExpr.expression);
}

// A call's meaning comes back as either a "verb" phrase — an action, read
// naturally as an imperative statement ("Sets X to Y.") but needing
// gerund-conversion + a "the result of" wrapper when it's a value being
// returned/assigned instead — or a "noun" phrase that already reads fine
// standalone in a value position ("the app router") and should never be
// wrapped or converted.
const ACTION_GERUNDS = { sets: 'setting', reads: 'reading', removes: 'removing', navigates: 'navigating', fetches: 'fetching' };

function describeCallNode(node) {
  const callee = calleeText(node);
  const args = node.arguments.map(describeExpr);

  if (/(^|\.)localStorage\.setItem$/.test(callee) && args.length >= 2) return { phrase: `sets the browser-storage key ${args[0]} to ${args[1]}`, form: 'verb' };
  if (/(^|\.)localStorage\.getItem$/.test(callee)) return { phrase: `reads the browser-storage key ${args[0]}`, form: 'verb' };
  if (/(^|\.)localStorage\.removeItem$/.test(callee)) return { phrase: `removes the browser-storage key ${args[0]}`, form: 'verb' };
  if (/\.push$/.test(callee) && args.length === 1) return { phrase: `navigates to ${args[0]}`, form: 'verb' };
  if (callee === 'fetch' && args.length) return { phrase: `fetches ${args[0]}${args[1] ? ` with ${args[1]}` : ''}`, form: 'verb' };
  if (/\.matches$/.test(callee) && args.length === 1) return { phrase: `\`${callee.replace(/\.matches$/, '')}\` matches ${args[0]}`, form: 'noun' };
  if (callee === 'useState') return { phrase: `local state starting at ${args[0] ?? 'nothing'}`, form: 'noun' };
  if (callee === 'useRouter') return { phrase: 'the app router', form: 'noun' };
  if (callee === 'useMachine' && node.arguments.length) return { phrase: `running the \`${text(node.arguments[0])}\` state machine`, form: 'noun' };

  const argsPhrase = args.length ? ` with ${joinEnglishList(args)}` : '';
  return { phrase: `calling \`${callee}\`${argsPhrase}`, form: 'verb' }; // already gerund-shaped, but still worth "the result of" when it's a value
}

function describeReturnValue(exprNode) {
  const inner = unwrapParens(exprNode);
  if (ts.isCallExpression(inner)) {
    const { phrase, form } = describeCallNode(inner);
    if (form === 'noun') return phrase;
    const gerund = phrase.replace(/^(sets|reads|removes|navigates|fetches)\b/, (w) => ACTION_GERUNDS[w]);
    return `the result of ${gerund}`;
  }
  return describeExpr(inner);
}

/** Strips parentheses and `await` — both are transparent for description
 * purposes; an awaited call is described exactly like its synchronous
 * counterpart (the enclosing function already reads as `async`, so nothing
 * is lost by not repeating "waits for" on every awaited expression). */
function unwrapParens(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node))) node = node.expression;
  return node;
}

// ---- expressions ----------------------------------------------------------

const BINARY_WORDS = {
  [ts.SyntaxKind.AmpersandAmpersandToken]: 'and',
  [ts.SyntaxKind.BarBarToken]: 'or',
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: 'equals',
  [ts.SyntaxKind.EqualsEqualsToken]: 'equals',
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: 'does not equal',
  [ts.SyntaxKind.ExclamationEqualsToken]: 'does not equal',
  [ts.SyntaxKind.QuestionQuestionToken]: 'or, if that is null/undefined,',
};

function paramNames(params) {
  const names = [];
  for (const p of params) {
    if (ts.isObjectBindingPattern(p.name)) {
      for (const el of p.name.elements) names.push(text(el.name));
    } else if (ts.isArrayBindingPattern(p.name)) {
      for (const el of p.name.elements) if (!ts.isOmittedExpression(el)) names.push(text(el.name));
    } else {
      names.push(text(p.name));
    }
  }
  return names;
}

function describeFunctionLike(node) {
  const params = paramNames(node.parameters);
  const paramsPhrase = params.length ? ` (given ${joinEnglishList(params.map((n) => `\`${n}\``))})` : '';
  if (ts.isBlock(node.body)) {
    const bodyText = node.body.statements.map(describeStatement).filter(Boolean).join(' ');
    return bodyText ? `a function${paramsPhrase} that: ${bodyText}` : `a function${paramsPhrase} that does nothing`;
  }
  return `a function${paramsPhrase} that returns ${describeReturnValue(node.body)}`;
}

export function describeExpr(node) {
  node = unwrapParens(node);
  if (!node) return 'nothing';

  if (ts.isStringLiteralLike(node)) return node.text === '' ? 'an empty string' : `the text '${node.text}'`;
  if (ts.isNumericLiteral(node)) return `the number ${node.text}`;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return 'true';
  if (node.kind === ts.SyntaxKind.FalseKeyword) return 'false';
  if (node.kind === ts.SyntaxKind.NullKeyword) return 'null';
  if (node.kind === ts.SyntaxKind.UndefinedKeyword) return 'undefined';
  if (ts.isIdentifier(node) && node.text === 'undefined') return 'undefined';

  if (ts.isTypeOfExpression(node)) return `the type of ${describeExpr(node.expression)}`;

  if (ts.isBinaryExpression(node)) {
    const eq = node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken;
    if (eq && ts.isTypeOfExpression(node.left) && ts.isStringLiteralLike(node.right)) {
      return node.right.text === 'undefined' ? `${describeExpr(node.left.expression)} is undefined` : `${describeExpr(node.left.expression)} is of type "${node.right.text}"`;
    }
    const word = BINARY_WORDS[node.operatorToken.kind];
    if (word) return `${describeExpr(node.left)} ${word} ${describeExpr(node.right)}`;
    return `${describeExpr(node.left)} (${text(node.operatorToken)}) ${describeExpr(node.right)}`;
  }

  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    return `not (${describeExpr(node.operand)})`;
  }

  if (ts.isConditionalExpression(node)) {
    return `${describeExpr(node.whenTrue)} if ${describeExpr(node.condition)}, otherwise ${describeExpr(node.whenFalse)}`;
  }

  if (ts.isArrowFunction(node)) return describeFunctionLike(node);

  if (ts.isCallExpression(node)) return describeCallNode(node).phrase;

  if (ts.isNewExpression(node)) {
    const args = (node.arguments || []).map(describeExpr);
    return `a new \`${text(node.expression)}\`${args.length ? ` (${joinEnglishList(args)})` : ''}`;
  }

  if (ts.isObjectLiteralExpression(node)) {
    if (!node.properties.length) return 'an empty object';
    const parts = node.properties.map((p) => {
      if (ts.isPropertyAssignment(p)) return `\`${text(p.name)}\` set to ${describeExpr(p.initializer)}`;
      if (ts.isShorthandPropertyAssignment(p)) return `\`${text(p.name)}\``;
      if (ts.isSpreadAssignment(p)) return `everything from ${describeExpr(p.expression)}`;
      return `\`${text(p)}\``;
    });
    return `an object with ${joinEnglishList(parts)}`;
  }

  if (ts.isArrayLiteralExpression(node)) {
    if (!node.elements.length) return 'an empty list';
    return `a list containing ${joinEnglishList(node.elements.map(describeExpr))}`;
  }

  if (ts.isPropertyAccessExpression(node) || ts.isIdentifier(node)) return `\`${text(node)}\``;

  return bareIdentifierPhrase(node);
}

// ---- statements -------------------------------------------------------

function describeJsxTags(node) {
  const names = new Set();
  for (const n of findAllNodes(node, (x) => ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x))) {
    const tagName = ts.isJsxElement(n) ? n.openingElement.tagName : n.tagName;
    names.add(text(tagName));
  }
  if (!names.size) return 'markup';
  return `${joinEnglishList([...names].map((n) => `\`<${n}>\``))} markup`;
}

export function describeStatement(node) {
  if (ts.isReturnStatement(node)) {
    if (!node.expression) return 'Returns.';
    const inner = unwrapParens(node.expression);
    if (ts.isJsxElement(inner) || ts.isJsxSelfClosingElement(inner) || ts.isJsxFragment(inner)) {
      return `Renders ${describeJsxTags(inner)}.`;
    }
    return `Returns ${describeReturnValue(inner)}.`;
  }

  if (ts.isThrowStatement(node)) {
    return `Throws ${describeReturnValue(node.expression)}.`;
  }

  if (ts.isIfStatement(node)) {
    const cond = describeExpr(node.expression);
    const thenText = ts.isBlock(node.thenStatement)
      ? node.thenStatement.statements.map(describeStatement).filter(Boolean).join(' ')
      : describeStatement(node.thenStatement);
    let out = `If ${cond}: ${thenText}`;
    if (node.elseStatement) {
      const elseText = ts.isBlock(node.elseStatement)
        ? node.elseStatement.statements.map(describeStatement).filter(Boolean).join(' ')
        : describeStatement(node.elseStatement);
      out += ` Otherwise: ${elseText}`;
    }
    return out;
  }

  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.map(describeVariableDeclaration).join(' ');
  }

  if (ts.isExpressionStatement(node)) {
    const expr = node.expression;
    if (ts.isCallExpression(expr)) {
      const callee = calleeText(expr);
      if (callee === 'useEffect' && expr.arguments.length >= 1 && ts.isArrowFunction(expr.arguments[0]) && ts.isBlock(expr.arguments[0].body)) {
        const deps = expr.arguments[1] && ts.isArrayLiteralExpression(expr.arguments[1]) ? expr.arguments[1].elements.map(text) : [];
        const bodyText = expr.arguments[0].body.statements.map(describeStatement).filter(Boolean).join(' ');
        const depsPhrase = deps.length ? `${joinEnglishList(deps.map((d) => `\`${d}\``))} change${deps.length === 1 ? 's' : ''}` : 'it runs (no dependencies)';
        return `Whenever ${depsPhrase}: ${bodyText}`;
      }
      return `${capitalize(describeCallNode(expr).phrase.replace(/^calling\b/, 'calls'))}.`;
    }
    if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return `Sets ${describeExpr(expr.left)} to ${describeExpr(expr.right)}.`;
    }
    return `Runs an expression ${bareIdentifierPhrase(expr)}.`;
  }

  return `Runs a step ${bareIdentifierPhrase(node)}.`;
}

function describeVariableDeclaration(decl) {
  const initializer = decl.initializer;
  if (ts.isArrayBindingPattern(decl.name)) {
    const names = decl.name.elements.map((el) => (ts.isOmittedExpression(el) ? '_' : text(el.name)));
    if (initializer && ts.isCallExpression(initializer)) {
      const callee = calleeText(initializer);
      if (callee === 'useState') {
        return `Holds local state \`${names[0]}\` (setter \`${names[1] ?? 'its setter'}\`), starting at ${describeExpr(initializer.arguments[0])}.`;
      }
      if (callee === 'useMachine') {
        return `Runs the \`${text(initializer.arguments[0])}\` state machine, tracking its status as \`${names[0]}\` and sending it events via \`${names[1] ?? 'its sender'}\`.`;
      }
    }
    return `Declares ${joinEnglishList(names.map((n) => `\`${n}\``))} from ${initializer ? describeReturnValue(initializer) : 'nothing'}.`;
  }
  if (ts.isObjectBindingPattern(decl.name)) {
    const names = decl.name.elements.map((el) => text(el.name));
    return `Declares ${joinEnglishList(names.map((n) => `\`${n}\``))} from ${initializer ? describeReturnValue(initializer) : 'nothing'}.`;
  }
  const name = text(decl.name);
  if (!initializer) return `Declares \`${name}\`.`;
  if (ts.isArrowFunction(initializer)) return `Defines \`${name}\` as ${describeFunctionLike(initializer)}.`;
  return `Declares \`${name}\` as ${describeReturnValue(initializer)}.`;
}

// ---- XState machine literals: the highest-value structured case -------

function objectProp(obj, name) {
  if (!obj || !ts.isObjectLiteralExpression(obj)) return null;
  const p = obj.properties.find((pr) => (ts.isPropertyAssignment(pr) || ts.isShorthandPropertyAssignment(pr)) && text(pr.name).replace(/^['"]|['"]$/g, '') === name);
  return p && ts.isPropertyAssignment(p) ? p.initializer : null;
}

function describeGuardedTarget(optionObj) {
  const guardExpr = objectProp(optionObj, 'guard');
  const targetExpr = objectProp(optionObj, 'target');
  const targetName = targetExpr && ts.isStringLiteralLike(targetExpr) ? targetExpr.text : 'itself';
  if (!guardExpr) return `to \`${targetName}\` otherwise`;
  const guardTypeProp = ts.isObjectLiteralExpression(guardExpr) ? objectProp(guardExpr, 'type') : null;
  const guardName = guardTypeProp && ts.isStringLiteralLike(guardTypeProp)
    ? guardTypeProp.text
    : ts.isStringLiteralLike(guardExpr)
      ? guardExpr.text
      : text(guardExpr);
  return `to \`${targetName}\` if \`${guardName}\` passes`;
}

function describeTransition(eventName, value) {
  if (ts.isArrayLiteralExpression(value)) {
    return `on \`${eventName}\`, moves ${value.elements.map(describeGuardedTarget).join(', ')}`;
  }
  if (ts.isStringLiteralLike(value)) return `on \`${eventName}\`, moves to \`${value.text}\``;
  if (ts.isObjectLiteralExpression(value)) return `on \`${eventName}\`, moves ${describeGuardedTarget(value)}`;
  return `on \`${eventName}\`, transitions per its configuration`;
}

function describeMachine(machineConfig) {
  const idExpr = objectProp(machineConfig, 'id');
  const initialExpr = objectProp(machineConfig, 'initial');
  const statesObj = objectProp(machineConfig, 'states');
  const id = idExpr && ts.isStringLiteralLike(idExpr) ? idExpr.text : null;
  const initial = initialExpr && ts.isStringLiteralLike(initialExpr) ? initialExpr.text : null;

  if (!statesObj || !ts.isObjectLiteralExpression(statesObj)) {
    return `Defines a state machine${id ? ` named \`${id}\`` : ''}.`;
  }

  const stateEntries = statesObj.properties.filter((p) => ts.isPropertyAssignment(p));
  const stateNames = stateEntries.map((p) => text(p.name));
  const sentences = [
    `Defines a state machine${id ? ` named \`${id}\`` : ''}${initial ? `, starting in \`${initial}\`` : ''}, with states ${joinEnglishList(stateNames.map((n) => `\`${n}\``))}.`,
  ];

  for (const p of stateEntries) {
    const stateName = text(p.name);
    const stateConfig = p.initializer;
    const parts = [];

    const typeExpr = objectProp(stateConfig, 'type');
    if (typeExpr && ts.isStringLiteralLike(typeExpr) && typeExpr.text === 'final') parts.push(`\`${stateName}\` is a final state`);

    const entryExpr = objectProp(stateConfig, 'entry');
    if (entryExpr && ts.isCallExpression(entryExpr) && calleeText(entryExpr) === 'assign' && entryExpr.arguments[0] && ts.isObjectLiteralExpression(entryExpr.arguments[0])) {
      const assigns = entryExpr.arguments[0].properties
        .filter((pr) => ts.isPropertyAssignment(pr))
        .map((pr) => `\`${text(pr.name)}\` to ${describeExpr(pr.initializer)}`);
      if (assigns.length) parts.push(`entering \`${stateName}\` sets ${joinEnglishList(assigns)}`);
    }

    const onObj = objectProp(stateConfig, 'on');
    if (onObj && ts.isObjectLiteralExpression(onObj)) {
      for (const evProp of onObj.properties) {
        if (ts.isPropertyAssignment(evProp)) parts.push(describeTransition(text(evProp.name), evProp.initializer));
      }
    }

    if (parts.length) sentences.push(`In \`${stateName}\`: ${parts.join('; ')}.`);
  }

  return sentences.join(' ');
}

// ---- top-level entry point ----------------------------------------------

/** Deterministic, template-based English translation of one export's
 * implementation source (as returned by extractDeclarationSource in
 * src/summarize.mjs). No LLM: every sentence traces back to a name or a
 * recognized AST shape in the code itself. Never throws — a snippet the
 * translator doesn't recognize still produces an identifier-based sentence
 * rather than falling back to raw code. `code` is parsed standalone as a
 * TSX snippet (it's always one complete top-level declaration). */
export function describeImplementation(code) {
  const sourceFile = ts.createSourceFile('snippet.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const previousSourceFile = currentSourceFile;
  currentSourceFile = sourceFile;
  try {
    const stmt = sourceFile.statements[0];
    if (!stmt) return 'Defines an export.';

    if (ts.isFunctionDeclaration(stmt) && stmt.body) {
      const paramsPhrase = paramNames(stmt.parameters);
      const paramsSentence = paramsPhrase.length ? `Takes ${joinEnglishList(paramsPhrase.map((n) => `\`${n}\``))} as input.` : null;
      const bodySentences = stmt.body.statements.map(describeStatement).filter(Boolean);
      return [paramsSentence, ...bodySentences].filter(Boolean).join(' ');
    }

    if (ts.isVariableStatement(stmt)) {
      const decl = stmt.declarationList.declarations[0];
      const initializer = decl.initializer;
      const machineCall = initializer && findNode(initializer, (n) => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'createMachine');
      if (machineCall) return describeMachine(machineCall.arguments[0]);

      if (initializer && ts.isArrowFunction(initializer)) {
        const paramsPhrase = paramNames(initializer.parameters);
        const paramsSentence = paramsPhrase.length ? `Takes ${joinEnglishList(paramsPhrase.map((n) => `\`${n}\``))} as input.` : null;
        if (ts.isBlock(initializer.body)) {
          const bodySentences = initializer.body.statements.map(describeStatement).filter(Boolean);
          return [paramsSentence, ...bodySentences].filter(Boolean).join(' ');
        }
        return [paramsSentence, `Returns ${describeReturnValue(initializer.body)}.`].filter(Boolean).join(' ');
      }

      return `Defines \`${text(decl.name)}\` as ${initializer ? describeReturnValue(initializer) : 'nothing'}.`;
    }

    if (ts.isClassDeclaration(stmt)) {
      const methods = stmt.members.filter((m) => ts.isMethodDeclaration(m)).map((m) => text(m.name));
      return `Defines a class${stmt.name ? ` \`${text(stmt.name)}\`` : ''} with method${methods.length === 1 ? '' : 's'} ${joinEnglishList(methods.map((m) => `\`${m}\``))}.`;
    }

    return bareIdentifierPhrase(stmt) === 'with no named parts' ? 'Defines an export.' : `Defines behavior ${bareIdentifierPhrase(stmt)}.`;
  } finally {
    currentSourceFile = previousSourceFile;
  }
}
