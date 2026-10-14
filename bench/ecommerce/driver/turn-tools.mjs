// #938: the Line arm's builder tools written for CHOOSING, and the small set one turn offers.
//
// Same names and arguments as qwen-agent's TOOLS.line (callTool runs them unchanged); each description is one
// "Use this when ..." line, parameter names stay plain, closed sets are enums (plan_add/plan_rules `tool`: the Line
// tools plan-cli offers), and required fields are minimal.
//
//   toolsForTurn(last, {max})   the tools a turn needs, from the last tool answer (the open step's state), most
//                               likely first, cut to the model profile's `maxTools`
//   INTENTS                     the layered turn's L1 sentences -> tool (packages/engine/line/harness/toolHarness.mjs)
import { BUILDER_TOOLS } from './plan-cli.mjs';
import { legacyIo } from '../../../packages/core/modelled-io.mjs';

const fn = (name, description, properties = {}, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const S = (description) => ({ type: 'string', description });
const LINE_TOOL = { type: 'string', enum: [...BUILDER_TOOLS], description: 'The Line tool, e.g. line.setCode' };

/** @type {Record<string, any>} */
export const CHOOSING_TOOLS = Object.fromEntries([
  fn('plan_status', 'Use this when you need to see the plan, the steps waiting to run and the acceptance points of the feature you work on.', { feature: S('Another feature, e.g. picks (optional)') }),
  // #948: never code in a call's JSON; code goes through write_function (one function per request, signature prefilled).
  fn('plan_add', 'Use this when you want to change the project: add one step {tool, args, why} (names, ids and choices, never code), or {fix, why} to take a fix a refusal offered.', { tool: LINE_TOOL, args: { type: 'object', description: 'The Line tool\'s arguments, e.g. {"libraryId": "pages/ListPage", "feature": "picks", "name": "PicksPage"} for line.baseOn' }, why: S('One sentence: why this step'), fix: S('A fix ref from the last refusal, e.g. f1') }, ['why']),
  fn('write_function', 'Use this when you need to write code: ONE function of a file, its signature already written by Line.', { file: S('Project-relative file, e.g. features/picks/pages/PicksPage.tsx'), name: S('The function, e.g. PicksPage'), signature: S('Only for a new function: its one-line signature, e.g. export function itemCount(items: Item[]): number'), why: S('One sentence: why this function') }, ['file', 'name', 'why']),
  fn('plan_run_next', 'Use this when a step is approved and waiting: it lands the next step and says whether it passed its checks.'),
  fn('read_file', 'Use this when you need the current code of one project file (and its contentHash, to replace it).', { path: S('Project-relative path, e.g. features/picks/pages/PicksPage.tsx') }, ['path']),
  fn('list_dir', 'Use this when you need to know which files a folder has.', { path: S('Project-relative folder, e.g. features/picks') }, ['path']),
  fn('plan_rules', 'Use this when a step of a tool was refused and you need the rules it must keep, each with an example.', { tool: LINE_TOOL, file: S('The file the step is about (optional)') }, ['tool']),
  fn('plan_validate', 'Use this when you think the work is done and want the whole project checked.'),
  fn('plan_findings', 'Use this when you need the library items, the features and the validate findings with their keys.'),
  fn('plan_tools', 'Use this when you need the Line tools you can add, each with its JSON Schema.'),
  // #932: the driver's own scratchpad (never a project file); not in any TURN_SETS subset until one is measured.
  fn('scratch_write', 'Use this when you want to keep a short plain-English note for later turns, like your plan or what to try next.', { text: S('The note, plain English'), about: S('The file or point id it is about (optional)') }, ['text']),
  fn('scratch_read', 'Use this when you want to see your notes so far.'),
  fn('finish', 'Use this when every acceptance point is done, or you cannot make more progress.', { summary: S('What you built and what is left') }, ['summary']),
].map((t) => [t.function.name, t]));

/** The tool order per situation, most likely first (`max` cuts from the end). */
export const TURN_SETS = Object.freeze({
  start: ['plan_status', 'plan_add', 'write_function', 'read_file', 'list_dir', 'plan_tools', 'finish'],
  waiting: ['plan_run_next', 'plan_status', 'plan_add', 'finish'],
  refused: ['write_function', 'plan_add', 'read_file', 'plan_rules', 'plan_status', 'finish'],
  landed: ['plan_add', 'write_function', 'plan_status', 'finish', 'plan_validate', 'read_file'],
  read: ['write_function', 'plan_add', 'read_file', 'plan_rules', 'list_dir', 'plan_status', 'finish'],
});

/**
 * The situation a turn is in, from the last tool call and its answer (null at the start).
 * @param {{name: string, out: any} | null} last
 * @returns {keyof typeof TURN_SETS}
 */
export function situation(last) {
  if (!last) return 'start';
  const { name, out } = last;
  if (out?.ok === false) return 'refused';
  if ((name === 'plan_add' && out?.state === 'ready') || (name === 'plan_status' && (out?.counts?.ready ?? 0) > 0) || (out?.work?.waiting ?? 0) > 0) return 'waiting';
  if (name === 'plan_run_next') return 'landed';
  if (name === 'read_file' || name === 'list_dir' || name === 'plan_rules' || name === 'plan_findings' || name === 'plan_tools') return 'read';
  return 'start';
}

/**
 * The tools one turn offers.
 * @param {{name: string, out: any} | null} last @param {{max?: number}} [o]
 */
export function toolsForTurn(last, { max = 6 } = {}) {
  // #948: LINE_LEGACY_IO=1 has no write_function (code goes in plan_add's JSON there).
  return TURN_SETS[situation(last)].filter((n) => !legacyIo() || n !== 'write_function').slice(0, Math.max(1, max)).map((n) => CHOOSING_TOOLS[n]);
}

/** L1 intent sentences -> tool (null: not a tool call). */
export const INTENTS = Object.freeze({
  'See the plan and the acceptance points': 'plan_status',
  'Add a step that changes the project': 'plan_add',
  'Write the code for this step': legacyIo() ? 'plan_add' : 'write_function',
  'Land the next approved step': 'plan_run_next',
  'Read a project file': 'read_file',
  'List a project folder': 'list_dir',
  'Read the rules a step must keep': 'plan_rules',
  'Check the whole project': 'plan_validate',
  'See the findings and library items': 'plan_findings',
  'See the Line tools I can add': 'plan_tools',
  'Stop: the work is done or I am stuck': 'finish',
  'Ask a question': null,
});

/** The intents of one turn's tool set, plus "Write the code for this step" and "Ask a question". */
export function intentsFor(tools) {
  const names = new Set(tools.map((t) => t.function.name));
  return Object.fromEntries(Object.entries(INTENTS).filter(([s, n]) => n === null || (names.has(n) && (s !== 'Write the code for this step' || names.has(n)))));
}
