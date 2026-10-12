// Results of the planner eval (#896), as plain JSON files.
//
//   <resultsDir>/<setup>/items.json   { setup, versions, mode, createdAt, apps, items: Item[] }   one eval run of a setup
//   <resultsDir>/<setup>/owner.json   { <itemId>: { scores, note, rubricVersion, at } }            the owner's grades
//   fixtures/results/<setup>/...      the same, committed (recorded with the fake judge; see fixtures/record.mjs)
//
// resultsDir defaults to trace/eval/beam/results (gitignored); TRACE_BEAM_RESULTS overrides it (the Playwright spec
// points it at a scratch folder). A setup that exists in both places is read from resultsDir. The owner's grades of a
// fixture setup start from the fixture's owner.json and are written to resultsDir, never into fixtures/.
import fs from "node:fs";
import path from "node:path";
import { BEAM_DIR, parseSetupId, loadRubric } from "./prompts.mjs";
import { reviewOrder, summarize } from "./agreement.mjs";
import { labelMatch } from "./gold.mjs";

export const FIXTURES_DIR = path.join(BEAM_DIR, "fixtures");

/** The folders a store reads and writes. */
export function beamDirs(env = process.env) {
  return {
    resultsDir: path.resolve(env.TRACE_BEAM_RESULTS || path.join(BEAM_DIR, "results")),
    runsDir: path.resolve(env.TRACE_BEAM_RUNS || path.join(BEAM_DIR, "runs")),
    fixturesDir: FIXTURES_DIR,
  };
}

const readJson = (p, fallback = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n"); };
const setupDirs = (root) => { try { return fs.readdirSync(root).filter((d) => parseSetupId(d) && fs.existsSync(path.join(root, d, "items.json"))); } catch { return []; } };

export function createStore(dirs = beamDirs()) {
  const fixtureResults = path.join(dirs.fixturesDir, "results");
  const where = (setup) => (fs.existsSync(path.join(dirs.resultsDir, setup, "items.json")) ? "results" : fs.existsSync(path.join(fixtureResults, setup, "items.json")) ? "fixture" : null);
  const docPath = (setup) => path.join(where(setup) === "results" ? dirs.resultsDir : fixtureResults, setup, "items.json");
  const ownerOf = (setup) => readJson(path.join(dirs.resultsDir, setup, "owner.json")) ?? readJson(path.join(fixtureResults, setup, "owner.json")) ?? {};

  return {
    dirs,
    /** Every setup with results, newest first. */
    listSetups() {
      const ids = [...new Set([...setupDirs(dirs.resultsDir), ...setupDirs(fixtureResults)])];
      return ids.map((id) => {
        const doc = readJson(docPath(id), {});
        return { id, versions: doc.versions ?? parseSetupId(id), source: where(id), mode: doc.mode ?? null, createdAt: doc.createdAt ?? null, items: (doc.items ?? []).length };
      }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id));
    },

    /** The raw results document of a setup (gold included: callers that face a judge must not pass it on). */
    loadDoc(setup) {
      if (!parseSetupId(setup) || !where(setup)) return null;
      return readJson(docPath(setup));
    },

    /**
     * A setup for the owner's view: owner grades merged, agreement computed, review order, summary. The requester's
     * gold labels are withheld until the owner has graded the item (`goldHidden`), so they cannot steer the owner.
     */
    view(setup) {
      const doc = this.loadDoc(setup);
      if (!doc) return null;
      const rubric = loadRubric(doc.versions?.rubric);
      const owner = ownerOf(setup);
      const items = doc.items.map((i) => ({ ...i, owner: owner[i.id] ?? null }));
      const ordered = reviewOrder(items, rubric.lines).map((i) => {
        const graded = Boolean(i.owner?.scores && rubric.lines.every((l) => Number.isInteger(i.owner.scores[l.id])));
        const { notes, gold, ...rest } = i;
        return graded ? { ...rest, gold, notes, goldHidden: false, goldMatch: labelMatch(gold, i.labels) } : { ...rest, goldHidden: true };
      });
      return { setup, source: where(setup), versions: doc.versions, mode: doc.mode, createdAt: doc.createdAt, apps: doc.apps, rubric: { version: rubric.version, lines: rubric.lines }, summary: summarize(items, rubric.lines), items: ordered };
    },

    /** Save an eval run's results document. */
    saveDoc(setup, doc) { writeJson(path.join(dirs.resultsDir, setup, "items.json"), doc); },

    /**
     * Save the owner's grade of one item. Scores are checked against the rubric the setup was graded with.
     * @returns {{ok: true, owner: object}|{ok: false, error: string}}
     */
    saveOwner(setup, itemId, { scores, note }, at = new Date().toISOString()) {
      const doc = this.loadDoc(setup);
      if (!doc) return { ok: false, error: "unknown setup" };
      if (!doc.items.some((i) => i.id === itemId)) return { ok: false, error: "unknown item" };
      const rubric = loadRubric(doc.versions?.rubric);
      const clean = {};
      for (const l of rubric.lines) {
        const v = scores?.[l.id];
        if (v === null || v === undefined) continue;
        if (!Number.isInteger(v) || v < 0 || v > l.max) return { ok: false, error: `${l.id} must be an integer 0..${l.max}` };
        clean[l.id] = v;
      }
      const owner = ownerOf(setup);
      owner[itemId] = { scores: clean, note: String(note ?? "").slice(0, 2000), rubricVersion: rubric.version, at };
      writeJson(path.join(dirs.resultsDir, setup, "owner.json"), owner);
      return { ok: true, owner: owner[itemId] };
    },
  };
}
