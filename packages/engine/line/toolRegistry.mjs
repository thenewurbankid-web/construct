// cu3 -- ONE tool registry for Line (contract: packages/engine/line/contract.mjs ToolEntry). Every capability is one
// typed tool call; the Cockpit's /api/line routes (ui/server/src/lineToolGate.mjs), construct-mcp (packages/mcp
// server.mjs), GateLM's tools (@mx/plan gatelmTools, through packages/line-links) and Studio's dispatcher
// (vision-architect-pipeline studio/src/dispatch.ts createDispatcher, fed by `studioHandlers`) all resolve here.
//
//   TOOL_ENTRIES          the static catalog: id, kind (read|write), writes (project|line|null), input schema, output
//                         shape, one sentence, optional controlId (cg1/ct1 light controls up by it), and its surfaces.
//   commandEntries(reg)   Construct's commands (construct.*) as entries, from the plan registry over the CLI commands.
//   entryForRoute / entryForMcp / entryById   the lookups each surface uses (exactly one entry each).
//   createToolRegistry()  binds the catalog to one project: `dispatch(id, args, {by})`.
//
// Dispatch rule (owner, cu3): a read runs directly. A write to project files only ever becomes a plan step (planService
// addStep); it runs after a person approves it (or Auto). A write to Line's own state (line/: the plan, the workspace,
// GateLM drafts) runs directly, is written atomically by its own store, and is logged to line/log/tools.jsonl. A
// person-only tool (plan.approve) refuses an agent. Nothing here writes a project file.
import fs from 'node:fs';
import path from 'node:path';
import { createTransaction } from '../transactionalWriter.mjs';
import { LINE_PLAN_TOOLS, assertToolEntry } from './contract.mjs';
import { LINE_CONTROLS } from './controls.mjs';

// ------------------------------------------------------------------------------------------------- schemas
const failed = (p, message) => ({ success: /** @type {const} */ (false), error: { issues: [{ path: p, message }] } });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * A SchemaLike over named fields: `required` must be present (non-empty strings unless typed otherwise), `optional`
 * may be, anything else is refused. Values are typed loosely here; the surface or the op checks them in full.
 * @param {string[]} required
 * @param {string[]} [optional]
 * @param {{open?: boolean}} [o] `open` lets unknown fields through.
 * @returns The schema (fields and safeParse).
 */
export function fieldsSchema(required, optional = [], o = {}) {
  const allowed = new Set([...required, ...optional]);
  return Object.freeze({
    fields: [...required, ...optional],
    safeParse(value) {
      const v = value ?? {};
      if (!isObj(v)) return failed([], 'must be an object');
      if (!o.open) { const extra = Object.keys(v).find((k) => !allowed.has(k)); if (extra) return failed([extra], 'is not an argument of this tool'); }
      const missing = required.find((k) => v[k] === undefined);
      if (missing) return failed([missing], 'is required');
      return { success: /** @type {const} */ (true), data: { ...v } };
    },
  });
}
const CHANGE_EXTRA = ['expect', 'retry', 'fixOf'];
const NONE = fieldsSchema([]);

// ------------------------------------------------------------------------------------------------- the catalog
const http = (method, p) => ({ method, path: `/api/line${p}` });

/** @type {readonly import('./contract.mjs').ToolEntry[]} */
export const TOOL_ENTRIES = Object.freeze(/** @type {any[]} */ ([
  // Line reads (Cockpit routes; line.project is also a plan step).
  { id: 'line.project', kind: 'read', writes: null, inputSchema: NONE, outputSchema: 'LineProject', sentence: 'Reads the Line view of the project: library, features, items and findings.', surfaces: { http: http('GET', '/project'), plan: true } },
  { id: 'line.feature', kind: 'read', writes: null, inputSchema: fieldsSchema(['name']), outputSchema: 'LineFeatureDetail', sentence: 'Reads one feature: its items by kind, a summary and how much of its spec is covered.', surfaces: { http: http('GET', '/feature') } },
  { id: 'line.pageTree', kind: 'read', writes: null, inputSchema: fieldsSchema(['file']), outputSchema: 'PageTree', sentence: 'Reads the parts of one feature page and their props.', surfaces: { http: http('GET', '/page-tree') } },
  { id: 'line.render', kind: 'read', writes: null, inputSchema: fieldsSchema(['file'], ['props']), outputSchema: 'RenderResult', sentence: 'Renders one library component alone with its props.', surfaces: { http: http('GET', '/render') } },
  { id: 'line.fragments', kind: 'read', writes: null, inputSchema: fieldsSchema(['file']), outputSchema: 'FragmentList', sentence: 'Lists the pieces of code in one file that can be changed on their own.', surfaces: { http: http('GET', '/fragments') } },
  { id: 'line.workspace', kind: 'read', writes: null, inputSchema: NONE, outputSchema: 'LineWorkspace', sentence: 'Reads the one folder Line may change.', surfaces: { http: http('GET', '/workspace') } },
  { id: 'line.tools', kind: 'read', writes: null, inputSchema: NONE, outputSchema: 'ToolList', sentence: 'Lists every tool Line offers, each marked read or write.', surfaces: { http: http('GET', '/tools') } },
  { id: 'line.workflows', kind: 'read', writes: null, inputSchema: fieldsSchema(['feature']), outputSchema: 'LineWorkflowList', sentence: 'Reads one feature\'s workflows and the library workflows to start from.', surfaces: { http: http('GET', '/workflows') } },
  { id: 'line.import.folders', kind: 'read', writes: null, inputSchema: NONE, outputSchema: 'ImportFolders', sentence: 'Lists the folders of the open project worth importing.', surfaces: { http: http('GET', '/import/folders') } },
  { id: 'line.import.scan', kind: 'read', writes: null, inputSchema: fieldsSchema(['folder']), outputSchema: 'ImportScan', sentence: 'Reads one folder and says what Line proposes for each item in it; writes nothing.', surfaces: { http: http('POST', '/import/scan') } },
  { id: 'line.import.plan', kind: 'read', writes: null, inputSchema: fieldsSchema(['folder'], ['answers']), outputSchema: 'ImportPlan', sentence: 'Turns an import scan and its answers into plan steps; writes nothing.', surfaces: { http: http('POST', '/import/plan') } },
  { id: 'line.spec', kind: 'read', writes: null, inputSchema: fieldsSchema([], ['topic', 'id']), outputSchema: 'LineSpec', sentence: 'Reads Line\'s versioned spec, generated from its code, one topic at a time.', surfaces: { mcp: 'line_spec' } },
  // cu7: mounted at its own path before the gate (it needs no open project); a person starts a new project folder.
  { id: 'line.newProject', kind: 'write', writes: 'project', inputSchema: fieldsSchema(['name', 'feature'], [], { open: true }), outputSchema: 'NewLineProjectResult', sentence: 'Starts a new Line project in a folder of the workspace and opens it.', personOnly: true, surfaces: { http: http('POST', '/new-project') } },
  { id: 'line.aiProfiles', kind: 'read', writes: null, inputSchema: NONE, outputSchema: 'AiProfiles', sentence: 'Reads every AI step\'s profile: its model, how it decides and its static fallback.', surfaces: { http: http('GET', '/ai-profiles') } },
  // ci2: the Import agent (its process file <folder>/line/import-plan.json is Line's own state; it changes project files
  // only by adding plan steps a person approves).
  { id: 'importAgent.status', kind: 'read', writes: null, inputSchema: fieldsSchema(['folder']), outputSchema: 'ImportAgentView', sentence: 'Reads the Import process for one folder: its stage, what it waits for, its plan and record.', surfaces: { http: http('GET', '/import-agent'), mcp: 'import_status' } },
  { id: 'importAgent.start', kind: 'write', writes: 'line', inputSchema: fieldsSchema(['folder']), outputSchema: 'ImportAgentView', sentence: 'Starts the Import process for one folder; it stops at the review.', surfaces: { http: http('POST', '/import-agent/start'), mcp: 'import_start' } },
  { id: 'importAgent.resume', kind: 'write', writes: 'line', inputSchema: fieldsSchema(['folder']), outputSchema: 'ImportAgentView', sentence: 'Carries the Import process on until it needs someone.', surfaces: { http: http('POST', '/import-agent/resume'), mcp: 'import_resume' } },
  { id: 'importAgent.pause', kind: 'write', writes: 'line', inputSchema: fieldsSchema(['folder']), outputSchema: 'ImportAgentView', sentence: 'Pauses the Import process.', surfaces: { http: http('POST', '/import-agent/pause') } },
  { id: 'importAgent.editStep', kind: 'write', writes: 'line', inputSchema: fieldsSchema(['folder', 'action'], ['stepId', 'args', 'to']), outputSchema: 'ImportAgentView', sentence: 'Edits, skips, moves or approves a step of the import plan during the review.', surfaces: { http: http('POST', '/import-agent/step'), mcp: 'import_plan_edit' } },
  { id: 'importAgent.answer', kind: 'write', writes: 'line', inputSchema: fieldsSchema(['folder', 'questionId', 'optionId']), outputSchema: 'ImportAgentView', sentence: 'Answers the one question the Import process asked.', surfaces: { http: http('POST', '/import-agent/answer'), mcp: 'import_answer' } },
  // System 1 drafter (LINE_DRAFTER=1): drafting is a read (routes are checked in a scratch copy); adding a route adds plan
  // steps and an answer saves the project's domain map (both Line's own state).
  { id: 'draft.status', kind: 'read', writes: null, inputSchema: NONE, outputSchema: '{ok, on}', sentence: 'Says whether the drafter is on.', surfaces: { http: http('GET', '/plan/draft') } },
  { id: 'draft.draft', kind: 'read', writes: null, inputSchema: fieldsSchema(['request']), outputSchema: 'DraftView', sentence: 'Drafts every checked route for a request; writes nothing.', surfaces: { http: http('POST', '/plan/draft') } },
  { id: 'draft.add', kind: 'write', writes: 'line', inputSchema: fieldsSchema(['request', 'routeId'], ['from']), outputSchema: 'PlanView & {added, next, sentence}', sentence: 'Adds a drafted route\'s steps to the plan, each waiting for a person\'s approval.', surfaces: { http: http('POST', '/plan/draft/add') } },
  { id: 'draft.answer', kind: 'write', writes: 'line', inputSchema: fieldsSchema(['word', 'key']), outputSchema: '{ok, sentence}', sentence: 'Saves what an unknown word means in the project\'s domain map.', surfaces: { http: http('POST', '/plan/draft/answer') } },
  // Train Line (owner + Claude teach the drafter): the store is Line's own state (line/train, through the writer, with a
  // who-did-it log). Agree/disagree is the owner's only (personOnly, never an MCP tool); Claude proposes drafts.
  { id: 'train.worlds', kind: 'read', writes: null, inputSchema: NONE, outputSchema: '{worlds}', sentence: 'Lists the projects Train Line can teach on.', surfaces: { http: http('GET', '/train/worlds') } },
  { id: 'train.cases', kind: 'read', writes: null, inputSchema: fieldsSchema([], ['filter', 'limit', 'offset']), outputSchema: '{cases}', sentence: 'Lists Train Line cases with names filled in.', surfaces: { http: http('GET', '/train/cases'), mcp: 'train_list_cases' } },
  { id: 'train.facts', kind: 'read', writes: null, inputSchema: fieldsSchema([], ['world']), outputSchema: 'WorldChoices', sentence: 'Lists what a project offers to pick from (features, library items, pages).', surfaces: { http: http('GET', '/train/facts') } },
  { id: 'train.draft', kind: 'read', writes: null, inputSchema: fieldsSchema(['request'], ['world']), outputSchema: 'TrainDraft', sentence: 'Drafts the routes for a request; writes nothing.', surfaces: { http: http('POST', '/train/draft') } },
  { id: 'train.preview', kind: 'read', writes: null, inputSchema: fieldsSchema([], [], { open: true }), outputSchema: 'TrainPreview', sentence: 'Shows a case as it would be saved, without project words; writes nothing.', surfaces: { http: http('POST', '/train/preview') } },
  { id: 'train.route', kind: 'read', writes: null, inputSchema: fieldsSchema([], [], { open: true }), outputSchema: 'TrainRoute', sentence: 'Builds one route from closed choices; writes nothing.', surfaces: { http: http('POST', '/train/route') } },
  { id: 'train.try', kind: 'read', writes: null, inputSchema: fieldsSchema([], [], { open: true }), outputSchema: 'TryResult', sentence: 'Tries a route in a scratch copy; the project is not touched.', surfaces: { http: http('POST', '/train/try') } },
  { id: 'train.save', kind: 'write', writes: 'line', inputSchema: fieldsSchema([], [], { open: true }), outputSchema: 'TrainCaseView', sentence: 'Saves a verified training case, without project words.', surfaces: { http: http('POST', '/train/cases') } },
  { id: 'train.propose', kind: 'write', writes: 'line', inputSchema: fieldsSchema(['request', 'intent', 'routes'], ['world', 'preferred', 'note']), outputSchema: 'TrainCaseView', sentence: 'Claude proposes one training case as a draft; it is kept only when Construct verifies every route.', surfaces: { mcp: 'train_propose_case' } },
  { id: 'train.review', kind: 'write', writes: 'line', inputSchema: fieldsSchema(['id', 'verdict'], ['note']), outputSchema: 'TrainCaseView', sentence: 'The owner agrees or disagrees with a case.', personOnly: true, surfaces: { http: http('POST', '/train/review') } },
  { id: 'train.synonym', kind: 'write', writes: 'line', inputSchema: fieldsSchema([], [], { open: true }), outputSchema: '{ok, sentence}', sentence: 'Saves a word as a synonym in a project\'s domain map.', surfaces: { http: http('POST', '/train/synonym') } },
  { id: 'train.eval', kind: 'read', writes: null, inputSchema: NONE, outputSchema: 'TrainEval', sentence: 'Drafts every held-out case and scores the drafter.', surfaces: { http: http('POST', '/train/eval'), mcp: 'train_run_eval' } },
  { id: 'train.scoreboard', kind: 'read', writes: null, inputSchema: NONE, outputSchema: 'Scoreboard', sentence: 'Shows the drafter\'s scores per tool family and intent.', surfaces: { http: http('GET', '/train/scoreboard') } },
  // Line's own state: written atomically by its store and logged, without asking.
  { id: 'line.setWorkspace', kind: 'write', writes: 'line', inputSchema: fieldsSchema(['folder']), outputSchema: 'LineWorkspace', sentence: 'Sets the one folder Line may change; everything outside it stays read-only.', controlId: 'workspace-folder', surfaces: { http: http('POST', '/workspace') } },
  // Project writes: only ever a plan step (approval per step, or Auto).
  { id: 'line.baseOn', kind: 'write', writes: 'project', inputSchema: fieldsSchema(['libraryId', 'feature', 'name'], CHANGE_EXTRA), outputSchema: 'LineStepResult', sentence: 'Creates a feature component based on one library item.', controlId: 'base-on', surfaces: { plan: true } },
  { id: 'line.promote', kind: 'write', writes: 'project', inputSchema: fieldsSchema(['featureItemId'], CHANGE_EXTRA), outputSchema: 'LineStepResult', sentence: 'Moves a feature item into the library and points its users at the library copy.', controlId: 'promote', surfaces: { plan: true } },
  { id: 'line.setPageProp', kind: 'write', writes: 'project', inputSchema: fieldsSchema(['file', 'nodeId', 'prop', 'kind', 'value'], CHANGE_EXTRA), outputSchema: 'LineStepResult', sentence: 'Sets one prop of one part of a feature page.', controlId: 'page-prop-save', surfaces: { plan: true } },
  { id: 'line.fix', kind: 'write', writes: 'project', inputSchema: fieldsSchema(['findingKey', 'fixId'], CHANGE_EXTRA), outputSchema: 'LineStepResult', sentence: 'Applies one typed fix of a finding.', controlId: 'apply-fix', surfaces: { plan: true } },
  { id: 'line.setFragment', kind: 'write', writes: 'project', inputSchema: fieldsSchema(['file', 'fragmentId', 'code', 'contentHash'], CHANGE_EXTRA), outputSchema: 'LineStepResult', sentence: 'Replaces one piece of code in a file.', controlId: 'fragment-save', surfaces: { plan: true } },
  { id: 'line.setBase', kind: 'write', writes: 'project', inputSchema: fieldsSchema(['file', 'libraryId'], CHANGE_EXTRA), outputSchema: 'LineStepResult', sentence: 'Points a feature item\'s base link at one library item.', surfaces: { plan: true } },
  { id: 'line.moveFile', kind: 'write', writes: 'project', inputSchema: fieldsSchema(['from', 'to'], ['base', ...CHANGE_EXTRA]), outputSchema: 'LineStepResult', sentence: 'Moves a file and points every import of it at the new place.', surfaces: { plan: true } },
  { id: 'line.createLayout', kind: 'write', writes: 'project', inputSchema: fieldsSchema([], CHANGE_EXTRA), outputSchema: 'LineStepResult', sentence: 'Creates the library folder so the project is laid out as Line.', surfaces: { plan: true } },
  { id: 'line.amend', kind: 'write', writes: 'project', inputSchema: fieldsSchema(['change'], ['fix', 'fixes', ...CHANGE_EXTRA]), outputSchema: 'LineStepResult', sentence: 'Applies a change Construct refused together with its typed fix (or a chain of fixes), as one change.', surfaces: { plan: true } },
  { id: 'line.import.mark', kind: 'write', writes: 'project', inputSchema: fieldsSchema(['folder', 'features'], ['appFolders', ...CHANGE_EXTRA]), outputSchema: 'LineStepResult', sentence: 'Import: marks a folder as a Line folder, with a library and its features.', surfaces: { plan: true } },
  { id: 'line.import.toLibrary', kind: 'write', writes: 'project', inputSchema: fieldsSchema(['folder', 'from', 'kind', 'name'], ['level', 'keepShim', ...CHANGE_EXTRA]), outputSchema: 'LineStepResult', sentence: 'Import: moves one item of the import folder into its library.', surfaces: { plan: true } },
  { id: 'line.import.toFeature', kind: 'write', writes: 'project', inputSchema: fieldsSchema(['folder', 'mode', 'kind', 'name', 'feature', 'base'], ['from', 'keepShim', 'route', ...CHANGE_EXTRA]), outputSchema: 'LineStepResult', sentence: 'Import: moves one item into a feature of the import folder, or adds it based on its library copy.', surfaces: { plan: true } },
  { id: 'line.import.fix', kind: 'write', writes: 'project', inputSchema: fieldsSchema(['folder', 'tool', 'args'], CHANGE_EXTRA), outputSchema: 'LineStepResult', sentence: 'Import: applies one typed fix of a refused import step inside the import folder.', surfaces: { plan: true } },
  { id: 'line.baseWorkflowOn', kind: 'write', writes: 'project', inputSchema: fieldsSchema(['libraryId', 'feature', 'name'], CHANGE_EXTRA), outputSchema: 'LineStepResult', sentence: 'Creates a feature workflow based on one library workflow.', surfaces: { plan: true } },
  { id: 'line.setWorkflowRole', kind: 'write', writes: 'project', inputSchema: fieldsSchema(['file', 'role', 'page'], CHANGE_EXTRA), outputSchema: 'LineStepResult', sentence: 'Binds one role of a feature workflow to a page of the feature.', surfaces: { plan: true } },
  { id: 'line.addWorkflowTransition', kind: 'write', writes: 'project', inputSchema: fieldsSchema(['file', 'from', 'event', 'to'], ['service', 'part', 'partState', ...CHANGE_EXTRA]), outputSchema: 'LineStepResult', sentence: 'Adds one When -> Do transition to a feature workflow.', surfaces: { plan: true } },
  { id: 'line.removeWorkflowTransition', kind: 'write', writes: 'project', inputSchema: fieldsSchema(['file', 'from', 'event'], CHANGE_EXTRA), outputSchema: 'LineStepResult', sentence: 'Removes one of a feature workflow\'s own transitions.', surfaces: { plan: true } },
  // A plan-only decision: recorded in the plan (Line's own state); it has no direct handler, so it is always a step.
  { id: 'line.leaveAsIs', kind: 'write', writes: 'line', inputSchema: fieldsSchema(['stepId']), outputSchema: '{left, sentence}', sentence: 'Records that a person chose to carry on after a step that needed them.', controlId: 'plan-leave', surfaces: { plan: true } },
  // The plan API itself (Line's own state, line/plans/): Cockpit routes and the agent's MCP tools.
  { id: 'plan.status', kind: 'read', writes: null, inputSchema: NONE, outputSchema: 'PlanView', sentence: 'Reads the project\'s current plan, each step with its state.', surfaces: { http: http('GET', '/plan'), mcp: 'plan_status' } },
  { id: 'plan.addStep', kind: 'write', writes: 'line', inputSchema: fieldsSchema(['tool'], ['args', 'why']), outputSchema: 'PlanView & {stepId}', sentence: 'Adds one step to the project\'s plan; a change waits there for approval.', surfaces: { http: http('POST', '/plan/step'), mcp: 'plan_add_step' } },
  { id: 'plan.approve', kind: 'write', writes: 'line', inputSchema: fieldsSchema(['stepId']), outputSchema: 'PlanView', sentence: 'A person approves one step of the plan.', controlId: 'plan-approve', personOnly: true, surfaces: { http: http('POST', '/plan/approve') } },
  { id: 'plan.runNext', kind: 'write', writes: 'line', inputSchema: fieldsSchema([], ['stepId']), outputSchema: 'PlanView', sentence: 'Runs exactly one ready step; a change runs only after a person approved it.', surfaces: { http: http('POST', '/plan/run'), mcp: 'plan_run_next' } },
  { id: 'plan.retry', kind: 'write', writes: 'line', inputSchema: fieldsSchema(['stepId']), outputSchema: 'PlanView & {stepId}', sentence: 'A person tries a step that needs them again, as a new step.', personOnly: true, surfaces: {} },
  { id: 'line.trace', kind: 'read', writes: null, inputSchema: fieldsSchema([], ['request', 'steps']), outputSchema: 'TraceMatch', sentence: 'Says which tools a request or the plan\'s open steps need, and which controls do them; plans and writes nothing.', surfaces: { http: http('POST', '/trace') } },
  // construct-mcp's read-only blocks.
  { id: 'blocks.requirementParse', kind: 'read', writes: null, inputSchema: fieldsSchema(['text']), outputSchema: 'RequirementCard', sentence: 'Reads one plain-English requirement into a requirement card.', surfaces: { mcp: 'requirement_parse' } },
  { id: 'blocks.placementPlace', kind: 'read', writes: null, inputSchema: fieldsSchema(['text'], ['answers']), outputSchema: 'Placement', sentence: 'Places a requirement in the project\'s layers and previews its plan.', surfaces: { mcp: 'placement_place' } },
  { id: 'blocks.planValidate', kind: 'read', writes: null, inputSchema: fieldsSchema(['plan']), outputSchema: 'PlanValidation', sentence: 'Checks a plan as data against the flow registry.', surfaces: { mcp: 'plan_validate' } },
  { id: 'blocks.decide', kind: 'read', writes: null, inputSchema: fieldsSchema([], ['summary', 'text']), outputSchema: 'Decision', sentence: 'Suggests which option to take for one question.', surfaces: { mcp: 'decide' } },
  { id: 'blocks.summarize', kind: 'read', writes: null, inputSchema: fieldsSchema([], ['feature', 'backend']), outputSchema: 'ProjectSummary', sentence: 'Summarizes the project or one feature.', surfaces: { mcp: 'summarize' } },
  { id: 'blocks.validate', kind: 'read', writes: null, inputSchema: fieldsSchema([], ['limit']), outputSchema: 'ValidateSummary', sentence: 'Runs construct validate and returns the counts and first findings.', surfaces: { mcp: 'validate' } },
  { id: 'blocks.machineCapabilities', kind: 'read', writes: null, inputSchema: NONE, outputSchema: 'MachineCapabilities', sentence: 'Says what this machine\'s memory and cores allow.', surfaces: { mcp: 'machine_capabilities' } },
  { id: 'blocks.tracesStats', kind: 'read', writes: null, inputSchema: fieldsSchema([], ['chooser']), outputSchema: 'TraceStats', sentence: 'Counts the decisions recorded for this project.', surfaces: { mcp: 'traces_stats' } },
  // GateLM's tools (@mx/plan adapters.ts gatelmTools). Drafts are Line's own state: written by GateLM's store, logged.
  { id: 'gatelm.find', kind: 'read', writes: null, inputSchema: fieldsSchema(['query']), outputSchema: 'GateLM FindResult', sentence: 'Finds real components in the project by words of their file and name.', surfaces: { gatelm: true, studio: true } },
  { id: 'gatelm.get', kind: 'read', writes: null, inputSchema: fieldsSchema(['draftId']), outputSchema: 'GateLM Draft', sentence: 'Reads a saved draft with its gaps, questions and answers.', surfaces: { gatelm: true, studio: true } },
  { id: 'gatelm.verify', kind: 'read', writes: null, inputSchema: fieldsSchema(['draftId']), outputSchema: 'GateLM VerifyResult', sentence: 'Applies a draft\'s answers in a scratch copy and verifies every site.', surfaces: { gatelm: true, studio: true } },
  { id: 'gatelm.reasoning', kind: 'read', writes: null, inputSchema: fieldsSchema(['draftId']), outputSchema: 'GateLM Ledger', sentence: 'Reads a draft\'s reasoning ledger.', surfaces: { gatelm: true, studio: true } },
  { id: 'gatelm.ask', kind: 'write', writes: 'line', inputSchema: fieldsSchema([], [], { open: true }), outputSchema: 'GateLM Draft', sentence: 'Drafts a new component from the project\'s own patterns and saves the draft with its gaps.', surfaces: { gatelm: true, studio: true } },
  { id: 'gatelm.fill', kind: 'write', writes: 'line', inputSchema: fieldsSchema(['draftId', 'gapKey'], ['value']), outputSchema: 'GateLM Draft', sentence: 'Records one answer for one gap of a draft.', controlId: 'gatelm-option', surfaces: { gatelm: true, studio: true } },
  { id: 'gatelm.answer', kind: 'write', writes: 'line', inputSchema: fieldsSchema(['questionId'], ['optionIndex', 'value']), outputSchema: 'GateLM Draft', sentence: 'Answers one of a draft\'s questions.', surfaces: { gatelm: true, studio: true } },
  { id: 'gatelm.setAuto', kind: 'write', writes: 'line', inputSchema: fieldsSchema(['draftId', 'auto']), outputSchema: 'GateLM Draft', sentence: 'Turns a draft\'s Auto setting on or off.', surfaces: { gatelm: true, studio: true } },
]).map((e) => {
  // cg1/ct1: the control Trace lights for a tool comes from the one control registry (controls.mjs), first control first.
  const c = LINE_CONTROLS.find((x) => x.toolId === e.id);
  return Object.freeze({ ...e, ...(c ? { controlId: c.controlId } : {}), surfaces: Object.freeze(e.surfaces) });
}));

for (const e of TOOL_ENTRIES) assertToolEntry(e);
// The plan's own tool list (cp1, contract.mjs LINE_PLAN_TOOLS) must agree with the catalog, kind for kind.
for (const t of LINE_PLAN_TOOLS) {
  const e = TOOL_ENTRIES.find((x) => x.id === t.name);
  if (!e || e.kind !== t.kind || !e.surfaces.plan) throw new Error(`The tool registry and the plan disagree about ${t.name}.`);
}

/**
 * Construct's commands as entries (construct.validate, ...), from a PlanRegistry over the CLI commands
 * (packages/core/plan-registry.mjs commandPlanRegistry). A write command changes project files, so it is a plan step.
 * @param {{list: () => any[]}} commands
 * @returns {import('./contract.mjs').ToolEntry[]}
 */
export function commandEntries(commands) {
  return commands.list().map((c) => {
    const e = { id: c.name, kind: c.kind, writes: c.kind === 'write' ? /** @type {const} */ ('project') : null, inputSchema: c.schema, outputSchema: 'CommandStepResult', sentence: /[.?!]$/.test(c.describe) ? c.describe : `${c.describe}.`, surfaces: { plan: true } };
    assertToolEntry(e);
    return e;
  });
}

/**
 * Every entry: the catalog plus the given extra entries (e.g. commandEntries), ids unique.
 * @param {import('./contract.mjs').ToolEntry[]} [extra]
 * @returns {import('./contract.mjs').ToolEntry[]}
 */
export function allEntries(extra = []) {
  const all = [...TOOL_ENTRIES, ...extra];
  const seen = new Set();
  for (const e of all) { if (seen.has(e.id)) throw new Error(`Two registry entries are named ${e.id}.`); seen.add(e.id); }
  return all;
}

/**
 * The entry with this id, or null.
 * @param {string} id
 * @param {readonly import('./contract.mjs').ToolEntry[]} [entries]
 * @returns {import('./contract.mjs').ToolEntry | null}
 */
export const entryById = (id, entries = TOOL_ENTRIES) => entries.find((e) => e.id === id) ?? null;
/**
 * The entries a Cockpit route resolves to (exactly one when the route is known).
 * @param {string} method
 * @param {string} fullPath
 * @returns {import('./contract.mjs').ToolEntry[]}
 */
export const entriesForRoute = (method, fullPath) => TOOL_ENTRIES.filter((e) => e.surfaces.http && e.surfaces.http.method === method && e.surfaces.http.path === fullPath);
/**
 * The one entry a Cockpit route resolves to, or null.
 * @param {string} method
 * @param {string} fullPath
 * @returns {import('./contract.mjs').ToolEntry | null}
 */
export const entryForRoute = (method, fullPath) => { const m = entriesForRoute(method, fullPath); return m.length === 1 ? m[0] : null; };
/**
 * The entries a construct-mcp tool resolves to.
 * @param {string} name
 * @returns {import('./contract.mjs').ToolEntry[]}
 */
export const entriesForMcp = (name) => TOOL_ENTRIES.filter((e) => e.surfaces.mcp === name);
/**
 * The one entry a construct-mcp tool resolves to, or null.
 * @param {string} name
 * @returns {import('./contract.mjs').ToolEntry | null}
 */
export const entryForMcp = (name) => { const m = entriesForMcp(name); return m.length === 1 ? m[0] : null; };

/**
 * One entry as GET /api/line/tools shows it.
 * @param {import('./contract.mjs').ToolEntry} e
 * @returns {import('./contract.mjs').ToolView}
 */
export function toolView(e) {
  return {
    id: e.id, kind: e.kind, writes: e.writes, sentence: e.sentence, outputSchema: e.outputSchema,
    inputFields: Array.isArray(e.inputSchema.fields) ? [...e.inputSchema.fields] : [],
    ...(e.controlId ? { controlId: e.controlId } : {}), ...(e.personOnly ? { personOnly: true } : {}), surfaces: { ...e.surfaces },
  };
}

// ------------------------------------------------------------------------------------------------- the log
/**
 * Where Line's own-state writes are logged, one JSON line each.
 * @param {string} root The project root.
 * @returns {string}
 */
export const toolLogFile = (root) => path.join(root, 'line', 'log', 'tools.jsonl');
/**
 * Append one entry (tool, who, ok; never the arguments, which may hold code) through Construct's writer, atomically.
 * Never throws: a log that cannot be written never stops the change.
 * @param {string} root The project root.
 * @param {{tool: string, by: string, ok: boolean}} entry
 * @returns {void}
 */
export function logToolWrite(root, { tool, by, ok }) {
  try {
    const file = toolLogFile(root);
    let before = '';
    try { before = fs.readFileSync(file, 'utf8'); } catch { /* first entry */ }
    const txn = createTransaction(root);
    txn.writeFile(file, `${before}${JSON.stringify({ at: new Date().toISOString(), tool, by, ok })}\n`);
    try { txn.commit({ validate: () => ({ violations: [], ok: true }) }); } catch { txn.reset(); }
  } catch { /* see above */ }
}

// ------------------------------------------------------------------------------------------------- dispatch
const asSentence = (s) => { const t = String(s ?? '').trim().replace(/\s+/g, ' '); return /[.?!]$/.test(t) ? t : `${t}.`; };
const refuse = (id, code, sentence, detail) => ({ ok: /** @type {const} */ (false), id, code, sentence: asSentence(sentence), ...(typeof detail === 'string' && detail ? { detail } : {}) });
/** Who calls: a person (Cockpit, a Studio chip, plain words) or an agent (MCP, chat's tool calls). */
const isAgent = (by) => by === 'agent';
const planBy = (by) => (isAgent(by) ? 'agent' : 'ui');

/**
 * The direct handlers for the reads and Line-state writes of the catalog, over Line's operations.
 * @param {string} root
 * @param {{readLineProject: Function, readLineFeature: Function, readPageTree: Function, listFragments: Function,
 *   readWorkspace: Function, setWorkspace: Function, renderLibraryComponent?: Function}} ops
 * @returns {Record<string, (args: any) => unknown>}
 */
export function lineHandlers(root, ops) {
  return {
    'line.project': () => ops.readLineProject(root),
    'line.feature': (a) => ops.readLineFeature(root, a.name),
    'line.pageTree': (a) => ops.readPageTree(root, a.file),
    'line.fragments': (a) => ops.listFragments(root, a.file),
    'line.workspace': () => ops.readWorkspace(root),
    'line.setWorkspace': (a) => ops.setWorkspace(root, { folder: a.folder }),
    ...(ops.renderLibraryComponent ? { 'line.render': (a) => ops.renderLibraryComponent(root, { file: a.file, props: a.props }) } : {}),
  };
}

/**
 * The real Line operations, loaded on demand (the render pulls in Morpheus's loader).
 * @returns {Promise<any>} The ops lineHandlers takes.
 */
export async function realLineOps() {
  const [model, feature, pageProp, fragments, workspace, render] = await Promise.all([
    import('./model.mjs'), import('./feature.mjs'), import('./pageProp.mjs'), import('./fragments.mjs'), import('./workspace.mjs'), import('./renderComponent.mjs'),
  ]);
  return {
    readLineProject: model.readLineProject, readLineFeature: feature.readLineFeature, readPageTree: pageProp.readPageTree,
    listFragments: fragments.listFragments, readWorkspace: workspace.readWorkspace, setWorkspace: workspace.setWorkspace,
    renderLibraryComponent: render.renderLibraryComponent,
  };
}

/**
 * The registry for one project.
 * @param {{root: string, planService: {view: Function, addStep: Function, approve: Function, runNext: Function},
 *   handlers?: Record<string, (args: any) => unknown>, commands?: {list: () => any[], call: (name: string, args: any) => Promise<any>} | null,
 *   gatelm?: {name: string, kind: string, run: (args: any) => Promise<unknown>}[] | null,
 *   blocks?: Record<string, (args: any) => unknown>}} o
 *   `handlers`: lineHandlers(root, ops). `commands`: the construct.* PlanRegistry. `gatelm`: @mx/plan gatelmTools(api)
 *   (each must match its catalog entry, kind for kind). `blocks`: construct-mcp's block handlers by entry id.
 * @returns The registry: entries, list and dispatch.
 */
export function createToolRegistry({ root, planService, handlers = {}, commands = null, gatelm = null, blocks = {} }) {
  const entries = allEntries(commands ? commandEntries(commands) : []);
  /** @type {Record<string, (args: any, by?: string) => unknown>} */
  const direct = {
    ...handlers,
    ...blocks,
    'line.tools': () => ({ ok: true, tools: entries.map(toolView) }),
    'plan.status': () => planService.view(),
    'plan.addStep': (a, by) => planService.addStep({ tool: a.tool, args: a.args, why: a.why }, planBy(by)),
    'plan.approve': (a, by) => planService.approve(a.stepId, planBy(by)),
    'plan.runNext': (a, by) => planService.runNext(planBy(by), a.stepId),
  };
  for (const t of gatelm ?? []) {
    const e = entryById(t.name, entries);
    if (!e || e.kind !== t.kind) throw new Error(`GateLM's tool ${t.name} does not match the tool registry.`);
    direct[t.name] = (a) => t.run(a);
  }
  if (commands) for (const e of entries.filter((x) => x.id.startsWith('construct.') && x.kind === 'read')) direct[e.id] = (a) => commands.call(e.id, a);

  /**
   * Dispatch one call. Never throws for a refusal; an unexpected crash is one sentence too.
   * @param {string} id @param {Record<string, unknown>} [args] @param {{by?: 'person'|'ui'|'agent'}} [o]
   * @returns {Promise<import('./contract.mjs').DispatchResult>}
   */
  async function dispatch(id, args = {}, { by = 'person' } = {}) {
    const e = entryById(id, entries);
    if (!e) return refuse(id, 'UNKNOWN_TOOL', `There is no tool named ${id || '(none)'}`);
    const parsed = e.inputSchema.safeParse(args ?? {});
    if (!parsed.success) return refuse(id, 'BAD_ARGS', `The arguments do not fit ${id}: ${/** @type {any} */ (parsed).error.issues.map((i) => `${i.path.join('.') || 'args'} ${i.message}`).join('; ')}`);
    if (e.personOnly && isAgent(by)) return refuse(id, 'PERSON_ONLY', `Only a person can do this, in Cockpit; an agent cannot (${id})`);
    const run = direct[id];
    // A project write, or any write with no direct handler, only ever becomes a plan step.
    if (e.kind === 'write' && (e.writes === 'project' || !run)) {
      if (!e.surfaces.plan) return refuse(id, 'NOT_A_STEP', `${id} cannot run here`);
      const r = await planService.addStep({ tool: id, args: parsed.data }, planBy(by));
      if (!r || r.ok === false) return refuse(id, r?.code ?? 'REFUSED', r?.sentence ?? 'The plan refused this step', r?.detail);
      const step = r.steps.find((s) => s.id === r.stepId);
      return { ok: true, via: 'plan', id, stepId: r.stepId, sentence: asSentence(step?.sentence ?? `Waiting for your approval: ${e.sentence}`), plan: r };
    }
    if (!run) return refuse(id, 'NOT_HERE', `${id} is not available here; ${e.surfaces.mcp ? `call ${e.surfaces.mcp} in construct-mcp` : 'it runs where it is offered'}`);
    try {
      const result = await run(parsed.data, by);
      const refused = result && typeof result === 'object' && /** @type {any} */ (result).ok === false;
      if (e.kind === 'write') logToolWrite(root, { tool: id, by: planBy(by), ok: !refused });
      if (refused) return refuse(id, /** @type {any} */ (result).code ?? 'REFUSED', /** @type {any} */ (result).sentence ?? 'That was refused', /** @type {any} */ (result).detail);
      return { ok: true, via: 'direct', id, result };
    } catch (err) {
      if (e.kind === 'write') logToolWrite(root, { tool: id, by: planBy(by), ok: false });
      const x = /** @type {any} */ (err);
      if (x?.name === 'LineOpError') return refuse(id, x.code, x.sentence, x.detail);
      return refuse(id, 'FAILED', `${id} could not finish; nothing was changed`);
    }
  }

  return { entries: () => entries, list: () => ({ ok: /** @type {const} */ (true), tools: entries.map(toolView) }), dispatch };
}

/**
 * Studio's dispatcher handlers (studio/src/dispatch.ts `createDispatcher(handlers)`), resolved from the registry: one
 * handler per entry, so a GateLM question's option `{tool, args}` (and later any tool) runs through `dispatch`. A chip
 * or plain words is the person; a `tool` call is an agent. A refusal throws its sentence, as Studio expects.
 * @param {{dispatch: Function, entries: () => import('./contract.mjs').ToolEntry[]}} registry
 * @returns {Record<string, (args: Record<string, unknown>, meta: {channel: 'chip'|'words'|'tool'}) => Promise<unknown>>}
 */
export function studioHandlers(registry) {
  return Object.fromEntries(registry.entries().map((e) => [e.id, async (args, meta) => {
    const r = await registry.dispatch(e.id, { ...args }, { by: meta?.channel === 'tool' ? 'agent' : 'person' });
    if (!r.ok) throw new Error(r.sentence);
    return r;
  }]));
}
