#!/usr/bin/env node
const fs = require('fs');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

// Every auto-generated identifier (extracted named variables, the collapsed
// params collection) goes through this, so a property like `rule_expected`
// or `RuleExpected` still produces a properly camelCased variable name
// instead of carrying through whatever casing the original property had.
function toCamelCase(name) {
  return name.replace(/[-_]+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase()).replace(/^[A-Z]/, (c) => c.toLowerCase());
}

// Capitalizes just the first character -- used to build compound names like
// pushToErrors/lengthOfError from an existing camelCase identifier.
function capitalize(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Naive English pluralization, just good enough for the identifier names
// this file generates itself (status -> statuses, entry -> entries) -- not
// a general-purpose inflector.
function pluralize(name) {
  if (/[^aeiou]y$/.test(name)) return name.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/.test(name)) return name + 'es';
  return name + 's';
}

// The "name" half of a.b -- used to build a.pushToB()/a.bOfA()-style method
// names from whatever's actually being accessed. Only handles the shapes
// that occur in practice (a plain identifier, `this`, or another named
// property read); anything else (a call result, a computed lookup) has no
// stable name to build from, so callers bail when this returns null.
function identifierNameOf(node) {
  if (t.isIdentifier(node)) return node.name;
  if (t.isThisExpression(node)) return 'this';
  if (!t.isMemberExpression(node) || node.computed) return null;
  const property = node.property;
  if (!t.isIdentifier(property)) return null;
  return property.name;
}

// A block qualifies only if it's EXACTLY one bare `return <expr>;` -- no
// declarations, no side effects, nothing else. Anything looser (like
// validateAll's declare+loop+return body) returns null, which bails the
// whole chain out of conversion.
function extractBareReturn(block) {
  if (!t.isBlockStatement(block) || block.body.length !== 1) return null;
  const stmt = block.body[0];
  if (!t.isReturnStatement(stmt) || !stmt.argument) return null;
  return stmt.argument;
}

// True `else if` syntax puts the nested if directly in `alternate`,
// but a nested if that came from converting a nested ternary always has an
// extra BlockStatement wrapper around it (return X ? A : (Y ? B : C)
// produces alternate: Block([return (Y?B:C)]), and once that inner return's
// ternary itself converts, the block ends up holding a single IfStatement,
// not the IfStatement itself). Recognizing only the bare form meant chains
// built from nested ternaries silently stopped extending after one arm.
function unwrapSingleIf(node) {
  if (t.isIfStatement(node)) return node;
  if (t.isBlockStatement(node) && node.body.length === 1 && t.isIfStatement(node.body[0])) {
    return node.body[0];
  }
  return null;
}

// Walks an if/else-if/.../else chain collecting {condition, result} arms.
// Requires a terminal plain `else` that's ALSO a bare return -- a chain with
// no final else (falls through to whatever comes after) can't be
// represented as a single branch()...elseIt() expression, so that bails too.
function buildBranchChain(ifNode) {
  const arms = [];
  let current = ifNode;
  while (true) {
    const result = extractBareReturn(current.consequent);
    if (!result) return null;
    arms.push({ condition: current.test, result });

    if (!current.alternate) return null;
    const nested = unwrapSingleIf(current.alternate);
    if (nested) {
      current = nested;
      continue;
    }
    const finalElse = extractBareReturn(current.alternate);
    if (!finalElse) return null;
    return { arms, finalElse };
  }
}

// function(x, y) -> function(args) { const [x, y] = args; ...unchanged... }
// Collapses a multi-param function/method to one param, a named collection
// destructured back to the original names as the very first statement --
// the rest of the body is untouched, so behavior doesn't change, only the
// signature does. Skipped for: fewer than 2 params (nothing to collapse),
// constructors (rewriting every `new Foo(a, b)` call site is a much bigger,
// riskier change than this function's own internals), and any param that
// isn't a plain identifier (destructuring/rest/default params already in
// place -- too much to safely re-collapse).
function collapseParams(node) {
  if (node.kind === 'constructor') return;
  if (node.params.length < 2) return;
  if (!node.params.every((p) => t.isIdentifier(p))) return;

  const collectionName = 'args';
  const destructure = t.variableDeclaration('const', [
    t.variableDeclarator(
      t.arrayPattern(node.params.map((p) => t.identifier(p.name))),
      t.identifier(collectionName)
    ),
  ]);

  node.params = [t.identifier(collectionName)];
  node.body.body.unshift(destructure);
}

// Recognizes validateAll's original shape -- a mutable boolean flag plus a
// for-in loop that flips it false and pushes an error whenever one item
// fails -- and replaces the whole three-statement body with map/filter.
// Not a piecewise conversion: invalid.length === 0 already IS the answer
// once the loop becomes a filter, so the flag and the loop aren't converted,
// they're removed. Anything that doesn't match this exact shape (multiple
// push targets, extra statements, no error array) is left completely
// alone -- a narrow pattern match, not a general loop-to-functional rewrite.
function tryConvertAccumulatorLoop(bodyPath) {
  const body = bodyPath.node.body;
  if (body.length !== 3) return false;
  const flagDecl = body[0];
  const forIn = body[1];
  const ret = body[2];

  if (!t.isVariableDeclaration(flagDecl, { kind: 'let' })) return false;
  const flagDeclarations = flagDecl.declarations;
  if (flagDeclarations.length !== 1) return false;
  const flagDeclarator = flagDeclarations[0];
  const flagId = flagDeclarator.id;
  const flagInit = flagDeclarator.init;
  if (!t.isIdentifier(flagId) || !t.isBooleanLiteral(flagInit, { value: true })) return false;
  const flagName = flagId.name;

  if (!t.isForInStatement(forIn)) return false;
  const forInLeft = forIn.left;
  const forInBody = forIn.body;
  const collectionExpr = forIn.right;
  if (!t.isVariableDeclaration(forInLeft) || !t.isBlockStatement(forInBody)) return false;
  const forInDeclarations = forInLeft.declarations;
  if (forInDeclarations.length !== 1) return false;
  const keyId = forInDeclarations[0].id;
  if (!t.isIdentifier(keyId)) return false;
  const keyName = keyId.name;

  if (!t.isReturnStatement(ret)) return false;
  const returnArgument = ret.argument;
  if (!t.isIdentifier(returnArgument, { name: flagName })) return false;

  const loopStatements = forInBody.body;
  if (loopStatements.length < 1) return false;
  const ifStmt = loopStatements[loopStatements.length - 1];
  if (!t.isIfStatement(ifStmt) || ifStmt.alternate) return false;
  const ifConsequent = ifStmt.consequent;
  const ifTest = ifStmt.test;
  if (!t.isBlockStatement(ifConsequent)) return false;

  const constStatements = loopStatements.slice(0, -1);
  const constDeclarators = [];
  for (const stmt of constStatements) {
    if (!t.isVariableDeclaration(stmt, { kind: 'const' })) return false;
    const declarations = stmt.declarations;
    if (declarations.length !== 1) return false;
    const declarator = declarations[0];
    if (!t.isIdentifier(declarator.id)) return false;
    constDeclarators.push(declarator);
  }
  const constNames = constDeclarators.map((d) => d.id.name);

  const ifBodyStatements = ifConsequent.body;
  if (ifBodyStatements.length < 2) return false;
  const flagSetStmt = ifBodyStatements[0];
  const sideEffectStmts = ifBodyStatements.slice(1);
  if (!t.isExpressionStatement(flagSetStmt)) return false;
  const flagSetExpr = flagSetStmt.expression;
  if (!t.isAssignmentExpression(flagSetExpr, { operator: '=' })) return false;
  const flagSetLeft = flagSetExpr.left;
  const flagSetRight = flagSetExpr.right;
  if (!t.isIdentifier(flagSetLeft, { name: flagName }) || !t.isBooleanLiteral(flagSetRight, { value: false })) {
    return false;
  }

  const pushes = [];
  for (const stmt of sideEffectStmts) {
    if (!t.isExpressionStatement(stmt)) return false;
    const call = stmt.expression;
    if (!t.isCallExpression(call)) return false;
    const callCallee = call.callee;
    if (!t.isMemberExpression(callCallee) || callCallee.computed) return false;
    const calleeProperty = callCallee.property;
    if (!t.isIdentifier(calleeProperty, { name: 'push' })) return false;
    const callArguments = call.arguments;
    if (callArguments.length !== 1) return false;
    pushes.push({ target: callCallee.object, arg: callArguments[0] });
  }
  // At least one push, and every push must target the SAME array -- more
  // than one distinct target would need independent filtering per target,
  // which this conversion doesn't attempt.
  if (pushes.length === 0) return false;
  const firstPush = pushes[0];
  const firstTargetCode = generate(firstPush.target).code;
  const allSameTarget = pushes.every((p) => generate(p.target).code === firstTargetCode);
  if (!allSameTarget) return false;

  const itemParam = 'item';
  const rewireNames = new Set([keyName, ...constNames]);

  // Rewires every bare reference to the loop key or a computed const --
  // inside an expression being pulled OUT of the loop -- to read off the
  // new item object instead. A standalone traverse over a throwaway File
  // wrapper, not a hand-rolled walk, so member-property names and object
  // keys are correctly left alone (only real variable REFERENCES match).
  function rewireToItem(expr) {
    const clonedExpr = t.cloneNode(expr, true);
    const wrapper = t.file(t.program([t.expressionStatement(clonedExpr)]));
    traverse(wrapper, {
      Identifier(identifierPath) {
        const identifierName = identifierPath.node.name;
        if (!rewireNames.has(identifierName)) return;
        const identifierParent = identifierPath.parent;
        const isMemberPropertyName =
          t.isMemberExpression(identifierParent) &&
          identifierParent.property === identifierPath.node &&
          !identifierParent.computed;
        if (isMemberPropertyName) return;
        const isObjectKey =
          t.isObjectProperty(identifierParent) &&
          identifierParent.key === identifierPath.node &&
          !identifierParent.computed;
        if (isObjectKey) return;
        identifierPath.replaceWith(t.memberExpression(t.identifier(itemParam), t.identifier(identifierName)));
        identifierPath.skip();
      },
    });
    const wrapperStatement = wrapper.program.body[0];
    return wrapperStatement.expression;
  }

  const itemsName = constNames.length === 1 ? pluralize(constNames[0]) : 'entries';
  const invalidName = 'invalid';

  const keyProperty = t.objectProperty(t.identifier(keyName), t.identifier(keyName), false, true);
  const constProperties = constDeclarators.map((d) => t.objectProperty(t.identifier(d.id.name), d.init));
  const itemProperties = [keyProperty, ...constProperties];

  const objectKeysCall = t.callExpression(t.memberExpression(t.identifier('Object'), t.identifier('keys')), [
    collectionExpr,
  ]);
  const mapCallback = t.arrowFunctionExpression([t.identifier(keyName)], t.objectExpression(itemProperties));
  const itemsInit = t.callExpression(t.memberExpression(objectKeysCall, t.identifier('map')), [mapCallback]);
  const itemsDecl = t.variableDeclaration('const', [t.variableDeclarator(t.identifier(itemsName), itemsInit)]);

  const filterCallback = t.arrowFunctionExpression([t.identifier(itemParam)], rewireToItem(ifTest));
  const invalidInit = t.callExpression(t.memberExpression(t.identifier(itemsName), t.identifier('filter')), [
    filterCallback,
  ]);
  const invalidDecl = t.variableDeclaration('const', [t.variableDeclarator(t.identifier(invalidName), invalidInit)]);

  const mapArgCallback = t.arrowFunctionExpression([t.identifier(itemParam)], rewireToItem(firstPush.arg));
  const pushReplacementInit = t.callExpression(t.memberExpression(t.identifier(invalidName), t.identifier('map')), [
    mapArgCallback,
  ]);
  const pushAssign = t.expressionStatement(t.assignmentExpression('=', firstPush.target, pushReplacementInit));

  const invalidLength = t.memberExpression(t.identifier(invalidName), t.identifier('length'));
  const finalReturn = t.returnStatement(t.binaryExpression('===', invalidLength, t.numericLiteral(0)));

  bodyPath.node.body = [itemsDecl, invalidDecl, pushAssign, finalReturn];
  return true;
}

// Recognizes a single subject.method(arg) call -- or its negated form,
// !subject.equals(arg) -- as one "leaf" of an and()/or() chain. Same
// negation rule as the if/else chain conversion: only equals() has a
// dedicated negation method (notEquals), so a negated leaf using any other
// method isn't representable and bails.
function buildAtomicLeaf(expr) {
  let inner = expr;
  let negated = false;
  if (t.isUnaryExpression(expr) && expr.operator === '!' && t.isCallExpression(expr.argument)) {
    inner = expr.argument;
    negated = true;
  }
  if (!t.isCallExpression(inner)) return null;
  const innerCallee = inner.callee;
  if (!t.isMemberExpression(innerCallee) || innerCallee.computed) return null;
  const innerArguments = inner.arguments;
  if (innerArguments.length !== 1) return null;
  const methodId = innerCallee.property;
  if (!t.isIdentifier(methodId)) return null;
  const methodName = methodId.name;
  if (negated && methodName !== 'equals') return null;

  return {
    subject: innerCallee.object,
    method: negated ? 'notEquals' : methodName,
    arg: innerArguments[0],
  };
}

// Flattens a same-operator chain of and()/or() calls (as produced by the
// LogicalExpression rule above, e.g. and(and(a, b), c) from `a && b && c`)
// into its leaves, left to right. Bails (returns null) the moment the chain
// mixes and()/or() or contains anything that isn't itself an and()/or()
// call at this level -- a mixed chain can't become one fluent expression.
function flattenAndOrChain(node, functionName) {
  const callee = node.callee;
  if (!t.isCallExpression(node) || !t.isIdentifier(callee, { name: functionName })) return null;
  const callArguments = node.arguments;
  if (callArguments.length !== 2) return null;
  const left = callArguments[0];
  const right = callArguments[1];

  const leftCallee = t.isCallExpression(left) ? left.callee : null;
  const leftIsSameChain = t.isIdentifier(leftCallee, { name: functionName });
  const leftLeaves = leftIsSameChain ? flattenAndOrChain(left, functionName) : [left];
  if (!leftLeaves) return null;
  return [...leftLeaves, right];
}

// `plugins` defaults to plain JS/module syntax (existing CLI/demo callers,
// unchanged) -- plug.js passes ['typescript', 'jsx'] to parse a .tsx source
// file; every rule below only ever touches expression nodes it recognizes,
// so turning those parser plugins on doesn't change output for code that
// doesn't use TS/JSX syntax.
// `return c ? a : b` rewritten without the ternary (null when the argument
// isn't a ternary). Shared with canonical.js, Smith's equivalent-form pass.
// cond ? true : false is just cond -- a redundant tautology, not a real
// branch. Simplifying it HERE (before any if/else or branch chain gets
// built) means isWithinRange-style conditions skip the whole
// ifIt/isTrue/thenItIs/orelseIs machinery entirely and just become
// `return and(...)` directly, instead of ceremony wrapped around a value
// that was already the answer.
function ternaryReturnReplacement(arg) {
  if (!arg || !t.isConditionalExpression(arg)) return null;
  if (t.isBooleanLiteral(arg.consequent, { value: true }) && t.isBooleanLiteral(arg.alternate, { value: false })) {
    return t.returnStatement(arg.test);
  }
  if (t.isBooleanLiteral(arg.consequent, { value: false }) && t.isBooleanLiteral(arg.alternate, { value: true })) {
    return t.returnStatement(t.unaryExpression('!', arg.test));
  }
  return t.ifStatement(
    arg.test,
    t.blockStatement([t.returnStatement(arg.consequent)]),
    t.blockStatement([t.returnStatement(arg.alternate)])
  );
}

function transform(code, { plugins = [] } = {}) {
  const ast = parser.parse(code, { sourceType: 'module', plugins });

  // Pass zero, before any other rule: recognize the accumulator-loop idiom
  // (validateAll's original shape) and replace it wholesale with
  // map/filter. Has to run first -- every later pass assumes it's looking
  // at a bare-return chain or a raw operator, neither of which this
  // loop-plus-mutable-flag shape is, until this pass rewrites it.
  traverse(ast, {
    ClassMethod(path) {
      tryConvertAccumulatorLoop(path.get('body'));
    },
    FunctionDeclaration(path) {
      tryConvertAccumulatorLoop(path.get('body'));
    },
  });

  traverse(ast, {
    ReturnStatement(path) {
      const replacement = ternaryReturnReplacement(path.node.argument);
      if (replacement) path.replaceWith(replacement);
    },
    ExpressionStatement(path) {
      const expr = path.node.expression;
      if (
        t.isAssignmentExpression(expr) &&
        expr.operator === '=' &&
        t.isConditionalExpression(expr.right)
      ) {
        const cond = expr.right;
        path.replaceWith(
          t.ifStatement(
            cond.test,
            t.blockStatement([
              t.expressionStatement(t.assignmentExpression('=', expr.left, cond.consequent)),
            ]),
            t.blockStatement([
              t.expressionStatement(t.assignmentExpression('=', expr.left, cond.alternate)),
            ])
          )
        );
      }
    },
    // Every common comparison operator gets the same treatment as ===: delegate
    // to a named method instead of leaving the raw operator inline. Negated
    // forms (!==, !=) wrap the positive method in a unary "!" rather than
    // inventing a separate "notEquals" method.
    BinaryExpression(path) {
      const { node } = path;
      const direct = {
        '===': 'equals',
        '==': 'equals',
        '>': 'greaterThan',
        '<': 'lessThan',
        '>=': 'greaterThanOrEqual',
        '<=': 'lessThanOrEqual',
      };
      const negated = { '!==': 'equals', '!=': 'equals' };

      if (direct[node.operator]) {
        path.replaceWith(
          t.callExpression(t.memberExpression(node.left, t.identifier(direct[node.operator])), [node.right])
        );
      } else if (negated[node.operator]) {
        path.replaceWith(
          t.unaryExpression(
            '!',
            t.callExpression(t.memberExpression(node.left, t.identifier(negated[node.operator])), [node.right])
          )
        );
      }
    },
    // && / || become plain function calls -- and(a, b) / or(a, b) -- rather
    // than a.and(b)/a.or(b). A method call would assume the left operand is
    // an object with .and()/.or(); but && and || almost always combine plain
    // booleans (e.g. the result of a > b), and booleans have no such method,
    // so a.and(b) throws at runtime. A free function has no such assumption.
    LogicalExpression(path) {
      const { node } = path;
      const name = { '&&': 'and', '||': 'or' }[node.operator];
      if (name) {
        path.replaceWith(t.callExpression(t.identifier(name), [node.left, node.right]));
      }
    },
  });

  // Second pass, on the ALREADY-converted tree: the if/else and param rules
  // below need to inspect conditions (e.g. is this a.equals(b)?) that only
  // exist post-conversion. Running them in the SAME traverse as the rules
  // above doesn't work -- when IfStatement's visitor fires, Babel hasn't
  // reached the nested `a === b` yet (that only happens via requeued
  // traversal AFTER this node is replaced), so a same-pass check always saw
  // the pre-conversion shape. A second full pass sees the real one.
  traverse(ast, {
    // if/else -> branch().ifIt().elseIfIt()...elseIt(), but ONLY when every
    // branch (all the way down an else-if chain, including the final else)
    // is a single bare `return`. That's the exact shape proven safe earlier:
    // ifIt/elseIfIt take CLOSURES, so an unmatched branch's code never
    // executes. Anything more complex (multiple statements, no final else,
    // a body that isn't just a return) bails out and stays plain if/else --
    // that's what protects against the crash we hit trying to flatten
    // validateField's actual multi-statement shape into eager values.
    IfStatement(path) {
      if (t.isIfStatement(path.parent) && path.parent.alternate === path.node) return;

      const chain = buildBranchChain(path.node);
      if (!chain) return;

      // Result arrows get a BLOCK body with an explicit `return`, not a bare
      // expression body -- an expression-bodied arrow (() => expr) has no
      // ReturnStatement node at all, so a nested ternary placed there would
      // never be visited by the ReturnStatement rule above and would stay
      // raw. Wrapping it in `{ return expr; }` gives that rule something to
      // find, so nested ternaries (describeLength's chain) keep flattening
      // instead of stopping after the first level.
      //
      // No closures anywhere -- ifIt/thenItIs/orelseIs all take PLAIN
      // VALUES. That's only safe because of a pre-pass below: any later
      // arm's condition that reads a property off an EARLIER arm's subject
      // (rule.expected, unsafe if rule is null) gets extracted into a named
      // variable via optional chaining (const expected = rule?.expected;)
      // BEFORE the chain runs. Once that data dependency is removed, every
      // value in the chain is safe to evaluate unconditionally, so the
      // chain can be flat -- extraction is what makes flat+plain-values
      // safe; plain-values-without-extraction is the exact thing that
      // crashed earlier (verified).
      const priorSubjects = new Set();
      const extractions = [];

      // !status.equals('valid') (from status !== 'valid') is a UnaryExpression
      // wrapping the call, not the call itself. "!" can't apply to a Clause
      // object, so this has to be recognized and handled as its OWN shape --
      // returns the inner subject.method(arg) call plus whether it was
      // negated, or null if `condition` isn't call-shaped at all (a compound
      // and(...)/or(...), which stays on the isTrue() fallback below).
      function unwrapNegation(condition) {
        if (t.isUnaryExpression(condition) && condition.operator === '!' && t.isCallExpression(condition.argument)) {
          return { inner: condition.argument, negated: true };
        }
        if (t.isCallExpression(condition)) {
          return { inner: condition, negated: false };
        }
        return null;
      }

      function subjectName(condition) {
        const unwrapped = unwrapNegation(condition);
        if (unwrapped && t.isMemberExpression(unwrapped.inner.callee) && t.isIdentifier(unwrapped.inner.callee.object)) {
          return unwrapped.inner.callee.object.name;
        }
        return null;
      }

      function rewriteRiskyArg(condition) {
        const unwrapped = unwrapNegation(condition);
        if (!unwrapped || !(t.isMemberExpression(unwrapped.inner.callee) && unwrapped.inner.arguments.length === 1)) {
          return condition;
        }
        const call = unwrapped.inner;
        const arg = call.arguments[0];
        if (t.isMemberExpression(arg) && !arg.computed && t.isIdentifier(arg.object) && priorSubjects.has(arg.object.name)) {
          const varName = toCamelCase(arg.property.name);
          if (!extractions.some((e) => e.varName === varName)) {
            extractions.push({ varName, object: arg.object, property: arg.property });
          }
          const rewrittenCall = t.callExpression(call.callee, [t.identifier(varName)]);
          return unwrapped.negated ? t.unaryExpression('!', rewrittenCall) : rewrittenCall;
        }
        return condition;
      }

      // First arm: ifIt(subject).method(arg) -- or ifIt(condition).isTrue()
      // for a compound condition. Every arm after that: orifIt(subject) on
      // the SAME running Conditional, not a fresh ifIt() -- this is only
      // safe because rewriteRiskyArg() has already extracted any argument
      // that depended on an earlier arm's subject into a named variable
      // (const expected = rule?.expected). With that dependency gone, every
      // arm's condition is unconditionally safe to evaluate, so continuing
      // the SAME chain (flat) is equivalent to nesting a fresh one -- but
      // simpler. Nesting was only ever a workaround for not having
      // extraction yet; it's not needed once extraction exists.
      function emitCondition(priorCall, condition) {
        const start = (name) =>
          priorCall === null
            ? t.callExpression(t.identifier('ifIt'), [name])
            : t.callExpression(t.memberExpression(priorCall, t.identifier('orifIt')), [name]);

        const unwrapped = unwrapNegation(condition);
        if (unwrapped && t.isMemberExpression(unwrapped.inner.callee) && unwrapped.inner.arguments.length === 1) {
          const call = unwrapped.inner;
          // Negation only has a dedicated method for equals -> notEquals
          // (the only method our own operator-conversion negation table
          // ever produces). Anything else negated falls through to the
          // isTrue() wrapping below -- correct, just less clean, same as
          // it's always been for that case.
          if (unwrapped.negated && t.isIdentifier(call.callee.property, { name: 'equals' })) {
            return t.callExpression(t.memberExpression(start(call.callee.object), t.identifier('notEquals')), [
              call.arguments[0],
            ]);
          }
          if (!unwrapped.negated) {
            return t.callExpression(t.memberExpression(start(call.callee.object), call.callee.property), [
              call.arguments[0],
            ]);
          }
        }
        return t.callExpression(t.memberExpression(start(condition), t.identifier('isTrue')), []);
      }

      function emitChain(arms, finalElse) {
        let call = null;
        for (const arm of arms) {
          const rewritten = rewriteRiskyArg(arm.condition);
          const conditionCall = emitCondition(call, rewritten);
          call = t.callExpression(t.memberExpression(conditionCall, t.identifier('thenItIs')), [arm.result]);
          const name = subjectName(arm.condition);
          if (name) priorSubjects.add(name);
        }
        return t.callExpression(t.memberExpression(call, t.identifier('orelseIs')), [finalElse]);
      }

      const chainExpr = emitChain(chain.arms, chain.finalElse);
      const declarations = extractions.map((e) =>
        t.variableDeclaration('const', [
          t.variableDeclarator(t.identifier(e.varName), t.optionalMemberExpression(e.object, e.property, false, true)),
        ])
      );

      path.replaceWithMultiple([...declarations, t.returnStatement(chainExpr)]);
    },
    // and(a.method(x), b.method(y)) -> ifIt(a).method(x).and(b).method(y):
    // the fluent replacement for the free and()/or() functions, read as one
    // sentence instead of a nested call. Only fires when every leaf is a
    // plain subject.method(arg) shape (see buildAtomicLeaf) -- anything
    // else (a compound sub-expression, a bare boolean, mixed and()/or())
    // bails and leaves the free-function form in place, same "safe shape
    // only" discipline as every other rule here.
    CallExpression(path) {
      const { node } = path;
      const callee = node.callee;
      if (!t.isIdentifier(callee)) return;
      const functionName = callee.name;
      if (functionName !== 'and' && functionName !== 'or') return;

      const leaves = flattenAndOrChain(node, functionName);
      // Exactly two leaves only -- AndSubject/OrSubject's methods return a
      // plain boolean (so the whole chain can be used directly, e.g. in a
      // `return`, with no closing .thenItIs() call needed), which means a
      // THIRD .and()/.or() has nothing to chain off of. A three-or-more-way
      // and()/or() stays on the free-function form, which already nests to
      // any depth correctly.
      if (!leaves || leaves.length !== 2) return;
      const atoms = leaves.map(buildAtomicLeaf);
      if (atoms.some((atom) => atom === null)) return;

      const chainMethod = functionName;
      const firstAtom = atoms[0];
      const ifItCall = t.callExpression(t.identifier('ifIt'), [firstAtom.subject]);
      let chain = t.callExpression(t.memberExpression(ifItCall, t.identifier(firstAtom.method)), [firstAtom.arg]);
      for (let i = 1; i < atoms.length; i++) {
        const atom = atoms[i];
        const connector = t.callExpression(t.memberExpression(chain, t.identifier(chainMethod)), [atom.subject]);
        chain = t.callExpression(t.memberExpression(connector, t.identifier(atom.method)), [atom.arg]);
      }

      path.replaceWith(chain);
    },
    // Multi-param functions/methods collapse to ONE param -- a named
    // collection, destructured back to the original names as the first
    // statement -- matching the same one-param-per-atom rule already
    // applied to comparisons (.equals(other)) and branching (.is(cond)).
    // Only plain-identifier params are handled (no destructuring/rest/
    // default params already in place); anything else bails out, same
    // "safe shape only" discipline as the if/else conversion.
    ClassMethod(path) {
      collapseParams(path.node);
    },
    FunctionDeclaration(path) {
      collapseParams(path.node);
    },
  });

  // Third pass, on the tree after both branch-chain and loop-to-functional
  // conversion: eliminate raw property access and .push() calls in favor of
  // named methods. Deliberately LAST -- running this alongside pass one
  // would swap a risky arg like `rule.expected` for a call
  // (`rule.expectedOfRule()`) BEFORE the branch-chain pass's extraction
  // safety check (rewriteRiskyArg, which only recognizes a bare
  // MemberExpression as risky) ever saw it, silently defeating the exact
  // null-crash protection that pass proved out. Running last means every
  // earlier pass sees the original raw shapes it already knows how to
  // reason about.
  traverse(ast, {
    CallExpression(path) {
      const { node } = path;
      const callee = node.callee;
      if (!t.isMemberExpression(callee) || callee.computed) return;
      const calleeProperty = callee.property;
      if (!t.isIdentifier(calleeProperty, { name: 'push' })) return;
      const calleeObject = callee.object;
      const objectName = identifierNameOf(calleeObject);
      if (!objectName) return;
      callee.property = t.identifier(`pushTo${capitalize(objectName)}`);
    },
    MemberExpression(path) {
      const { node, parent } = path;
      const nodeProperty = node.property;
      const nodeObject = node.object;
      if (node.computed || !t.isIdentifier(nodeProperty)) return;
      const isCallCallee = t.isCallExpression(parent) && parent.callee === node;
      if (isCallCallee) return;
      const isAssignmentTarget = t.isAssignmentExpression(parent) && parent.left === node;
      if (isAssignmentTarget) return;
      const objectName = identifierNameOf(nodeObject);
      if (!objectName) return;
      const propertyName = nodeProperty.name;
      const newMethodName = `${propertyName}Of${capitalize(objectName)}`;
      path.replaceWith(t.callExpression(t.memberExpression(nodeObject, t.identifier(newMethodName)), []));
    },
  });

  return generate(ast, { retainLines: false }).code;
}

function findFiles(patterns) {
  const files = new Set();
  for (const pattern of patterns) {
    for (const f of fs.globSync(pattern, { cwd: process.cwd() })) {
      if (fs.statSync(f).isFile()) files.add(f);
    }
  }
  return [...files];
}

// Reformats the ORIGINAL through the same parser+generator as transform()
// (no rule changes applied) before comparing. transform() always reformats
// whitespace, so comparing its output straight against the raw original file
// would call every file "changed" even when no rule actually fired.
function reformatOnly(code) {
  return generate(parser.parse(code, { sourceType: 'module' }), { retainLines: false }).code;
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const check = args.includes('--check');
  const patterns = args.filter((a) => !a.startsWith('--'));

  if (!patterns.length) {
    console.error('Usage: node transform.js <glob...> [--write | --check]');
    console.error('  (no flag)  print each transformed file to stdout');
    console.error('  --write    rewrite files in place');
    console.error('  --check    CI mode: exit 1 if any file would change, writes nothing');
    process.exit(1);
  }

  const files = findFiles(patterns);
  if (!files.length) {
    console.error('No files matched.');
    process.exit(1);
  }

  let changedCount = 0;
  const changedFiles = [];

  for (const file of files) {
    const original = fs.readFileSync(file, 'utf8');
    let output;
    try {
      output = transform(original);
    } catch (e) {
      console.error(`Skipping ${file} (parse error): ${e.message}`);
      continue;
    }

    const changed = output !== reformatOnly(original);
    if (changed) {
      changedCount++;
      changedFiles.push(file);
    }

    if (check) continue;
    if (write) {
      if (changed) fs.writeFileSync(file, output);
    } else {
      console.log(`// ${file}`);
      console.log(output);
    }
  }

  if (check) {
    if (changedCount) {
      console.error(`${changedCount} file(s) would change:`);
      changedFiles.forEach((f) => console.error(`  ${f}`));
      process.exit(1);
    }
    console.log(`All ${files.length} file(s) clean.`);
    return;
  }

  if (write) {
    console.log(`Rewrote ${changedCount} of ${files.length} file(s).`);
  }
}

module.exports = { transform, ternaryReturnReplacement };

if (require.main === module) {
  main();
}
