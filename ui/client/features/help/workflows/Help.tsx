import { buildTopicSections } from '../domain/Help';
import type { HelpData, HelpViewState } from '../types';

// Pure (WORKFLOW-001) — turns the raw fetched HelpData into the three
// section lists the CLI reference renders, or reports why it can't yet.
export function loadedHelpView(help: HelpData): HelpViewState {
  const { grouped, flat, rest } = buildTopicSections(help);
  return { status: 'loaded', usage: help.usage, topLevelHelp: help.topLevelHelp, grouped, flat, rest };
}
