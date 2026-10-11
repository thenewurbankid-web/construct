// cd1: part of the Features chat (static rules over the read routes' answers, no model). Tested by FeatureChat.spec.mjs.
import type { ChatItem, ChatMessage, LineProject } from '../types';
import { featureItems } from './ChatOptions.ts';

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** The first message of the full-screen chat: the features to pick from. */
export function listIntro(project: LineProject): ChatMessage {
  const n = project.features.length;
  if (n === 0) return { id: 'intro', from: 'line', text: 'This project has no features yet. Choose what to do below.' };
  return { id: 'intro', from: 'line', text: `Your project has ${plural(n, 'feature', 'features')}. Pick one to open it, or choose what to do below.`, pick: { label: 'Features', items: featureItems(project) } };
}

/** "What is missing?" for the whole project: features that need attention, features with no spec. */
export function listMissing(project: LineProject, id: string): ChatMessage {
  const problems = project.features.filter((f) => f.items.some((i) => i.status === 'problem'));
  const noSpec = project.features.filter((f) => !f.spec);
  if (!problems.length && !noSpec.length) return { id, from: 'line', text: 'Nothing is missing: every feature passes the checks and has a spec.' };
  const parts = [
    ...problems.map((f) => `${f.name} needs attention (${plural(f.items.filter((i) => i.status === 'problem').length, 'item', 'items')}).`),
    ...noSpec.map((f) => `${f.name} has no spec yet.`),
  ];
  const items = problems.map((f) => featureItems(project).find((c) => c.id === f.name)).filter((c): c is ChatItem => Boolean(c));
  const details = project.findings.map((f) => `${f.rule} ${f.file}:${f.line}`);
  return { id, from: 'line', text: `${parts.join(' ')} Open one to see what to do.`, pick: items.length ? { label: 'Features that need attention', items } : undefined, details };
}

/** "Explain" for the whole project. */
export function listExplain(project: LineProject, id: string): ChatMessage {
  const lib = project.library.length;
  return {
    id,
    from: 'line',
    text: `Your library holds ${plural(lib, 'complete item', 'complete items')} (components, pages, workflows and fixtures). Each feature owns its own items, and every one of them is based on exactly one library item. A feature uses the library, never another feature, and keeps its spec in its own folder.`,
    details: [`library: ${project.layout.library}/`, `features: ${project.layout.features}/`],
  };
}
