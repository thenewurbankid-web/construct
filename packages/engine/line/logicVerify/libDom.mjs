// Line logic verification, spec E (step 5): read TypeScript's own lib.dom.d.ts through the compiler API, so the layout
// fakes are typed by the real declarations rather than a hand-kept list. One program over lib.es5 + es2015 + lib.dom
// (about 150 ms, built once per process and cached); `libDomInterface(name)` returns every member lib.dom.d.ts declares
// on that interface (inherited ones included) with its type text and whether it is a method.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ts } from '@construct/ast/lazy';

const require = createRequire(import.meta.url);
const LIBS = ['lib.es5.d.ts', 'lib.es2015.core.d.ts', 'lib.es2015.symbol.d.ts', 'lib.es2015.iterable.d.ts', 'lib.es2015.promise.d.ts', 'lib.dom.d.ts'];

/**
 * One member as lib.dom.d.ts declares it.
 * @typedef {{name: string, type: string, method: boolean, readonly: boolean, literals: string[]|null}} LibDomMember
 */

/** @type {{checker: import('typescript').TypeChecker, symbols: Map<string, import('typescript').Symbol>, file: string}|null} */
let LIB = null;
/** @type {Map<string, Map<string, LibDomMember>>} */
const CACHE = new Map();

/**
 * The path of the lib.dom.d.ts the installed TypeScript ships.
 * @returns {string}
 */
export function libDomPath() {
  return require.resolve('typescript/lib/lib.dom.d.ts');
}

function load() {
  if (LIB) return LIB;
  const dir = path.dirname(libDomPath());
  const roots = LIBS.map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));
  const program = ts.createProgram({ rootNames: roots, options: { noLib: true, types: [], noEmit: true, strict: true } });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(path.join(dir, 'lib.dom.d.ts'));
  if (!sf) throw new Error(`lib.dom.d.ts was not found next to ${dir}.`);
  const symbols = new Map();
  for (const s of checker.getSymbolsInScope(sf, ts.SymbolFlags.Interface)) symbols.set(s.name, s);
  LIB = { checker, symbols, file: sf.fileName };
  return LIB;
}

/** The string literals a type is a union of (`DocumentVisibilityState` -> hidden, visible), else null. */
function literalsOf(type) {
  const parts = type.isUnion() ? type.types : [type];
  const out = [];
  for (const p of parts) {
    if (!p.isStringLiteral()) return null;
    out.push(p.value);
  }
  return out.sort();
}

/**
 * Every member lib.dom.d.ts declares on `name` (own and inherited), by member name.
 * @param {string} name An interface name, e.g. `DOMRectReadOnly`, `Window`.
 * @returns {Map<string, LibDomMember>}
 */
export function libDomInterface(name) {
  if (CACHE.has(name)) return /** @type {Map<string, LibDomMember>} */ (CACHE.get(name));
  const { checker, symbols } = load();
  const sym = symbols.get(name);
  if (!sym) throw new TypeError(`lib.dom.d.ts declares no interface ${name}.`);
  const out = new Map();
  for (const p of checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(sym))) {
    const t = checker.getTypeOfSymbol(p);
    const decl = p.valueDeclaration ?? p.declarations?.[0];
    const readonly = Boolean(decl && ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Readonly);
    out.set(p.name, Object.freeze({ name: p.name, type: checker.typeToString(t), method: Boolean(p.flags & ts.SymbolFlags.Method), readonly, literals: literalsOf(t) }));
  }
  CACHE.set(name, out);
  return out;
}

/**
 * The fake value kind a lib.dom member type maps to: `number`, `boolean`, `string`, `DOMRect`, `DOMRect|null`,
 * `ResizeObserverSize[]`, `Element`, `method` or null when the layout fakes have no kind for it.
 * @param {LibDomMember} m
 * @returns {string|null}
 */
export function valueKindOf(m) {
  if (m.method) return 'method';
  const t = m.type;
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'string' || m.literals) return 'string';
  if (t === 'DOMRectReadOnly' || t === 'DOMRect') return 'DOMRect';
  if (t === 'DOMRectReadOnly | null' || t === 'DOMRect | null') return 'DOMRect|null';
  if (t === 'readonly ResizeObserverSize[]' || t === 'ResizeObserverSize[]') return 'ResizeObserverSize[]';
  if (t === 'Element') return 'Element';
  return null;
}
