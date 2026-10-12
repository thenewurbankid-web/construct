// What each judge is allowed to see (#896). Every judge and the planner get their input ONLY from these builders, and
// each builder is a whitelist: it copies named fields into a fresh object, never spreads an item.
//
//   requester (write)  the app: name, route, about, page source, endpoints with one example, story. Never the planner's
//                      saved answers or decisions, never the rubric.
//   requester (answer) the app, its own requirement and private notes, the planner's question. Never gold (the answer
//                      goes back to the planner, so labels must not ride along).
//   planner            the requirement text (and later the owner's answer). Nothing else.
//   grader             the requirement, the question and answer, ONE run (labels + path) under a blind id. Never gold,
//                      notes, or which run is recommended.
//
// `assertGraderInputClean` runs on every grader input before the call (judges.mjs) and in the tests.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadContract } from "../../src/contract.mjs";

/** Keys that must never appear anywhere in a grader or planner input. */
export const PRIVATE_KEYS = Object.freeze(["gold", "notes", "recommended", "privateNotes", "owner", "grader"]);

const readOr = (p, fallback = "") => { try { return fs.readFileSync(p, "utf8"); } catch { return fallback; } };
const oneExample = (v) => (Array.isArray(v) ? v.slice(0, 1) : v);

/**
 * The app as a product owner sees it.
 * @param {string} examplesDir
 * @param {string} app
 */
export function appView(examplesDir, app) {
  const dir = path.join(examplesDir, app);
  const spec = JSON.parse(readOr(path.join(dir, "feature.json"), "{}"));
  const contract = loadContract(dir);
  return {
    name: app,
    route: spec.route ?? null,
    about: spec.about ?? "",
    page: readOr(path.join(dir, spec.page ?? "page.jsx")),
    endpoints: (contract.apis ?? []).map((a) => ({ method: a.method, path: a.path, ...(a.request ? { request: a.request } : {}), ...(a.response !== undefined ? { response: oneExample(a.response) } : {}) })),
    story: readOr(path.join(dir, "story.md")) || null,
  };
}

/** Requester "write" input. */
export function buildRequesterWriteInput({ view, index, earlier = [] }) {
  return { task: "write", app: view, index, earlier: earlier.map(String) };
}

/** Requester "answer" input: no gold. */
export function buildRequesterAnswerInput({ view, requirement, notes, question }) {
  return { task: "answer", app: view, requirement: String(requirement), notes: String(notes ?? ""), question: { text: String(question?.text ?? ""), options: (question?.options ?? []).map(String) } };
}

/** The planner's only input: the request text. */
export function buildPlannerRequest(item) {
  return String(item.requirement);
}

const blindKey = (salt, id) => crypto.createHash("sha256").update(`${salt}\0${id}`).digest("hex");

/**
 * The runs in a blind order with blind ids ("A", "B", ...): the order depends on a hash of the item id, so the
 * recommended run is not always first, and the id never says which one it is.
 * @param {{id: string}[]} runs
 * @param {string} salt The item id.
 * @returns {{blindId: string, run: any}[]}
 */
export function blindRuns(runs, salt) {
  return [...runs].sort((a, b) => blindKey(salt, a.id).localeCompare(blindKey(salt, b.id))).map((run, i) => ({ blindId: String.fromCharCode(65 + i), run }));
}

/**
 * Grader input for one run.
 * @param {{requirement: string, plannerQuestion?: any, requesterAnswer?: any}} item
 * @param {{labels: any, path: any[], question: any}} run
 * @param {string} blindId
 */
export function buildGraderInput(item, run, blindId) {
  const q = item.plannerQuestion;
  const input = {
    requirement: String(item.requirement),
    plannerQuestion: q ? { text: String(q.text ?? ""), options: (q.options ?? []).map(String) } : null,
    ownerAnswer: item.requesterAnswer ? String(item.requesterAnswer.answer ?? "") : null,
    run: {
      id: blindId,
      labels: run.labels ? { intent: run.labels.intent ?? null, object: run.labels.object ?? null, target: run.labels.target ?? null, layers: [...(run.labels.layers ?? [])] } : null,
      path: (run.path ?? []).map((n) => ({ layer: n.layer, label: n.label, decision: n.decision ?? null, ...(n.picks ? { picks: { static: n.picks.static, jev: n.picks.jev } } : {}), fork: Boolean(n.fork) })),
      question: run.question ? { text: String(run.question.text ?? ""), options: (run.question.options ?? []).map(String) } : null,
    },
  };
  assertGraderInputClean(input, item);
  return input;
}

const keysDeep = (v, out = new Set()) => {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out); }
  return out;
};

/**
 * Throws when a grader input carries a private key or the requester's private notes text.
 * @param {object} input
 * @param {{notes?: string}} [item]
 */
export function assertGraderInputClean(input, item = {}) {
  const keys = keysDeep(input);
  const bad = PRIVATE_KEYS.filter((k) => keys.has(k));
  if (bad.length) throw new Error(`grader input carries private field(s): ${bad.join(", ")}`);
  const notes = String(item.notes ?? "").trim();
  if (notes && JSON.stringify(input).includes(notes)) throw new Error("grader input carries the requester's private notes");
}
