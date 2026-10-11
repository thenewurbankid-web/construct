// The MCP server (#649): eight read-only, plan-only tools over Construct's existing blocks, one project root fixed at startup. This
// file is the adapter and nothing else: it declares each tool's input (zod), takes a token from the rate limiter, calls the block in
// blocks.mjs, cleans and caps what comes out, and turns every failure into a typed `{ ok: false, error: { code, message } }`.
// No tool writes; none takes a path; none reads outside the root (traces_stats reads this project's own trace file, read-only).
import fs from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { LIMITS, ToolError, createTokenBucket, DEFAULT_RATE_PER_MINUTE } from './limits.mjs';
import { openRoot, createScrubber } from './guard.mjs';
import * as blocks from './blocks.mjs';
import * as plan from './plan.mjs';
import { entryForMcp } from '@line/construct-engine/line/tool-registry';
import * as importAgent from './importAgent.mjs';
import * as train from './train.mjs';

const PACKAGE = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const READ_ONLY = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

const OPTION_ID = /^[a-z][a-z-]{0,30}$/;
const QUESTION_ID = /^(o\d{1,3}|q-[A-Za-z0-9-]{1,40})$/;
const text = (what) => z.string().min(1).max(LIMITS.textChars).describe(what);

/**
 * The tools: name, one-sentence description, input schema and the block that answers. Every description says what the tool reads
 * and that it writes nothing, because that is what a model decides on.
 *
 * @type {readonly { name: string, title: string, description: string, inputSchema: import('zod/v4').ZodObject<any>, run: Function }[]}
 */
export const TOOLS = Object.freeze([
  {
    name: 'requirement_parse',
    title: 'Parse a requirement',
    description: 'Read one plain-English requirement sentence into a requirement card (nouns, verbs, checks) with the deterministic lexicon. Words it does not know come back as closed questions of 2 to 5 options. Reads nothing from the project; writes nothing.',
    inputSchema: z.object({ text: text('The requirement, for example "A user wants to see a list of products".') }),
    run: blocks.requirementParse,
  },
  {
    name: 'placement_place',
    title: 'Place a requirement and preview its plan',
    description: 'Place a requirement in the project\'s layers and, when nothing is left open, preview the plan: the steps, the files each step would touch, its proof and its wiring. Open questions and offers are closed choices; answer them in `answers` and call again with the same text. Reads architecture.yml and folder listings; writes nothing and applies nothing.',
    inputSchema: z.object({
      text: text('The requirement sentence.'),
      answers: z.array(z.object({ id: z.string().regex(QUESTION_ID).describe('A question id from an earlier result: o1, o2 (words), q-shape, q-dependency, q-route, q-source, q-env, q-verify, q-steps, q-states, q-access, q-state, q-handler or q-v1 (placement).'), option: z.string().regex(OPTION_ID).describe('One of that question\'s option ids.') }).strict()).max(LIMITS.answers).optional(),
    }),
    run: blocks.placementPlace,
  },
  {
    name: 'plan_validate',
    title: 'Validate a plan',
    description: 'Check a plan (plan v1 JSON: version, ticket, steps) against the flow registry and return every problem with its path, plus what each step would touch. The plan is checked as data and is never run. A plan naming a path outside the project is refused.',
    inputSchema: z.object({ plan: z.record(z.string(), z.unknown()).describe('The plan object.') }),
    run: blocks.planValidate,
  },
  {
    name: 'decide',
    title: 'Suggest the next option',
    description: 'Ask the project\'s decision provider (the deterministic rules provider unless the server allows a project plugin) which option to take for one question summary, or for every open question of a requirement sentence. Suggests only: nothing is chosen, applied or recorded. Give exactly one of `summary` and `text`.',
    inputSchema: z.object({
      summary: z.object({
        id: z.string().min(1).max(80),
        question: z.string().max(400),
        options: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().max(80).optional(), enabled: z.boolean().optional(), why: z.string().max(240).optional() })).min(1).max(5),
        chosen: z.string().max(40).nullable().optional(),
      }).optional().describe('A chooser or open-question summary, as returned by requirement_parse and placement_place.'),
      text: text('A requirement sentence.').optional(),
    }),
    run: blocks.decide,
  },
  {
    name: 'summarize',
    title: 'Summarize the project or a feature',
    description: 'A bounded summary of the project or one feature: lines of code, public API and file count per layer, and a compact paragraph to use instead of reading files. With backend: true, a summary of the project\'s Node.js / Express backend instead: the route table (method, full path, handler, middleware, file:line), file roles, effects, environment variable names and import cycles. Reads the project\'s sources; writes nothing.',
    inputSchema: z.object({
      feature: z.string().min(1).max(LIMITS.nameChars).optional().describe('A feature name (never a path). Omit for the whole project.'),
      backend: z.boolean().optional().describe('true: summarize the backend (backend.dir in architecture.yml, else the project root) instead of the features. Not together with feature.'),
    }),
    run: blocks.summarize,
  },
  {
    name: 'validate',
    title: 'Validate the architecture',
    description: 'Run construct validate on the project: whether it passes, the counts by severity and rule, and the first findings with rule id, file, line, message and the suggested fix. Reads the project\'s sources; fixes nothing.',
    inputSchema: z.object({ limit: z.number().int().min(1).max(LIMITS.findings).optional().describe(`How many findings to list (default ${LIMITS.defaultFindings}).`) }),
    run: blocks.validate,
  },
  {
    name: 'machine_capabilities',
    title: 'Machine tier and capabilities',
    description: 'The tier of this machine (Lite, Cockpit use, Contributor) and what its memory and cores allow (model proposals, the Cockpit). Memory and cores only: no tool lookup and no network.',
    inputSchema: z.object({}),
    run: blocks.machineCapabilities,
  },
  {
    name: 'traces_stats',
    title: 'Decision trace statistics',
    description: 'Counts of the decisions recorded for this project (by chooser and provider), how often a suggestion was accepted, and the outcomes. Read-only; never returns a record or a path.',
    inputSchema: z.object({ chooser: z.string().min(1).max(LIMITS.nameChars).optional().describe('Count only this chooser id.') }),
    run: blocks.tracesStats,
  },
  {
    name: 'line_spec',
    title: 'Line spec (from its code)',
    description: 'Line\'s versioned spec, generated from Construct\'s code: rules (every rule id, why, expected), commands (construct commands and line.* plan tools with JSON Schemas of their args), plan (the plan protocol, step states, checks, refusal codes), model (library and feature kinds, layout) and modules (each module\'s header and exports). Give a topic, and an id to narrow it (a rule id, a tool name, a module); no topic lists the topics and the version. Reads only; writes nothing.',
    inputSchema: z.object({
      topic: z.enum(['rules', 'commands', 'plan', 'model', 'modules']).optional().describe('The slice to read.'),
      id: z.string().min(1).max(LIMITS.nameChars).optional().describe('Narrow the topic: a rule id (LINE-DIR), a tool or command name (line.promote, validate) or a module (line-engine, planService).'),
    }),
    run: blocks.lineSpec,
  },
]);

/**
 * cp1 -- the plan tools: the agent drives the project's Line plan session (the one Cockpit shows), adding steps and
 * running the next approved one. They are not read-only (a step joins the plan file; an approved step writes through
 * Construct's writer), and none approves: only a person approves a write, in Cockpit.
 */
export const PLAN_TOOLS = Object.freeze([
  {
    name: 'plan_status',
    title: 'Read the Line plan',
    description: 'The project\'s current Line plan (the one Cockpit shows): each step with its state (waiting for approval, ready, done, needs you), one sentence, what is already there before it runs, and its checks after. Reads only.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: plan.planStatus,
  },
  {
    name: 'plan_add_step',
    title: 'Add a step to the Line plan',
    description: 'Add one step to the project\'s Line plan: tool line.baseOn, line.promote, line.setPageProp (writes, so a person must approve it in Cockpit), line.project (read), or a construct.* command. A change is planned first and refused in one sentence when it cannot be made. To apply a fix that plan_status offers for a step that needs one, add its step with args.fixOf set to that step id. Writes no project file.',
    inputSchema: z.object({
      tool: z.string().min(3).max(60).regex(/^[a-z][\w]*(\.[a-zA-Z][\w]*)+$/).describe('A tool name, for example line.baseOn.'),
      args: z.record(z.string(), z.unknown()).optional().describe('The tool\'s arguments, for example {"libraryId": "components/Badge", "feature": "orders", "name": "StatusBadge"}.'),
      why: z.string().min(3).max(400).optional().describe('One plain-English sentence; a change is worded by its own plan when left out.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: plan.planAddStep,
  },
  {
    name: 'plan_run_next',
    title: 'Run the next approved step',
    description: 'Run exactly one ready step of the Line plan. A write step runs only after a person approved it in Cockpit; a step whose checks failed stops the plan until the person decides. The result says what happened in one sentence.',
    inputSchema: z.object({ stepId: z.string().min(1).max(80).optional().describe('A step id; the next ready step when left out.') }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: plan.planRunNext,
  },
]);

/**
 * ci2 -- the Import agent's tools: an agent drives the Import process for one folder (read, start, review the plan, answer,
 * resume). Its review approval never approves a write; each write is a plan step a person approves in Cockpit.
 */
const FOLDER = z.string().min(1).max(200).regex(/^(?!\/)(?!.*(^|\/)\.\.?(\/|$))[\w@.-]+(\/[\w@.-]+)*$/).describe('The import folder, relative to the project, for example src/alerts.');
const WRITES_PLAN = Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
export const IMPORT_AGENT_TOOLS = Object.freeze([
  {
    name: 'import_status',
    title: 'Read the Import process',
    description: 'The Import process for one folder: its stage (scan, classify, plan, review, execute, verify, done), what it waits for (the review, a person\'s approval of a plan step, or one question), the import plan\'s steps and every recorded change. Reads only.',
    inputSchema: z.object({ folder: FOLDER }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: importAgent.importStatus,
  },
  {
    name: 'import_start',
    title: 'Start an Import',
    description: 'Read, sort and plan the folder with static rules (decisions through @mx/reason, else the recommended option); stops at the review. Writes only the folder\'s line/import-plan.json, through Construct\'s writer.',
    inputSchema: z.object({ folder: FOLDER }),
    annotations: WRITES_PLAN,
    run: importAgent.importStart,
  },
  {
    name: 'import_plan_edit',
    title: 'Edit the Import plan',
    description: 'Review the import plan before its steps run: edit a step (only the fields it allows, e.g. name, feature, base, level), skip or bring back a step, move a step (to: 0-based place), or approve one or all steps. Your approval ends the review but never approves a write: each change still waits for a person in Cockpit. Every edit is recorded as yours.',
    inputSchema: z.object({
      folder: FOLDER,
      action: z.enum(['edit', 'skip', 'unskip', 'move', 'approve', 'approve-all']),
      stepId: z.string().min(1).max(80).optional().describe('The import plan step (not needed for approve-all).'),
      args: z.record(z.string(), z.unknown()).optional().describe('For edit: the fields to change, for example {"feature": "inbox"}.'),
      to: z.number().int().min(0).max(500).optional().describe('For move: the new 0-based place.'),
    }),
    annotations: WRITES_PLAN,
    run: importAgent.importPlanEdit,
  },
  {
    name: 'import_answer',
    title: 'Answer the Import question',
    description: 'Answer the one question the Import process asked (its id and one of its option ids, from import_status).',
    inputSchema: z.object({ folder: FOLDER, questionId: z.string().min(1).max(200), optionId: z.string().min(1).max(200) }),
    annotations: WRITES_PLAN,
    run: importAgent.importAnswer,
  },
  {
    name: 'import_resume',
    title: 'Resume the Import',
    description: 'Carry on until the process needs someone: it adds plan steps and runs the ones a person approved; a refused step gets its top typed fix tried, and when a round does not improve it asks one question.',
    inputSchema: z.object({ folder: FOLDER }),
    annotations: WRITES_PLAN,
    run: importAgent.importResume,
  },
]);

/**
 * Train Line: Claude proposes training cases for Line's drafter, lists them and runs eval. Only `train_propose_case`
 * changes anything (it adds one case, labelled 'claude', status 'draft', kept only when Construct verifies every route
 * in a scratch copy); there is no approve tool: only the owner agrees or disagrees, in Cockpit's Train Line.
 */
export const TRAIN_MCP_TOOLS = Object.freeze([
  {
    name: 'train_propose_case',
    title: 'Propose a Train Line case',
    description: 'Propose one training case for Line\'s drafter: a plain-English request over a world ("sample" or an imaginary "w07:clean"), its intent id, and every valid route as Line tool calls with real values (line.baseOn, line.promote, line.setPageProp, line.setFragment, line.fix). Saved without project words, as Claude\'s draft for the owner to review; refused in one sentence when a route does not pass in a scratch copy.',
    inputSchema: z.object({
      world: z.string().min(3).max(40).optional().describe('"sample" (default) or an imaginary world such as "w03:clean".'),
      request: z.string().min(3).max(400).describe('The request in plain English, e.g. "Make StatusBadge in orders, based on Badge."'),
      intent: z.string().min(3).max(60).describe('An intent id of the catalog, e.g. add.component, share.item, fix.problem.'),
      routes: z.array(z.object({
        label: z.string().min(3).max(200).optional(),
        steps: z.array(z.object({ tool: z.string().min(3).max(60), args: z.record(z.string(), z.unknown()) })).min(1).max(5),
      })).min(1).max(5).describe('Every valid way to do it; each step a tool call with real values, e.g. {"tool": "line.baseOn", "args": {"libraryId": "components/Badge", "feature": "orders", "name": "StatusBadge"}}.'),
      preferred: z.number().int().min(0).max(4).optional().describe('Which route is preferred (0-based); the first by default.'),
      note: z.string().max(400).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: train.trainProposeCase,
  },
  {
    name: 'train_list_cases',
    title: 'List Train Line cases',
    description: 'A page of Train Line cases with names filled in: the request, its intent, each route as sentences and its checks, who labelled it and its status (draft, agreed, disputed with the owner\'s note). Filter: claude, sample (the owner\'s review sample), mine (the owner\'s), all. Reads only.',
    inputSchema: z.object({
      filter: z.enum(['claude', 'sample', 'mine', 'all']).optional(),
      limit: z.number().int().min(1).max(20).optional(),
      offset: z.number().int().min(0).max(100000).optional(),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: train.trainListCases,
  },
  {
    name: 'train_run_eval',
    title: 'Run the Train Line eval',
    description: 'Draft every held-out case (whole imaginary projects the drafter never learned from) and score it: share of valid routes found (recall), share of drafted routes that are valid (precision), preferred route picked, per tool family and per intent, plus the owner\'s agreement on the review sample. Saves nothing.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: train.trainRunEval,
  },
]);

const INSTRUCTIONS = 'Construct blocks, read-only and plan-only. Start with requirement_parse, then placement_place (answer its closed questions and call again), then plan_validate. summarize and validate describe the project before you read files; line_spec says what Line is (rules, tools, plan protocol), from its code. Every tool is bounded and path-free; none writes. A plan preview is applied through the Cockpit\'s per-diff approval, never here. To change a Line project, add a step with plan_add_step, ask the user to approve it in Cockpit, then plan_run_next; plan_status shows the plan.';

/** A server class whose own errors (input the schema refused, an unexpected throw) come out typed, like every other refusal. */
class ConstructMcpServer extends McpServer {
  /** @param {any} serverInfo The server name and version. @param {any} options SDK options. @param {(message: string) => any} makeError Turns a message into a typed error result. */
  constructor(serverInfo, options, makeError) {
    super(serverInfo, options);
    this.makeError = makeError;
  }

  /**
   * The SDK calls this with the message of an input it refused (or of anything a handler threw).
   *
   * @param {string} errorMessage The SDK's message.
   * @returns {object} A tool result with `isError: true` and a typed body.
   */
  createToolError(errorMessage) {
    return this.makeError(String(errorMessage));
  }
}

/**
 * Create the server for one project. The root is checked here (it must be a real directory, not the file system root or the home
 * directory) and never changes; no tool takes a path.
 *
 * @param {{ root?: string, ratePerMinute?: number, maxOutputBytes?: number, allowPlugins?: boolean, now?: () => number, log?: (line: string) => void }} [options]
 *   `root` the project (default the working directory); `ratePerMinute` the token bucket (default `DEFAULT_RATE_PER_MINUTE`);
 *   `maxOutputBytes` a lower per-call output cap than `LIMITS.outputBytes` (it cannot be raised); `allowPlugins` whether a project's
 *   decision plugin may load (default: `CONSTRUCT_DECISION_PLUGINS=on`); `now` a millisecond clock; `log` where diagnostics go (default stderr).
 * @returns {import('@modelcontextprotocol/server').McpServer} The server, not yet connected to a transport.
 * @throws {Error} When the root is not a usable project directory.
 *
 * @example
 * const server = createConstructMcpServer({ root: '/work/web' });
 * await server.connect(new StdioServerTransport());
 */
export function createConstructMcpServer(options = {}) {
  const root = openRoot(options.root ?? process.cwd());
  const maxBytes = Math.min(LIMITS.outputBytes, Number.isFinite(options.maxOutputBytes) && options.maxOutputBytes > 0 ? Math.floor(options.maxOutputBytes) : LIMITS.outputBytes);
  const bucket = createTokenBucket({ perMinute: options.ratePerMinute ?? DEFAULT_RATE_PER_MINUTE, now: options.now });
  const scrub = createScrubber(root);
  const log = options.log ?? ((line) => process.stderr.write(`${line}\n`));
  let server;

  const respond = (body, isError) => ({ content: [{ type: 'text', text: JSON.stringify(scrub(body)) }], ...(isError ? { isError: true } : {}) });
  const fail = (code, message, extra = {}) => respond({ ok: false, error: { code, message: String(message).slice(0, 400), ...extra } }, true);
  const succeed = (body) => {
    const result = respond(body, false);
    const size = Buffer.byteLength(result.content[0].text);
    if (size > maxBytes) return fail('OUTPUT_TOO_LARGE', `The result would be ${size} bytes and a call returns at most ${maxBytes}. Ask for less (a feature, a smaller limit).`);
    return result;
  };

  const ctx = {
    root,
    allowPlugins: options.allowPlugins ?? process.env.CONSTRUCT_DECISION_PLUGINS === 'on',
    clientName: () => {
      const name = server?.server?.getClientVersion?.()?.name;
      return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._ -]{0,39}$/.test(name) ? name : undefined;
    },
  };

  server = new ConstructMcpServer({ name: 'construct', version: PACKAGE.version }, { instructions: INSTRUCTIONS }, (message) => {
    const invalid = /^Input validation error/i.test(message);
    return fail(invalid ? 'INVALID_INPUT' : 'TOOL_FAILED', invalid ? message.replace(/^Input validation error: /i, '') : 'The tool could not answer.');
  });

  for (const tool of [...TOOLS, ...PLAN_TOOLS, ...IMPORT_AGENT_TOOLS, ...TRAIN_MCP_TOOLS]) {
    // cu3: every MCP tool is one entry of Line's tool registry; an agent never writes project files directly.
    const entry = entryForMcp(tool.name);
    if (!entry) throw new Error(`construct-mcp: ${tool.name} is not in Line's tool registry.`);
    if (entry.kind === 'write' && entry.writes === 'project') throw new Error(`construct-mcp: ${tool.name} would write project files without approval.`);
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: { title: tool.title, ...(/** @type {any} */ (tool).annotations ?? READ_ONLY) } }, async (args) => {
      const taken = bucket.take();
      if (!taken.ok) return fail('RATE_LIMITED', `More than ${bucket.capacity} calls a minute. Try again in ${taken.retryAfterSeconds} seconds.`, { retryAfterSeconds: taken.retryAfterSeconds });
      try {
        return succeed(await tool.run(ctx, args ?? {}));
      } catch (e) {
        if (e instanceof ToolError) return fail(e.code, e.message, e.extra);
        log(`construct-mcp: ${tool.name} failed (${e?.name ?? 'Error'})`);
        return fail('TOOL_FAILED', 'The tool could not answer.');
      }
    });
  }
  return server;
}
