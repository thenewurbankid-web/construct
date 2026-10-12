// cg1 -- the ONE control registry: every Cockpit control that triggers a tool, with the tool it triggers, the screen
// it sits on and the label the person sees (contract.mjs LineControl). The DOM carries `data-line-control="<id>"`
// (and `data-line-target="<item>"` for the item it acts on), so Trace can light it up wherever it is.
//
// The tools themselves live in the one tool catalog (toolRegistry.mjs, owner decision); each catalog entry's
// `controlId` is the first control here that triggers it. Do not add a second tool list anywhere else.
//
// Pure data, no Node imports: the Cockpit client's mock mode imports it too.
import { LINE_PLAN_TOOLS, PLAN_ACTION_TOOLS } from './contract.mjs';

/** @type {readonly import('./contract.mjs').LineControl[]} */
export const LINE_CONTROLS = Object.freeze([
  // Components: the library cards and each feature's components.
  { controlId: 'components.baseOn', toolId: 'line.baseOn', screen: 'components', label: 'Base on this' },
  { controlId: 'components.baseOnFeature', toolId: 'line.baseOn', screen: 'components', label: 'Feature' },
  { controlId: 'components.baseOnName', toolId: 'line.baseOn', screen: 'components', label: 'Name' },
  { controlId: 'components.baseOnCreate', toolId: 'line.baseOn', screen: 'components', label: 'Create' },
  { controlId: 'components.promote', toolId: 'line.promote', screen: 'components', label: 'Promote to library' },
  { controlId: 'components.promoteConfirm', toolId: 'line.promote', screen: 'components', label: 'Promote' },
  // Pages: pick a feature and a page, change one prop or one piece of code.
  { controlId: 'pages.feature', toolId: 'line.project', screen: 'pages', label: 'Which feature' },
  { controlId: 'pages.page', toolId: 'line.project', screen: 'pages', label: 'Page' },
  { controlId: 'pages.propInput', toolId: 'line.setPageProp', screen: 'pages', label: 'Prop value' },
  { controlId: 'pages.propSave', toolId: 'line.setPageProp', screen: 'pages', label: 'Save' },
  { controlId: 'pages.codeToggle', toolId: 'line.setFragment', screen: 'pages', label: 'Edit code' },
  { controlId: 'pages.fragmentSave', toolId: 'line.setFragment', screen: 'pages', label: 'Save code' },
  // cu5: the page's two bindings, a part to a library component (Morpheus) and an action to the API (Trace).
  { controlId: 'pages.bindPart', toolId: 'line.bindPart', screen: 'pages', label: 'Bind to library' },
  { controlId: 'pages.bindInteraction', toolId: 'line.bindInteraction', screen: 'pages', label: 'Bind action' },
  // Features: the feature cards and what needs attention.
  { controlId: 'features.card', toolId: 'line.project', screen: 'features', label: 'Feature' },
  { controlId: 'features.finding', toolId: 'line.fix', screen: 'features', label: 'What needs attention' },
  // The Plan panel (on Components and Pages): the person's decisions on a step.
  { controlId: 'plan.approve', toolId: 'plan.approve', screen: 'plan', label: 'Approve' },
  { controlId: 'plan.retry', toolId: 'plan.retry', screen: 'plan', label: 'Try again' },
  { controlId: 'plan.leave', toolId: 'line.leaveAsIs', screen: 'plan', label: 'Leave as it is' },
  { controlId: 'plan.fix', toolId: 'line.fix', screen: 'plan', label: 'Apply recommended fix' },
].map((c) => Object.freeze(/** @type {import('./contract.mjs').LineControl} */ (c))));

const FIX_PATH = ['features.finding', 'plan.fix', 'plan.approve'];

/** Which controls a person uses, in order, to do each tool (a path may pass controls of a read tool, e.g. picking a page). */
export const TOOL_PATHS = Object.freeze({
  'line.baseOn': ['components.baseOn', 'components.baseOnFeature', 'components.baseOnName', 'components.baseOnCreate', 'plan.approve'],
  'line.promote': ['components.promote', 'components.promoteConfirm', 'plan.approve'],
  'line.setPageProp': ['pages.feature', 'pages.page', 'pages.propInput', 'pages.propSave', 'plan.approve'],
  'line.setFragment': ['pages.feature', 'pages.page', 'pages.codeToggle', 'pages.fragmentSave', 'plan.approve'],
  'line.bindPart': ['pages.feature', 'pages.page', 'pages.bindPart', 'plan.approve'],
  'line.bindInteraction': ['pages.feature', 'pages.page', 'pages.bindInteraction', 'plan.approve'],
  'line.fix': FIX_PATH,
  'line.setBase': FIX_PATH,
  'line.moveFile': FIX_PATH,
  'line.createLayout': FIX_PATH,
  'line.leaveAsIs': ['plan.leave'],
  'line.project': ['features.card'],
  'plan.approve': ['plan.approve'],
  'plan.retry': ['plan.retry'],
});

/**
 * The control with this id, or undefined.
 * @param {string} controlId
 * @returns {import('./contract.mjs').LineControl | undefined}
 */
export const controlById = (controlId) => LINE_CONTROLS.find((c) => c.controlId === controlId);
