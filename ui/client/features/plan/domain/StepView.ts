// Pure (DOMAIN-001): one step as everything its card shows, already worked out: the tags, the argument
// boxes, the exact command line, what it touches, and its errors in plain words.
import type { StepView } from '../types.ts';
import type { StepViewInput } from './StepViewInput.ts';
import { commandLine } from './CommandText.ts';
import { EXECUTORS, executorLabel } from './ExecutorLabels.ts';
import { argText } from './PlanDocument.ts';
import { errorViews } from './StepErrors.ts';

export function buildStepView({ step, flow, preview, errors }: StepViewInput): StepView {
  const args = (flow?.args ?? []).filter((a) => a.type !== 'object');
  return {
    id: step.id,
    flow: step.flow,
    title: step.title,
    executor: step.executor,
    executorLabel: executorLabel(step.executor),
    tags: EXECUTORS.map((e) => ({ ...e, pressed: e.id === step.executor })),
    args: args.map((a) => ({ name: a.name, label: `${a.name}${a.required ? ' *' : ''}`, enum: a.enum ?? null, description: a.description ?? null, value: argText(step.args[a.name]) })),
    hasObjectArg: !!flow?.args.some((a) => a.type === 'object'),
    touches: (step.touches?.features ?? []).join(', '),
    command: preview?.argv ? commandLine(preview.argv) : null,
    manual: !!preview?.manual,
    model: step.executor === 'local-model',
    errors: errorViews(errors),
  };
}
