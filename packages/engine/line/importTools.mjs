// ci2 -- the Import steps as plan tools in cp1's ONE registry (planTools.mjs createLinePlanRegistry), so the Import agent
// executes only by adding plan steps that a person approves, like every other Line change.
//
//   line.import.mark / toLibrary / toFeature   write   one ci1 import step (import.mjs IMPORT_STEP_TOOLS)
//   line.import.fix                            write   one typed fix (fixes.mjs planStep) run inside the import folder
//
// Each runs with the import folder as the writer's root (`<project>/<args.folder>`), so it can never write outside the
// folder, and records the same LineStepResult as the other change tools (planTools.mjs runChange: plan, narrow to what is
// not there yet, applyChange, checks, the refusal's typed fixes as options). A fix option is re-worded as a
// line.import.fix step, so the fix also runs inside the folder.
import fs from 'node:fs';
import path from 'node:path';
import { IMPORT_TOOLS, LINE_FIX_TOOLS, LineOpError, importFolderProblem } from './contract.mjs';
import { planImportStep } from './import.mjs';
import { REAL_PLAN_OPS, runChange } from './planTools.mjs';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const failed = (p, message) => ({ success: /** @type {const} */ (false), error: { issues: [{ path: p, message }] } });
const PLAN_ONLY = ['expect', 'retry', 'fixOf'];

/** The args each import tool takes (besides `folder` and the plan-only fields). */
const ARGS = Object.freeze({
  'line.import.mark': ['features'],
  'line.import.toLibrary': ['from', 'kind', 'name', 'level', 'keepShim'],
  'line.import.toFeature': ['mode', 'from', 'kind', 'name', 'feature', 'base', 'route', 'keepShim'],
  'line.import.fix': ['tool', 'args'],
});

/** A folder inside the project: relative, no "..", not the project itself (contract.mjs importFolderProblem). */
export const folderProblem = importFolderProblem;

function schemaOf(tool) {
  const allowed = new Set(['folder', ...ARGS[tool], ...PLAN_ONLY]);
  return Object.freeze({
    fields: ['folder', ...ARGS[tool]],
    /** cl1's spec: line.import.fix's arguments as a JSON Schema (the plan-only fields as every change tool has them). */
    jsonSchema: () => ({
      type: 'object',
      properties: {
        folder: { type: 'string', minLength: 1 }, tool: { enum: [...LINE_FIX_TOOLS] }, args: { type: 'object' },
        expect: { type: 'array' }, retry: { type: 'object', required: ['of'], properties: { of: { type: 'string' } } }, fixOf: { type: 'string', minLength: 1 },
      },
      required: ['folder', 'tool', 'args'],
      additionalProperties: false,
    }),
    safeParse(value) {
      const v = value ?? {};
      if (!isObj(v)) return failed([], 'must be an object');
      const extra = Object.keys(v).find((k) => !allowed.has(k));
      if (extra) return failed([extra], 'is not an argument of this tool');
      const bad = folderProblem(v.folder);
      if (bad) return failed(['folder'], bad);
      if (tool === 'line.import.fix') {
        if (!LINE_FIX_TOOLS.includes(v.tool)) return failed(['tool'], `must be one of ${LINE_FIX_TOOLS.join(', ')}`);
        if (!isObj(v.args)) return failed(['args'], 'must be the fix step\'s arguments');
      }
      if (tool !== 'line.import.mark' && tool !== 'line.import.fix' && (typeof v.name !== 'string' || !v.name)) return failed(['name'], 'must be a non-empty string');
      if (v.retry !== undefined && (!isObj(v.retry) || typeof v.retry.of !== 'string')) return failed(['retry'], 'must be {"of": "<step id>"}');
      if (v.fixOf !== undefined && (typeof v.fixOf !== 'string' || !v.fixOf)) return failed(['fixOf'], 'must be the id of the step this fix is for');
      return { success: /** @type {const} */ (true), data: { ...v } };
    },
  });
}

const DESCRIBE = Object.freeze({
  'line.import.mark': 'Import: marks the import folder as a Line folder (architecture.yml, library, feature specs), through the checked writer.',
  'line.import.toLibrary': 'Import: moves one item of the import folder into its library and points its users at it, through the checked writer.',
  'line.import.toFeature': 'Import: moves or adds one item of the import folder into a feature, based on a library item, through the checked writer.',
  'line.import.fix': 'Import: applies one typed fix of a refused import step inside the import folder, through the checked writer.',
});

/**
 * The import folder's absolute root, or a LineOpError.
 * @param {any} root
 * @param {any} folder
 * @returns {any}
 */
export function folderRootOf(root, folder) {
  const bad = folderProblem(folder);
  if (bad) throw new LineOpError(`The import folder ${bad}.`, 'BAD_FOLDER');
  const abs = path.resolve(root, folder);
  if (!abs.startsWith(path.resolve(root) + path.sep)) throw new LineOpError('The import folder must be inside the project.', 'BAD_FOLDER');
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new LineOpError(`The project has no folder ${folder}.`, 'BAD_FOLDER');
  return abs;
}

/**
 * A fix option's step, re-worded to run inside the import folder.
 * @param {any} folder
 * @param {any} step
 * @returns {any}
 */
export const asImportFix = (folder, step) => (step ? { tool: 'line.import.fix', args: { folder, tool: step.tool, args: { ...step.args } } } : step);

/**
 * Run one import tool. Never throws for a refusal; the result says the step needs the person.
 * @param {any} root
 * @param {any} tool
 * @param {any} args
 * @param {any} [ops]
 * @returns {import('./contract.mjs').LineStepResult}
 */
export function runImportTool(root, tool, args, ops = REAL_PLAN_OPS) {
  let folderRoot;
  try { folderRoot = folderRootOf(root, args.folder); } catch (e) {
    const s = /** @type {any} */ (e).sentence ?? 'The import folder cannot be used.';
    return { apply: { ok: false, sentence: `Nothing was saved: ${s.charAt(0).toLowerCase()}${s.slice(1)}`, files: [], findings: [] }, checks: [], passed: 0, total: 1, needsYou: true, options: [{ id: 'leave', sentence: 'Leave it as it is and carry on.' }], stopped: false, sentence: `This needs you: ${s}` };
  }
  let r;
  if (tool === 'line.import.fix') {
    const { tool: inner, args: innerArgs } = /** @type {any} */ (args);
    r = runChange(folderRoot, inner, { ...innerArgs, ...(args.retry ? { retry: args.retry } : {}) }, ops);
  } else {
    // runChange plans through ops.planStep for the moveFile tool; the import step is planned there instead, on the folder.
    const importOps = { ...ops, planStep: (fr, step) => planImportStep(fr, /** @type {any} */ ({ id: 'run', tool, args: step.args })) };
    const { expect, retry, fixOf: _f, ...req } = /** @type {any} */ (args);
    r = runChange(folderRoot, 'line.moveFile', { ...req, ...(expect ? { expect } : {}), ...(retry ? { retry } : {}) }, importOps);
  }
  return { ...r, options: r.options.map((o) => (o.id === 'fix' && o.step ? { ...o, step: asImportFix(args.folder, o.step) } : o)) };
}

/**
 * The import tools for one project root, in planTools.mjs lineTools' shape.
 * @param {{root: string, ops?: typeof REAL_PLAN_OPS, afterSave?: (root: string, file: string) => unknown}} o
 * @returns {any}
 */
export function importTools({ root, ops = REAL_PLAN_OPS, afterSave }) {
  // line.import.mark/toLibrary/toFeature are planTools.mjs's own change tools (the integrator's, run in the folder); this
  // module adds only the fix step that runs inside the import folder (one module per concern).
  return ['line.import.fix'].map((name) => ({
    name,
    kind: /** @type {const} */ ('write'),
    schema: schemaOf(name),
    describe: DESCRIBE[name],
    async run(args) {
      const r = runImportTool(root, name, args, ops);
      if (afterSave && r.apply?.ok) for (const f of r.apply.files) afterSave(root, `${args.folder}/${f}`);
      return r;
    },
  }));
}
