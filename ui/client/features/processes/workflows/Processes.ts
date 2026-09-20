// Pure (WORKFLOW-001): what the Processes drawer knows, and how each event changes it.
import type { ProcessDetail, ProcessSummary, ProcessesAction, ProcessesState } from '../types.ts';

export const initialProcesses: ProcessesState = {
  loaded: false,
  error: null,
  order: [],
  details: {},
  selectedId: null,
  busyId: null,
  notice: null,
  diffs: {},
  live: false,
};

/** A summary-only entry: enough for the list until the detail arrives. */
function stub(summary: ProcessSummary): ProcessDetail {
  return { summary, steps: [], artifacts: [], log: [], logHidden: 0 };
}

/** Newest first; a process that is not in the list yet goes on top. */
function withId(order: string[], id: string): string[] {
  return order.includes(id) ? order : [id, ...order];
}

/** An update older than what is already shown is dropped: a control's response and the socket's
 * frame for the same change can arrive in either order. */
function isStale(state: ProcessesState, incoming: ProcessSummary): boolean {
  const have = state.details[incoming.id];
  return !!have && (have.summary.version ?? 0) > (incoming.version ?? 0);
}

export function processesReducer(state: ProcessesState, action: ProcessesAction): ProcessesState {
  switch (action.type) {
    case 'LISTED': {
      const details = { ...state.details };
      for (const s of action.summaries) {
        if (isStale(state, s)) continue;
        details[s.id] = details[s.id] ? { ...details[s.id], summary: s } : stub(s);
      }
      const order = action.summaries.map((s) => s.id);
      const selectedId = state.selectedId && order.includes(state.selectedId) ? state.selectedId : (order[0] ?? null);
      return { ...state, loaded: true, error: null, order, details, selectedId };
    }
    case 'LIST_FAILED':
      return { ...state, loaded: true, error: action.error };
    case 'UPDATE': {
      const id = action.detail.summary.id;
      if (isStale(state, action.detail.summary)) return state;
      return {
        ...state,
        details: { ...state.details, [id]: action.detail },
        order: withId(state.order, id),
        // A process that appears while you watch is the one you want to see.
        selectedId: state.order.includes(id) ? (state.selectedId ?? id) : id,
      };
    }
    case 'SELECT':
      return { ...state, selectedId: action.id, notice: null };
    case 'CONTROL_START':
      return { ...state, busyId: action.id, notice: null };
    case 'CONTROL_DONE':
      return { ...state, busyId: null, notice: action.notice };
    case 'DIFF':
      return { ...state, diffs: { ...state.diffs, [action.key]: action.result } };
    case 'LIVE':
      return { ...state, live: action.live };
    default:
      return state;
  }
}

/** The summaries in list order (newest first). */
export function summariesOf(state: ProcessesState): ProcessSummary[] {
  return state.order.flatMap((id) => (state.details[id] ? [state.details[id].summary] : []));
}
