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

/** A refusal as a typed tool error: its plain text (#885: what was wrong, the rule, the choices by ref or a correct
 * call); the plan's own code and the choices' refs and steps ride along, so {"fix": "f1"} can be sent back. */
function answer(r) {
  if (r && r.ok === false) {
    const fixes = Array.isArray(r.fixes) ? r.fixes.slice(0, 8).map((f) => ({ ref: f.ref, step: f.step, ...(f.why ? { why: f.why } : {}) })) : [];
    // The message is capped (400 characters), so it says what was wrong, the rule and how to apply a choice; the
    // whole text (choices with why, effect and context) and the choices themselves ride along.
    const h = r.hint;
    const message = h ? [`Refused (${r.code}): ${h.wrong}`, `Rule: ${h.rule}.`, h.apply ?? (h.example ? `A correct call: ${h.example}` : '')].filter(Boolean).join('\n') : String(r.sentence);
    throw new ToolError('PLAN_REFUSED', message, { reason: String(r.code), ...(fixes.length ? { fixes } : {}), ...(r.text ? { text: String(r.text) } : {}) });
  }
  return r;
}

/**
 * `plan_status`: the session's current plan, each step with its state, sentence, gap and checks.
 * @param {any} ctx The MCP server context (its root).
 * @returns {Promise<any>} The plan view.
 */
export async function planStatus(ctx) {
  return answer(await (await serviceOf(ctx)).view());
}

/**
 * `plan_add_step`: add one step (a change is planned first and refused in one sentence when it cannot be made).
 * @param {any} ctx The MCP server context (its root).
 * @param {{tool?: string, args?: object, why?: string, fix?: string, answer?: string, option?: string, folder?: string}} args
 *   The step to add; or `fix`: a choice the last refusal offered (its ref, f1 = recommended, or its id), added in place
 *   of tool and args (#880); or `answer` + `option` + `folder`: an answer to the folder's open import question (#887).
 * @returns {Promise<any>} The plan view with the new step.
 */
export async function planAddStep(ctx, args) {
  const req = args.answer ? { answer: args.answer, option: args.option, folder: args.folder } : args.fix ? { fix: args.fix, why: args.why } : { tool: args.tool, args: args.args ?? {}, why: args.why };
  return answer(await (await serviceOf(ctx)).addStep(req, 'agent'));
}

/**
 * `plan_run_next`: run exactly one ready step; a write runs only after a person approved it in Cockpit.
 * @param {any} ctx The MCP server context (its root).
 * @param {{stepId?: string}} args Optionally the step to run.
 * @returns {Promise<any>} The plan view after the run.
 */
export async function planRunNext(ctx, args) {
  return answer(await (await serviceOf(ctx)).runNext('agent', args.stepId));
}

/** ci2: the same plan service, for the Import agent's tools (importAgent.mjs). */
export const planServiceOf = serviceOf;
