import { AttributionBadge } from './AttributionBadge.jsx';

// The one existing component worth a story ahead of #46 (reusable
// component extraction hasn't happened yet, so this is also a smoke
// test that Storybook itself is wired up correctly against the real
// app — real component, real CSS classes, real #44 theme tokens).
export default {
  title: 'Existing/AttributionBadge',
  component: AttributionBadge,
};

export const ToolOnly = {
  args: {
    attribution: { tool: 'created features/billing/{domain,service,...}', llm: '0 calls' },
  },
};

export const ToolAndLlm = {
  args: {
    attribution: {
      tool: 'scaffolded the file(s) above from templates',
      llm: '1 call(s) to analyze the route',
    },
  },
};

export const NoAttribution = {
  args: { attribution: null },
};
