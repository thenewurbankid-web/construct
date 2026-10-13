// #937 (epic #934): the tool registry's reads that run from a project root alone: the one handler map construct-mcp
// registers (packages/mcp server.mjs) and the bench builder calls in-process (bench/ecommerce/driver/read-tools.mjs).
// Re-exported by toolRegistry.mjs. Names (mcpNameOf), fields and argument checks stay the registry entries' own; this
// file only says how each read runs from a root, and which reads cannot (READ_SKIPPED, each with why).
import path from 'node:path';
import { TOOL_ENTRIES, lineHandlers, realLineOps } from '../toolRegistry.mjs';

const refuse = (id, code, sentence) => ({ ok: /** @type {const} */ (false), id, code, sentence });

/**
 * #937: the MCP tool name of an entry: its own mcp surface, else its id with dots as underscores (line.pageTree ->
 * line_pageTree), so every registry read can be offered under one stable name.
 * @param {import('../contract.mjs').ToolEntry} e
 * @returns {string}
 */
export const mcpNameOf = (e) => e.surfaces.mcp ?? e.id.replace(/\./g, '_');


/**
 * The reads that are not offered from a project root, with the reason. Everything else of kind read has a handler here
 * or on construct-mcp's own hand-written list (blocks.*, plan.status, plan.seed, importAgent.status, train.eval, ...).
 */
export const READ_SKIPPED = Object.freeze({
  'line.render': 'renders a component by loading and running its code (Morpheus loader); a read tool never runs project code',
  'line.openProject': 'switches the project Cockpit has open (Cockpit session state)',
  'line.aiProfiles': 'reads the Cockpit machine\'s AI step settings, not the project',
  'line.memory': 'Line\'s per-person decision memory, shown in Cockpit only',
  'line.memory.records': 'Line\'s per-person decision memory, shown in Cockpit only',
  'line.memory.export': 'exports a file the person keeps; Cockpit only',
  'line.misses': 'needs the Cockpit server\'s miss snapshot',
  'line.graph': 'the knows service lives in the Cockpit session (it holds a writer for proposed changes)',
  'line.graphChanges': 'the knows service lives in the Cockpit session (it holds a writer for proposed changes)',
  'line.graphStats': 'the knows service lives in the Cockpit session (it holds a writer for proposed changes)',
  'draft.status': 'the System 1 drafter is switched on per Cockpit server (LINE_DRAFTER)',
  'draft.draft': 'the System 1 drafter is switched on per Cockpit server (LINE_DRAFTER) and checks routes in scratch copies',
  'train.worlds': 'Train Line\'s store belongs to the Cockpit Train screen; agents use train_list_cases',
  'train.cases': 'Train Line\'s store belongs to the Cockpit Train screen; agents use train_list_cases',
  'train.facts': 'Train Line\'s store belongs to the Cockpit Train screen',
  'train.draft': 'Train Line\'s store belongs to the Cockpit Train screen',
  'train.preview': 'Train Line\'s store belongs to the Cockpit Train screen',
  'train.route': 'Train Line\'s store belongs to the Cockpit Train screen',
  'train.try': 'Train Line tries routes in scratch copies from the Cockpit Train screen',
  'train.scoreboard': 'Train Line\'s store belongs to the Cockpit Train screen',
  'gatelm.find': 'GateLM\'s tools run over Studio\'s GateLM api, not a project root',
  'gatelm.get': 'GateLM\'s tools run over Studio\'s GateLM api, not a project root',
  'gatelm.verify': 'GateLM\'s tools run over Studio\'s GateLM api, not a project root',
  'gatelm.reasoning': 'GateLM\'s tools run over Studio\'s GateLM api, not a project root',
});

/**
 * Every read an agent may call: kind read, not person-only.
 * @returns {import('../contract.mjs').ToolEntry[]}
 */
export const registryReads = () => TOOL_ENTRIES.filter((e) => e.kind === 'read' && !e.personOnly);

/** Argument names that hold a project file: checked to stay inside the project before any read. */
const FILE_ARGS = ['file'];

/**
 * The read handlers that run from a root alone (by registry id), loaded on demand.
 * @param {string} root The project root.
 * @returns {Promise<Record<string, (args: any) => unknown>>}
 */
export async function readHandlers(root) {
  const [ops, coder, workflows, components, imp, trace, model, lsp] = await Promise.all([
    realLineOps(), import('./reads.mjs'), import('../workflows.mjs'), import('../components.mjs'), import('../import.mjs'),
    import('../traceMatch.mjs'), import('../model.mjs'), import('../lsp/tools.mjs'),
  ]);
  const line = lineHandlers(root, ops);
  /** @type {Record<string, (args: any) => unknown>} */
  const out = {
    'line.project': line['line.project'],
    'line.feature': line['line.feature'],
    'line.pageTree': line['line.pageTree'],
    'line.fragments': line['line.fragments'],
    'line.pageBinding': line['line.pageBinding'],
    'line.workspace': line['line.workspace'],
    'line.workflows': (a) => workflows.readLineWorkflows(root, a.feature),
    'line.component': (a) => components.readLineComponent(root, a.file),
    'line.import.folders': () => imp.listImportFolders(root),
    'line.import.scan': (a) => imp.scanImport(root, a.route ? { route: a.route, ...(a.folder ? { folder: a.folder } : {}) } : a.folder),
    'line.import.plan': (a) => imp.planImport(root, a.route ? { route: a.route, ...(a.folder ? { folder: a.folder } : {}) } : a.folder, a.answers ?? {}),
    'line.trace': (a) => trace.traceMatch({ request: a.request, steps: a.steps }, { project: model.readLineProject(root) }),
    'line.tools': () => ({ ok: true, tools: registryReads().map((e) => ({ id: e.id, name: mcpNameOf(e), sentence: e.sentence })) }),
    'line.featureSummary': (a) => coder.featureSummary(root, a),
    'line.scope': (a) => coder.scopeOf(root, a),
    'line.atoms': (a) => coder.atomsFor(a),
    // #945: the Line LSP calls (lsp/tools.mjs), in process for Line's own coder; construct-mcp lists them by hand.
    'lsp.nextSteps': (a) => lsp.lspNextSteps(root, a),
    'lsp.completions': (a) => lsp.lspCompletions(root, a),
    'lsp.symbolInfo': (a) => lsp.lspSymbolInfo(root, a),
    'lsp.smithCheck': (a) => lsp.lspSmithCheck(root, a),
    'lsp.fixes': (a) => lsp.lspFixes(root, a),
  };
  for (const id of Object.keys(out)) if (typeof out[id] !== 'function' || id in READ_SKIPPED) delete out[id];
  return out;
}

/**
 * One project's read dispatcher over the registry: the args are checked by the entry's inputSchema, a file argument
 * must stay inside the project, and the handler's LineOpError (or crash) comes back as one sentence.
 * @param {string} root
 * @returns {Promise<{ids: string[], has: (id: string) => boolean, entry: (id: string) => any,
 *   byName: (name: string) => any, dispatch: (id: string, args?: any) => Promise<any>}>}
 */
export async function createReadDispatcher(root) {
  const handlers = await readHandlers(root);
  const reads = registryReads().filter((e) => handlers[e.id]);
  const entry = (id) => reads.find((e) => e.id === id) ?? null;
  return {
    ids: reads.map((e) => e.id),
    has: (id) => entry(id) !== null,
    entry,
    byName: (name) => reads.find((e) => mcpNameOf(e) === name) ?? null,
    async dispatch(id, args = {}) {
      const e = entry(id);
      if (!e) return refuse(id, 'UNKNOWN_TOOL', `There is no read tool ${id}.`);
      const parsed = e.inputSchema.safeParse(args ?? {});
      if (!parsed.success) return refuse(id, 'BAD_ARGS', `The arguments do not fit ${mcpNameOf(e)}: ${/** @type {any} */ (parsed).error.issues.map((i) => `${i.path.join('.') || 'args'} ${i.message}`).join('; ')}.`);
      for (const k of FILE_ARGS) {
        const v = parsed.data[k];
        if (v === undefined) continue;
        const rel = String(v);
        const abs = path.resolve(root, rel);
        if (path.isAbsolute(rel) || /^~|^[A-Za-z]:/.test(rel) || rel.split(/[\\/]/).includes('..') || !(abs === root || abs.startsWith(root + path.sep))) {
          return refuse(id, 'PATH_OUTSIDE_ROOT', `Name a file inside the project by its project-relative path; ${k} "${rel.slice(0, 80)}" is not one.`);
        }
      }
      try {
        const result = await handlers[id](parsed.data);
        return result && typeof result === 'object' && 'ok' in result ? result : { ok: true, result };
      } catch (err) {
        const x = /** @type {any} */ (err);
        if (x?.name === 'LineOpError') return refuse(id, x.code, x.sentence ?? x.message);
        return refuse(id, 'FAILED', `${mcpNameOf(e)} could not finish: ${String(x?.message ?? x).slice(0, 200)}`);
      }
    },
  };
}
