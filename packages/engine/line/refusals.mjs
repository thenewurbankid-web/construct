// bench-gaps 1 -- every refusal a builder's plan step can meet, and how a builder gets past it. LINE.md: every
// Construct error carries a typed fix that runs as a plan step; where no step can decide for the person, the refusal
// is on the explicit "person decides" list below with the reason. test/line-refusal-fixes.test.mjs walks every code
// the builder modules can throw and every rule that can refuse a step under the Line profile, and asserts each is
// here; each `typed` entry has a scenario there whose fix step lands.
//
//   typed:  the refusal carries fixes[] (a request refused before it joined the plan, contract.mjs RefusalFix) or
//           options[].step (a step Construct refused when it ran, from the finding's LineFix), naming where
//   person: no plan step can make this decision; the sentence says what the person (or their agent) must decide

/** The modules whose planners the builder plan tools run (plan-cli's tools: lineToolSpecs without line.import.*). */
export const BUILDER_MODULES = Object.freeze(['build', 'shell', 'ops', 'fixes', 'pageProp', 'fragments', 'workflows', 'planTools', 'planService', 'conditions', 'typeGate']);

/** @type {Readonly<Record<string, {typed?: string, person?: string}>>} */
export const REFUSAL_FIXES = Object.freeze({
  // ---- typed (a step that gets past it) -----------------------------------------------------------------------------
  NAME_TAKEN: { typed: 'line.createFeature on a feature that exists: use it (line.setCode of its spec.md with this story and these points)', person: 'line.baseOn or line.addRoute on a name or route that is taken: only the person can pick the other name or route' },
  UNKNOWN_ITEM: { typed: 'line.addRoute: each feature page (line.addRoute), or a new page (line.baseOn); line.setCode on app/: line.setLayoutSlot or line.addRoute; line.setLayoutSlot: each component that fits', person: 'a library item, file or fragment that does not exist elsewhere: the person names one that does' },
  TYPE_ERROR: { typed: 'line.setCode: an import that does not resolve or misses an export, re-pointed at the library or own-feature file that has it (line.setCode)', person: 'any other type error: the code itself must change, which only its author can decide' },
  BAD_ARGS: { typed: 'line.setLayoutSlot with an unknown slot: the same components in each slot', person: 'arguments that do not fit the tool: the sentence names the field and the shape it needs' },
  // ---- the person decides ---------------------------------------------------------------------------------------------
  BAD_CODE: { person: 'the code does not parse or is empty: only its author can write it' },
  BAD_EVENT: { person: 'a workflow event name is the person\'s word for what happens' },
  BAD_FEATURE: { person: 'a feature name is the person\'s choice; the sentence says what a valid name looks like' },
  BAD_FOLDER: { person: 'an import folder is the person\'s choice of what to bring in' },
  BAD_JSON: { person: 'a fixture that is not JSON must be repaired by hand; Line cannot guess the data' },
  BAD_NAME: { person: 'an item name is the person\'s choice; the sentence gives a valid example' },
  BAD_ROUTE: { person: 'a URL is the person\'s choice; the sentence shows the accepted forms' },
  BAD_TRANSITION: { person: 'which state a workflow goes to is the person\'s decision' },
  BAD_VALUE: { person: 'a prop value of the wrong kind: the person gives the value' },
  LIBRARY_ITEM: { person: 'a library workflow is shared by every feature; changing it is the person\'s decision' },
  LIBRARY_TRANSITION: { person: 'a transition the library workflow owns can only be changed in the library, by the person' },
  NEEDS_YOU: { person: 'an earlier step needs the person; the sentence names its typed fix when it has one' },
  NOTHING_TO_DO: { person: 'the request already holds; there is nothing to fix' },
  NOTHING_TO_FIX: { person: 'args.fixOf names a step that needs no fix; drop fixOf' },
  NOTHING_TO_LEAVE: { person: 'line.leaveAsIs names a step that needs no one; nothing to leave' },
  NOT_A_CHANGE: { person: 'the tool reads and does not plan a change' },
  NOT_A_MACHINE: { person: 'the file is not a workflow Line can read; the person points at one' },
  NOT_LINE_LAYOUT: { person: 'a hand-written app/layout.tsx: only the person knows which of its code to keep before Line owns it' },
  NOT_RETRYABLE: { person: 'the step named is not one that needs the person' },
  NO_CHANGE: { person: 'the change is already there; nothing to do' },
  NO_EXPORT: { person: 'the file exports nothing to show; its author adds the export' },
  NO_PLAN: { person: 'there is no plan yet; the person states the goal by adding a step' },
  NO_ROLES: { person: 'the workflow has no page roles to fill' },
  NO_STEP: { person: 'the finding\'s fix is advice only; its sentence says what to do by hand' },
  OUTSIDE_WORKSPACE: { person: 'the workspace folder is the person\'s boundary; only they can widen it' },
  PRE_FAILED: { person: 'the tool\'s precondition does not hold; the sentence names what must exist first' },
  STALE: { person: 'the file changed since it was read: read it again for a fresh contentHash (a read, not a step)' },
  STOPPED: { person: 'a retry passed no more checks than before, so Line stops looping and asks' },
  UNKNOWN_FEATURE: { person: 'the feature does not exist; creating one needs the person\'s story and points' },
  UNKNOWN_FILE: { person: 'the file does not exist; the person names one that does' },
  UNKNOWN_FINDING: { person: 'the finding is gone; reload the findings' },
  UNKNOWN_FIX: { person: 'the fix no longer applies; reload the findings and pick again' },
  UNKNOWN_PAGE: { person: 'the page for a workflow role does not exist; the person picks one' },
  UNKNOWN_PROP: { person: 'the component has no such prop; the person picks one it has' },
  UNKNOWN_ROLE: { person: 'the workflow has no such role' },
  UNKNOWN_STATE: { person: 'the workflow has no such state' },
  UNKNOWN_TOOL: { person: 'there is no such tool; the sentence lists the tools' },
  UNKNOWN_TRANSITION: { person: 'the workflow has no such transition' },
  WRONG_KIND: { person: 'the item is of another kind than the tool works on' },
});

/** Rules that refuse a step (error severity) under the Line profile, and how a builder gets past each. */
export const RULE_FIXES = Object.freeze({
  'LINE-BASE': { typed: 'fixes.mjs: line.setBase to the library item it imports (or each of its kind), or line.promote' },
  'LINE-OWNER': { typed: 'fixes.mjs: line.moveFile into a feature\'s or the library\'s pages/', person: 'one route claimed by two features: the person picks the owner' },
  'LINE-DIR': { typed: 'fixes.mjs: line.promote the other feature\'s item into the library (chained when it has dependencies)' },
  'LINE-LAYOUT': { typed: 'fixes.mjs: line.createLayout or line.moveFile into its kind', person: 'a stray folder: the person says which kind each file is' },
  'LINE-WRITER': { person: 'a direct file write: routing it through the writer changes behaviour, so its author decides' },
  'LINE-SHARED': { person: 'an own copy of a shared concern: replacing it with the shared module is a code change its author makes' },
  'LINE-MODULE': { person: 'a deep import between packages: packages/tools/line-module/fix-imports.mjs rewrites it outside the plan' },
  'PAGE-002': { typed: 'fixes.mjs: line.useViaUsecase (the workflow through a usecase of the feature)' },
  'PAGE-003': { typed: 'fixes.mjs: line.useViaUsecase (the service through a usecase of the feature)' },
  'PAGE-005': { typed: 'fixes.mjs: line.useViaUsecase (the domain through a usecase of the feature)' },
  'COMPONENT-003': { typed: 'fixes.mjs: line.useViaUsecase (through a usecase of the feature, or a library usecase)' },
  'PAGE-004': { person: 'a page that calls fetch(): which service or usecase owns that request is the author\'s design' },
  'PAGE-006': { person: 'a page that uses a state machine or a custom hook: Line has no hooks kind; the author moves it into a usecase' },
  'COMPONENT-002': { person: 'a component that imports a controller: Line has no controllers; the author passes the data in as props' },
  'WORKFLOW-001': { person: 'a workflow that imports React: the author moves the UI out of the state machine' },
  'SERVICE-001': { person: 'a service rule: the author restructures the service' },
});
