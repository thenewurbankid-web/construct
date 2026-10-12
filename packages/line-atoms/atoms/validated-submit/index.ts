// Atom validated-submit (form.submit): validate a form's values against a schema, then submit them.
// Wraps the react-hook-form + zod pattern (handleSubmit with a schema resolver; formState errors, isSubmitting,
// isSubmitSuccessful). A zod schema plugs in as it is (its safeParse); a valibot one through fromValibot.
import type { AtomMachine } from '../types.ts';

export type Path = (string | number)[];
export interface Issue { path: Path; message: string }
export type ParseResult<O> = { success: true; data: O } | { success: false; error: { issues: Issue[] } };
export interface Schema<V, O> { safeParse(values: V): ParseResult<O> }

export type SubmitStatus = 'idle' | 'invalid' | 'submitting' | 'submitted' | 'failed';

export interface SubmitState<V, O, R> {
  status: SubmitStatus;
  schema: Schema<V, O>;
  values: V;
  errors: Record<string, string>;
  data: O | null;
  result: R | null;
  error: unknown;
  attempts: number;
}

export type SubmitEvent<V, R> =
  | { type: 'SUBMIT'; values?: V }
  | { type: 'RESOLVE'; result: R }
  | { type: 'REJECT'; error: unknown }
  | { type: 'EDIT'; values: V }
  | { type: 'RESET'; values?: V };

export interface SubmitInput<V, O> { schema: Schema<V, O>; values: V }

/** The first message for each field path ("address.city"), the way formState.errors keys them. */
export function fieldErrors(issues: Issue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.');
    if (!(key in out)) {
      out[key] = issue.message;
    }
  }
  return out;
}

/** A valibot-style safeParse ({success, output, issues}) as a Schema. */
export function fromValibot<V, O>(safeParse: (values: V) => { success: boolean; output?: O; issues?: { path?: { key: string | number }[]; message: string }[] }): Schema<V, O> {
  return {
    safeParse(values: V): ParseResult<O> {
      const r = safeParse(values);
      if (r.success) {
        return { success: true, data: r.output as O };
      }
      const issues = (r.issues ?? []).map((i) => ({ path: (i.path ?? []).map((p) => p.key), message: i.message }));
      return { success: false, error: { issues } };
    },
  };
}

function validate<V, O, R>(state: SubmitState<V, O, R>, values: V): SubmitState<V, O, R> {
  const parsed = state.schema.safeParse(values);
  if (parsed.success) {
    return { ...state, status: 'submitting', values, errors: {}, data: parsed.data, error: null, attempts: state.attempts + 1 };
  }
  return { ...state, status: 'invalid', values, errors: fieldErrors(parsed.error.issues), data: null };
}

/** Errors of the fields an edit changed are cleared; the others stay until the next submit. */
function clearEdited(errors: Record<string, string>, before: unknown, after: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(errors)) {
    const top = key.split('.')[0];
    const was = (before as Record<string, unknown>)?.[top];
    const now = (after as Record<string, unknown>)?.[top];
    if (Object.is(was, now)) {
      out[key] = message;
    }
  }
  return out;
}

export const machine: AtomMachine<SubmitState<any, any, any>, SubmitEvent<any, any>, SubmitInput<any, any>> = {
  id: 'validated-submit',
  init(input) {
    return { status: 'idle', schema: input.schema, values: input.values, errors: {}, data: null, result: null, error: null, attempts: 0 };
  },
  send(state, event) {
    switch (event.type) {
      case 'SUBMIT':
        if (state.status === 'submitting') {
          return state;
        }
        return validate(state, event.values ?? state.values);
      case 'RESOLVE':
        if (state.status !== 'submitting') {
          return state;
        }
        return { ...state, status: 'submitted', result: event.result };
      case 'REJECT':
        if (state.status !== 'submitting') {
          return state;
        }
        return { ...state, status: 'failed', error: event.error };
      case 'EDIT':
        if (state.status === 'submitting') {
          return state;
        }
        return { ...state, values: event.values, errors: clearEdited(state.errors, state.values, event.values) };
      case 'RESET':
        return machine.init({ schema: state.schema, values: event.values ?? state.values });
      default:
        return state;
    }
  },
  stateOf(state) {
    return state.status;
  },
};

/**
 * Validate `values` and, when they pass, submit the parsed data: the whole handleSubmit round in one call.
 * Answers the final state: submitted (with the result), failed (with the error) or invalid (with field errors).
 */
export async function validatedSubmit<V, O, R>(state: SubmitState<V, O, R>, submit: (data: O) => Promise<R>, values?: V): Promise<SubmitState<V, O, R>> {
  const checked = machine.send(state, { type: 'SUBMIT', values }) as SubmitState<V, O, R>;
  if (checked.status !== 'submitting') {
    return checked;
  }
  try {
    const result = await submit(checked.data as O);
    return machine.send(checked, { type: 'RESOLVE', result }) as SubmitState<V, O, R>;
  } catch (error) {
    return machine.send(checked, { type: 'REJECT', error }) as SubmitState<V, O, R>;
  }
}
