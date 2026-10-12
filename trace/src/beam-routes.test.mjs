// #896: the planner eval routes, called directly (no server, no model). The guard (Host, Origin, content type) for
// these routes is asserted with every other route in server.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBeamRoutes, EVAL_MISSING } from "./beam-routes.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplesDir = path.join(root, "examples");
const envIn = (extra = {}) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "beam-routes-")); return { TRACE_BEAM_RESULTS: path.join(d, "results"), TRACE_BEAM_RUNS: path.join(d, "runs"), ...extra }; };
const h = { readBody: async (req) => req.body, json: (res, code, body) => { res.code = code; res.body = body; }, file: (res, p) => { res.code = 200; res.file = p; } };
const call = async (route, method, p, body) => { const res = {}; const handled = await route({ method, body }, res, new URL(p, "http://127.0.0.1"), h); return { handled, ...res }; };
const waitJob = async (route, id) => { for (let i = 0; i < 100; i++) { const r = await call(route, "GET", `/api/beam/job?id=${id}`); if (r.body.status !== "running") return r.body; await new Promise((ok) => setTimeout(ok, 20)); } throw new Error("job did not finish"); };

test("pages and unknown paths: /beam and its module are served, other paths fall through", async () => {
  const route = createBeamRoutes({ examplesDir, env: envIn() });
  assert.match((await call(route, "GET", "/beam")).file, /ui\/beam\.html$/);
  assert.match((await call(route, "GET", "/ui/beam.mjs")).file, /ui\/beam\.mjs$/);
  assert.equal((await call(route, "GET", "/studio")).handled, false);
  assert.equal((await call(route, "GET", "/api/beam/nope")).code, 404);
});

test("setups, a setup's view, the owner's grade", async () => {
  const env = envIn();
  const route = createBeamRoutes({ examplesDir, env });
  const s = await call(route, "GET", "/api/beam/setups");
  assert.deepEqual(s.body.setups.map((x) => x.id).sort(), ["r-v1.g-v1", "r-v1.g-v2"]);
  assert.deepEqual(s.body.versions.grader, ["v2", "v1"]);
  assert.equal(s.body.live, false);
  const v = await call(route, "GET", "/api/beam/setup?id=r-v1.g-v1");
  assert.equal(v.body.items[0].id, "orders-2");
  assert.equal((await call(route, "GET", "/api/beam/setup?id=..%2F..")).code, 404);
  assert.equal((await call(route, "POST", "/api/beam/owner", { setup: "r-v1.g-v1", item: "orders-1", scores: { path: 7 } })).code, 400);
  assert.equal((await call(route, "POST", "/api/beam/owner", { setup: 1 })).code, 400);
  const ok = await call(route, "POST", "/api/beam/owner", { setup: "r-v1.g-v1", item: "orders-1", scores: { intent: 2, path: 3, reuse: 2, question: 2, unused: 2 }, note: "ok" });
  assert.equal(ok.code, 200);
  assert.ok(fs.existsSync(path.join(env.TRACE_BEAM_RESULTS, "r-v1.g-v1", "owner.json")));
});

test("re-run replays by default; a live run needs TRACE_BEAM_LIVE=1 and live:true", async () => {
  const env = envIn();
  const route = createBeamRoutes({ examplesDir, env });
  assert.equal((await call(route, "POST", "/api/beam/run", { requester: "v1", grader: "../x" })).code, 400);
  assert.equal((await call(route, "POST", "/api/beam/run", { requester: "v1", grader: "v9" })).code, 400);
  assert.equal((await call(route, "POST", "/api/beam/run", { requester: "v1", grader: "v2", live: true })).code, 403);
  const r = await call(route, "POST", "/api/beam/run", { requester: "v1", grader: "v2" });
  assert.equal(r.code, 202);
  assert.equal(r.body.live, false);
  const job = await waitJob(route, r.body.job);
  assert.equal(job.status, "done", job.error);
  const doc = JSON.parse(fs.readFileSync(path.join(env.TRACE_BEAM_RESULTS, "r-v1.g-v2", "items.json"), "utf8"));
  assert.equal(doc.mode, "replay");
  assert.equal(doc.calls, 0);
  assert.equal(doc.items.length, 6);

  const seen = [];
  const liveRoute = createBeamRoutes({ examplesDir, env: envIn({ TRACE_BEAM_LIVE: "1" }), run: async (o) => { seen.push(o); } });
  const lr = await call(liveRoute, "POST", "/api/beam/run", { requester: "v1", grader: "v1", live: true, apps: ["contacts", "../../etc"], items: 3 });
  assert.equal(lr.code, 202);
  assert.equal(seen[0].dryRun, false);
  assert.deepEqual(seen[0].apps, ["contacts", "orders"], "a bad app list falls back to the setup's own apps");
  assert.equal(seen[0].items, 3);
});

test("a deploy build without eval/beam: the pages still load, the API answers 503 with a sentence, the server module imports", async () => {
  const route = createBeamRoutes({ examplesDir, env: envIn(), loadEval: async () => null });
  assert.match((await call(route, "GET", "/beam")).file, /ui\/beam\.html$/);
  const r = await call(route, "GET", "/api/beam/setups");
  assert.equal(r.code, 503);
  assert.equal(r.body.error, EVAL_MISSING);
  // beam-routes.mjs itself never imports ../eval at load time (a deploy build ships only src/, examples/, subframe-app/)
  const own = fs.readFileSync(path.join(root, "src", "beam-routes.mjs"), "utf8");
  assert.doesNotMatch(own, /^import [^\n]*\.\.\/eval\//m);
});
