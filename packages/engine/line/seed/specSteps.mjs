// #914 -- spec -> steps: the plan steps a block can fully decide from a project's SPEC.md, so the blocks do that part and
// a builder (a small model or a person) only fills the gaps. Deterministic, no LLM, writes nothing: it reads the spec and
// the project map and returns steps a plan runs through the usual checked writer.
//
//   parseSpecMd(text)                SPEC.md -> {features: [{name, story, points: [{id, text}]}], routes: [{route,
//                                    feature, page}]}: each "## <story> (feature `name`)" section's numbered points, and
//                                    the route table's rows (| `/route` | feature | page |), routes in Line's form
//   specSteps(root, {spec, planned}) the steps, stub-first per feature: its feature steps (openWork's line.createFeature,
//                                    or line.setCode of a placeholder spec.md), then per page route the spec names:
//                                    line.baseOn on the library page of its shape (#933 pageShape.mjs: list, form or
//                                    detail, read from the points about that page and its route), data-wired by
//                                    basePage.mjs, then line.addRoute. Each step's `why` names the spec point.
//
// Which routes a block can decide: the route table's rows (route, feature) and the points that say "The page at `/x`";
// a page whose shape the points do not decide (both a list and one record, or nothing said) is skipped with why, in the
// spec's words. A list of the member's own selection (a count every page shows, kept on reload, added to by name) is
// not wired to a fixture: `open` names the store for it (construct create store), its nav count link and its empty text,
// unless a recipe (atomSteps.mjs) seeds them.
// A route a point only mentions ("opens `/cart`") is never seeded: which feature and page serve it is the builder's
// call. Behaviour points (filters, forms, cart state) are atomSteps.mjs's (#919): wired from atoms when a block decides them. Idempotent: a step whose effect is on disk (the
// feature, the page, the served route) or that the plan already holds (`planned`, not done) is skipped, with why.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '@line/construct-core/config';
import { normalizeLineConfig, CODE_EXTENSIONS } from '@line/construct-core/profiles/line/contract';
import { resolveLayout } from '@line/construct-core/profiles/line/checks';
import { openWork } from '../openWork.mjs';
import { appDirOf, routeFolders, featurePages } from '../build.mjs';
import { arrayFixtures, fixtureFor } from '../basePage.mjs';
import { atomSteps } from './atomSteps.mjs';
import { routeEvidence, pageShape, pointRole, memberState, storeHint, namedRoutes } from './pageShape.mjs';

const posix = path.posix;
const readOrNull = (abs) => { try { return fs.readFileSync(abs, 'utf8'); } catch { return null; } };
/** "/products/<id>" or "/products/[id]" -> "/products/:id". */
const lineRoute = (r) => String(r).trim().replace(/<([A-Za-z]\w*)>/g, ':$1').replace(/\[([A-Za-z]\w*)\]/g, ':$1');
const pascal = (s) => String(s).split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');

/**
 * @typedef {{id: string, text: string}} SpecPoint
 * @typedef {{name: string, story: string, points: SpecPoint[]}} SpecFeature
 * @typedef {{route: string, feature: string, page: string}} SpecRoute
 * @typedef {{features: SpecFeature[], routes?: SpecRoute[]}} SeedSpec
 * @typedef {{tool: string, args: any, why: string, kind: 'feature'|'page'|'route', feature: string, point: string|null,
 *   route?: string, base?: string, fixture?: string}} SeedStep
 * @typedef {{kind: string, feature: string, route?: string, reason: string}} SeedSkip
 */

/**
 * SPEC.md as the seed reads it: its features (story and numbered points, "1. CAT-1: ...") and its route table.
 * @param {string} text The SPEC.md content.
 * @returns {{features: SpecFeature[], routes: SpecRoute[]}}
 */
export function parseSpecMd(text) {
  const s = String(text ?? '');
  const at = s.search(/^## /m);
  /** @type {SpecFeature[]} */
  const features = [];
  for (const sec of (at < 0 ? '' : s.slice(at)).split(/^(?=## )/m)) {
    const head = /^## (.+)$/m.exec(sec)?.[1] ?? '';
    const name = /\(feature `([\w-]+)`\)/.exec(head)?.[1];
    if (!name) continue;
    const story = head.replace(/\s*\(feature `[\w-]+`\)\s*$/, '').trim();
    const points = [...sec.matchAll(/^\d+\.\s+([A-Z][A-Z0-9]*-\d+):\s+(.+)$/gm)].map((m) => ({ id: m[1], text: m[2].trim() }));
    features.push({ name, story, points });
  }
  /** @type {SpecRoute[]} */
  const routes = [];
  for (const m of s.matchAll(/^\|\s*`(\/[^`\s]*)`\s*\|\s*`?([\w-]+)`?\s*\|\s*([^|]*?)\s*\|\s*$/gm)) {
    const route = lineRoute(m[1]);
    if (!routes.some((r) => r.route === route)) routes.push({ route, feature: m[2], page: m[3] });
  }
  return { features, routes };
}

/** The routes a point puts its page at ("The page at `/x`"), in Line's form. */
const pageAtRoutes = (text) => [...String(text).matchAll(/\bpage at `(\/[^`\s]*)`/g)].map((m) => lineRoute(m[1]));
/** Whether a point names `route` in backticks (any wording). */
const names = (text, route) => [...String(text).matchAll(/`(\/[^`\s]*)`/g)].some((m) => lineRoute(m[1]) === route);

/**
 * The page routes each feature serves, in spec order: the route table's rows for it, then its "page at" routes the table
 * does not give to another feature. Each with the point that names it (a "page at" point first), or null.
 * @param {SeedSpec} spec
 * @returns {Map<string, {route: string, point: SpecPoint|null, page: string}[]>}
 */
function routesByFeature(spec) {
  const table = spec.routes ?? [];
  const out = new Map(spec.features.map((f) => [f.name, /** @type {{route: string, point: SpecPoint|null, page: string}[]} */ ([])]));
  const pointFor = (f, route) => f.points.find((p) => pageAtRoutes(p.text).includes(route)) ?? f.points.find((p) => names(p.text, route)) ?? null;
  for (const r of table) {
    const f = spec.features.find((x) => x.name === r.feature);
    if (f) out.get(f.name)?.push({ route: r.route, point: pointFor(f, r.route), page: r.page });
  }
  for (const f of spec.features) {
    for (const p of f.points) for (const route of pageAtRoutes(p.text)) {
      if (table.some((r) => r.route === route) || [...out.values()].some((l) => l.some((x) => x.route === route))) continue;
      out.get(f.name)?.push({ route, point: p, page: '' });
    }
  }
  return out;
}

/** The page's name: the feature's first route gets <Feature>Page, a later one <LastSegment>Page. */
function pageName(feature, route, i, taken) {
  const seg = route.split('/').filter((x) => x && !x.startsWith(':')).at(-1);
  let n = `${pascal(i === 0 || !seg ? feature : seg)}Page`;
  for (let k = 2; taken.has(n); k += 1) n = `${pascal(i === 0 || !seg ? feature : seg)}Page${k}`;
  taken.add(n);
  return n;
}

/** Whether a plan step (not done) already does what `step` would: same feature, same page, same route. */
function plannedLike(planned, step) {
  return planned.some((s) => {
    if (s.tool !== step.tool) return false;
    const a = s.args ?? {};
    if (step.tool === 'line.createFeature') return a.name === step.args.name;
    if (step.tool === 'line.setCode') return a.file === step.args.file;
    if (step.tool === 'line.baseOn') return a.feature === step.args.feature && a.name === step.args.name;
    if (step.tool === 'line.addRoute') return lineRoute(a.route ?? '') === step.args.route;
    return false;
  });
}

/**
 * The plan steps a block can decide from `spec` for the project at `root`, stub-first (see the header).
 * @param {string} root Project root.
 * @param {{spec: SeedSpec, planned?: {tool: string, args?: any, state?: string}[]}} o `planned`: the current plan's
 *   steps (a done or cancelled one is ignored; its effect is on disk or nowhere).
 * @returns {{steps: SeedStep[], skipped: SeedSkip[], open: {point: string, feature: string, reason: string}[]}}
 */
export function specSteps(root, { spec, planned = [] }) {
  const layout = resolveLayout(root, normalizeLineConfig(/** @type {any} */ (loadConfig(root)).line));
  const open = planned.filter((s) => !['done', 'cancelled', 'skipped'].includes(String(s.state ?? '')));
  const work = openWork(root, { spec: { features: spec.features } });
  const byFeature = routesByFeature(spec);
  const libPages = (() => { try { return fs.readdirSync(path.join(root, layout.library, 'pages')).filter((n) => CODE_EXTENSIONS.includes(posix.extname(n))).sort(); } catch { return []; } })();
  const pages = featurePages(root).map((file) => ({ file, src: readOrNull(path.join(root, file)) ?? '' }));
  const served = new Set(pages.map((p) => /@line-route\s+(\S+)/.exec(p.src)?.[1]).filter(Boolean));
  const app = appDirOf(root);
  // #935: each feature sees its own fixtures, those its imported features export from their index, then the library's.
  const seen = new Map();
  const fixturesOf = (name) => { if (!seen.has(name)) seen.set(name, arrayFixtures(root, layout, name)); return seen.get(name); };
  /** @type {SeedStep[]} */
  const steps = [];
  /** @type {SeedSkip[]} */
  const skipped = [];
  /** @type {{point: string, feature: string, route: string, reason: string}[]} */
  const undecided = [];
  const push = (step) => {
    if (plannedLike(open, step)) skipped.push({ kind: step.kind, feature: step.feature, ...(step.route ? { route: step.route } : {}), reason: `the plan already has ${step.tool} for it` });
    else steps.push(step);
  };

  for (const f of spec.features) {
    const w = work.features.find((x) => x.name === f.name);
    const firstId = f.points[0]?.id ?? null;
    // The feature itself: openWork's exact steps (a missing feature, a missing or placeholder spec.md).
    for (const it of (w?.open ?? []).filter((x) => (x.kind === 'feature' || x.kind === 'spec') && x.step)) {
      push({ tool: it.step.tool, args: it.step.args, kind: 'feature', feature: f.name, point: firstId,
        why: it.kind === 'feature' ? `The spec has feature ${f.name} (${f.points.map((p) => p.id).join(', ')}) and the project has no folder for it yet.` : `The spec's story and points for ${f.name} (${f.points.map((p) => p.id).join(', ')}) are not in its spec.md yet.` });
    }
    const specText = readOrNull(path.join(root, layout.features, f.name, 'spec.md'));
    const textForFixture = specText && !/^- Describe one thing a person can do in /m.test(specText) ? specText : `${f.story}\n${f.points.map((p) => p.text).join('\n')}`;
    const taken = new Set(pages.filter((p) => p.file.split('/').at(-3) === f.name).map((p) => posix.basename(p.file).replace(/\.[^.]+$/, '')));
    (byFeature.get(f.name) ?? []).forEach(({ route, point, page }, i) => {
      const pid = point?.id ?? null;
      const said = !pid ? `The spec's route table serves ${f.name} at ${route}` : pageAtRoutes(point?.text).includes(route) ? `${pid} puts a page at ${route}` : `${pid} names ${route} (the route table gives it to ${f.name})`;
      let entry;
      try { const folders = routeFolders(route); entry = folders ? `${app}/${folders}/page` : `${app}/page`; } catch {
        skipped.push({ kind: 'route', feature: f.name, route, reason: `${route} is not a route Line can serve` }); return;
      }
      if (served.has(route) || ['tsx', 'ts', 'jsx', 'js'].some((x) => fs.existsSync(path.join(root, `${entry}.${x}`)))) {
        skipped.push({ kind: 'route', feature: f.name, route, reason: `${route} is served already` }); return;
      }
      // The page: an unrouted page of this feature with the seeded name is reused, else based on the fitting library page.
      // After line/r4-gaps merges, openWork.mjs pointStep (the baseOn that creates a point's page) can pick this step.
      const want = pageName(f.name, route, i, new Set());
      const existing = pages.find((p) => p.file.split('/').at(-3) === f.name && posix.basename(p.file).replace(/\.[^.]+$/, '') === want);
      let file;
      if (existing) {
        const other = /@line-route\s+(\S+)/.exec(existing.src)?.[1];
        if (other) { skipped.push({ kind: 'route', feature: f.name, route, reason: `${existing.file} serves ${other} already` }); return; }
        file = existing.file;
        skipped.push({ kind: 'page', feature: f.name, route, reason: `${file} exists already` });
      } else {
        const name = pageName(f.name, route, i, taken);
        const routes = (byFeature.get(f.name) ?? []).map((x) => x.route);
        const sh = pageShape({ route, points: routeEvidence(f, route, routes), label: page });
        if (!sh.shape) { skipped.push({ kind: 'page', feature: f.name, route, reason: sh.reason }); undecided.push({ point: pid ?? route, feature: f.name, route, reason: sh.reason }); return; }
        const lib = libPages.map((n) => ({ id: `pages/${n.replace(/\.[^.]+$/, '')}`, n })).find(({ id }) => id === sh.base);
        if (!lib) { skipped.push({ kind: 'page', feature: f.name, route, reason: `${sh.reason}, and the library has no ${sh.base.split('/')[1]}` }); return; }
        // A list or record of the member's own selection is a store, not the fixture (#933, open below).
        const own = sh.shape !== 'form' ? memberState(spec, f.name, routes) : null;
        // A detail page is a fixture record only when its route names the record (/x/:id); a confirmation is not.
        const fx = sh.shape !== 'form' && !own && (sh.shape === 'list' || route.includes(':')) ? fixtureFor(fixturesOf(f.name), f.name, textForFixture, sh.shape) : null;
        file = `${layout.features}/${f.name}/pages/${name}${posix.extname(lib.n)}`;
        push({ tool: 'line.baseOn', args: { libraryId: lib.id, feature: f.name, name }, kind: 'page', feature: f.name, point: pid, route, base: lib.id, ...(fx ? { fixture: fx.rel } : {}),
          why: `${said}: ${name} is based on the library ${lib.id.split('/')[1]}${fx ? `, wired to ${fx.rel}` : ''}.` });
      }
      push({ tool: 'line.addRoute', args: { route, page: file }, kind: 'route', feature: f.name, point: pid, route, why: `${said}: serve ${posix.basename(file).replace(/\.[^.]+$/, '')} there.` });
    });
  }
  // #919: then the behaviour points a block decides (atomSteps.mjs), once their pages are on disk; the rest stay open.
  const more = atomSteps(root, { spec, planned: open });
  const same = (a, b) => a.tool === b.tool && JSON.stringify(a.args) === JSON.stringify(b.args);
  for (const s of more.steps) if (!steps.some((x) => same(x, s))) steps.push(s);
  return { steps, skipped: [...skipped, ...more.skipped], open: [...more.open, ...selectionOpen(spec, byFeature, more, undecided)] };
}

/**
 * #933: what the seed leaves to the builder that no recipe takes, each in the spec's own words: a page whose shape the
 * points do not decide; a feature whose items are the member's own selection (the store to keep them in, never the
 * fixture); the nav link every page shows with their count (the app shell's nav slot); a list page's empty text (its
 * empty slot).
 * @param {SeedSpec} spec @param {Map<string, {route: string, point: SpecPoint|null, page: string}[]>} byFeature
 * @param {{claimed: string[], claimedRoutes: string[]}} more @param {{point: string, feature: string, route: string, reason: string}[]} undecided
 * @returns {{point: string, feature: string, reason: string}[]}
 */
function selectionOpen(spec, byFeature, more, undecided) {
  const claimed = new Set(more.claimed);
  /** @type {{point: string, feature: string, reason: string}[]} */
  const out = undecided.filter((u) => !more.claimedRoutes.includes(u.route)).map(({ point, feature, reason }) => ({ point, feature, reason: `which library page fits is the builder's call: ${reason}` }));
  const all = spec.features.flatMap((g) => g.points.map((p) => ({ p, feature: g.name })));
  /** One item per point: a second reason for the same point is added to it. */
  const add = (p, feature, reason) => {
    if (claimed.has(p.id)) return;
    const had = out.find((o) => o.point === p.id);
    if (had) had.reason = `${had.reason}; and ${reason}`; else out.push({ point: p.id, feature, reason });
  };
  // The member's own selections first (the store is what the nav link and the list page read), then the empty slots.
  for (const f of spec.features) {
    const routes = (byFeature.get(f.name) ?? []).map((x) => x.route);
    const st = memberState(spec, f.name, routes);
    if (!st) continue;
    const route = routes.find((r) => pageShape({ route: r, points: routeEvidence(f, r, routes) }).shape !== 'form');
    const first = route ? routeEvidence(f, route, routes)[0] : null;
    if (!first || claimed.has(first.id)) continue;
    add(first, f.name, `the ${f.name} are the member's own selection (${st.because.join('; ')}): keep them in a library store (${storeHint(f.name)}) and list it at ${route}, not a fixture`);
    for (const { p, feature } of all) {
      const r = pointRole(p.text);
      const to = namedRoutes(p.text).find((n) => routes.includes(n.route))?.route;
      if (r?.role === 'nav-count' && to) add(p, feature, `every page shows a link "${r.label ?? f.name} (<count>)" to ${to}: a component in the app shell's nav slot (line.setLayoutSlot nav) that counts the ${f.name} store`);
    }
  }
  for (const f of spec.features) {
    const routes = (byFeature.get(f.name) ?? []).map((x) => x.route);
    routes.forEach((route, i) => {
      const ev = routeEvidence(f, route, routes);
      if (pageShape({ route, points: ev, label: byFeature.get(f.name)?.[i]?.page ?? '' }).shape !== 'list') return;
      for (const p of ev) {
        const r = pointRole(p.text);
        if (r?.role === 'empty') add(p, f.name, `"${r.text}" is the empty slot of the list page at ${route} (the library ListPage's empty prop)`);
      }
    });
  }
  return out;
}

/**
 * The seed as one line per step, for a log or a builder: "1. line.baseOn {...} -- why".
 * @param {SeedStep[]} steps
 * @returns {string}
 */
export const seedText = (steps) => steps.map((s, i) => `${i + 1}. ${s.tool} ${JSON.stringify(s.tool === 'line.createFeature' || s.tool === 'line.setCode' ? { ...(s.args.name ? { name: s.args.name } : { file: s.args.file }) } : s.args)}: ${s.why}`).join('\n');
