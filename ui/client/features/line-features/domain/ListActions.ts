// cd1: part of the Features chat (static rules over the read routes' answers, no model). Tested by FeatureChat.spec.mjs.
import type { ChatMessage, LineProject } from '../types';
import { featureItems } from './ChatOptions.ts';

/** "Create something": pick the feature it goes in (a brand-new feature folder is not a plan step yet). */
export function createPick(project: LineProject, id: string): ChatMessage {
  return { id, from: 'line', text: 'Which feature should the new item go in? Making a brand-new feature folder is not something I can do from here yet.', pick: { label: 'Features to add to', items: featureItems(project) } };
}

/** "Import an app": the Import screen. */
export function importAnswer(id: string): ChatMessage {
  return { id, from: 'line', text: 'Import scans an existing app and proposes, in plain English, what goes to the library and what goes to a feature. Nothing moves until you approve each step.', link: { href: '/import', label: 'Open Import' } };
}
