// Types from the TypeScript checker, for code whose parameters are typed only by their
// context: `send(state, event)` inside `const machine: AtomMachine<PollState, PollEvent> =
// {...}` has no annotation, so the equivalence check generated nothing it could use and
// most runs never reached the code past `switch (event.type)`.
//
//   const checker = createCheckerTypes()
//   checker.paramTypes(file, code, kind) -> [descriptor | null] per parameter, in the shapes
//                                           bench/atoms/equivalence.js generates values from
//   checker.typesAt({ file, code, start, end }) -> ['expr: type', ...] for a place's parts
//
// One program per file, with its real imports. Read-only: nothing is written.
const ts = require('typescript');

const UNKNOWN = { k: 'unknown' };
const OPTIONS = { noEmit: true, strict: true, allowImportingTsExtensions: true, allowJs: true, skipLibCheck: true, jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2023 };

// A checker type -> a value descriptor (equivalence.js describeType gives the same shapes
// from written annotations).
function describeTsType(type, checker, at, depth = 0) {
  if (!type || depth > 5) return UNKNOWN;
  const sub = (t) => describeTsType(t, checker, at, depth + 1);
  const F = ts.TypeFlags;
  const f = type.flags;
  if (f & (F.Any | F.Unknown | F.Never | F.TypeParameter)) return UNKNOWN;
  if (f & F.StringLiteral) return { k: 'lit', v: type.value };
  if (f & F.NumberLiteral) return { k: 'lit', v: type.value };
  if (f & F.BooleanLiteral) return { k: 'lit', v: type.intrinsicName === 'true' };
  if (f & F.Boolean) return { k: 'boolean' };
  if (f & F.String || f & F.TemplateLiteral) return { k: 'string' };
  if (f & F.Number) return { k: 'number' };
  if (f & F.Null) return { k: 'lit', v: null };
  if (f & (F.Undefined | F.Void)) return { k: 'undefined' };
  if (type.isUnion()) return { k: 'union', of: type.types.map(sub) };
  if (type.isIntersection()) {
    const parts = type.types.map(sub);
    return parts.every((p) => p.k === 'object') ? { k: 'object', fields: parts.flatMap((p) => p.fields) } : parts[0];
  }
  if (!(f & F.Object)) return UNKNOWN;
  const args = checker.getTypeArguments ? (type.target ? checker.getTypeArguments(type) : []) : [];
  if (checker.isTupleType(type)) return { k: 'tuple', of: args.map(sub) };
  if (checker.isArrayType(type)) return { k: 'array', of: sub(args[0]) };
  const name = type.symbol && type.symbol.name;
  if (name === 'Date') return { k: 'date' };
  if (name === 'RegExp') return { k: 'regexp' };
  if (name === 'Set' || name === 'ReadonlySet') return { k: 'set', of: sub(args[0]) };
  if (name === 'Map' || name === 'ReadonlyMap') return { k: 'map', key: sub(args[0]), of: sub(args[1]) };
  if (type.getCallSignatures().length) return { k: 'fn' };
  const props = checker.getPropertiesOfType(type);
  const index = type.getStringIndexType();
  if (!props.length && index) return { k: 'record', of: sub(index) };
  return {
    k: 'object',
    fields: props.map((p) => {
      const t = checker.getTypeOfSymbolAtLocation(p, at);
      return { name: p.name, optional: !!(p.flags & ts.SymbolFlags.Optional), d: t.getCallSignatures().length ? { k: 'fn' } : sub(t) };
    }),
  };
}

function createCheckerTypes() {
  const programs = new Map();
  const sourceFor = (file) => {
    if (!programs.has(file)) programs.set(file, ts.createProgram([file], OPTIONS));
    const program = programs.get(file);
    return { program, sf: program.getSourceFile(file), checker: program.getTypeChecker() };
  };
  // the deepest node spanning exactly [start, end), or the function starting at `start`
  const nodeAt = (sf, start, end, test) => {
    let hit = null;
    const visit = (n) => {
      if (n.getStart(sf) <= start && n.end >= end) {
        if (n.getStart(sf) === start && (end == null || n.end === end) && (!test || test(n))) hit = n;
        ts.forEachChild(n, visit);
      }
    };
    visit(sf);
    return hit;
  };

  function paramTypes(file, code) {
    const { sf, checker } = sourceFor(file);
    const at = sf ? sf.text.indexOf(code) : -1;
    if (at < 0) return null;
    const fn = nodeAt(sf, at, null, ts.isFunctionLike);
    if (!fn) return null;
    return fn.parameters.map((p) => (p.type ? null : describeTsType(checker.getTypeAtLocation(p.name), checker, p)));
  }

  function typesAt(c) {
    const { sf, checker } = sourceFor(c.file);
    const at = sf ? sf.text.indexOf(c.code) : -1;
    if (at < 0) return [];
    const node = nodeAt(sf, at + c.start, at + c.end);
    if (!node) return [];
    const parts = ts.isBinaryExpression(node) ? [node.left, node.right]
      : ts.isCallExpression(node) ? [...(ts.isPropertyAccessExpression(node.expression) ? [node.expression.expression] : []), ...node.arguments]
        : ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? [node.expression]
          : [];
    const show = (n) => `${n.getText(sf).replace(/\s+/g, ' ').slice(0, 80)}: ${checker.typeToString(checker.getTypeAtLocation(n), undefined, ts.TypeFormatFlags.NoTruncation).slice(0, 160)}`;
    return [...parts.map(show), show(node)];
  }

  return { paramTypes, typesAt };
}

module.exports = { createCheckerTypes, describeTsType };
