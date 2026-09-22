// PROP-LINK (#473): cross-references a component's DECLARED props (react-docgen, via
// describeComponent, #434) against what every real JSX call site of that component in the
// project actually PASSES. Two directions, both Info-level (owner decision, 2026-09-22 --
// this is a diagnostic, not a hard validation error):
//
//   - "missing": a REQUIRED prop (react-docgen `required: true` -- no default value, not
//     marked optional) that at least one call site never passes. The component renders but
//     silently does nothing where it's missing (e.g. a heart button with no onToggle).
//   - "unknown": an attribute a call site passes that the component's own declared props
//     never mention at all -- typically forwarded straight to a DOM attribute, or dead.
//
// An optional or defaulted prop is never flagged "missing" by itself: excluding it is exactly
// what checking `required === true` does, since react-docgen only sets that for a prop with no
// default and no `?`. This is the false-positive guard the ticket calls for.
//
// No LLM, nothing here evaluates or imports project code -- describeComponent parses with
// react-docgen (a sandboxed worker), and call sites come from the same deterministic building
// blocks the rest of Construct already uses: the project's own reverse import index
// (buildImportGraph, src/engine/impact.mjs -- the same one impact analysis/PR health use) and
// the JSX element tree (parseJsxTree, src/ast/jsxTree.mjs -- the same one the Pages editor's
// node-props panel uses). Same files in, same JSON out.
//
// Known, deliberate limits (see #473's own "exceptions" section):
//   - A call site that spreads props (`{...rest}`) can't be resolved statically in either
//     direction -- it is excluded from both checks rather than risking a false positive, and
//     counted separately as `notCheckedCallSites`.
//   - Only one level of import resolution is followed: a prop forwarded through an
//     intermediate wrapper/controller (`<Controller {...props} />` rendering the real
//     component) is not traced through to its ultimate call site.
//   - A JSX tag whose local name differs from the component's declared name only through an
//     aliased named import (`import { Foo as Bar }`) is not matched (default imports are
//     matched regardless of local name, which covers the common one-component-per-file case).
import fs from 'node:fs';
import path from 'node:path';
import { describeComponent } from './describeComponent.mjs';
import { createContext } from './units/facts.mjs';
import { buildImportGraph } from './impact.mjs';
import { resolveImportSpecifier } from '../route-resolver.mjs';
import { parseToAst, parseJsxTree, findImportOfName } from '../ast/index.mjs';
import { rel } from '../fs.mjs';
import { makeViolation } from '../diagnostics.mjs';

/** Every JSX call site of the component at `componentPath`, found in `importerRel` (a file
 * that the project's import graph says imports it). Resolves each candidate JSX tag's own
 * import back to a real file (never by name alone), so a same-named component from a
 * different file is never mistaken for this one. */
function callSitesIn(root, componentPath, aliases, importerRel) {
  const abs = path.join(root, importerRel);
  let source;
  try {
    source = fs.readFileSync(abs, 'utf8');
  } catch {
    return [];
  }
  let tree;
  let ast;
  try {
    tree = parseJsxTree(source);
    ast = parseToAst(source);
  } catch {
    return []; // not JSX, or a syntax error -- nothing we can check here
  }
  const tagBases = new Set();
  for (const node of tree.byId.values()) {
    if (node.isCustomComponent) tagBases.add(node.tag.split('.')[0]);
  }
  const sites = [];
  for (const tagBase of tagBases) {
    const imported = findImportOfName(ast, tagBase);
    if (!imported) continue;
    const resolved = resolveImportSpecifier(abs, imported.source, aliases);
    if (!resolved || rel(root, resolved) !== componentPath) continue;
    for (const node of tree.byId.values()) {
      if (!node.isCustomComponent || node.tag.split('.')[0] !== tagBase) continue;
      sites.push({
        file: importerRel,
        line: node.line,
        tag: node.tag,
        isDefault: imported.isDefault,
        spread: node.props.some((p) => p.kind === 'spread'),
        props: node.props.filter((p) => p.kind !== 'spread').map((p) => p.name),
      });
    }
  }
  return sites;
}

/** Missing/unknown findings for one described component against the call sites that resolve to it. */
function diffOneComponent(comp, allSites, onlyComponentInFile) {
  const sites = allSites
    .filter((s) => (s.isDefault ? onlyComponentInFile : s.tag.split('.')[0] === comp.name))
    .sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  const checked = sites.filter((s) => !s.spread);
  const notCheckedCallSites = sites.length - checked.length;

  const missing = [];
  for (const prop of comp.props) {
    if (prop.required !== true) continue; // optional or defaulted: never a gap by itself
    const lacking = checked.filter((s) => !s.props.includes(prop.name));
    if (!lacking.length) continue;
    missing.push({
      prop: prop.name,
      totalCallSites: checked.length,
      passedCallSites: checked.length - lacking.length,
      requiredCallSites: lacking.map((s) => ({ file: s.file, line: s.line })),
    });
  }

  const declared = new Set(comp.props.map((p) => p.name));
  const unknownByProp = new Map();
  for (const s of checked) {
    for (const name of s.props) {
      if (declared.has(name)) continue;
      if (!unknownByProp.has(name)) unknownByProp.set(name, []);
      unknownByProp.get(name).push({ file: s.file, line: s.line });
    }
  }
  const unknown = [...unknownByProp.entries()].map(([prop, callSites]) => ({ prop, callSites }));

  return { name: comp.name, callSiteCount: sites.length, notCheckedCallSites, missing, unknown };
}

/**
 * Cross-reference a component's declared props (react-docgen) against every real JSX call
 * site of it in the project: a required prop no call site ever passes ("missing"), or an
 * attribute a call site passes that the component never declares ("unknown"). Deterministic,
 * no LLM; same text in, same JSON out (given the same files on disk).
 *
 * @param {string} root Project root.
 * @param {string} componentPath Component file, relative to `root` (same shape describeComponent takes).
 * @param {{describeOptions?: object, ctx?: object, described?: object}} [opts] `describeOptions` forwards to
 *   describeComponent (engine/maxBytes/timeoutMs/describe); `ctx` reuses an already-built
 *   `createContext(root)` (from src/engine/units/facts.mjs) instead of building a fresh one --
 *   for a caller checking many components in the same project in one pass; `described` reuses a
 *   `describeComponent` result the caller already has (e.g. the Components screen's own
 *   describe route), skipping a second react-docgen parse of the same file.
 * @returns {Promise<{ok:true, path:string, components:object[]}|{ok:false, path:string, code:string, error:string}>}
 */
export async function checkPropLinks(root, componentPath, opts = {}) {
  const described = opts.described || (await describeComponent(root, componentPath, opts.describeOptions));
  if (!described.ok) return { ok: false, path: componentPath, code: described.code, error: described.error };
  if (!described.components.length) return { ok: true, path: componentPath, components: [] };

  const ctx = opts.ctx || createContext(root);
  const graph = buildImportGraph(ctx);
  const importerRels = graph.importers(componentPath);
  const aliases = ctx.aliases();
  const allSites = importerRels.flatMap((f) => callSitesIn(root, componentPath, aliases, f));

  const onlyComponentInFile = described.components.length === 1;
  const components = described.components.map((comp) => diffOneComponent(comp, allSites, onlyComponentInFile));
  return { ok: true, path: componentPath, components };
}

/**
 * Turn one `checkPropLinks` component result into diagnostics.mjs-shaped PROP-LINK violations
 * (severity always `info` — this is a finding, never a hard validation error), one per
 * (prop, call site) pair so each points at exactly where the gap is, e.g. "ShopHome.tsx:88 —
 * missing onToggle" / "CartDrawer.tsx:41 — passes an undeclared size". `file` is the
 * component's own file (this is what the Components screen has open when it asks), with the
 * real call site named in the message text.
 *
 * @param {string} componentPath The component's own file, relative to root.
 * @param {{name:string, missing:object[], unknown:object[]}} result One entry from `checkPropLinks(...).components`.
 * @param {{severity?: string}} [ruleConfig] `config.rules['PROP-LINK']` (from `loadConfig`), or omit for the
 *   default `info` severity. `severity: 'off'` returns no violations, same convention as every other rule.
 * @returns {object[]} `makeViolation`-shaped PROP-LINK violations.
 */
export function propLinkViolations(componentPath, result, ruleConfig = {}) {
  const severity = ruleConfig.severity || 'info';
  if (severity === 'off') return [];
  const out = [];
  for (const m of result.missing) {
    for (const site of m.requiredCallSites) {
      out.push(makeViolation({
        rule: 'PROP-LINK',
        module: 'architecture',
        severity,
        file: componentPath,
        line: 1,
        message: `"${result.name}" declares required prop "${m.prop}", never passed · ${m.passedCallSites} of ${m.totalCallSites} uses — missing at ${site.file}:${site.line}.`,
        why: 'A required prop with no value at a call site silently does nothing there; react-docgen and the JSX call graph agree this is not a rendering choice.',
        expected: [`"${m.prop}" passed at ${site.file}:${site.line}`],
      }));
    }
  }
  for (const u of result.unknown) {
    for (const site of u.callSites) {
      out.push(makeViolation({
        rule: 'PROP-LINK',
        module: 'architecture',
        severity,
        file: componentPath,
        line: 1,
        message: `"${result.name}" is called with "${u.prop}" at ${site.file}:${site.line}, which it does not declare as a prop.`,
        why: 'An attribute the component never reads is either dead or meant for a different element.',
        expected: [`a declared prop of "${result.name}", or removing "${u.prop}" at ${site.file}:${site.line}`],
      }));
    }
  }
  return out;
}
