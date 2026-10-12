// Playwright globalSetup: request every Cockpit route once before the first spec runs.
//
// `next dev` compiles a route the first time it is requested. A spec that walks several routes in one test (the
// profile menu's Settings, Local model and Help pages, project-gate.spec.js) used to spend its 30-60 s budget on
// those cold compiles and fail now and then. Playwright starts the webServers before globalSetup, so here every
// route is compiled once, one at a time (next dev compiles one route at a time anyway), and the specs see warm pages.
//
//   E2E_WARM_ROUTES=0                     skip the warm-up (a reused, already warm dev server)
//   E2E_WARM_ROUTES=/settings,/help       warm only these routes
//
// A route that fails to warm is reported and skipped: the spec that needs it will say what is wrong.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/app');
const PAGE = /^page\.(tsx|jsx|ts|js)$/;
const PER_ROUTE_MS = 120_000;
const ATTEMPTS = 4;

/** Every static App Router route under ui/client/app (dynamic `[x]` segments are left out; `(group)` folders add no segment). */
export function appRoutes(dir = APP, prefix = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isFile() && PAGE.test(e.name)) out.push(prefix || '/');
    if (!e.isDirectory() || e.name.startsWith('[') || e.name.startsWith('_') || e.name.startsWith('@')) continue;
    const seg = /^\(.*\)$/.test(e.name) ? '' : `/${e.name}`;
    out.push(...appRoutes(path.join(dir, e.name), `${prefix}${seg}`));
  }
  return [...new Set(out)];
}

export default async function warmRoutes(config) {
  const setting = process.env.E2E_WARM_ROUTES;
  if (setting === '0') return;
  const base = config.projects[0]?.use?.baseURL ?? `http://localhost:${Number(process.env.E2E_CLIENT_PORT) || 3000}`;
  const routes = setting ? setting.split(',').map((r) => r.trim()).filter(Boolean) : appRoutes();
  const t0 = Date.now();
  const failed = [];
  for (const route of routes) {
    let why = null;
    // a refused or reset connection (the dev server busy recompiling) is tried again, up to ATTEMPTS times
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const res = await fetch(new URL(route, base), { signal: AbortSignal.timeout(PER_ROUTE_MS) });
        await res.arrayBuffer();
        why = res.status >= 500 ? String(res.status) : null;
        break;
      } catch (e) {
        why = e?.name === 'TimeoutError' ? `no answer in ${PER_ROUTE_MS / 1000} s` : `${e?.message ?? e}${e?.cause?.code ? ` ${e.cause.code}` : ''}`;
        if (e?.name === 'TimeoutError') break;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    if (why) failed.push(`${route} (${why})`);
  }
  console.log(`[warm-routes] ${routes.length - failed.length} of ${routes.length} routes compiled in ${Math.round((Date.now() - t0) / 1000)} s${failed.length ? `; not warmed: ${failed.join(', ')}` : ''}`);
}
