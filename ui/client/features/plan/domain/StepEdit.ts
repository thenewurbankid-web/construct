// Pure (DOMAIN-001): edit one step: its tag, an argument, its title.
import type { Executor, FlowInfo, PlanStep } from './PlanTypes.ts';
import { deriveTouches } from './StepTouches.ts';

export const retagStep = (steps: PlanStep[], id: string, executor: Executor, flow: FlowInfo | null): PlanStep[] => {
  return steps.map((s) => {
    if (s.id !== id) return s;
    const args = { ...s.args };
    if (executor === 'local-model' && flow?.args.some((a) => a.name === 'llm') && !args.llm) args.llm = 'ollama';
    return { ...s, executor, args };
  });
};

export const setStepArg = (steps: PlanStep[], id: string, name: string, raw: string, flow: FlowInfo | null): PlanStep[] => {
  const spec = flow?.args.find((a) => a.name === name);
  return steps.map((s) => {
    if (s.id !== id) return s;
    const args: Record<string, unknown> = { ...s.args };
    const text = raw.trim();
    if (!text) delete args[name];
    else if (spec?.type === 'string[]') args[name] = text.split(',').map((p) => p.trim()).filter(Boolean);
    else if (spec?.type === 'boolean') args[name] = text === 'true';
    else args[name] = raw;
    const next: PlanStep = { ...s, args };
    if (name === 'feature' || (s.flow === 'create.feature' && name === 'name')) {
      const touches = deriveTouches(flow, args);
      if (touches) next.touches = { features: touches.features, files: s.touches?.files ?? [] };
    }
    return next;
  });
};

export const setStepTitle = (steps: PlanStep[], id: string, title: string): PlanStep[] => steps.map((s) => (s.id === id ? { ...s, title } : s));
