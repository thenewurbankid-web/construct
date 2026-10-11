// cl1 -- Line describes itself from its code: one versioned JSON spec (contract.mjs LineSpec) built from the rules
// catalog, the command and plan-tool registry (with JSON Schemas), the plan contract, the library and feature model and
// each module's contract (its header and its exports, read from the source). Nothing here is hand-written prose about
// Line: every value comes from a constant or a source file, so the spec changes exactly when the code does.
// `construct line spec` prints it; the MCP tool `line_spec` serves one topic at a time (sliceSpec).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  SPEC_FORMAT, SPEC_TOPICS, LINE_PLAN_TOOLS, CHECK_KINDS, PLAN_STEP_STATES, STEP_OPTION_IDS, PLAN_PROTOCOL, LINE_API,
  LINE_FIX_TOOLS, LINE_KINDS, LEVELS, FRAGMENT_KINDS, TRACE_KINDS, PLAN_REFUSAL_CODES,
} from './contract.mjs';
import { DEFAULT_EXPECT, lineToolSpecs } from './planTools.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');

/** The source files whose contracts the `modules` topic lists (repo-relative), grouped by module. */
export const SPEC_MODULES = Object.freeze([
  { module: 'line-engine', what: 'Line operations, plan tools and plan service', dir: 'packages/engine/line', match: /\.mjs$/ },
  { module: 'line-profile', what: 'the Line validate profile (LINE-* rules)', dir: 'packages/core/profiles/line', match: /\.mjs$/ },
  { module: 'line-links', what: 'the linked Line modules (@mx/reason, @mx/plan, ...) and their contracts', dir: 'packages/line-links', match: /\.(mjs|d\.ts)$/ },
  { module: 'writer', what: 'Construct\'s transactional writer and the Line-state path', dir: 'packages/engine', match: /^transactionalWriter\.mjs$/ },
  { module: 'mcp', what: 'the MCP server agents drive Line through', dir: 'packages/mcp/src', match: /\.mjs$/ },
]);

/**
 * A source file's contract: its leading comment (joined, cut to 400 characters) and its exported names.
 * @param {string} file Absolute path of the source file.
 * @returns {{header: string, exports: string[]}}
 */
export function moduleContract(file) {
  const text = fs.readFileSync(file, 'utf8');
  const head = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(?:\/\/+|\/?\*+\/?)\s?(.*)$/.exec(line);
    if (!m) break;
    if (m[1].trim()) head.push(m[1].trim());
  }
  const exports = new Set();
  for (const m of text.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class|interface|type)\s+([A-Za-z_$][\w$]*)/gm)) exports.add(m[1]);
  for (const m of text.matchAll(/^export\s*\{([^}]*)\}/gm)) for (const n of m[1].split(',')) { const name = n.trim().split(/\s+as\s+/).pop(); if (name) exports.add(name); }
  const header = head.join(' ').replace(/\s+/g, ' ');
  return { header: header.length > 400 ? `${header.slice(0, 397)}...` : header, exports: [...exports].sort() };
}

/** Real sources, overridable so a test can add a rule or a command and watch the spec change. */
async function realSources() {
  const [{ catalogRules }, { LINE_RULES, ITEM_KINDS, KIND_LAYER, FEATURE_FILES, LIBRARY_FILES, SHARED_CONCERNS }, { createCommandRegistry }, { registerBuiltinCommands }, { READ_COMMANDS, NEVER_OFFERED, commandToolName }] = await Promise.all([
    import('@line/construct-core/rules-catalog'), import('@line/construct-core/profiles/line/contract'), import('@line/construct-core/command-registry'),
    import('@line/construct-core/builtin-commands'), import('@line/construct-core/plan-registry'),
  ]);
  const registry = createCommandRegistry();
  registerBuiltinCommands(registry);
  return {
    catalogRules: catalogRules(),
    lineRules: LINE_RULES,
    commands: registry.list().filter((c) => !NEVER_OFFERED.includes(c.name)).map((c) => ({
      name: c.name, tool: commandToolName(c.name), kind: READ_COMMANDS.includes(c.name) ? 'read' : 'write', summary: c.summary,
      args: { type: 'object', properties: { argv: { type: 'array', items: { type: 'string' }, description: 'The words after the command, as typed.' } }, additionalProperties: false },
    })),
    lineTools: lineToolSpecs(),
    model: { ITEM_KINDS, KIND_LAYER, FEATURE_FILES, LIBRARY_FILES, SHARED_CONCERNS },
  };
}

/** The modules topic: each module's files with their header and exports, read from the source. */
function modulesTopic(repo) {
  return SPEC_MODULES.map((m) => {
    const dir = path.join(repo, m.dir);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => m.match.test(f) && !/\.test\.mjs$/.test(f)).sort(); } catch { files = []; }
    return { module: m.module, what: m.what, files: files.map((f) => ({ file: `${m.dir}/${f}`, ...moduleContract(path.join(dir, f)) })) };
  });
}

const stable = (v) => JSON.stringify(v, (_k, x) => (x instanceof RegExp ? x.source : x));

/**
 * Build the spec. Pure read: nothing is written.
 * @param {{sources?: Partial<Awaited<ReturnType<typeof realSources>>>, repo?: string}} [o] `sources` replace the real
 *   rules, commands, tools or model (tests); `repo` the checkout whose sources the modules topic reads.
 * @returns {Promise<import('./contract.mjs').LineSpec>}
 */
export async function buildLineSpec({ sources = {}, repo = REPO } = {}) {
  const src = { ...(await realSources()), ...sources };
  const lineRules = Object.values(src.lineRules).map((r) => ({
    id: r.id, module: 'line', layers: [], scope: 'project', defaultSeverity: r.defaultSeverity, why: r.why, expected: [...r.expected], fix: null, check: r.check,
  }));
  const topics = {
    rules: [...src.catalogRules.map((r) => ({ id: r.id, module: r.module, layers: r.layers, scope: r.scope, defaultSeverity: r.defaultSeverity, why: r.why, expected: r.expected, fix: r.fix })), ...lineRules]
      .sort((a, b) => a.id.localeCompare(b.id)),
    commands: { construct: src.commands, line: src.lineTools },
    plan: {
      protocol: [...PLAN_PROTOCOL], tools: LINE_PLAN_TOOLS.map((t) => ({ ...t })), stepStates: [...PLAN_STEP_STATES], optionIds: [...STEP_OPTION_IDS],
      checkKinds: [...CHECK_KINDS], defaultExpect: DEFAULT_EXPECT.map((c) => ({ ...c })), fixTools: [...LINE_FIX_TOOLS],
      refusalCodes: { plan: [...PLAN_REFUSAL_CODES] }, traceKinds: [...TRACE_KINDS], http: LINE_API.map((r) => ({ ...r })),
    },
    model: {
      kinds: [...LINE_KINDS], levels: [...LEVELS], fragmentKinds: [...FRAGMENT_KINDS], kindLayer: { ...src.model.KIND_LAYER },
      featureFiles: [...src.model.FEATURE_FILES], libraryFiles: [...src.model.LIBRARY_FILES],
      layout: { library: 'library (or src/library)', features: 'features (or src/features)', state: 'line' },
      sharedConcerns: src.model.SHARED_CONCERNS.map((c) => ({ id: c.id, concern: c.concern, module: c.module, owners: [...c.owners] })),
    },
    modules: modulesTopic(repo),
  };
  const version = `sha256:${crypto.createHash('sha256').update(stable(topics)).digest('hex').slice(0, 16)}`;
  const construct = JSON.parse(fs.readFileSync(path.join(HERE, '../package.json'), 'utf8')).version;
  return { format: SPEC_FORMAT, version, construct, topics };
}

/**
 * One topic of the spec (the whole spec's version stays, so a reader knows which spec the slice came from), optionally
 * narrowed by `id`: a rule id, a command or tool name, or a module name / file (case-insensitive substring).
 * @param {import('./contract.mjs').LineSpec} spec
 * @param {string} topic One of SPEC_TOPICS.
 * @param {string} [id]
 * @returns {any} The slice.
 */
export function sliceSpec(spec, topic, id) {
  if (!SPEC_TOPICS.includes(topic)) throw new Error(`"${topic}" is not a spec topic; the topics are ${SPEC_TOPICS.join(', ')}.`);
  let value = /** @type {any} */ (spec.topics)[topic];
  if (id) {
    const q = String(id).toLowerCase();
    const has = (s) => String(s ?? '').toLowerCase().includes(q);
    if (topic === 'rules') value = value.filter((r) => has(r.id));
    else if (topic === 'commands') value = { construct: value.construct.filter((c) => has(c.name) || has(c.tool)), line: value.line.filter((t) => has(t.name)) };
    else if (topic === 'modules') value = value.map((m) => (has(m.module) ? m : { ...m, files: m.files.filter((f) => has(f.file)) })).filter((m) => m.files.length);
  }
  return { format: spec.format, version: spec.version, construct: spec.construct, topics: { [topic]: value } };
}
