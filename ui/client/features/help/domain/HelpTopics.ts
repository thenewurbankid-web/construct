// Pure (DOMAIN-001): the Help screen's top-level topics, shared by the
// in-page contents nav and the Browser-pane contents tab so they never drift.
export type HelpTopic = { id: string; label: string };

export const HELP_TOPICS: HelpTopic[] = [
  { id: 'getting-started', label: 'Getting started' },
  { id: 'attribution', label: 'Tool vs LLM attribution' },
  { id: 'ui-guide', label: 'UI guide' },
  { id: 'tutorials', label: 'Tutorials' },
  { id: 'cli-reference', label: 'CLI reference' },
];
