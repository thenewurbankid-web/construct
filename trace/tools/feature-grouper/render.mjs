// Live-render support for the "Extract" button: turns a pasted TSX page (plus the groups `groupPage`
// already found for it) into a self-contained, browser-runnable bundle with a `data-group="gN"` attribute
// on each group member's own root JSX element, so the client (page.html) can mount it in a sandboxed
// iframe, read each `[data-group]` element's real `getBoundingClientRect()`, and draw an overlay box in
// the right place -- no guessing where a group landed on screen, the browser measures it.
//
// Construct check (project CLAUDE.md rule -- done before writing this):
//  - packages/engine/jsxSourceAnnotator.mjs does the closest thing (insert a source-position-keyed
//    attribute on a JSX element's opening tag, back-to-front so earlier offsets stay valid) but with a
//    different contract that doesn't fit: it annotates EVERY host element uniformly with
//    `data-cx-src="file:line:col"` and explicitly skips custom-component call sites ("the host elements
//    they render are annotated in their own files"). We need exactly the elements `groupPage` already
//    chose as group members -- which can themselves be a custom component's call site when that's the
//    group's root -- keyed by group id, not every host element. Its *insertion technique* is reused below
//    (see `insertGroupAttributes`); its own two-parser abstraction isn't, because this tool already has
//    its own single seam for that (./construct.mjs) and jsxSourceAnnotator hard-imports Construct's own
//    `packages/ast/index.mjs` directly.
//  - packages/engine/previewFiber.mjs reads React DevTools fiber internals from an ALREADY RUNNING dev
//    server (Vite, sourcemaps, a Cockpit-specific postMessage/nonce handshake). A pasted snippet has no
//    dev server and no sourcemap, so there is nothing for it to attach to.
//  - packages/engine/pageTransformer.mjs statically rewrites an ingested file into a Construct page
//    (extracts interactive props, emits a Props interface); it never renders anything, so it doesn't help
//    decide "what does this look like".
// None fit, so the render/bundle/mount pipeline below is this tool's own.
import esbuild from "esbuild";
import { PARSER } from "./construct.mjs";
import { groupPage } from "./grouper.mjs";

/** The attribute the client's overlay code looks for on the live-rendered DOM. */
export const GROUP_ATTR = "data-group";

/** Raised when a pasted page has no component to render, or esbuild cannot bundle it. */
export class RenderError extends Error {}

/**
 * Insert `data-group="<id>"` onto the opening tag of every group member's own root JSX element.
 * Pure; same technique Construct's jsxSourceAnnotator uses for its own per-element attribute (insert
 * right after the opening tag's name, applied back-to-front so an earlier insert never shifts a later
 * offset still to be applied).
 *
 * @param {string} source The page source `nodes` was built from (same string given to `groupPage`).
 * @param {object[]} nodes `groupPage`'s (non-enumerable) `result.nodes`: `{id, tag, start, ...}` per element.
 * @param {object[]} groups `groupPage`'s `result.groups`: `{id, members:[{id}, ...]}`.
 * @returns {string} `source` with one `data-group` attribute inserted per member.
 * @throws {Error} If a member's node id isn't in `nodes` (would mean `nodes`/`groups` came from different runs).
 */
export function insertGroupAttributes(source, nodes, groups) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inserts = [];
  for (const g of groups) {
    for (const m of g.members) {
      const node = byId.get(m.id);
      if (!node) throw new Error(`insertGroupAttributes: no node "${m.id}" for group ${g.id} (nodes and groups must come from the same groupPage() result)`);
      inserts.push({ at: node.start + 1 + node.tag.length, text: ` ${GROUP_ATTR}="${g.id}"` });
    }
  }
  inserts.sort((a, b) => b.at - a.at); // back to front keeps earlier offsets valid
  let code = source;
  for (const { at, text } of inserts) code = code.slice(0, at) + text + code.slice(at);
  return code;
}

const isComponentFn = (n) => n && (n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression" || n.type === "FunctionDeclaration");

/**
 * Find the page's own top-level component to render, among `ast`'s body. Every fixture and demo page this
 * tool already ships is `export default function XPage(...) {...}`, so that is tier "default"; a pasted
 * snippet may have had its `export` trimmed off, so this also accepts a plain top-level capitalized
 * function/const, tier "declared" (or "exported" if it kept a non-default `export`). This is a heuristic
 * about *which declaration* is "the page", not a guess about what the code does -- and the caller reports
 * which one it picked (`entry.tier`/`entry.name`) rather than rendering silently.
 *
 * @param {object} ast The `Program` node from `parseJsxTree(source).ast` -- walked generically (same
 *   `.type` duck-typing `describe.mjs`'s `buildNodes` already uses), so it works with either parser engine.
 * @returns {{name:string|null, tier:"default"|"exported"|"declared"|"anonymous-default"}|null} The chosen
 *   component, or null if nothing renderable was found.
 */
export function findEntryComponent(ast) {
  const declared = []; // {name, tier}
  let defaultName = null;
  let anonymousDefault = false;
  for (const node of ast.body ?? []) {
    if (node.type === "ExportDefaultDeclaration") {
      const d = node.declaration;
      if (isComponentFn(d)) {
        if (d.id?.name) defaultName = d.id.name;
        else anonymousDefault = true; // `export default () => ...` / `export default function () {...}`
      }
      continue;
    }
    const exported = node.type === "ExportNamedDeclaration";
    const decl = exported ? node.declaration : node;
    if (!decl) continue;
    if (decl.type === "FunctionDeclaration" && decl.id && /^[A-Z]/.test(decl.id.name)) {
      declared.push({ name: decl.id.name, tier: exported ? "exported" : "declared" });
    } else if (decl.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        if (d.id?.type === "Identifier" && /^[A-Z]/.test(d.id.name) && isComponentFn(d.init)) {
          declared.push({ name: d.id.name, tier: exported ? "exported" : "declared" });
        }
      }
    }
  }
  if (defaultName) return { name: defaultName, tier: "default" };
  if (anonymousDefault) return { name: null, tier: "anonymous-default" };
  const exportedOnes = declared.filter((d) => d.tier === "exported");
  if (exportedOnes.length) return exportedOnes[exportedOnes.length - 1];
  if (declared.length) return declared[declared.length - 1];
  return null;
}

/** Marks every bare-specifier import (not starting with "." or "/") external, so esbuild never tries to
 * resolve it from node_modules. The sandboxed iframe supplies "react"/"react-dom" itself via a tiny
 * `window.require` shim (see page.html); any other bare import fails at *runtime* inside the iframe with
 * a clear "Cannot resolve..." message instead of failing the whole bundle. */
const externalizeBarePlugin = {
  name: "fg-externalize-bare",
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) => ({ path: args.path, external: true }));
  },
};

/**
 * Build a self-contained, browser-runnable IIFE bundle of a pasted TSX page, with `data-group="gN"` on
 * each group member's root element, for the "Extract" live-preview overlay. The bundle assigns the chosen
 * entry component to `window.__FG_ENTRY__`; it does not mount anything itself (page.html's iframe
 * bootstrap does that, so it can also supply safe placeholder props and an error boundary).
 *
 * Relative imports (`import Row from "./Row"`) only resolve when `resolveDir` is given and is the page's
 * real directory on disk (true for a known demo-app page; never true for a freshly pasted snippet, which
 * has no file location) -- that, and any bare import other than "react"/"react-dom", are this preview's
 * known, documented limits, not something this function works around.
 *
 * @param {string} source The pasted page's TSX/JSX text.
 * @param {object} [options]
 * @param {string} [options.file] Name to report (default `"<pasted>"`).
 * @param {string} [options.resolveDir] Directory relative imports resolve against; omitted for a pasted
 *   snippet with no known location.
 * @param {object} [options.parser] Parser info from ./construct.mjs (default: this process's `PARSER`).
 * @param {object} [options.groupResult] An already-computed `groupPage` result to reuse, so one request
 *   does one parse+group pass instead of two; recomputed from `source` if omitted.
 * @returns {Promise<{code:string, entry:{name:string|null, tier:string}, groups:object[]}>}
 * @throws {RenderError} No entry component found, or esbuild could not bundle the page.
 */
export async function buildPreview(source, options = {}) {
  const { file = "<pasted>", resolveDir, parser = PARSER } = options;
  const result = options.groupResult ?? (await groupPage(source, { file, parser }));
  const tree = parser.parseJsxTree(source);
  const entry = findEntryComponent(tree.ast);
  if (!entry) {
    throw new RenderError(
      "no top-level page component found to render (expected `export default function Page() {...}`, `export default () => {...}`, or a capitalized top-level function/const)",
    );
  }

  let annotated = insertGroupAttributes(source, result.nodes, result.groups);
  if (entry.tier === "anonymous-default") {
    const idx = annotated.indexOf("export default");
    if (idx === -1) throw new RenderError("could not locate the anonymous `export default` to render");
    annotated = `${annotated.slice(0, idx)}window.__FG_ENTRY__ =${annotated.slice(idx + "export default".length)}`;
  } else {
    annotated += `\nwindow.__FG_ENTRY__ = typeof ${entry.name} !== "undefined" ? ${entry.name} : undefined;\n`;
  }

  let built;
  try {
    built = await esbuild.build({
      stdin: { contents: annotated, loader: "tsx", sourcefile: file, resolveDir: resolveDir ?? process.cwd() },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: "es2020",
      jsx: "transform",
      jsxFactory: "React.createElement",
      jsxFragment: "React.Fragment",
      logLevel: "silent",
      plugins: [externalizeBarePlugin],
    });
  } catch (e) {
    const detail = Array.isArray(e.errors) && e.errors.length ? e.errors.map((x) => x.text).join("; ") : e.message;
    throw new RenderError(`cannot render ${file} live: ${detail}`);
  }
  return { code: built.outputFiles[0].text, entry, groups: result.groups };
}
