// AST package: fast-check equivalence for pure exports touched by a staged edit (#749, second slice of
// epic #461's "Change check"). Reuses domainPurity.mjs's allowlist purity detection (#506) to find exported
// functions the AST semantic diff (#747) alone can't judge -- a genuine logic change that still parses as
// "changed" gets a concrete counter-example here instead of just a verdict. No LLM: fast-check (MIT) drives
// generated inputs through the extracted before/after function bodies and compares outputs.
import { isDeepStrictEqual } from 'node:util';
import fc from 'fast-check';
import { parseToAst } from './parse.mjs';
import { collectImpureDomainReferences } from './domainPurity.mjs';

/** Fast-check runs per function, and the wall-clock budget for the whole run (#461's "under 2s for
 * functions in scope" latency target) -- a function that would blow this budget is reported skipped, not
 * silently dropped (interruptAfterTimeLimit stops early without failing the check). */
const NUM_RUNS = 50;
const TIME_BUDGET_MS = 2000;

/**
 * A fast-check arbitrary for a TS parameter type-annotation node, or `null` when the type isn't one of the
 * small set this check knows how to generate -- callers skip the whole function rather than guess at a
 * shape (#749's "functions that fail purity detection are skipped, not guessed at" applies just as much to
 * an unsupported type as to an impure body).
 *
 * @param {object|null} typeNode A typescript-estree type node (e.g. `TSNumberKeyword`), or `null` (no annotation).
 * @returns {object|null} A fast-check arbitrary, or `null` if unsupported.
 */
function arbitraryForTypeNode(typeNode) {
  if (!typeNode) return null;
  switch (typeNode.type) {
    case 'TSNumberKeyword':
      return fc.double({ noNaN: true, noDefaultInfinity: true });
    case 'TSStringKeyword':
      return fc.string();
    case 'TSBooleanKeyword':
      return fc.boolean();
    case 'TSArrayType': {
      const inner = arbitraryForTypeNode(typeNode.elementType);
      return inner ? fc.array(inner, { maxLength: 10 }) : null;
    }
    default:
      return null;
  }
}

/**
 * One fast-check arbitrary per parameter, or `null` if any parameter lacks a supported type annotation.
 *
 * @param {object[]} params A function/arrow function's `params`.
 * @returns {object[]|null} Arbitraries in parameter order, or `null` when unsupported.
 */
function arbitrariesForParams(params) {
  const arbitraries = [];
  for (const param of params) {
    const arb = arbitraryForTypeNode(param.typeAnnotation?.typeAnnotation ?? null);
    if (!arb) return null;
    arbitraries.push(arb);
  }
  return arbitraries;
}

/**
 * Every top-level exported function declaration or `export const name = (...) => ...` / `function` expression
 * in `ast`, with its own source text and a purity verdict from domainPurity's allowlist detection.
 *
 * @param {object} ast A parsed Program.
 * @param {string} source The exact source `ast` was parsed from (for slicing each function's own text).
 * @returns {{name: string, params: object[], source: string, evalSource: string, isPure: boolean}[]}
 */
function findTopLevelPureCandidates(ast, source) {
  const candidates = [];
  for (const node of ast.body) {
    let decl = null;
    if (node.type === 'ExportNamedDeclaration' && node.declaration) decl = node.declaration;
    else if (node.type === 'ExportDefaultDeclaration') decl = node.declaration;
    if (!decl) continue;

    if (decl.type === 'FunctionDeclaration' && decl.id) {
      candidates.push({ name: decl.id.name, fnNode: decl });
    } else if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        if (d.id.type === 'Identifier' && (d.init?.type === 'ArrowFunctionExpression' || d.init?.type === 'FunctionExpression')) {
          candidates.push({ name: d.id.name, fnNode: d.init });
        }
      }
    }
  }
  return candidates.map(({ name, fnNode }) => ({
    name,
    params: fnNode.params,
    source: source.slice(fnNode.range[0], fnNode.range[1]),
    evalSource: stripTypeAnnotations(fnNode, source),
    // collectImpureDomainReferences reads `ast.body` for top-level import scanning, so it needs a
    // Program-shaped wrapper around the function node, not the bare node itself.
    isPure: collectImpureDomainReferences({ type: 'Program', body: [fnNode] }).length === 0,
  }));
}

/**
 * A function/arrow function's own source text with every parameter's `: Type` annotation and its own
 * `: ReturnType` annotation removed -- the raw slice is valid TypeScript but not valid JS, and `loadFn` below
 * needs to `eval` it directly with no compile step (keeping the property check dependency-free and fast).
 *
 * @param {object} fnNode A `FunctionDeclaration`/`FunctionExpression`/`ArrowFunctionExpression` node.
 * @param {string} source The full source `fnNode` was parsed from.
 * @returns {string} The function's source text, stripped of type annotations, still valid TS syntax otherwise.
 */
function stripTypeAnnotations(fnNode, source) {
  const removals = fnNode.params.map((p) => p.typeAnnotation?.range).filter(Boolean);
  if (fnNode.returnType) removals.push(fnNode.returnType.range);
  if (removals.length === 0) return source.slice(fnNode.range[0], fnNode.range[1]);
  removals.sort((a, b) => a[0] - b[0]);
  let result = '';
  let cursor = fnNode.range[0];
  for (const [start, end] of removals) {
    result += source.slice(cursor, start);
    cursor = end;
  }
  result += source.slice(cursor, fnNode.range[1]);
  return result;
}

/**
 * Evaluates a function expression's own source text into a callable. Safe only because the caller has
 * already required `isPure` (domainPurity's allowlist: no free references beyond the function's own locals,
 * type-only imports and a narrow built-in list) -- the extracted text is self-contained, needing no import
 * or outer scope to run.
 *
 * @param {string} source A `function ...` / `(...) => ...` expression's exact source text.
 * @returns {Function} The callable.
 */
function loadFn(source) {
  return new Function(`"use strict"; return (${source});`)();
}

/**
 * Runs `before`/`after` versions of one function through fast-check on generated inputs.
 *
 * @param {string} name The export's name.
 * @param {string} beforeEvalSource Its source before the edit, type annotations stripped (eval-safe).
 * @param {string} afterEvalSource Its source after the edit, type annotations stripped (eval-safe).
 * @param {object[]} arbitraries One fast-check arbitrary per parameter.
 * @returns {{name: string, verdict: 'equivalent'|'diverged'|'skipped'|'cant-tell', reason?: string, input?: any[], before?: any, after?: any}}
 */
function runEquivalence(name, beforeEvalSource, afterEvalSource, arbitraries) {
  let beforeFn;
  let afterFn;
  try {
    beforeFn = loadFn(beforeEvalSource);
    afterFn = loadFn(afterEvalSource);
  } catch (e) {
    return { name, verdict: 'cant-tell', reason: `eval error: ${e?.message ?? e}` };
  }

  const callBoth = (...args) => {
    const call = (fn) => {
      try {
        return { threw: false, value: fn(...args) };
      } catch (e) {
        return { threw: true, value: String(e?.message ?? e) };
      }
    };
    return { before: call(beforeFn), after: call(afterFn) };
  };

  // fast-check's `property` signature needs a fixed-length tuple type to line up each arbitrary's
  // generated value with the predicate's positional args; `arbitraries` is a runtime-length array (one
  // per the function-under-test's real arity, discovered per call site), which TS cannot express as a
  // tuple here -- cast just the argument to a tuple shape rather than fork a per-arity overload for a
  // test-only helper (casting `fc.property` itself instead breaks `fc.check`'s overload resolution below).
  const typedArbitraries = /** @type {[any, ...any[]]} */ (arbitraries);
  const property = fc.property(...typedArbitraries, (...args) => {
    const { before, after } = callBoth(...args);
    if (before.threw || after.threw) return before.threw === after.threw && before.value === after.value;
    return isDeepStrictEqual(before.value, after.value);
  });

  const report = fc.check(property, { numRuns: NUM_RUNS, interruptAfterTimeLimit: TIME_BUDGET_MS, markInterruptAsFailure: false });
  if (report.interrupted) return { name, verdict: 'skipped', reason: 'exceeded the time budget' };
  if (!report.failed) return { name, verdict: 'equivalent' };

  const { before, after } = callBoth(...report.counterexample);
  return {
    name,
    verdict: 'diverged',
    input: report.counterexample,
    before: before.threw ? { threw: before.value } : before.value,
    after: after.threw ? { threw: after.value } : after.value,
  };
}

/**
 * The fast-check equivalence check for every pure export touched between `beforeSource` and `afterSource`
 * (#749): parses both, finds exported functions present (by name) in both with different source text, skips
 * anything domainPurity doesn't clear or whose parameter types this check can't generate, and runs the rest
 * through fast-check. Deterministic and LLM-free; a parse failure on either side reports nothing rather than
 * guessing.
 *
 * @param {string} beforeSource The source before the edit.
 * @param {string} afterSource The source after the edit.
 * @returns {{checked: object[], skipped: {name: string, reason: string}[], reason?: string}}
 *
 * @example
 * pureExportEquivalence(
 *   'export const total = (a, b) => a + b;',
 *   'export const total = (a, b) => a - b;',
 * );
 * // => { checked: [{ name: 'total', verdict: 'diverged', input: [...], before: ..., after: ... }], skipped: [] }
 */
export function pureExportEquivalence(beforeSource, afterSource) {
  let beforeAst;
  let afterAst;
  try {
    beforeAst = parseToAst(beforeSource);
    afterAst = parseToAst(afterSource);
  } catch (e) {
    return { checked: [], skipped: [], reason: `parse error: ${e?.message ?? e}` };
  }

  const beforeCandidates = findTopLevelPureCandidates(beforeAst, beforeSource);
  const afterByName = new Map(findTopLevelPureCandidates(afterAst, afterSource).map((c) => [c.name, c]));

  const checked = [];
  const skipped = [];

  for (const before of beforeCandidates) {
    const after = afterByName.get(before.name);
    if (!after || before.source === after.source) continue; // removed, or untouched

    if (!before.isPure || !after.isPure) {
      skipped.push({ name: before.name, reason: 'not detected as pure' });
      continue;
    }
    const arbitraries = arbitrariesForParams(after.params);
    if (!arbitraries) {
      skipped.push({ name: before.name, reason: 'unsupported parameter types' });
      continue;
    }
    checked.push(runEquivalence(before.name, before.evalSource, after.evalSource, arbitraries));
  }

  return { checked, skipped };
}
