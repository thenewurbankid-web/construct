// cp1 -- an agent drives the SAME plan session Cockpit shows (the project's line/plans/ses-cockpit.json), through
// @line/construct-engine's plan service (which runs @mx/plan when linked, else Line's built-in plan store). An agent
// reads the plan, adds steps and runs the next approved one. It cannot approve: only a person approves a write, in
// Cockpit, so there is no plan_approve here and the service refuses an agent's approval anyway. Every write a step
// makes goes through Construct's transactional writer inside the engine; nothing in this package writes a file.
import { ToolError } from './limits.mjs';

/** One plan service per server (its root never changes). */
const services = new WeakMap();
async function serviceOf(ctx) {
  if (!services.has(ctx)) {
    const { createLinePlanService } = await import('@line/construct-engine/line/plan-service');
    services.set(ctx, createLinePlanService({ root: ctx.root }));
  }
  return services.get(ctx);
}

/** A refusal as a typed tool error with the plan's sentence; the plan's own code rides along. */
function answer(r) {
  if (r && r.ok === false) throw new ToolError('PLAN_REFUSED', String(r.sentence), { reason: String(r.code) });
  return r;
}

/** `plan_status`: the session's current plan, each step with its state, sentence, gap and checks. */
export async function planStatus(ctx) {
  return answer(await (await serviceOf(ctx)).view());
}

/** `plan_add_step`: add one step (a change is planned first and refused in one sentence when it cannot be made). */
export async function planAddStep(ctx, args) {
  return answer(await (await serviceOf(ctx)).addStep({ tool: args.tool, args: args.args ?? {}, why: args.why }, 'agent'));
}

/** `plan_run_next`: run exactly one ready step; a write runs only after a person approved it in Cockpit. */
export async function planRunNext(ctx, args) {
  return answer(await (await serviceOf(ctx)).runNext('agent', args.stepId));
}

/** ci2: the same plan service, for the Import agent's tools (importAgent.mjs). */
export const planServiceOf = serviceOf;
