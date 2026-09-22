import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectServerRoutes, renderRouteGroupMarkdown } from '../lib/serverRoutes.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('collectServerRoutes: direct routes and mounted sub-routers, grouped by /api/<group>', () => {
  const { groups, total } = collectServerRoutes(REPO_ROOT);
  assert.ok(total > 40, `expected many routes, got ${total}`);
  const byGroup = Object.fromEntries(groups.map((g) => [g.group, g.routes]));

  // A direct app.get in index.mjs itself.
  const health = byGroup.health?.find((r) => r.path === '/api/health' && r.method === 'GET');
  assert.ok(health, 'direct /api/health route is found');
  assert.equal(health.source, 'ui/server/src/index.mjs');

  // A mounted sub-router (processesApi.mjs), path-joined onto its mount.
  const processes = byGroup.processes;
  assert.ok(processes && processes.length > 3, 'processes sub-router routes are found');
  assert.ok(processes.some((r) => r.method === 'GET' && r.path === '/api/processes'), 'the router root route keeps the mount path');
  const decide = processes.find((r) => r.path === '/api/processes/:id/decide');
  assert.ok(decide, ':id/decide is joined correctly');
  assert.equal(decide.method, 'POST');
  assert.equal(decide.source, 'ui/server/src/processesApi.mjs');
  assert.ok(decide.params.includes('id'), 'path :params are captured');
  assert.ok(decide.body.includes('path') && decide.body.includes('verdict'), 'req.body destructured fields are captured');

  // cloneApi.mjs declares TWO router factories in one file (createCloneRouter, createRemoteRouter):
  // each mount's routes must come from its OWN factory body only, never the other one's.
  const clone = byGroup.clone || [];
  const remote = byGroup.git?.filter((r) => r.source === 'ui/server/src/cloneApi.mjs') || [];
  assert.ok(clone.length > 0 && remote.length > 0, 'both cloneApi.mjs-mounted groups have routes');
  assert.ok(!clone.some((r) => remote.some((r2) => r.method === r2.method && r.path === r2.path)), 'the two cloneApi.mjs routers do not bleed into each other');
});

test('collectServerRoutes: route comments never carry an internal ticket number', () => {
  const { groups } = collectServerRoutes(REPO_ROOT);
  for (const g of groups) for (const r of g.routes) assert.doesNotMatch(r.desc, /#\d+/, `${g.group} ${r.method} ${r.path}: "${r.desc}"`);
});

test('renderRouteGroupMarkdown: one heading per route, with a parameter table when there are params', () => {
  const { groups } = collectServerRoutes(REPO_ROOT);
  const g = groups.find((x) => x.group === 'processes');
  const md = renderRouteGroupMarkdown(g, (f) => `https://github.com/o/r/blob/main/${f}`);
  assert.match(md, /## `GET \/api\/processes`/);
  assert.match(md, /## `POST \/api\/processes\/:id\/decide`/);
  assert.match(md, /\| `id` \| path \|/);
  assert.match(md, /\[`ui\/server\/src\/processesApi\.mjs`\]\(https:\/\/github\.com\/o\/r\/blob\/main\/ui\/server\/src\/processesApi\.mjs\)/);
});
