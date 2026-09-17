export type HelpId = string;

/** ui/server's GET /api/help response (see ui/server/src/index.mjs) —
 * sourced live from src/usage.mjs and src/repl.mjs, never hand-copied. */
export type HelpData = {
  usage: string;
  topLevelHelp: string;
  topics: string[];
  helpTopics: Record<string, string>;
};

export type TopicSection = { id: string; title: string; text: string };

export type HelpViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; usage: string; topLevelHelp: string; grouped: TopicSection[]; flat: TopicSection[]; rest: TopicSection[] };
