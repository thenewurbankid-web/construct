// The FLOW section of a feature summary (#328, core half): how a URL reaches a feature's code and what
// that code is made of, drawn from the REAL import graph, not from a fixed layer order.
//
//   route (root) -> controller(s) -> "behaviour" branch (hook, workflow, service, domain)
//                                 -> "render"    branch (page, component)
//
// Presentation only: no folder structure change, no validation rule. Deterministic, no LLM.
//   - Roots are ROUTES, from the per-framework adapter (route-adapters.mjs, #334). A framework with no
//     adapter shows NO routes (a note says so), never a guess.
//   - A route that renders controllers from several features is a FAN-OUT: the route on top, each feature
//     beneath, ordered by the route file's own IMPORT ORDER. Every feature under the route is expanded
//     (`self` marks the summarized one); the shared-once rule spans the whole route tree.
//   - A CONTROLLER reached by several routes REPEATS under each route, so each route reads as a complete
//     flow. Files BELOW a controller are listed once per route tree and marked `shownAbove` afterwards.
//   - `types.ts` and `index.ts` are left out. A feature barrel (`features/x/index.ts`) is followed to the
//     file that defines what was imported, which is how a shared component is reached (SLICE-002).
//   - A feature no route reaches gets an info-level note (a note, not a warning: libraries are legitimate).
// Reuses: facts.mjs (ctx.facts / ctx.layerOf), impact.mjs (buildImportGraph, scopeOf), route-adapters.mjs.
import { buildImportGraph, scopeOf } from '../impact.mjs';
import { importBindings, throughBarrel, isStructuralFile, routeAdapterFor, frameworkOf } from './route-adapters.mjs';

const BEHAVIOUR = new Set(['hook', 'workflow', 'service', 'domain']);
const RENDER = new Set(['page', 'component']);
const BRANCHES = ['behaviour', 'render', 'other'];
const branchOf = (layer) => (BEHAVIOUR.has(layer) ? 'behaviour' : RENDER.has(layer) ? 'render' : 'other');
const isTest = (p) => /\.(test|spec)\./.test(p);

export const NOTE_NO_ROUTE = { severity: 'info', code: 'no-route', message: 'No route reaches this feature. That is fine for a shared library.' };

/** What `file` imports, in the file's own import order, following feature barrels to real files and
 * leaving out types.ts / index.ts / tests. Edges come from the real import graph. */
function importsOf(ctx, graph, file) {
  const direct = new Set(graph.deps.get(file) || []);
  const out = [];
  for (const b of importBindings(ctx, file)) {
    if (!b.resolved || !direct.has(b.resolved)) continue;
    for (const t of throughBarrel(ctx, b.resolved, [b.imported])) {
      if (t !== file && !isStructuralFile(t) && !isTest(t) && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

export function buildFlow(ctx, feature, { detail = 'standard', adapters, graph = buildImportGraph(ctx) } = {}) {
  const adapter = routeAdapterFor(ctx, adapters);
  const framework = frameworkOf(ctx);
  if (!adapter) {
    return { framework, routeAdapter: false, routes: [], notes: [{ severity: 'info', code: 'no-route-adapter', message: `No route adapter exists for framework "${framework}", so no routes are shown.` }] };
  }
  const withPurpose = detail === 'full';

  const nodeOf = (file, seen) => {
    const layer = ctx.layerOf(file) || 'unclassified';
    const owner = scopeOf(ctx, file);
    const base = { file, layer, ...(owner.name !== feature ? { feature: owner.name } : {}), ...(withPurpose ? { purpose: ctx.facts(file).purpose } : {}) };
    if (seen.has(file)) return { ...base, shownAbove: true };
    seen.add(file);
    const children = importsOf(ctx, graph, file).map((t) => nodeOf(t, seen));
    return children.length ? { ...base, children } : base;
  };

  const controllerTree = (file, seen) => {
    seen.add(file);
    const buckets = { behaviour: [], render: [], other: [] };
    for (const t of importsOf(ctx, graph, file)) buckets[branchOf(ctx.layerOf(t))].push(t);
    const tree = { file, layer: 'controller' };
    // behaviour first, then render: a file both branches use is drawn under behaviour and "shown above" under render
    for (const k of BRANCHES) if (buckets[k].length) tree[k] = buckets[k].map((t) => nodeOf(t, seen));
    return tree;
  };

  const routes = adapter.routes(ctx).filter((r) => r.entries.some((e) => e.feature === feature)).map((r) => {
    const seen = new Set(); // shared-once is per route tree, so each route reads as a complete flow
    const byFeature = [];
    for (const e of r.entries) {
      let f = byFeature.find((x) => x.feature === e.feature);
      if (!f) byFeature.push((f = { feature: e.feature, self: e.feature === feature, ref: `feature:${e.feature}`, controllers: [] }));
      f.controllers.push(controllerTree(e.file, seen));
    }
    return { route: r.route, file: r.file, fanOut: byFeature.length > 1, features: byFeature };
  });

  const notes = [];
  if (!routes.length && !adapter.featureRoutes(ctx, feature).length) notes.push({ ...NOTE_NO_ROUTE });
  return { framework, routeAdapter: true, routes, notes };
}

// ---- markdown ---------------------------------------------------------------------------------

function nodeLines(n, depth) {
  const pad = '  '.repeat(depth);
  const tag = n.shownAbove ? ' _(shown above)_' : '';
  const from = n.feature ? ` (from ${n.feature})` : '';
  return [`${pad}- ${n.layer}: \`${n.file}\`${from}${tag}`, ...(n.children || []).flatMap((c) => nodeLines(c, depth + 1))];
}

/** The flow as an indented tree for humans (`construct summarize <feature> --format markdown`). */
export function renderFlowMarkdown(flow) {
  const lines = [];
  for (const r of flow.routes) {
    lines.push(`- route \`${r.route}\` (${r.file})${r.fanOut ? ` — fan-out: ${r.features.map((f) => f.feature).join(', ')}` : ''}`);
    for (const f of r.features) {
      for (const c of f.controllers) {
        lines.push(`  - ${f.feature}: controller \`${c.file}\``);
        for (const k of BRANCHES) if (c[k]) lines.push(`    - ${k}`, ...c[k].flatMap((n) => nodeLines(n, 3)));
      }
    }
  }
  if (!flow.routes.length) lines.push('- _no routes_');
  for (const n of flow.notes) lines.push(`- ${n.severity}: ${n.message}`);
  return lines.join('\n');
}
