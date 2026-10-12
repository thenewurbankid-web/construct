// Module hooks that let Node's own test runner load the primitives' .tsx sources and test kits: TypeScript's
// transpileModule turns TSX into plain ESM (JSX via react/jsx-runtime); extensionless relative imports resolve to
// .tsx, then .ts. Registered by register-tsx.mjs; only files outside node_modules are transformed.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const TS_FILE = /\.(c|m)?tsx?$/;

/**
 * Resolve an import; a relative specifier without an extension tries .tsx, then .ts.
 * @param {string} specifier The import specifier.
 * @param {object} context Node's resolve context.
 * @param {Function} next The next resolver.
 * @returns {Promise<object>} The resolution.
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (!/^\.{1,2}\//.test(specifier) || /\.[a-z]+$/i.test(specifier)) throw error;
    for (const ext of ['.tsx', '.ts']) {
      try { return await next(`${specifier}${ext}`, context); } catch { /* try the next extension */ }
    }
    throw error;
  }
}

/**
 * Load a module; project .ts/.tsx files are transpiled to ESM.
 * @param {string} url The module URL.
 * @param {object} context Node's load context.
 * @param {Function} next The next loader.
 * @returns {Promise<object>} The loaded module.
 */
export async function load(url, context, next) {
  if (!url.startsWith('file:') || !TS_FILE.test(url) || url.includes('/node_modules/')) return next(url, context);
  const file = fileURLToPath(url);
  const source = await readFile(file, 'utf8');
  const out = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, sourceMap: false, inlineSourceMap: true },
  });
  return { format: 'module', source: out.outputText, shortCircuit: true };
}
