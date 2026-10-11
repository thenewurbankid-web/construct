// cd1: part of the Features chat (static rules over the read routes' answers, no model). Tested by FeatureChat.spec.mjs.
import type { ChatItem, ChatOption, LineFeatureDetail, LineProject } from '../types';
import { featureCards } from './FeatureCards.ts';
import { fixable } from './FixActions.ts';

/** The options of the full-screen chat (no feature open). Ids are stable. */
export const LIST_OPTIONS: ChatOption[] = [
  { id: 'features.open', label: 'Open a feature', sentence: 'Pick a feature to see everything it owns.', effect: 'read' },
  { id: 'features.missing', label: 'What is missing?', sentence: 'Which features need attention or have no spec yet.', effect: 'read' },
  { id: 'features.create', label: 'Create something', sentence: 'Add a page, component, workflow or fixture to a feature, based on your library.', effect: 'plan' },
  { id: 'features.import', label: 'Import an app', sentence: 'Bring an existing app into this Line project.', effect: 'navigate' },
  { id: 'features.explain', label: 'Explain', sentence: 'How features and the library fit together in this project.', effect: 'read' },
];

/** The options of the side panel, for the open feature. Fix is offered only when a finding has a typed fix. */
export function itemOptions(detail: LineFeatureDetail | null): ChatOption[] {
  const canFix = Boolean(detail?.findings.some(fixable));
  const fix: ChatOption = { id: 'feature.fix', label: 'Fix what is wrong', sentence: 'Apply a fix Construct suggests, as a plan step you approve.', effect: 'plan' };
  return [
    { id: 'feature.missing', label: 'What is missing?', sentence: 'Problems and spec points not covered yet.', effect: 'read' },
    { id: 'feature.explain', label: 'Explain', sentence: 'What this feature is and what it is built on.', effect: 'read' },
    { id: 'feature.add', label: 'Add from the library', sentence: 'Create a new item in this feature, based on a library item, as a plan step.', effect: 'plan' },
    canFix ? fix : { ...fix, disabled: 'Nothing here has a fix Construct can apply.' },
    { id: 'feature.back', label: 'All features', sentence: 'Close this feature and go back to the list.', effect: 'read' },
  ];
}

/** Every feature as a pickable item, with "All fine" or "Needs attention". */
export function featureItems(project: LineProject): ChatItem[] {
  return featureCards(project).map((c) => ({ id: c.name, name: c.name, text: c.text, status: { tone: c.ok ? 'fit' : 'gap', label: c.status } }));
}
