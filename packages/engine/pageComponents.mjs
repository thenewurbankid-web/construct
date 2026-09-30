// PAGE-COMPONENTS (#716, Part of #715 -- Page->ViewModel Phase 1): loop the existing per-node
// analysis blocks (parseJsxTree, scopeLinks, describeComponent, classifyProjectFile) across a
// WHOLE page instead of one node at a time -- the building blocks already exist, nobody
// aggregates them across a page yet. This is the FORWARD direction of
// packages/engine/propLinks.mjs's checkPropLinks (component -> every call site, project-wide):
// here it's one page -> every custom component it renders, nested or not. Pure-ish (fs reads
// only, no evaluation of project code), no LLM, same text in -> same JSON out, and it never
// throws (same defensive contract as describeComponent.mjs).
//
//   resolvePageComponents(root, pageRelPath, opts?) -> Promise<Result>
//   Result = { ok: true,  path, components: [{ tag, nodeId, line, resolvedFile, layer,
//                          declaredProps, boundProps, unboundProps, undeclaredProps, childPropsResolved }] }
//          | { ok: false, path, code, error }
//   code: OUTSIDE_ROOT | NOT_SOURCE | NOT_FOUND | PARSE_ERROR | ENGINE_ERROR
//
// A tag whose import resolves to nothing (bare/package import, e.g. a UI-library button) still
// appears in `components` with `resolvedFile: null, layer: null` -- never silently dropped, so
// the caller sees the page's full render tree.
import fs from 'node:fs';
import path from 'node:path';
import { describeComponent, DESCRIBE_EXTENSIONS } from './describeComponent.mjs';
import { buildScopeLinks, importOfTag, providerHookImports } from './scopeLinks.mjs';
import { createContext } from './units/facts.mjs';
import { resolveImportSpecifier } from '../core/route-resolver.mjs';
import { classifyProjectFile } from '../core/architecture-graph.mjs';
import { parseJsx, parseJsxTree } from '../ast/index.mjs';
import { rel } from '../core/fs.mjs';

const fail = (relPath, code, error) => ({ ok: false, path: relPath, code, error });

/** Root-relative `relPath` -> real absolute path of a regular source file inside `root`, or a
 * failure result. Mirrors describeComponent.mjs's resolveFile containment-check shape exactly
 * (same reuse-the-pattern-don't-hand-roll-a-new-one contract #716 asks for). */
function resolvePageFile(root, relPath) {
  if (typeof relPath !== 'string' || !relPath || relPath.includes('\0') || path.isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath) || relPath.split(/[\\/]/).includes('..')) {
    return { fail: fail(String(relPath ?? ''), 'OUTSIDE_ROOT', 'That path is not a file inside the project.') };
  }
  if (!DESCRIBE_EXTENSIONS.includes(path.extname(relPath))) return { fail: fail(relPath, 'NOT_SOURCE', 'Only .tsx, .jsx, .ts, .js and .mjs files can be analyzed.') };
  try {
    const realRoot = fs.realpathSync(root);
    const real = fs.realpathSync(path.resolve(realRoot, relPath));
    const inside = real === realRoot || real.startsWith(realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep);
    if (!inside || real.split(path.sep).includes('node_modules')) return { fail: fail(relPath, 'OUTSIDE_ROOT', 'That path is not a file inside the project.') };
    if (!fs.statSync(real).isFile()) return { fail: fail(relPath, 'NOT_FOUND', 'No such file.') };
    return { real };
  } catch {
    return { fail: fail(relPath, 'NOT_FOUND', 'No such file.') };
  }
}

/** Every reachable Provider hook's own file source, keyed by import specifier (same lookup shape
 * `buildScopeLinks`' `providerSources` expects: `providerSources?.[source] ?? providerSources?.[hookName]`).
 * Computed once for the whole page (providerHookImports reads only the page's own top-level
 * imports, independent of which node is being described) -- reimplements
 * ui/server/src/pagesEditor.mjs's private resolveProviderSources using resolveImportSpecifier
 * (the correct cross-file, alias-aware resolver) instead of that file's UI-only resolver, per
 * #716's explicit instruction not to import UI-specific workspace-containment plumbing into a
 * core engine module. An import that doesn't resolve to a real in-project file is simply left
 * out -- same "unresolved -> no scope added" contract childSource already has below. */
function resolvePageProviderSources(pageSource, pageAbsPath, aliases) {
  let ast;
  try {
    ast = parseJsx(pageSource);
  } catch {
    return undefined;
  }
  const entries = {};
  for (const { source: specifier } of providerHookImports(ast)) {
    if (entries[specifier] !== undefined) continue;
    const abs = resolveImportSpecifier(pageAbsPath, specifier, aliases);
    if (!abs) continue;
    try {
      entries[specifier] = fs.readFileSync(abs, 'utf8');
    } catch {
      // leave unresolved -- same contract as an unreadable childSource below
    }
  }
  return Object.keys(entries).length ? entries : undefined;
}

/** Memoizing wrapper around describeComponent, keyed by resolved file: the same component
 * rendered many times on one page (e.g. inside a .map()) must not spin up a react-docgen worker
 * once per render. Stores the in-flight Promise (not its resolved value) so concurrent callers
 * within the same page also collapse onto one call. */
function describeCached(cache, root, relFile, describeOptions) {
  if (!cache.has(relFile)) cache.set(relFile, describeComponent(root, relFile, describeOptions));
  return cache.get(relFile);
}

/** Which of describeComponent's `components` (react-docgen, keyed by the name IT read off the
 * source) backs this JSX tag. A dotted tag (`Foo.Bar`) looks up the sub-component name, matching
 * buildScopeLinks' own resolveDeclared convention. A default import's local alias can differ from
 * the exported function's own name, so when there is exactly one described component in the file,
 * a default-imported tag falls back to it regardless of name (mirrors propLinks.mjs's
 * "onlyComponentInFile" heuristic). Returns null when nothing matches -- caller treats that as
 * "doc-derived props unknown", never a guess. */
function pickDescribed(described, tag, isDefault) {
  if (!described.ok || !described.components.length) return null;
  const wantName = tag.includes('.') ? tag.split('.').slice(-1)[0] : tag;
  const byName = described.components.find((c) => c.name === wantName);
  if (byName) return byName;
  if (isDefault && described.components.length === 1) return described.components[0];
  return null;
}

/**
 * Aggregate every custom component a page renders -- resolved file, layer, doc-derived declared
 * props, and prop-wiring status -- in one pass. Walks the WHOLE parsed tree (`byId.values()`, not
 * just `roots`), so elements nested inside a condition (`{show && <X/>}`) or a `.map()` callback
 * are included exactly like a page's outer element is.
 *
 * @param {string} root Project root.
 * @param {string} pageRelPath Page file, relative to `root` (same shape describeComponent takes).
 * @param {{describeOptions?: object, ctx?: object}} [opts] `describeOptions` forwards to
 *   describeComponent (engine/maxBytes/timeoutMs/describe); `ctx` reuses an already-built
 *   `createContext(root)` (packages/engine/units/facts.mjs) instead of building a fresh one --
 *   for a caller analyzing many pages in the same project in one pass.
 * @returns {Promise<{ok:true, path:string, components:object[]}|{ok:false, path:string, code:string, error:string}>}
 */
export async function resolvePageComponents(root, pageRelPath, opts = {}) {
  try {
    const at = resolvePageFile(root, pageRelPath);
    if (at.fail) return at.fail;
    const source = fs.readFileSync(at.real, 'utf8');

    let tree;
    try {
      tree = parseJsxTree(source);
    } catch {
      return fail(pageRelPath, 'PARSE_ERROR', 'This page could not be parsed as JSX/TSX.');
    }

    const ctx = opts.ctx || createContext(root);
    const graph = ctx.graph();
    const frozenGlobs = ctx.frozen();
    const aliases = ctx.aliases();
    const providerSources = resolvePageProviderSources(source, at.real, aliases);
    const describeCache = new Map();

    const components = [];
    for (const node of tree.byId.values()) {
      if (!node.isCustomComponent) continue;
      const imported = importOfTag(source, node.tag);
      const resolvedAbs = imported ? resolveImportSpecifier(at.real, imported.source, aliases) : null;

      let resolvedFile = null;
      let layer = null;
      let childSource;
      let declaredProps = [];
      if (resolvedAbs) {
        resolvedFile = rel(root, resolvedAbs);
        layer = classifyProjectFile(root, resolvedAbs, { graph, frozenGlobs });
        try {
          childSource = fs.readFileSync(resolvedAbs, 'utf8');
        } catch {
          childSource = undefined;
        }
        const described = await describeCached(describeCache, root, resolvedFile, opts.describeOptions);
        const match = pickDescribed(described, node.tag, imported.isDefault);
        declaredProps = match ? match.props : [];
      }

      let scoped;
      try {
        scoped = buildScopeLinks(source, node.id, { childSource, providerSources });
      } catch {
        scoped = null; // defensive only -- node.id always comes from this same parse, so NO_SUCH_NODE can't happen
      }

      const childProps = scoped?.childProps || [];
      components.push({
        tag: node.tag,
        nodeId: node.id,
        line: node.line,
        resolvedFile,
        layer,
        declaredProps,
        boundProps: childProps.filter((c) => c.status === 'bound').map((c) => c.name),
        unboundProps: childProps.filter((c) => c.status === 'unbound').map((c) => c.name),
        undeclaredProps: scoped?.undeclared || [],
        childPropsResolved: scoped?.childPropsResolved || false,
      });
    }
    return { ok: true, path: pageRelPath, components };
  } catch {
    return fail(String(pageRelPath ?? ''), 'ENGINE_ERROR', 'The page could not be analyzed.');
  }
}
