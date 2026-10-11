// ci2 -- an agent drives the Import agent over MCP: it reads the process, starts it, edits, skips, reorders or approves
// the import plan's steps (the review), answers its question and resumes it. It shares the project's Line plan session
// with Cockpit (the same plan service as plan.mjs), so every write is still a cp1 plan step a person approves in
// Cockpit: an agent's review approval never approves a write. Every change lands in <folder>/line/import-plan.json
// with `by: "agent"`, through Construct's writer inside the engine; nothing in this package writes a file.
import { ToolError } from './limits.mjs';
import { planServiceOf } from './plan.mjs';

/** One agent per (server, folder). */
const agents = new WeakMap();
async function agentOf(ctx, folder) {
  if (!agents.has(ctx)) agents.set(ctx, new Map());
  const byFolder = agents.get(ctx);
  if (!byFolder.has(folder)) {
    const [{ createImportAgentOnDisk }, { verifyImport, lineBaseline }, { createReasonProvider }] = await Promise.all([
      import('@line/construct-engine/line/import-agent'), import('@line/construct-engine/line/import-verify'), import('@line/construct-core/reason-provider'),
    ]);
    let agent;
    try {
      agent = createImportAgentOnDisk({ root: ctx.root, folder, planService: await planServiceOf(ctx), reason: createReasonProvider(), verify: verifyImport, baseline: lineBaseline });
    } catch (e) {
      throw new ToolError('IMPORT_REFUSED', String(/** @type {any} */ (e)?.sentence ?? e?.message ?? e), { reason: String(/** @type {any} */ (e)?.code ?? 'BAD_FOLDER') });
    }
    byFolder.set(folder, agent);
  }
  return byFolder.get(folder);
}

async function answer(fn) {
  let r;
  try { r = await fn(); } catch (e) {
    if (e instanceof ToolError) throw e;
    if (/** @type {any} */ (e)?.name === 'LineOpError') throw new ToolError('IMPORT_REFUSED', String(/** @type {any} */ (e).sentence), { reason: String(/** @type {any} */ (e).code) });
    throw e;
  }
  if (r && r.ok === false) throw new ToolError('IMPORT_REFUSED', String(r.sentence), { reason: String(r.code) });
  return r;
}

/** `import_status`: the Import process for a folder (stage, what it waits for, the plan steps, the change log). */
export async function importStatus(ctx, args) {
  return answer(async () => (await agentOf(ctx, args.folder)).view());
}

/** `import_start`: scan, classify and plan the folder; stops at the review. */
export async function importStart(ctx, args) {
  return answer(async () => (await agentOf(ctx, args.folder)).start('agent'));
}

/** `import_plan_edit`: edit, skip, unskip, move or approve plan steps (the review), recorded as the agent's. */
export async function importPlanEdit(ctx, args) {
  return answer(async () => (await agentOf(ctx, args.folder)).editStep('agent', { action: args.action, stepId: args.stepId, args: args.args ?? {}, to: args.to }));
}

/** `import_answer`: answer the one open question. */
export async function importAnswer(ctx, args) {
  return answer(async () => (await agentOf(ctx, args.folder)).answer('agent', args.questionId, args.optionId));
}

/** `import_resume`: carry on until the process needs someone (a write waits for the person's approval in Cockpit). */
export async function importResume(ctx, args) {
  return answer(async () => (await agentOf(ctx, args.folder)).resume('agent'));
}
