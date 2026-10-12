#!/usr/bin/env node
// Re-record the committed fixtures of the planner eval (#896) with a scripted fake judge and a fixture planner.
// NO model is called. The output is what tests, `run.mjs --dry-run` and the UI replay until the owner runs for real.
//
//   node trace/eval/beam/fixtures/record.mjs
//
// Writes fixtures/runs/<setup>/<item>/*.json (transcripts + planner.json), fixtures/results/<setup>/items.json, and
// the owner seed fixtures/results/<setup>/owner.json (a few hand grades so the UI shows agreement and disagreement).
// Three setups: r-v1.g-v1 and r-v1.g-v2 (rubric v1; grader v2 is stricter on the question line) and r-v1.g-v3 (the
// owner's rubric v2: fits, layer, asked, clarity), to compare side by side.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAndSave } from "../pipeline.mjs";
import { createStore } from "../store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.join(here, "..", "..", "..", "examples");

/** What the scripted requester writes, per item id. */
export const REQUESTER = {
  "contacts-1": { requirement: "In the contacts table, show each person's full name, first and last name together, in the Name column.", notes: "The Name column should join first and last from the list we already load; nothing new from the server.", gold: { intent: "update.prop", object: "prop", target: { kind: "page", name: "contacts" }, layers: ["ui"] } },
  "orders-1": { requirement: "Show the total value of all orders in the header next to the order count.", notes: "Add up the totals of the orders on the page; I do not want a new report endpoint.", gold: { intent: "update.prop", object: "prop", target: { kind: "page", name: "orders" }, layers: ["ui"] }, answer: { answer: "Add up the totals of the orders we already show.", option: "computed from the orders" } },
  "contacts-2": { requirement: "When I press Call on a contact, log that we called that person so I can see it later.", notes: "Just record the call against the contact; a log line is enough for now.", gold: { intent: "update.handler", object: "handler", target: { kind: "page", name: "contacts" }, layers: ["ui"] } },
  "orders-2": { requirement: "Let me mark an order as shipped from the orders list.", notes: "A button per row that sets the order's status to Shipped on the server.", gold: { intent: "add.handler", object: "handler", target: { kind: "page", name: "orders" }, layers: ["ui", "api"] } },
  "contacts-3": { requirement: "Show how many contacts there are in the page header.", notes: "The count of the list we load; it is already in the header design.", gold: { intent: "update.prop", object: "prop", target: { kind: "page", name: "contacts" }, layers: ["ui"] }, answer: { answer: "The number of contacts in the list.", option: "count of the loaded contacts" } },
  "orders-3": { requirement: "Next to the order count, show how many orders are still pending.", notes: "Count the orders whose status is Pending.", gold: { intent: "update.prop", object: "prop", target: { kind: "page", name: "orders" }, layers: ["ui"] } },
};

const n = (layer, label, decision, extra = {}) => ({ layer, label, decision, ...extra });

/** What the fixture planner answers, per item id (keyed by requirement in planner.json). */
export const PLANNER = {
  "contacts-1": { labels: { intent: "update.prop", object: "prop", target: { kind: "page", name: "contacts" }, layers: ["ui"], by: "static" }, path: [n("page-part", "fullName (Name cell)", "dynamic"), n("source", "first + last from GET /api/contacts", "computed"), n("controller", "ContactsController.rows", "fn"), n("hook", "useContactName(row)", "stub"), n("service", "contactsService.list", "fn"), n("contract", "GET /api/contacts", "fn")] },
  "orders-1": {
    runs: [
      { id: "run-static", labels: { intent: "update.prop", object: "prop", target: { kind: "page", name: "orders" }, layers: ["ui", "api"], by: "static" }, path: [n("page-part", "totalValue (header)", "dynamic"), n("source", "GET /api/orders/total", "api", { picks: { static: "api", jev: "computed" }, fork: true }), n("controller", "OrdersController.totalValue", "create"), n("service", "ordersService.total", "create"), n("contract", "GET /api/orders/total", "create")] },
      { id: "run-jev", labels: { intent: "update.prop", object: "prop", target: { kind: "page", name: "orders" }, layers: ["ui"], by: "jev" }, path: [n("page-part", "totalValue (header)", "dynamic"), n("source", "sum of orders[].total", "computed", { picks: { static: "api", jev: "computed" }, fork: true }), n("controller", "OrdersController.orders", "fn"), n("hook", "useOrderTotals(orders)", "create"), n("contract", "GET /api/orders", "fn")] },
    ],
    recommended: "run-jev",
    question: { text: "Should the total value come from an api field or be computed from the orders on the page?", options: ["an api field", "computed from the orders"] },
  },
  "contacts-2": { labels: { intent: "update.handler", object: "handler", target: { kind: "page", name: "contacts" }, layers: ["ui"], by: "static" }, path: [n("page-part", "call (row action)", "dynamic"), n("controller", "ContactsController.onCall(contact)", "create"), n("hook", "useCallLog(contact, when)", "create")] },
  "orders-2": { labels: { intent: "update.prop", object: "prop", target: { kind: "page", name: "orders" }, layers: ["ui"], by: "static" }, path: [n("page-part", "ship (row action)", "dynamic"), n("controller", "OrdersController.onShip(order)", "create"), n("provider", "ordersProvider.update(order)", "create"), n("service", "ordersService.update(order)", "create"), n("contract", "PUT /api/orders/:id", "create")] },
  "contacts-3": { labels: { intent: "update.prop", object: "prop", target: { kind: "page", name: "contacts" }, layers: ["ui"], by: "static" }, path: [n("page-part", "contactCount (header)", "dynamic"), n("source", "contacts.length", "computed"), n("controller", "ContactsController.rows", "fn")], question: { text: "What should the contact count show?", options: [] } },
  "orders-3": { labels: { intent: "update.prop", object: "prop", target: { kind: "page", name: "orders" }, layers: ["ui"], by: "static" }, path: [n("page-part", "pendingCount (header)", "dynamic"), n("source", "orders where status = Pending", "computed"), n("controller", "OrdersController.orders", "fn"), n("hook", "usePendingCount(orders)", "create")] },
};

// The beam's record per item (#902), in the contract of trace/src/beam/contract.mjs: the arms' readings (best first)
// and the events.jsonl lines. Run ids match the planner's surviving runs above; closed runs exist only in events.
const R = (intent, confidence, layers = ["ui"], target = "F1") => ({ intent, object: intent.split(".")[1], target, layers, confidence });
const open = (run, reading, forks = []) => ({ t: "runOpened", run, parent: null, reading, forks });
const close = (run, reason, detail) => ({ t: "runClosed", run, reason, detail });
const rank = (run, score, r, why) => ({ t: "runRanked", run, score, rank: r, why });
const done = (outcome, run, openN, closedN, ms) => ({ t: "done", outcome, run, open: openN, closed: closedN, ms });

export const BEAM = {
  "contacts-1": {
    arms: { static: [R("update.prop", 0.8), R("update.component", 0.3)], sklearn: [R("update.prop", 0.7)], spacy: [R("update.prop", 0.6)], jev: [R("update.prop", 0.9)], "zero-shot": [R("add.component", 0.5), R("update.prop", 0.4)] },
    events: [open("run-1", R("update.prop", 0.8)), open("run-2", R("add.component", 0.5)), close("run-2", "structural", "the contacts page has no free slot for a new component"), rank("run-1", 0.92, 1, ["completes the useContactName stub"]), done("plan", "run-1", 1, 1, 640)],
  },
  "orders-1": {
    arms: { static: [R("update.prop", 0.6)], sklearn: [R("update.prop", 0.7)], spacy: [R("update.prop", 0.5)], jev: [R("update.prop", 0.8)], "zero-shot": [R("add.handler", 0.45), R("update.prop", 0.4)] },
    events: [
      open("run-static", R("update.prop", 0.6, ["ui", "api"]), [{ point: "source", pick: "api", label: "from a new api field" }]),
      open("run-jev", R("update.prop", 0.8), [{ point: "source", pick: "computed", label: "computed from the orders" }]),
      open("run-3", R("add.handler", 0.45, ["ui"], "F2")),
      close("run-3", "precondition", "an add.handler needs an action slot; the header has none"),
      rank("run-jev", 0.81, 1, ["computed from fields already loaded"]), rank("run-static", 0.55, 2, ["creates three layers"]),
      { t: "question", question: { id: "beam:orders-1", sentence: "Should the total value come from an api field or be computed from the orders on the page?", hint: "Computed first: every field it needs is already loaded (rule: reuse before create).", recommended: "run-jev", options: [{ id: "run-jev", sentence: "computed from the orders", effect: "adds a hook over the loaded orders" }, { id: "run-static", sentence: "an api field", effect: "adds GET /api/orders/total and three layers" }] } },
      done("question", "run-jev", 2, 1, 1210),
    ],
  },
  "contacts-2": {
    arms: { static: [R("update.prop", 0.55)], sklearn: [R("update.handler", 0.6)], spacy: [R("update.handler", 0.5)], jev: [R("update.handler", 0.75)], "zero-shot": [R("add.handler", 0.5), R("update.handler", 0.45)] },
    events: [open("run-1", R("update.handler", 0.75)), open("run-2", R("update.prop", 0.55)), open("run-3", R("add.handler", 0.5)), close("run-2", "goal", "goal condition false: the call is never logged"), close("run-3", "emit", "tsc: useCallLog is not exported"), rank("run-1", 0.7, 1, ["the Call button already has a handler"]), done("plan", "run-1", 1, 2, 980)],
  },
  "orders-2": {
    arms: { static: [R("update.prop", 0.6)], sklearn: [R("update.prop", 0.5)], spacy: [R("add.handler", 0.4, ["ui", "api"])], jev: [R("update.prop", 0.55)], "zero-shot": [R("add.handler", 0.6, ["ui", "api"])] },
    events: [open("run-1", R("update.prop", 0.6)), open("run-2", R("add.handler", 0.6, ["ui", "api"])), close("run-2", "precondition", "the orders api has no status field"), rank("run-1", 0.5, 1, ["the only run left"]), done("plan", "run-1", 1, 1, 1530)],
  },
  "contacts-3": {
    arms: { static: [R("update.prop", 0.85)], sklearn: [R("update.prop", 0.8)], spacy: [R("update.prop", 0.7)], jev: [R("update.prop", 0.9)], "zero-shot": [R("update.prop", 0.6)] },
    events: [open("run-1", R("update.prop", 0.85)), rank("run-1", 0.9, 1, ["count of the loaded list"]), done("plan", "run-1", 1, 0, 420)],
  },
  "orders-3": {
    arms: { static: [R("update.prop", 0.7)], sklearn: [R("update.prop", 0.65)], spacy: [R("update.prop", 0.6)], jev: [R("update.prop", 0.8)], "zero-shot": [R("update.handler", 0.5)] },
    events: [open("run-1", R("update.prop", 0.8)), open("run-2", R("update.handler", 0.5)), close("run-2", "cap", "ranked below the beam cap"), rank("run-1", 0.85, 1, ["filter over the loaded orders"]), done("plan", "run-1", 1, 1, 760)],
  },
};

/** What the scripted grader answers, per grader version, item id and run id. */
const GRADES = {
  "contacts-1": { "*": { scores: { intent: 2, path: 3, reuse: 3, question: 2, unused: 2 }, justification: "Computed from existing fields, completes the useContactName stub; nothing to fault." } },
  "orders-1": {
    "run-static": { scores: { intent: 2, path: 0, reuse: 0, question: 2, unused: 2 }, justification: "Routes a computable total to a new endpoint and creates three layers that the orders list already covers." },
    "run-jev": { scores: { intent: 2, path: 3, reuse: 2, question: 2, unused: 2 }, justification: "Right computed path; creates useOrderTotals where no stub exists, fine; reuse could map the list hook." },
  },
  "contacts-2": { "*": { scores: { intent: 2, path: 2, reuse: 2, question: 2, unused: 0 }, justification: "useCallLog takes `when` and never reads it: ships a stub (unused line)." } },
  "orders-2": { "*": { scores: { intent: 1, path: 2, reuse: 2, question: 1, unused: 2 }, justification: "Reads an add of a ship action as update.prop; path is plausible but the missing status field was not asked about." } },
  "contacts-3": {
    v1: { scores: { intent: 2, path: 3, reuse: 3, question: 1, unused: 2 }, justification: "Right computed count; the open question was harmless but not needed." },
    v2: { scores: { intent: 2, path: 3, reuse: 3, question: 0, unused: 2 }, justification: "Asks an open question whose answer is already in the requirement (question line)." },
  },
  "orders-3": { "*": { scores: { intent: 2, path: 3, reuse: 2, question: 2, unused: 2 }, justification: "Computed pending count; creates a hook where the orders hook could take a filter." } },
};

/** Grader v3 grades with the owner's rubric v2 (fits 0-3, layer 0-3, asked 0-2, clarity 0-2). */
const GRADES_V2 = {
  "contacts-1": { "*": { scores: { fits: 3, layer: 3, asked: 2, clarity: 2 }, justification: "Computed from existing fields and completes the useContactName stub; nothing to fault." } },
  "orders-1": {
    "run-static": { scores: { fits: 2, layer: 0, asked: 2, clarity: 2 }, justification: "Routes a computable total to a new endpoint and creates three layers the orders list already covers (layer)." },
    "run-jev": { scores: { fits: 3, layer: 2, asked: 2, clarity: 2 }, justification: "Right computed path, needed closed question; creates useOrderTotals where the list hook could be reused (layer)." },
  },
  "contacts-2": { "*": { scores: { fits: 2, layer: 2, asked: 2, clarity: 2 }, justification: "Logs the call, but useCallLog takes `when` and never reads it (fits: an unused input ships a stub)." } },
  "orders-2": { "*": { scores: { fits: 1, layer: 2, asked: 0, clarity: 2 }, justification: "Reads an add of a ship action as update.prop and does not ask about the missing status field (asked)." } },
  "contacts-3": { "*": { scores: { fits: 3, layer: 3, asked: 0, clarity: 0 }, justification: "Asks an open question whose answer is already in the requirement (asked, clarity)." } },
  "orders-3": { "*": { scores: { fits: 3, layer: 2, asked: 2, clarity: 2 }, justification: "Computed pending count; creates a hook where the orders hook could take a filter (layer)." } },
};

const byRequirement = Object.fromEntries(Object.entries(REQUESTER).map(([id, r]) => [r.requirement, id]));

/** The scripted judge: answers from the tables above by reading the input it was given. */
export function fakeLlm(graderVersion) {
  return (system, prompt, { step, role }) => {
    const input = JSON.parse(prompt.slice(prompt.indexOf("{")));
    if (role === "requester" && input.task === "write") {
      const id = `${input.app.name}-${input.index}`;
      const { requirement, notes, gold } = REQUESTER[id];
      return JSON.stringify({ requirement, notes, gold });
    }
    if (role === "requester") return JSON.stringify(REQUESTER[byRequirement[input.requirement]].answer ?? { answer: "Either is fine.", option: null });
    const id = byRequirement[input.requirement];
    const table = (graderVersion === "v3" ? GRADES_V2 : GRADES)[id];
    // The grader never sees run ids or pickers (blind ids only), so the script tells the two runs apart by their path.
    const runId = table["run-static"] ? (input.run.path.some((p) => p.decision === "api") ? "run-static" : "run-jev") : null;
    const g = runId ? table[runId] : table[graderVersion] ?? table["*"];
    if (!g) throw new Error(`no scripted grade for ${id} ${step}`);
    return JSON.stringify(g);
  };
}

/** The owner's hand grades (same for both setups: the owner grades the item, not the setup). */
export const OWNER = {
  "contacts-1": { scores: { intent: 2, path: 3, reuse: 3, question: 2, unused: 2 }, note: "Agree." },
  "contacts-3": { scores: { intent: 2, path: 3, reuse: 3, question: 0, unused: 2 }, note: "The question asks what the requirement already says." },
  "orders-2": { scores: { intent: 0, path: 1, reuse: 2, question: 0, unused: 2 }, note: "Wrong intent, and it must ask: the api has no status field." },
  "contacts-2": { scores: { intent: 2, path: 2, reuse: 2, question: 2, unused: 1 }, note: "One unused input, not a whole stub." },
};

/** The owner's hand grades with rubric v2 (grader v3 setups). */
export const OWNER_V2 = {
  "contacts-1": { scores: { fits: 3, layer: 3, asked: 2, clarity: 2 }, note: "Agree." },
  "contacts-3": { scores: { fits: 3, layer: 3, asked: 0, clarity: 0 }, note: "The question asks what the requirement already says, and it is open." },
  "orders-2": { scores: { fits: 0, layer: 1, asked: 0, clarity: 2 }, note: "Wrong intent, and it must ask: the api has no status field." },
  "contacts-2": { scores: { fits: 2, layer: 2, asked: 2, clarity: 2 }, note: "One unused input." },
};

async function main() {
  const dirs = { resultsDir: path.join(here, "results"), runsDir: path.join(here, "runs"), fixturesDir: here };
  fs.rmSync(dirs.resultsDir, { recursive: true, force: true });
  fs.rmSync(dirs.runsDir, { recursive: true, force: true });
  const planner = Object.fromEntries(Object.entries(PLANNER).map(([id, p]) => [REQUESTER[id].requirement, { ...p, ...BEAM[id] }]));
  fs.writeFileSync(path.join(here, "planner.json"), JSON.stringify(planner, null, 2) + "\n");
  const store = createStore(dirs);
  let t = Date.parse("2026-10-12T15:00:00Z");
  const now = () => new Date(t += 1000).toISOString();
  for (const grader of ["v1", "v2", "v3"]) {
    const doc = await runAndSave({ requester: "v1", grader, apps: ["contacts", "orders"], items: 6, planner: "fixture", examplesDir, dirs, store, llm: fakeLlm(grader), now });
    doc.mode = "fixture";
    store.saveDoc(doc.setup, doc);
    const owner = Object.fromEntries(Object.entries(grader === "v3" ? OWNER_V2 : OWNER).map(([id, o]) => [id, { ...o, rubricVersion: doc.versions.rubric, at: "2026-10-12T15:30:00.000Z" }]));
    fs.writeFileSync(path.join(dirs.resultsDir, doc.setup, "owner.json"), JSON.stringify(owner, null, 2) + "\n");
    console.log(`recorded ${doc.setup}: ${doc.items.length} items, ${doc.calls} scripted calls`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
