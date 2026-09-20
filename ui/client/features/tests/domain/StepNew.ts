// Pure (DOMAIN-001): a new row, filled with the first thing the flow offers (the user changes it in the panel).
import type { MachineInfo, StepFields } from '../types.ts';

export function blankStep(kind: 'event' | 'state' | 'check-text', machine: MachineInfo): StepFields {
  if (kind === 'event') return { kind, event: machine.events[0]?.event ?? '', testId: machine.events[0]?.testId ?? '' };
  if (kind === 'state') return { kind, state: machine.states[0] ?? '' };
  return { kind, text: '', timeout: 5000 };
}
