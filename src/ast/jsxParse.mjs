// AST package: strict JSX parsing on typescript-estree (the JSX edit/analysis family, #173).
//
// Unlike parseToAst (which falls back to non-JSX mode), the JSX operations always parse in JSX +
// TypeScript mode as a module and let syntax errors propagate: an editor must never guess at
// intent for text that is not valid JSX. Positions are `range` (UTF-16 offsets) and `loc` lines.
import { parse } from '@typescript-eslint/typescript-estree';
import { walkAst } from './walk.mjs';

const JSX_OPTIONS = { jsx: true, loc: true, range: true, comment: false, sourceType: 'module', errorOnUnknownASTType: false };

// TypeScript's parser rejects a bare `>` or `}` in JSX text ("Did you mean `{'>'}`?"); Babel -- the parser
// this editor used before -- and real-world pages accept it. JSX text is never inspected by any JSX
// operation, so on exactly that diagnostic the offending character is blanked (same length, so every
// offset is unchanged) in the copy handed to the parser, and parsing is retried. Source text is never modified.
const BARE_TEXT_CHAR = /^Unexpected token\. Did you mean `\{'[>}]'\}`/;
const MAX_TEXT_REPAIRS = 500;

function parseWithTextRepair(source) {
  let text = source;
  for (let repairs = 0; ; repairs++) {
    try {
      return parse(text, JSX_OPTIONS);
    } catch (e) {
      const at = e.index;
      if (repairs >= MAX_TEXT_REPAIRS || !BARE_TEXT_CHAR.test(e.message) || (text[at] !== '>' && text[at] !== '}')) throw e;
      text = text.slice(0, at) + ' ' + text.slice(at + 1);
    }
  }
}

// TypeScript accepts `<a b={} />` (it reports that as a checker error, not a syntax error); it is invalid JSX.
function assertNoEmptyAttributeExpressions(ast) {
  walkAst(ast, {
    enter(node) {
      if (node.type === 'JSXAttribute' && node.value?.type === 'JSXExpressionContainer' && node.value.expression.type === 'JSXEmptyExpression') {
        const err = new Error('JSX attributes must only be assigned a non-empty expression.');
        err.index = node.value.range[0];
        throw err;
      }
    },
  });
}

/** Parse `source` as a JSX/TSX module. Throws (a plain Error carrying the parser's message) on a syntax error. */
export function parseJsx(source) {
  const ast = parseWithTextRepair(source);
  assertNoEmptyAttributeExpressions(ast);
  return ast;
}

/** The parser's error message if `source` is not a valid JSX/TSX module, else `null`. */
export function jsxParseError(source) {
  try {
    parseJsx(source);
    return null;
  } catch (e) {
    return e.message;
  }
}

/**
 * Check a replacement snippet that is to be spliced in place of one JSX node: it must parse on its
 * own as a JSX expression, and be exactly one element or fragment. Returns `{ok: true}`, or
 * `{ok: false, kind: 'parse', error}` (not valid JSX) / `{ok: false, kind: 'shape'}` (valid, but not a
 * single JSX element/fragment).
 */
export function checkJsxReplacement(snippet) {
  let ast;
  try {
    ast = parseJsx(`const __x__ = (\n${snippet}\n);`);
  } catch (e) {
    return { ok: false, kind: 'parse', error: e.message };
  }
  const init = ast.body[0]?.declarations?.[0]?.init;
  if (!init || !(init.type === 'JSXElement' || init.type === 'JSXFragment')) return { ok: false, kind: 'shape' };
  return { ok: true };
}
