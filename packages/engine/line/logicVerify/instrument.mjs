// Line logic verification, spec D (step 4, #883): branch coverage for the isolated runner without loosening its sandbox.
// V8 precise coverage needs an inspector session (--allow-inspector) and NODE_V8_COVERAGE writes nothing under the
// permission model unless the child gets a writable dir (--allow-fs-write): both are new permissions on the child. So the
// unit's source is instrumented here, in the parent, before it is sent: a TypeScript `before` transformer puts a counter
// increment at the start of every block of the unit function, and the counters come back in the child's JSON line.
//
//   instrumentUnit(fn) -> {transformer, blocks()}            blocks() is the block count once the transform has run
//   branchCoverage(runs, total) -> {covered, total}|null      one side over every case
//   coverageLevel(before, after) -> CoverageLevel             full, partial, low (contract.mjs LOW_COVERAGE), unavailable
//
// A block: the unit's body and every nested function body (an arrow's expression body too), each branch of an `if`
// (an `if` without `else` counts its implicit else), of a `?:`, the right side of `&&`, `||` and `??`, each `case` and
// `default`, a `catch` and a loop body. The counters are a module-local array exported as `__lineCov`; an increment is a
// plain array write, so the unit's behaviour, effects and the child's flags are unchanged.
import { ts } from '@construct/ast/lazy';
import { LOW_COVERAGE } from './contract.mjs';

/** The counter array's name in the instrumented module (and the export the child reads). */
export const COVERAGE_VAR = '__lineCov';

/**
 * A TypeScript `before` transformer that instruments the top-level function `fn` (a function declaration, or a variable
 * initialised with a function or arrow), and a getter for how many blocks it counted (0 when `fn` was not found).
 * @param {string} fn
 * @returns {{transformer: import('typescript').TransformerFactory<import('typescript').SourceFile>, blocks: () => number}}
 */
export function instrumentUnit(fn) {
  let n = 0;
  /** @type {import('typescript').TransformerFactory<import('typescript').SourceFile>} */
  const transformer = (context) => (sf) => {
    const f = context.factory;
    const hit = () => f.createPostfixIncrement(f.createElementAccessExpression(f.createIdentifier(COVERAGE_VAR), n++));
    const stmt = () => f.createExpressionStatement(hit());
    const expr = (e) => f.createParenthesizedExpression(f.createComma(hit(), e));
    /** A block whose first statement (after any directive prologue) counts it. */
    const block = (s) => {
      if (s === undefined) return f.createBlock([stmt()], true);
      const body = ts.isBlock(s) ? [...s.statements] : [s];
      let k = 0;
      while (k < body.length && ts.isExpressionStatement(body[k]) && ts.isStringLiteral(body[k].expression)) k++;
      return f.createBlock([...body.slice(0, k), stmt(), ...body.slice(k)], true);
    };
    const LOGICAL = new Set([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken]);
    /** @param {import('typescript').Node} node @returns {import('typescript').Node} */
    const visit = (node) => {
      const v = /** @type {any} */ (ts.visitEachChild(node, visit, context));
      if (ts.isIfStatement(v)) return f.updateIfStatement(v, v.expression, block(v.thenStatement), v.elseStatement && ts.isIfStatement(v.elseStatement) ? v.elseStatement : block(v.elseStatement));
      if (ts.isConditionalExpression(v)) return f.updateConditionalExpression(v, v.condition, v.questionToken, expr(v.whenTrue), v.colonToken, expr(v.whenFalse));
      if (ts.isBinaryExpression(v) && LOGICAL.has(v.operatorToken.kind)) return f.updateBinaryExpression(v, v.left, v.operatorToken, expr(v.right));
      if (ts.isCaseClause(v)) return f.updateCaseClause(v, v.expression, [stmt(), ...v.statements]);
      if (ts.isDefaultClause(v)) return f.updateDefaultClause(v, [stmt(), ...v.statements]);
      if (ts.isCatchClause(v)) return f.updateCatchClause(v, v.variableDeclaration, block(v.block));
      if (ts.isForStatement(v)) return f.updateForStatement(v, v.initializer, v.condition, v.incrementor, block(v.statement));
      if (ts.isForOfStatement(v)) return f.updateForOfStatement(v, v.awaitModifier, v.initializer, v.expression, block(v.statement));
      if (ts.isForInStatement(v)) return f.updateForInStatement(v, v.initializer, v.expression, block(v.statement));
      if (ts.isWhileStatement(v)) return f.updateWhileStatement(v, v.expression, block(v.statement));
      if (ts.isArrowFunction(v)) return f.updateArrowFunction(v, v.modifiers, v.typeParameters, v.parameters, v.type, v.equalsGreaterThanToken, ts.isBlock(v.body) ? block(v.body) : expr(v.body));
      if (ts.isFunctionExpression(v) && v.body) return f.updateFunctionExpression(v, v.modifiers, v.asteriskToken, v.name, v.typeParameters, v.parameters, v.type, block(v.body));
      if (ts.isFunctionDeclaration(v) && v.body) return f.updateFunctionDeclaration(v, v.modifiers, v.asteriskToken, v.name, v.typeParameters, v.parameters, v.type, block(v.body));
      if (ts.isMethodDeclaration(v) && v.body) return f.updateMethodDeclaration(v, v.modifiers, v.asteriskToken, v.name, v.questionToken, v.typeParameters, v.parameters, v.type, block(v.body));
      return v;
    };
    const isFn = (e) => e && (ts.isArrowFunction(e) || ts.isFunctionExpression(e));
    const statements = sf.statements.map((s) => {
      if (ts.isFunctionDeclaration(s) && s.name?.text === fn && s.body) return /** @type {import('typescript').Statement} */ (visit(s));
      if (ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === fn && isFn(d.initializer))) {
        return /** @type {import('typescript').Statement} */ (ts.visitEachChild(s, (dl) => ts.visitEachChild(dl, (d) => (ts.isVariableDeclaration(d) && ts.isIdentifier(d.name) && d.name.text === fn && isFn(d.initializer)
          ? f.updateVariableDeclaration(d, d.name, d.exclamationToken, d.type, /** @type {import('typescript').Expression} */ (visit(/** @type {import('typescript').Node} */ (d.initializer))))
          : d), context), context));
      }
      return s;
    });
    if (!n) return sf;
    // var, so a hoisted call during module evaluation finds it; exported so the child can read it after each run
    const counters = f.createVariableStatement(undefined, f.createVariableDeclarationList([
      f.createVariableDeclaration(COVERAGE_VAR, undefined, undefined, f.createArrayLiteralExpression(Array.from({ length: n }, () => f.createNumericLiteral(0)))),
    ], ts.NodeFlags.None));
    const exported = f.createExpressionStatement(f.createAssignment(f.createPropertyAccessExpression(f.createIdentifier('exports'), COVERAGE_VAR), f.createIdentifier(COVERAGE_VAR)));
    return f.updateSourceFile(sf, [counters, exported, ...statements]);
  };
  return { transformer, blocks: () => n };
}

/**
 * One side's branch coverage over every case: a block is covered when its counter was above 0 in any case's run. A run
 * whose counters did not come back (the module failed to load, or the unit replaced them) counts nothing.
 * @param {Array<number[]|null|undefined>} runs each case's counters
 * @param {number} total the side's block count (0: the unit was not instrumented, so coverage is not measured)
 * @returns {{covered: number, total: number}|null}
 */
export function branchCoverage(runs, total) {
  if (!total) return null;
  let covered = 0;
  for (let k = 0; k < total; k++) if (runs.some((c) => Array.isArray(c) && c.length === total && c[k] > 0)) covered++;
  return { covered, total };
}

/**
 * The level of a pair's coverage (contract.mjs COVERAGE_LEVELS): unavailable when a side was not measured, low when a
 * side ran under LOW_COVERAGE of its blocks, full when both ran every block, else partial.
 * @param {{covered: number, total: number}|null} before
 * @param {{covered: number, total: number}|null} after
 * @returns {import('./contract.mjs').CoverageLevel}
 */
export function coverageLevel(before, after) {
  if (!before || !after) return 'unavailable';
  const share = (c) => c.covered / c.total;
  if (share(before) < LOW_COVERAGE || share(after) < LOW_COVERAGE) return 'low';
  return share(before) === 1 && share(after) === 1 ? 'full' : 'partial';
}
