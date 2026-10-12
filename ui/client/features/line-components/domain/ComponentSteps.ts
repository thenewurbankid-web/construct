// Pure (DOMAIN-001): the plan step of each change the Components editor makes (the arguments of contract.mjs's cu4
// plan tools). Nothing here writes: each step waits in the Plan panel for a person's Approve.
import type { ComponentEventGroup, LineComponentEditor, PlanStepRequest } from '../types.ts';

/** Behaviour: give the component one of the behaviours that fit it, with the role mapping Morpheus suggests. */
function attach(c: LineComponentEditor, primitive: string): PlanStepRequest {
  const fit = c.behaviour.fits.find((f) => f.primitive === primitive);
  return { tool: 'line.attachComponentPrimitive', args: { file: c.file, primitive, ...(fit && Object.keys(fit.mapping).length ? { mapping: { ...fit.mapping } } : {}) } };
}

/** Events: When <source> Do <action>, both picked from what the component offers. Null when either is unknown. */
function whenDo(c: LineComponentEditor, sourceId: string, actionId: string): PlanStepRequest | null {
  const s = c.events.sources.find((x) => x.id === sourceId);
  const a = c.events.actions.find((x) => x.id === actionId);
  if (!s || !a) return null;
  return { tool: 'line.addComponentEvent', args: { file: c.file, source: { ...s.source }, action: { ...a.action } } };
}

/** Events: change what one When -> Do does. Null when the action is unknown. */
function change(c: LineComponentEditor, wire: string, actionId: string): PlanStepRequest | null {
  const a = c.events.actions.find((x) => x.id === actionId);
  if (!a) return null;
  return { tool: 'line.changeComponentEvent', args: { file: c.file, id: wire, action: { ...a.action } } };
}

/** Events: apply the fix Studio offers for a conflict. Null when the card has none. */
function fix(c: LineComponentEditor, g: ComponentEventGroup): PlanStepRequest | null {
  if (!g.fix) return null;
  return { tool: 'line.fixComponentEvent', args: { file: c.file, label: g.fix.label, remove: [...g.fix.remove], add: g.fix.add.map((x) => ({ source: { ...x.source }, action: { ...x.action } })) } };
}

/** States: put one behaviour in a state picked on its graph. */
const setState = (c: LineComponentEditor, ref: string, state: string): PlanStepRequest => ({ tool: 'line.setComponentState', args: { file: c.file, ref, state } });

/** New component: a feature component based on a library component. */
const newComponent = (libraryId: string, feature: string, name: string): PlanStepRequest => ({ tool: 'line.newComponent', args: { libraryId, feature, name: name.trim() } });

export const componentSteps = Object.freeze({ attach, whenDo, change, fix, setState, newComponent });
