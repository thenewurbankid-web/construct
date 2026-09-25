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
      answers: z.array(z.object({ id: z.string().regex(QUESTION_ID).describe('A question id from an earlier result: o1, o2 (words), q-shape, q-dependency, q-route, q-source, q-env, q-verify, q-steps, q-states or q-v1 (placement).'), option: z.string().regex(OPTION_ID).describe('One of that question\'s option ids.') }).strict()).max(LIMITS.answers).optional(),
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
]);

const INSTRUCTIONS = 'Construct blocks, read-only and plan-only. Start with requirement_parse, then placement_place (answer its closed questions and call again), then plan_validate. summarize and validate describe the project before you read files. Every tool is bounded and path-free; none writes. A plan preview is applied through the Cockpit\'s per-diff approval, never here.';

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

  for (const tool of TOOLS) {
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: { title: tool.title, ...READ_ONLY } }, async (args) => {
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
