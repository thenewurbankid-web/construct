import type { HelpData, TopicSection } from '../types';

// Pure (DOMAIN-001) — groupings purely for presentation; the actual list of
// topics (and their order) comes from the backend's /api/help. This just
// buckets that list into "the four grouped capabilities", "flat
// equivalents", and "reference topics" so the CLI reference reads as
// sections instead of one long flat list.
const GROUPED = ['create', 'refactor', 'research', 'import'];
const FLAT = ['init', 'feature', 'generate', 'sync', 'validate', 'summarize', 'doctor'];

const TOPIC_TITLES: Record<string, string> = {
  create: 'create — scaffold a feature, layer, or vertical slice',
  refactor: 'refactor — mechanical, LLM-free moves/renames',
  research: 'research — read-only summarize / doctor',
  import: 'import — port an existing, non-Construct file',
  init: 'init — bootstrap a new project',
  feature: 'feature — flat form of "create feature"',
  generate: 'generate — flat form of "create <layer>" / "create layer"',
  sync: 'sync — regenerate dependency-cruiser config + public APIs',
  validate: 'validate — run every enforcer and report violations',
  summarize: 'summarize — flat form of "research summarize"',
  doctor: 'doctor — flat form of "research doctor"',
  dir: '--dir — targeting a nested project',
  'import-001': 'IMPORT-001 — why build order is enforced',
};

function toSections(ids: string[], help: HelpData): TopicSection[] {
  return ids.map((id) => ({ id, title: TOPIC_TITLES[id] || id, text: help.helpTopics[id] }));
}

export function buildTopicSections(help: HelpData) {
  const rest = help.topics.filter((t) => !GROUPED.includes(t) && !FLAT.includes(t));
  return {
    grouped: toSections(GROUPED, help),
    flat: toSections(FLAT, help),
    rest: toSections(rest, help),
  };
}
