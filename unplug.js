// UNPLUG: fold an edited plug.tsx back into source.tsx (LIN-122, block 2 of
// 2 -- PLUG is block 1, plug.js).
//
// Scope of this block: matches top-level declarations between source.tsx
// and unplug.tsx by name (plug() never adds/removes/renames/reorders
// top-level declarations -- transform.js only rewrites expressions INSIDE
// them -- so a name mismatch here means the user restructured the module
// in a way this block doesn't handle yet). For each matched declaration:
//   - byte-identical to a fresh plug(source) -> untouched, copied from
//     source.tsx byte-for-byte (this is what makes the empty-edit round
//     trip exact: unplug(source, plug(source)) === source).
//   - same statements, different order -> a pure reorder. Applied to
//     source.tsx's OWN statements (never the atomic ones), via
//     to-english.js's reorderSteps, so nothing needs to be "resolved back"
//     -- the raw source for each statement was never touched.
//   - anything else (a statement's content actually changed -- an edited
//     atom call, a new statement, a literal changed) -- flagged with a
//     reason, left untouched in source.tsx. Never guessed at and silently
//     applied; that's a later block (mapping a changed atom call back to
//     the atom's registered implementation).
const parser = require('@babel/parser');
const generate = require('@babel/generator').default;
const { plug, TSX_PLUGINS } = require('./plug');
const { toEnglish, reorderSteps } = require('./to-english');

const PARSE_OPTS = { sourceType: 'module', plugins: TSX_PLUGINS };

function normalize(code) {
  return generate(parser.parse(code, PARSE_OPTS), { retainLines: false }).code;
}

// Same idea as normalize(), but for a single STATEMENT slice (a step's own
// `.code`, e.g. a bare `return x + y;`) rather than a full declaration --
// those aren't valid standalone program text without this flag (Babel
// rejects a top-level `return`).
function normalizeStmt(code) {
  return generate(parser.parse(code, { ...PARSE_OPTS, allowReturnOutsideFunction: true }), { retainLines: false }).code;
}

// One entry per top-level declaration this block understands well enough to
// name and locate: `function foo(){}`, `export function foo(){}`,
// `export const foo = ...`. Kind 'function' is the only kind reorder-diffing
// applies to; everything else is name/span-only (used for the untouched-
// byte-for-byte and flag-only paths).
// `start`/`end` are the FULL top-level declaration span (includes a leading
// `export `, when present) -- used to splice a replacement into the file.
// `fnStart`/`fnEnd` are the bare FunctionDeclaration node's own span (no
// `export` keyword) -- that's the only shape reorderSteps/toEnglish (kind
// 'function') can parse standalone, so content comparison and reordering
// both operate on that inner slice, and `export ` (source.slice(start,
// fnStart)) is stitched back on unchanged when rebuilding.
function topLevelDecls(code) {
  const ast = parser.parse(code, PARSE_OPTS);
  const decls = [];
  for (const node of ast.program.body) {
    const info = declInfo(node);
    if (info) decls.push({ ...info, start: node.start, end: node.end });
  }
  return decls;
}

function declInfo(node) {
  if (node.type === 'FunctionDeclaration' && node.id) {
    return { name: node.id.name, kind: 'function', fnStart: node.start, fnEnd: node.end };
  }
  if (node.type === 'ExportNamedDeclaration' && node.declaration) {
    const d = node.declaration;
    if (d.type === 'FunctionDeclaration' && d.id) return { name: d.id.name, kind: 'function', fnStart: d.start, fnEnd: d.end };
    if (d.type === 'VariableDeclaration' && d.declarations.length === 1 && d.declarations[0].id.type === 'Identifier') {
      return { name: d.declarations[0].id.name, kind: 'other' };
    }
  }
  return null;
}

// Tries to explain editedCode as a pure reorder of pristineCode's top-level
// statements (both already-plugged function text). Returns the `order`
// array reorderSteps expects (pristine statement index at each edited
// position) when every edited statement matches some pristine statement 1:1
// by normalized text; null when it isn't a pure reorder (content actually
// changed, or a statement was added/removed).
function matchAsReorder(pristineCode, editedCode) {
  const pristineSteps = toEnglish(pristineCode, 'function').steps;
  const editedSteps = toEnglish(editedCode, 'function').steps;
  if (pristineSteps.length !== editedSteps.length) return null;

  const pristineNorm = pristineSteps.map((s) => normalizeStmt(s.code));
  const used = new Array(pristineNorm.length).fill(false);
  const order = [];
  for (const step of editedSteps) {
    const target = normalizeStmt(step.code);
    const i = pristineNorm.findIndex((c, idx) => c === target && !used[idx]);
    if (i === -1) return null;
    used[i] = true;
    order.push(i);
  }
  return order;
}

function unplug(originalSource, editedPlugText) {
  const pristinePlugText = plug(originalSource);
  const origDecls = topLevelDecls(originalSource);
  const pristineDecls = topLevelDecls(pristinePlugText);
  const editedDecls = topLevelDecls(editedPlugText);

  const names = pristineDecls.map((d) => d.name);
  const editedNames = editedDecls.map((d) => d.name);
  const sameShape = names.length === editedNames.length && names.every((n, i) => n === editedNames[i]);

  if (!sameShape) {
    return {
      updated: originalSource,
      changed: [],
      flags: [{ name: null, reason: 'Top-level declarations were added, removed, renamed, or reordered in unplug.tsx -- not supported yet; source.tsx left unchanged.' }],
    };
  }

  const origByName = new Map(origDecls.map((d) => [d.name, d]));
  const edits = [];
  const changed = [];
  const flags = [];

  for (const name of names) {
    const origDecl = origByName.get(name);
    const pristineDecl = pristineDecls.find((d) => d.name === name);
    const editedDecl = editedDecls.find((d) => d.name === name);
    if (!origDecl) {
      flags.push({ name, reason: `"${name}" has no matching declaration in source.tsx; skipped.` });
      continue;
    }

    const pristineFull = pristinePlugText.slice(pristineDecl.start, pristineDecl.end);
    const editedFull = editedPlugText.slice(editedDecl.start, editedDecl.end);
    if (normalize(pristineFull) === normalize(editedFull)) continue; // untouched

    if (pristineDecl.kind !== 'function') {
      flags.push({ name, reason: `"${name}" changed but isn't a function -- only reordering statements inside functions is supported in this block.` });
      continue;
    }

    // Bare-function slices (no `export `) -- the only shape reorderSteps/
    // toEnglish can parse standalone.
    const pristineFn = pristinePlugText.slice(pristineDecl.fnStart, pristineDecl.fnEnd);
    const editedFn = editedPlugText.slice(editedDecl.fnStart, editedDecl.fnEnd);
    const origFn = originalSource.slice(origDecl.fnStart, origDecl.fnEnd);

    // A reorder's `order` array indexes PRISTINE's statement list; applying
    // it to origFn's own statements only makes sense when the two line up
    // 1:1. transform.js's collapseParams (multi-param -> `const [a, b] =
    // args;`) and its accumulator-loop rewrite both insert/remove
    // statements, so a step count mismatch means plug() restructured this
    // function -- flag it rather than mapping the wrong indices.
    const origStepCount = toEnglish(origFn, 'function').steps.length;
    const pristineStepCount = toEnglish(pristineFn, 'function').steps.length;
    if (origStepCount !== pristineStepCount) {
      flags.push({ name, reason: `"${name}" was restructured by plug() (e.g. multi-parameter collapse) -- reordering isn't supported for it in this block.` });
      continue;
    }

    const order = matchAsReorder(pristineFn, editedFn);
    if (!order) {
      flags.push({ name, reason: `"${name}"'s statements changed (not just reordered) -- resolving an edited atom call back to source code isn't supported yet.` });
      continue;
    }

    const { code: reorderedFn } = reorderSteps(origFn, 'function', order, { plugins: TSX_PLUGINS });
    // Stitch the reordered bare function back into its original outer span
    // (e.g. the `export ` prefix), byte-for-byte outside the function itself.
    const reordered =
      originalSource.slice(origDecl.start, origDecl.fnStart) + reorderedFn + originalSource.slice(origDecl.fnEnd, origDecl.end);
    edits.push({ start: origDecl.start, end: origDecl.end, code: reordered });
    changed.push({ name, before: originalSource.slice(origDecl.start, origDecl.end), after: reordered });
  }

  edits.sort((a, b) => b.start - a.start);
  let updated = originalSource;
  for (const e of edits) updated = updated.slice(0, e.start) + e.code + updated.slice(e.end);

  return { updated, changed, flags };
}

module.exports = { unplug };
