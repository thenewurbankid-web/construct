// Pure (WORKFLOW-001): what the step editor knows (the opened document, the draft, the selection, the review of the
// diff) and how each event changes it. No I/O: the hook fetches, previews and saves.
import { draftOf } from '../domain/StepDraft.ts';
import { canMove, insertStep, move } from '../domain/StepMoves.ts';
import { blankStep } from '../domain/StepNew.ts';
import type { DraftStep, StepEditorAction, StepEditorState, StepFields } from '../types.ts';

export const initialStepEditor: StepEditorState = { status: 'idle' };

const stripRow = ({ keyword: _k, sentence: _s, binding: _b, ...fields }: StepFields & { keyword?: string; sentence?: string; binding?: string }): StepFields => fields as StepFields;

/** A field patch that keeps the data-testid derived from the event the machine really has. */
function patched(step: StepFields, patch: Partial<StepFields>, events: { event: string; testId: string }[]): StepFields {
  const next = { ...step, ...patch } as StepFields;
  if (next.kind === 'event') {
    const hit = events.find((e) => e.event === next.event);
    if (hit) next.testId = hit.testId;
  }
  return next;
}

const dirty = (s: Extract<StepEditorState, { status: 'editing' }>, extra: Partial<Extract<StepEditorState, { status: 'editing' }>>): StepEditorState => ({ ...s, review: { status: 'none' }, notice: null, ...extra });

export function stepEditorReducer(state: StepEditorState, action: StepEditorAction): StepEditorState {
  if (action.type === 'OPEN') return { status: 'loading', name: action.name };
  if (action.type === 'CLOSE') return initialStepEditor;
  if (action.type === 'LOADED') {
    const d = action.doc;
    if (!d.ok) return { status: 'error', message: d.error };
    if (!d.editable) return { status: 'readonly', name: d.name, path: d.path, reason: d.reason };
    const original = d.steps.map(stripRow);
    const draft = draftOf(original);
    return { status: 'editing', name: d.name, path: d.path, hash: d.hash, title: d.title, machine: d.machine, original, draft, selected: draft.find((x) => x.step.kind !== 'fixme' && x.step.kind !== 'goto')?.key ?? null, nextKey: draft.length, review: { status: 'none' }, announce: '', notice: action.notice ?? null };
  }
  if (state.status !== 'editing') return state;
  switch (action.type) {
    case 'SELECT':
      return { ...state, selected: action.key };
    case 'PATCH':
      return dirty(state, { draft: state.draft.map((d) => (d.key === action.key ? { ...d, step: patched(d.step, action.patch, state.machine.events) } : d)) });
    case 'ADD': {
      const key = state.nextKey;
      const draft = insertStep(state.draft, state.selected, blankStep(action.kind, state.machine), key);
      return dirty(state, { draft, selected: key, nextKey: key + 1, announce: `Added step ${draft.filter((d) => !d.removed).findIndex((d) => d.key === key) + 1}.` });
    }
    case 'REMOVE': {
      const target = state.draft.find((d) => d.key === action.key);
      if (!target || target.step.kind === 'goto') return state;
      // a row added and not yet saved simply disappears; a saved row stays, struck through, until the change is written
      const draft: DraftStep[] = target.origin === null ? state.draft.filter((d) => d.key !== action.key) : state.draft.map((d) => (d.key === action.key ? { ...d, removed: true } : d));
      return dirty(state, { draft, selected: state.selected === action.key ? null : state.selected, announce: 'Step removed.' });
    }
    case 'RESTORE':
      return dirty(state, { draft: state.draft.map((d) => (d.key === action.key ? { ...d, removed: false } : d)), announce: 'Step restored.' });
    case 'MOVE': {
      if (!canMove(state.draft, action.key, action.dir)) return state;
      const draft = move(state.draft, action.key, action.dir);
      const at = draft.findIndex((d) => d.key === action.key) + 1;
      return dirty(state, { draft, announce: `Moved to step ${at} of ${draft.length}.` });
    }
    case 'DISCARD': {
      const draft = draftOf(state.original);
      return { ...state, draft, nextKey: draft.length, selected: null, review: { status: 'none' }, notice: null, announce: 'Changes discarded.' };
    }
    case 'REVIEW_START':
      return { ...state, review: { status: 'loading' } };
    case 'REVIEW_READY':
      return { ...state, review: { status: 'ready', resultSha: action.resultSha, changed: action.changed, rows: action.rows, added: action.added, removed: action.removed } };
    case 'REVIEW_FAILED':
      return { ...state, review: { status: 'error', message: action.message, stale: action.stale } };
    case 'REVIEW_BACK':
      return { ...state, review: { status: 'none' } };
    case 'SAVE_START':
      return { ...state, review: { status: 'saving' } };
    default:
      return state;
  }
}
