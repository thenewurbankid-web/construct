// #585 (part of #575) -- an optional response schema for `defineService`, checked at the
// service's boundary. Core takes NO runtime dependency on any schema library: the two
// interfaces below are structural descriptions of what a schema object must look like, and
// `checkResponse` only ever calls into the object the caller handed it.
//
//   - `StandardSchema<Output>`  -- the Standard Schema spec (https://standardschema.dev,
//     MIT): a `~standard.validate(value)` method returning `{ value }` or `{ issues }`. Zod
//     3.24+/4, Valibot, ArkType and friends all implement it, so a real `z.object({...})` is
//     accepted as-is without this file ever importing zod. Written out by hand here (the spec
//     is ~40 lines) rather than pulled from `@standard-schema/spec`, so this package still has
//     zero dependencies -- see examples/service-schema.ts for the hand-written fixture that
//     proves the interface is enough on its own.
//   - `SafeParseSchema<Output>` -- a `safeParse(value)` method returning `{ success: true,
//     data }` or `{ success: false, error: { issues } }`: zod's own older surface (pre-3.24
//     zod, or a hand-rolled parser). When a schema offers both (zod does), `~standard` wins.
//
// The boundary result (`ServiceResult<T>`) is a discriminated union on `status`: a mismatch
// becomes `{ status: 'error', kind: 'schema', issues }` -- a typed state the caller has to
// narrow on before touching `.value` (a real `tsc` error otherwise, see
// examples/service-schema-invalid.ts), never a thrown surprise. `kind` is there so a later
// slice can add other boundary failures (e.g. `kind: 'transport'`) without changing the
// shape callers already narrow on.

/** One Standard-Schema-shaped validation issue, as the spec defines it. */
export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

/** The Standard Schema `validate` result: `{ value }` on success, `{ issues }` on failure. */
export type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardSchemaIssue> };

/** The Standard Schema V1 interface (https://standardschema.dev). `types` carries no runtime
 * value; it is how the schema's static output type is recovered (see `SchemaOutput`). */
export interface StandardSchema<Output = unknown, Input = unknown> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

/** A `safeParse`-shaped schema (zod's classic surface, or anything hand-rolled to match). */
export interface SafeParseSchema<Output = unknown> {
  safeParse(value: unknown):
    | { readonly success: true; readonly data: Output }
    | { readonly success: false; readonly error: { readonly issues: ReadonlyArray<StandardSchemaIssue> } };
}

/** What `defineService`'s `schema` option accepts. */
export type ResponseSchema = StandardSchema<unknown, unknown> | SafeParseSchema<unknown>;

/** The static output type of a `ResponseSchema` -- the type the service's `ok` branch narrows
 * to. Mirrors the spec's own `InferOutput` for a Standard Schema; for a `safeParse` schema it is
 * whatever the `success: true` branch's `data` is typed as. */
export type SchemaOutput<S> =
  S extends StandardSchema<unknown, unknown>
    ? NonNullable<S['~standard']['types']>['output']
    : S extends SafeParseSchema<unknown>
      ? ReturnType<S['safeParse']> extends infer R
        ? R extends { readonly success: true; readonly data: infer Out } ? Out : never
        : never
      : never;

/** A normalized issue: every vendor's path spelling (`'a'`, `0`, `{ key: 'a' }`) flattened to a
 * plain key list, so callers never need to know which library produced it. */
export interface SchemaIssue {
  readonly message: string;
  readonly path: ReadonlyArray<PropertyKey>;
}

/** The boundary result of a schema-checked service. Narrow on `status` before using `value`. */
export type ServiceResult<T> =
  | { readonly status: 'ok'; readonly value: T }
  | { readonly status: 'error'; readonly kind: 'schema'; readonly issues: ReadonlyArray<SchemaIssue> };

/** The return type of a schema-checked service: the same sync/async-ness as `fn` itself, with
 * `fn`'s own value replaced by the boundary result carrying the schema's output type. */
export type CheckedReturn<Return, Output> =
  Return extends Promise<unknown> ? Promise<ServiceResult<Output>> : ServiceResult<Output>;

function normalizeIssues(issues: ReadonlyArray<StandardSchemaIssue>): SchemaIssue[] {
  return issues.map((issue) => ({
    message: String(issue.message),
    path: (issue.path ?? []).map((segment) =>
      typeof segment === 'object' && segment !== null ? segment.key : segment,
    ),
  }));
}

function schemaError(issues: ReadonlyArray<SchemaIssue>): ServiceResult<never> {
  return { status: 'error', kind: 'schema', issues };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

/** Run `schema` against one already-produced value. Never throws: a validator that itself throws,
 * or (for a synchronous caller) one that can only validate asynchronously, is reported as a
 * `kind: 'schema'` error state with a single explanatory issue. Returns a Promise only when the
 * validator did. */
export function checkResponse<S extends ResponseSchema>(
  schema: S,
  value: unknown,
): ServiceResult<SchemaOutput<S>> | Promise<ServiceResult<SchemaOutput<S>>> {
  type Out = SchemaOutput<S>;
  const toResult = (r: StandardSchemaResult<unknown>): ServiceResult<Out> =>
    r.issues ? schemaError(normalizeIssues(r.issues)) : { status: 'ok', value: r.value as Out };
  try {
    if ('~standard' in schema) {
      const raw = schema['~standard'].validate(value);
      return isThenable(raw)
        ? Promise.resolve(raw).then(toResult, (e: unknown) => schemaError([{ message: `schema threw: ${describe(e)}`, path: [] }]))
        : toResult(raw);
    }
    const parsed = schema.safeParse(value);
    return parsed.success
      ? { status: 'ok', value: parsed.data as Out }
      : schemaError(normalizeIssues(parsed.error.issues));
  } catch (e) {
    return schemaError([{ message: `schema threw: ${describe(e)}`, path: [] }]);
  }
}

/** Apply `checkResponse` to a service's raw return value, preserving `fn`'s own sync/async-ness:
 * a Promise is awaited first; a plain value is checked inline. A synchronous service whose
 * schema can only validate asynchronously gets a `kind: 'schema'` error state (there is nothing
 * to await it with), not a Promise it did not ask for and not a throw. */
export function checkServiceReturn<S extends ResponseSchema>(
  schema: S,
  raw: unknown,
): ServiceResult<SchemaOutput<S>> | Promise<ServiceResult<SchemaOutput<S>>> {
  if (isThenable(raw)) return Promise.resolve(raw).then((v) => checkResponse(schema, v));
  const result = checkResponse(schema, raw);
  if (isThenable(result)) {
    // Nothing can await this; settle it quietly so an async validator's own rejection never
    // surfaces as an unhandled rejection either.
    Promise.resolve(result).then(undefined, () => undefined);
    return schemaError([{
      message: 'schema validates asynchronously but the service returned synchronously; make the service async (return a Promise) or use a synchronous schema',
      path: [],
    }]);
  }
  return result;
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
