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

// #75 — the prop-flow diagram needs one distinct color per prop name (more
// than the 4 fixed tones cover), so Badge grew an additive className/style
// passthrough; this story documents that escape hatch.
export const CustomColor = {
  args: { className: 'propflow-pill', style: { background: 'rgba(91, 140, 255, 0.18)', color: '#5b8cff' }, children: 'title' },
};
