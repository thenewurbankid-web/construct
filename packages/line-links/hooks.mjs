// cu1 -- the module hooks behind importLinked (index.mjs). In-process (`module.registerHooks`, Node >= 22.15), no
// loader flag and no dependency. They act only on linked names and on files under a linked source folder:
//
//   resolve   `@mx/<name>` -> its entry file; inside a linked source, a relative `./x.js` that does not exist -> `./x.ts`
//             (the TypeScript repo imports with `.js` specifiers, as NodeNext asks).
//   load      a `.ts`/`.mts` file under a linked source -> JavaScript through Node's own `stripTypeScriptTypes` in
//             transform mode (the source uses parameter properties, which plain type stripping refuses).
//
// Everything else (Construct's own files, node_modules, JSON) goes to Node's default resolve and load unchanged.
import fs from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const roots = new Set();
const names = new Map();
let installed = false;

/** @param {string} dir A linked source folder; files under it are transformed. */
export function addLinkRoot(dir) {
  roots.add(pathToFileURL(dir.endsWith('/') ? dir : `${dir}/`).href);
}

/** @param {string} name `@mx/<name>` @param {string} entryFile The file the name resolves to. */
export function addLinkName(name, entryFile) {
  names.set(name, pathToFileURL(entryFile).href);
}

const underRoot = (url) => typeof url === 'string' && !url.includes('/node_modules/') && [...roots].some((r) => url.startsWith(r));
const TS = /\.(c|m)?ts$/;

function quietStrip(source, url) {
  // stripTypeScriptTypes warns once that it is experimental; the link is opt-in, so keep that line out of CLI output.
  const emit = process.emitWarning;
  process.emitWarning = (w, ...rest) => { if (!/stripTypeScriptTypes|Type Stripping/i.test(String(w?.message ?? w))) emit.call(process, w, ...rest); };
  try { return stripTypeScriptTypes(source, /** @type {any} */ ({ mode: 'transform', sourceUrl: url })); } finally { process.emitWarning = emit; }
}

/** Install the hooks once per process (later calls do nothing). */
export function installLinkHooks() {
  if (installed) return;
  installed = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const mapped = names.get(specifier);
      if (mapped) return { url: mapped, format: 'module', shortCircuit: true };
      if (underRoot(context.parentURL) && /^\.\.?\//.test(specifier) && specifier.endsWith('.js')) {
        const asJs = new URL(specifier, context.parentURL);
        if (!fs.existsSync(fileURLToPath(asJs))) {
          const asTs = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
          if (fs.existsSync(fileURLToPath(asTs))) return { url: asTs.href, format: 'module', shortCircuit: true };
        }
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (underRoot(url) && TS.test(new URL(url).pathname)) {
        const source = fs.readFileSync(fileURLToPath(url), 'utf8');
        return { format: 'module', source: quietStrip(source, url), shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
}
