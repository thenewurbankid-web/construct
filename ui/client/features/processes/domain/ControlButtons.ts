// Pure (DOMAIN-001): the buttons a process shows, derived from the machine's own `controls`.
import type { ControlEvent, ControlVerb } from '../types.ts';

/** `START` is absent on purpose: starting a process is Plan mode's job, not this drawer's. */
const VERB_FOR_EVENT: Partial<Record<ControlEvent, { verb: ControlVerb; label: string }>> = {
  PAUSE: { verb: 'pause', label: 'Pause' },
  RESUME: { verb: 'resume', label: 'Resume' },
  CANCEL: { verb: 'cancel', label: 'Cancel' },
  RETRY: { verb: 'retry', label: 'Retry' },
};

const ORDER: ControlEvent[] = ['PAUSE', 'RESUME', 'RETRY', 'CANCEL'];

/** Buttons for exactly the events the machine offers, in a stable order. Never invents one. */
export function controlButtons(controls: ControlEvent[]): { verb: ControlVerb; label: string }[] {
  return ORDER.filter((e) => controls.includes(e)).map((e) => VERB_FOR_EVENT[e]!);
}
