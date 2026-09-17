import { Badge } from './Badge.jsx';

export default {
  title: 'UI/Badge',
  component: Badge,
  args: { children: 'llm' },
};

export const Tool = { args: { tone: 'tool', children: 'tool' } };
export const Llm = { args: { tone: 'llm' } };
export const LlmNone = { args: { tone: 'llm-none' } };
export const Error = { args: { tone: 'error', children: 'error' } };
