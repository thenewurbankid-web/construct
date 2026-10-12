// The beam's prune stages, cheapest first (#901). Each returns null when the run passes, else {reason, detail}
// with `reason` from CLOSE_REASONS. Nothing here writes to disk: the scratch emit buffers in a write transaction
// that is reset, never committed.
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import ts from "typescript";
import { applyStructural } from "../structural-gate.mjs";
import { createWriteTransaction } from "../write-transaction.mjs";
import { emitService, emitDomain, emitDomainTest, emitWorkflow, emitController, emitRoute, emitMock } from "../emit.mjs";
import { rewritePage } from "../rewrite-page.mjs";
import { checkPre } from "../../../packages/engine/line/conditions.mjs";
import { evaluate } from "../../../packages/engine/line/expr.mjs";

// ------------------------------------------------------------------------------------------------ 1. shape
const Ident = z.string().regex(/^[A-Za-z_$][\w$]*$/);
/** The plan shape emit.mjs and rewrite-page.mjs read (makePlan's output). */
export const PlanShape = z.object({
  names: z.object({ feature: z.string().min(1), fid: Ident, Feature: Ident, Item: Ident, item: Ident }),
  route: z.string().startsWith("/"),
  idField: z.string().min(1),
  rowFields: z.array(z.object({ name: z.string() }).passthrough()),
  values: z.array(z.object({ name: z.string() }).passthrough()),
  sort: z.object({ dir: z.enum(["none", "asc", "desc"]) }).passthrough(),
  actions: z.array(z.object({ name: z.string(), scope: z.enum(["row", "page"]), kind: z.string() }).passthrough()),
  placeholders: z.array(z.object({ part: z.string(), fn: Ident, layer: z.string() }).passthrough()),
  layers: z.array(z.object({ name: z.string(), why: z.string() })).min(1),
}).passthrough();

/**
 * Stage 1: the plan has the shape emit reads, and every placeholder function name is unique.
 * @param {any} plan makePlan's output.
 * @returns {{reason: 'shape', detail: string}|null}
 */
export function checkShape(plan) {
  const r = PlanShape.safeParse(plan);
  if (!r.success) {
    const i = r.error.issues[0];
    return { reason: "shape", detail: `The plan does not have the shape the generator reads: ${i.path.join(".") || "plan"} ${i.message.toLowerCase()}.` };
  }
  const fns = plan.placeholders.map((p) => p.fn);
  const dup = fns.find((f, i) => fns.indexOf(f) !== i);
  return dup ? { reason: "shape", detail: `Two placeholders would both be called ${dup}.` } : null;
}

// ------------------------------------------------------------------------------------------------ 2. structural
/**
 * Stage 2: the structural gate on a clone of the run's match. It only fires on single-candidate parts, so a part this
 * run trimmed to one candidate is checked here even when the original had several. The run closes only when a part
 * IT picked is asked about (a part that was single to begin with is the same for every run: a question for the
 * person, not a fault of the run).
 * @param {any} m The run's match result (not mutated).
 * @param {{labels?: any, docs?: any}} ctx structuralContext(pageSource, spec).
 * @param {string[]} forkedParts The run's fork points ("list.<f>", "value.<v>").
 * @returns {{reason: 'structural', detail: string}|null}
 */
export function checkStructural(m, ctx, forkedParts) {
  const rows = applyStructural(structuredClone(m), ctx);
  const hit = rows.find((r) => r.decision === "asked" && forkedParts.includes(r.part));
  return hit ? { reason: "structural", detail: `${hit.part}: ${hit.reason}; the page's own words do not support it.` } : null;
}

// ------------------------------------------------------------------------------------------------ 3. Line preconditions
/**
 * The Line steps a run's Trace nodes map to. Only the Page node maps today: rewriting the page is a
 * `line.setFragment` on the page file read at `pageHash` (the file must still be what was read).
 * @param {any} plan
 * @param {{pageFile?: string, pageSource?: string}} line
 * @returns {{tool: string, args: Record<string, unknown>, node: string}[]}
 */
export function lineSteps(plan, line) {
  if (!line?.pageFile || typeof line.pageSource !== "string") return [];
  const contentHash = crypto.createHash("sha256").update(line.pageSource).digest("hex");
  return [{ node: `page:${plan.names.Feature}Page`, tool: "line.setFragment", args: { file: line.pageFile, contentHash } }];
}

/**
 * Stage 3: Line preconditions, only where a Trace node maps to a Line step (checkPre over cached buildFacts), then
 * the caller's cheap plan* dry runs (each may throw a LineOpError: its message closes the run).
 * @param {any} plan
 * @param {{facts?: any, layout?: any, pageFile?: string, pageSource?: string, dryRuns?: ((plan: any) => void)[]}|null} line
 * @returns {{reason: 'precondition', detail: string}|null}
 */
export function checkLine(plan, line) {
  if (!line?.facts) return null;
  for (const s of lineSteps(plan, line)) {
    const why = checkPre(line.facts, s.tool, s.args, line.layout);
    if (why) return { reason: "precondition", detail: `${s.node} (${s.tool}): ${why}` };
  }
  for (const dry of line.dryRuns ?? []) {
    try { dry(plan); } catch (e) {
      if (e?.name === "LineOpError" || e?.code) return { reason: "precondition", detail: String(e.message) };
      throw e;
    }
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ 4. scratch emit
/**
 * The files a plan generates (what pipeline.mjs writes), relative to the feature folder. Pure.
 * @param {any} plan @param {string} pageSource @param {{page: string}} spec
 * @returns {Record<string, {code: string, layer: string}>}
 */
export function emitFiles(plan, pageSource, spec) {
  const n = plan.names;
  const { page, component } = rewritePage(pageSource, plan);
  const ext = /\.tsx$/.test(spec.page) ? "tsx" : "jsx";
  return {
    [`route/${n.Feature}Route.jsx`]: { code: emitRoute(plan), layer: "Route" },
    [`controller/${n.Feature}Controller.jsx`]: { code: emitController(plan), layer: "Controller" },
    [`workflow/${n.feature}.workflow.js`]: { code: emitWorkflow(plan), layer: "Workflow" },
    [`service/${n.feature}.service.js`]: { code: emitService(plan), layer: "Service" },
    [`domain/${n.feature}.domain.js`]: { code: emitDomain(plan), layer: "Domain" },
    [`domain/${n.feature}.domain.test.js`]: { code: emitDomainTest(plan), layer: "Domain" },
    [`page/${n.Feature}Page.${ext === "tsx" ? "tsx" : "jsx"}`]: { code: page, layer: "Page" },
    ...(component ? { [`component/${n.Item}Row.jsx`]: { code: component, layer: "Component" } } : {}),
    [`mocks/${n.feature}.mock.js`]: { code: emitMock(plan), layer: "Mocks" },
  };
}

/**
 * tsc's own syntax check (TypeScript transpileModule diagnostics) on each file: in-process, no project, no disk.
 * @param {Record<string, string>} files relative path -> source
 * @returns {{ok: boolean, errors: string[]}}
 */
export function tscSyntax(files) {
  const errors = [];
  for (const [file, code] of Object.entries(files)) {
    const r = ts.transpileModule(code, { fileName: file, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve, allowJs: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
    for (const d of r.diagnostics ?? []) {
      const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
      errors.push(`${file}${pos ? `:${pos.line + 1}` : ""}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Stage 4 (only for the top few): emit into a write transaction rooted in a scratch folder, never committed (reset
 * after), then type-check. `typecheck` defaults to tscSyntax; a caller may pass a full tsc.
 * @param {any} plan @param {string} pageSource @param {{page: string}} spec
 * @param {{typecheck?: (files: Record<string, string>) => {ok: boolean, errors: string[]}}} [o]
 * @returns {{fail: {reason: 'emit', detail: string}|null, files: Record<string, {code: string, layer: string}>}}
 */
export function scratchEmit(plan, pageSource, spec, { typecheck = tscSyntax } = {}) {
  let files;
  try { files = emitFiles(plan, pageSource, spec); } catch (e) {
    return { fail: { reason: "emit", detail: `The generator stopped: ${String(e?.message ?? e).split("\n")[0]}` }, files: {} };
  }
  const txn = createWriteTransaction(path.join(os.tmpdir(), "construct-beam-scratch"));
  try {
    for (const [rel, f] of Object.entries(files)) txn.writeFile(rel, f.code);
    const staged = Object.fromEntries(txn.pendingFiles().map((rel) => [rel, txn.readFile(rel)]));
    const r = typecheck(staged);
    return { fail: r.ok ? null : { reason: "emit", detail: `The generated code does not compile: ${r.errors[0]}` }, files };
  } finally {
    txn.reset();
  }
}

// ------------------------------------------------------------------------------------------------ 5. goals
/**
 * The facts a run's goal conditions read (Line expressions over plain JSON).
 * @param {any} plan @param {{forks: {point: string, pick: string}[], emitted: boolean, open: string[]}} run
 * @returns {Record<string, unknown>}
 */
export function runFacts(plan, run) {
  return {
    plan: {
      feature: plan.names.feature,
      layers: plan.layers.map((l) => l.name),
      placeholders: plan.placeholders.map((p) => p.fn),
      todo: [...plan.rowFields.filter((f) => f.todo || f.static).map((f) => `list.${f.name}`), ...plan.values.filter((v) => v.todo).map((v) => `value.${v.name}`)],
      actions: plan.actions.map((a) => ({ name: a.name, kind: a.kind })),
      sort: { field: plan.sort.field ?? null, dir: plan.sort.dir },
      fields: Object.fromEntries(plan.rowFields.map((f) => [f.name, { field: f.field ?? null, formatter: f.formatter ?? null, agg: f.agg ?? null }])),
      values: Object.fromEntries(plan.values.map((v) => [v.name, { field: v.field ?? null, formatter: v.formatter ?? null, agg: v.agg ?? null }])),
    },
    forks: Object.fromEntries(run.forks.map((f) => [f.point, f.pick])),
    emit: { ok: run.emitted },
    open: run.open,
  };
}

/** The default goal: the plan reaches the page (Route and Page layers) and its emit compiled. */
export const DEFAULT_GOALS = Object.freeze([
  { id: "routed", expr: { and: [{ in: ["Route", { path: ["plan", "layers"] }] }, { in: ["Page", { path: ["plan", "layers"] }] }] } },
  { id: "compiles", expr: { eq: [{ path: ["emit", "ok"] }, true] } },
]);

/**
 * Stage 5: every goal condition holds on the run's facts (Line evaluate()).
 * @param {Record<string, unknown>} facts runFacts(...)
 * @param {{id: string, expr: unknown}[]} goals
 * @returns {{reason: 'goal', detail: string}|null}
 */
export function checkGoals(facts, goals) {
  for (const g of goals) {
    const r = evaluate(facts, g.expr);
    if (!r.ok) return { reason: "goal", detail: `Goal ${g.id}: ${r.failed[0].sentence}` };
  }
  return null;
}
