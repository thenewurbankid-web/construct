// Atom multi-step-flow (flow.step): walk through the steps of a multi-step flow (a wizard, a checkout).
// Wraps xstate's machine shape: one state per step, NEXT guarded by the step's own check, BACK, and a final "done"
// state. The pure machine here and the xstate machine config from toXStateConfig take the same steps, so a flow can
// run with no library or as a real xstate actor.
import type { AtomMachine } from '../types.ts';

export interface Step<D> {
  id: string;
  /** Whether the flow may leave this step with this data (for example: the address is filled in). */
  canLeave?: (data: D) => boolean;
}

export type FlowPosition = 'first' | 'middle' | 'last' | 'done';

export interface FlowState<D> {
  status: FlowPosition;
  steps: Step<D>[];
  index: number;
  data: D;
  visited: number;
  blocked: string | null;
}

export type FlowEvent<D> =
  | { type: 'NEXT'; data?: Partial<D> }
  | { type: 'BACK' }
  | { type: 'GO_TO'; step: string }
  | { type: 'RESET' };

/** Where step `index` of `count` stands (a one-step flow's only step is its last). */
export function positionOf(index: number, count: number): FlowPosition {
  if (index >= count) {
    return 'done';
  }
  if (index === count - 1) {
    return 'last';
  }
  if (index === 0) {
    return 'first';
  }
  return 'middle';
}

/** Whether the step's own check lets the flow leave it with this data. */
export function canLeave<D>(step: Step<D>, data: D): boolean {
  if (step.canLeave === undefined) {
    return true;
  }
  return step.canLeave(data);
}

function at<D>(state: FlowState<D>, index: number, data: D, blocked: string | null): FlowState<D> {
  return { ...state, status: positionOf(index, state.steps.length), index, data, visited: Math.max(state.visited, index), blocked };
}

/** The current step's id ("done" once the flow is finished). */
export function currentStep(state: FlowState<unknown>): string {
  if (state.status === 'done') {
    return 'done';
  }
  return state.steps[state.index].id;
}

/** How far along the flow is, from 0 to 1. */
export function progress(state: FlowState<unknown>): number {
  return state.index / state.steps.length;
}

export const machine: AtomMachine<FlowState<any>, FlowEvent<any>, { steps: Step<any>[]; data: any }> = {
  id: 'multi-step-flow',
  init(input) {
    if (input.steps.length === 0) {
      throw new TypeError('A multi-step flow needs at least one step.');
    }
    return { status: positionOf(0, input.steps.length), steps: input.steps, index: 0, data: input.data, visited: 0, blocked: null };
  },
  send(state, event) {
    if (state.status === 'done' && event.type !== 'RESET') {
      return state;
    }
    switch (event.type) {
      case 'NEXT': {
        const data = { ...state.data, ...(event.data ?? {}) };
        const step = state.steps[state.index];
        if (!canLeave(step, data)) {
          return at(state, state.index, data, step.id);
        }
        return at(state, state.index + 1, data, null);
      }
      case 'BACK':
        if (state.index === 0) {
          return state;
        }
        return at(state, state.index - 1, state.data, null);
      case 'GO_TO': {
        // Only a step already reached can be jumped to, so no step's check is skipped.
        const index = state.steps.findIndex((s) => s.id === event.step);
        if (index < 0 || index > state.visited || index === state.index) {
          return state;
        }
        return at(state, index, state.data, null);
      }
      case 'RESET':
        return machine.init({ steps: state.steps, data: state.data });
      default:
        return state;
    }
  },
  stateOf(state) {
    return state.status;
  },
};

/** Walk the flow with a list of events; the shorthand a usecase uses. */
export function multiStepFlow<D>(steps: Step<D>[], data: D, events: FlowEvent<D>[]): FlowState<D> {
  return events.reduce((s, e) => machine.send(s, e), machine.init({ steps, data })) as FlowState<D>;
}

/**
 * The same flow as an xstate machine config (createMachine(config)): one state per step plus a final "done" state.
 * `assign` is xstate's own assign, passed in so this atom does not depend on xstate.
 */
export function toXStateConfig<D>(id: string, steps: Step<D>[], data: D, assign: (fn: (args: { context: { data: D }; event: any }) => { data: D }) => unknown): Record<string, unknown> {
  const merged = ({ context, event }: { context: { data: D }; event: any }) => ({ data: { ...context.data, ...(event.data ?? {}) } });
  const states: Record<string, unknown> = {};
  steps.forEach((step, i) => {
    let target = 'done';
    if (i < steps.length - 1) {
      target = steps[i + 1].id;
    }
    const on: Record<string, unknown> = {
      NEXT: [
        { target, guard: (args: { context: { data: D }; event: any }) => canLeave(step, merged(args).data), actions: assign(merged) },
        { actions: assign(merged) },
      ],
    };
    if (i > 0) {
      on.BACK = { target: steps[i - 1].id };
    }
    states[step.id] = { on };
  });
  states.done = { type: 'final' };
  return { id, initial: steps[0].id, context: { data }, states };
}
