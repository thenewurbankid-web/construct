// Which parts of the refactor pipeline are deterministic, and the one switch
// that lets a model in.
//
// DEFAULT: fully deterministic. /api/refactor returns transform.js's AST pass
// and never calls a model. The LLM extraction step (server.js, Ollama
// /api/chat, "split a multi-concern function into named helpers") runs only
// when it is explicitly switched on -- `"llmExtraction": true` in config.json,
// or `"llm": true` in that one request's body -- and even then only for a
// function the likelyNeedsExtraction heuristic flags; its output is still
// re-validated (parses, no reintroduced ternary/raw operator) and falls back
// to the AST pass otherwise.
//
// Every rule transform.js applies is a pure AST rewrite: same input, same
// output, no network, no clock, no randomness. In pass order:
const DETERMINISTIC_RULES = [
  { pass: 0, rule: 'accumulatorLoop', does: 'a declare/for-of/push/flag accumulator loop -> map/filter (tryConvertAccumulatorLoop)' },
  { pass: 1, rule: 'ternaryTautology', does: 'return c ? true : false -> return c; return c ? false : true -> return !c' },
  { pass: 1, rule: 'ternaryReturn', does: 'return c ? a : b -> if (c) { return a } else { return b }' },
  { pass: 1, rule: 'ternaryAssign', does: 'x = c ? a : b; -> if (c) { x = a } else { x = b }' },
  { pass: 1, rule: 'comparison', does: '===/== -> a.equals(b); > < >= <= -> a.greaterThan(b) / lessThan / greaterThanOrEqual / lessThanOrEqual' },
  { pass: 1, rule: 'negatedComparison', does: '!==/!= -> !a.equals(b)' },
  { pass: 1, rule: 'logical', does: 'a && b -> and(a, b); a || b -> or(a, b)' },
  { pass: 2, rule: 'branchChain', does: 'if/else-if/else where every branch is one bare return -> branch().ifIt(...).elseIfIt(...).elseIt(...), risky member args extracted to named consts first' },
  { pass: 2, rule: 'andOrSentence', does: 'and(a.m(x), b.n(y)) / or(...) with exactly two plain subject.method(arg) leaves -> ifIt(a).m(x).and(b).n(y)' },
  { pass: 2, rule: 'collapseParams', does: 'a 2+ plain-identifier param function/method -> one named collection param, destructured as its first statement' },
  { pass: 3, rule: 'pushToMethod', does: 'items.push(x) / a.items.push(x) -> .pushToItems(x) (receiver has a stable name)' },
  { pass: 3, rule: 'memberToMethod', does: 'a.b (a plain property read) -> a.bOfA()' },
];

// The only LLM step. Off unless explicitly enabled.
function llmExtractionEnabled(cfg = {}, body = {}) {
  return cfg.llmExtraction === true || (body && body.llm === true);
}

module.exports = { DETERMINISTIC_RULES, llmExtractionEnabled };
