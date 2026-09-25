// AST package: load the TypeScript compiler and the typescript-estree parser on first use, not at import.
// `typescript` costs about 72 MB and 450 ms; importing a module that merely reaches the AST package (placement, plan,
// decide, summarize's first call) must not pay for it. Both are CommonJS, so a synchronous require keeps every call
// site synchronous: the first property read or call loads the module, later ones reuse it (#657).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cache = new Map();
const load = (name) => {
  if (!cache.has(name)) cache.set(name, require(name));
  return cache.get(name);
};

/**
 * The `typescript` module, loaded on the first property read. Use exactly like `import ts from 'typescript'`.
 * @type {typeof import('typescript')}
 */
export const ts = new Proxy({}, {
  get: (_target, key) => load('typescript')[key],
  has: (_target, key) => key in load('typescript'),
});

/**
 * typescript-estree's `parse`, loading the parser (and with it the compiler) on the first call.
 * @param {string} source Source text.
 * @param {object} options typescript-estree options.
 * @returns {object} A typescript-estree `Program` node.
 */
export const estreeParse = (source, options) => load('@typescript-eslint/typescript-estree').parse(source, options);
