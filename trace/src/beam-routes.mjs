// #896: the planner eval page (/beam) and its API. Reads and writes only through eval/beam/store.mjs; runs only through
// eval/beam/pipeline.mjs runAndSave (the same entry point as `node eval/beam/run.mjs`).
//
//   GET  /beam                       the page            GET /ui/beam.mjs   its module
//   GET  /api/beam/setups            setups with results, prompt versions per role, whether live runs are allowed
//   GET  /api/beam/setup?id=<setup>  one setup for the owner: items in review order, summary, rubric (gold withheld
//                                    until the owner has graded an item)
//   POST /api/beam/owner             { setup, item, scores, note }  the owner's grade of one item
//   POST /api/beam/run               { requester, grader, live? }   re-run a setup; answers { job } at once
//   GET  /api/beam/job?id=<job>      { status: running | done | error, setup, error? }
//
// Live (Opus) runs need the server started with TRACE_BEAM_LIVE=1 AND { live: true } in the request; otherwise a run
// is a replay of recorded transcripts and never calls a model. TRACE_BEAM_RESULTS / TRACE_BEAM_RUNS move the data.
//
// eval/ is loaded lazily, on the first /api/beam/* request, not imported at the top: a deploy build ships only
// build-info.mjs's TOP_DIRS (src, examples, subframe-app), so a static import of ../eval would stop the deployed
// server from starting at all. In a build without eval/ the API answers 503 with a sentence; the rest of the server runs.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const UI = { "/beam": ["ui/beam.html", "text/html; charset=utf-8"], "/ui/beam.mjs": ["ui/beam.mjs", "text/javascript"] };
const VERSION = /^[\w-]{1,32}$/;
export const EVAL_MISSING = "The planner eval (trace/eval/beam) is a dev tool and is not part of this build; run the server from the Trace source checkout to use /beam.";

/** The eval modules this file uses, imported on first use; null when this build has no eval/beam (a deploy build). */
export async function loadBeamEval() {
  if (!fs.existsSync(path.join(here, "..", "eval", "beam", "store.mjs"))) return null;
  const [store, prompts, pipeline] = await Promise.all([import("../eval/beam/store.mjs"), import("../eval/beam/prompts.mjs"), import("../eval/beam/pipeline.mjs")]);
  return { createStore: store.createStore, beamDirs: store.beamDirs, listVersions: prompts.listVersions, loadPrompt: prompts.loadPrompt, setupId: prompts.setupId, runAndSave: pipeline.runAndSave };
}

/**
 * @param {{examplesDir: string, env?: NodeJS.ProcessEnv, run?: Function, loadEval?: typeof loadBeamEval}} ctx
 * @returns {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, url: URL, h: {readBody: Function, json: Function, file: Function}) => Promise<boolean>}
 */
export function createBeamRoutes({ examplesDir, env = process.env, run, loadEval = loadBeamEval }) {
  const liveAllowed = env.TRACE_BEAM_LIVE === "1";
  const jobs = new Map();
  let ready = null; // Promise of { ev, dirs, store }, or of null when eval/ is not in this build
  const init = () => (ready ??= loadEval().then((ev) => { if (!ev) return null; const dirs = ev.beamDirs(env); return { ev, dirs, store: ev.createStore(dirs) }; }));

  return async function beamRoute(req, res, url, { readBody, json, file }) {
    const p = url.pathname;
    if (UI[p]) { file(res, path.join(here, UI[p][0]), UI[p][1]); return true; }
    if (!/^\/api\/beam\//.test(p)) return false;
    const loaded = await init();
    if (!loaded) { json(res, 503, { error: EVAL_MISSING }); return true; }
    const { ev, dirs, store } = loaded;
    const { listVersions, loadPrompt, setupId } = ev;

    if (p === "/api/beam/setups" && req.method === "GET") {
      json(res, 200, {
        setups: store.listSetups(),
        versions: { requester: listVersions("requester").map((v) => v.version), grader: listVersions("grader").map((v) => v.version), rubric: listVersions("rubric").map((v) => v.version) },
        live: liveAllowed,
      });
      return true;
    }
    if (p === "/api/beam/setup" && req.method === "GET") {
      const v = store.view(url.searchParams.get("id") ?? "");
      json(res, v ? 200 : 404, v ?? { error: "unknown setup" });
      return true;
    }
    if (p === "/api/beam/owner" && req.method === "POST") {
      const { setup, item, scores, note } = await readBody(req);
      if (typeof setup !== "string" || typeof item !== "string" || (scores !== undefined && (typeof scores !== "object" || scores === null))) { json(res, 400, { error: "setup and item must be strings, scores an object" }); return true; }
      const r = store.saveOwner(setup, item, { scores: scores ?? {}, note });
      json(res, r.ok ? 200 : 400, r);
      return true;
    }
    if (p === "/api/beam/run" && req.method === "POST") {
      const body = await readBody(req);
      const { requester, grader } = body;
      if (!VERSION.test(String(requester)) || !VERSION.test(String(grader))) { json(res, 400, { error: "requester and grader must be version ids" }); return true; }
      let setup;
      try { setup = setupId(loadPrompt("requester", requester).version, loadPrompt("grader", grader).version); } catch (e) { json(res, 400, { error: e.message }); return true; }
      const live = body.live === true;
      if (live && !liveAllowed) { json(res, 403, { error: "live runs are off: start the server with TRACE_BEAM_LIVE=1 to call Opus" }); return true; }
      const prev = store.loadDoc(setup) ?? store.loadDoc(setupId("v1", "v1"));
      const apps = Array.isArray(body.apps) && body.apps.every((a) => /^[\w-]+$/.test(a) && fs.existsSync(path.join(examplesDir, a, "feature.json"))) ? body.apps : prev?.apps ?? ["contacts", "orders"];
      const items = Number.isInteger(body.items) && body.items > 0 && body.items <= 100 ? body.items : prev?.items?.length ?? 6;
      const id = randomUUID();
      const job = { id, setup, status: "running", live, error: null, startedAt: new Date().toISOString() };
      jobs.set(id, job);
      (run ?? ev.runAndSave)({ requester, grader, apps, items, dryRun: !live, examplesDir, dirs, store })
        .then(() => { job.status = "done"; })
        .catch((e) => { job.status = "error"; job.error = e.message; });
      json(res, 202, { job: id, setup, live });
      return true;
    }
    if (p === "/api/beam/job" && req.method === "GET") {
      const job = jobs.get(url.searchParams.get("id") ?? "");
      json(res, job ? 200 : 404, job ?? { error: "unknown job" });
      return true;
    }
    json(res, 404, { error: "not found" });
    return true;
  };
}
