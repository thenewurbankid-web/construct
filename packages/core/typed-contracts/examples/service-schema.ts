// #585 (part of #575) -- `defineService(name, fn, { schema })` with a HAND-WRITTEN Standard
// Schema object (https://standardschema.dev): proof that core needs no schema library at all,
// only the interface -- anything exposing `~standard.validate` (zod 3.24+/4, Valibot, ArkType)
// plugs in the same way; see service-schema-zod.ts for the real-zod twin of this file.
// Compiles clean under this directory's own tsconfig.json; the type-level assertions below are
// what actually pin the narrowing (not just "no red squiggles").
import {
  defineService,
  type ServiceResult,
  type ServiceUnit,
  type StandardSchema,
  type StandardSchemaIssue,
} from '../index.ts';

// ---- a Standard Schema, by hand ------------------------------------------
interface User { id: string; name: string }

const UserSchema: StandardSchema<User> = {
  '~standard': {
    version: 1,
    vendor: 'hand-written',
    validate(value) {
      const v = value as Partial<User> | null;
      const issues: StandardSchemaIssue[] = [];
      if (typeof v?.id !== 'string') issues.push({ message: 'expected string', path: ['id'] });
      if (typeof v?.name !== 'string') issues.push({ message: 'expected string', path: [{ key: 'name' }] });
      return issues.length ? { issues } : { value: v as User };
    },
  },
};

// ---- an async service (the common case: a transport call) ----------------
// `fn` returns `Promise<unknown>` -- "whatever the wire gave us"; the schema is what turns that
// into `User` at the boundary. Nothing downstream ever sees the raw wire value.
const fetchUser = defineService('fetchUser', async ({ id }: { id: string }): Promise<unknown> => ({ id, name: 'Ada' }), {
  schema: UserSchema,
});

// ---- a sync service keeps its sync-ness ------------------------------------
const readUser = defineService('readUser', ({ raw }: { raw: unknown }) => raw, { schema: UserSchema });

// ---- a `safeParse`-shaped schema is accepted too ---------------------------
const CountSchema = {
  safeParse(value: unknown) {
    return typeof value === 'number'
      ? ({ success: true, data: value } as const)
      : ({ success: false, error: { issues: [{ message: 'expected number' }] } } as const);
  },
};
const countUsers = defineService('countUsers', ({ n }: { n: unknown }) => n, { schema: CountSchema });

// ---- the consumer's side: narrow on `status`, then `value` IS the schema's output ------
export async function consume(): Promise<string> {
  const result = await fetchUser({ id: 'u1' });
  if (result.status === 'error') {
    // `kind` and `issues` are only reachable on the error branch.
    const _kind: 'schema' = result.kind;
    void _kind;
    return result.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
  }
  const user: User = result.value; // narrowed to the schema's output, not `unknown`
  return user.name;
}

// ---- prove the types, not just the runtime ---------------------------------
// async fn -> Promise<ServiceResult<User>>; sync fn -> ServiceResult<User>; safeParse -> number.
// (guard against `any` first: `any extends X ? true : false` is `boolean`, which `true` would
// satisfy -- so an accidental `any` return would otherwise pass every check below.)
const _notAny: 0 extends 1 & ReturnType<typeof fetchUser> ? false : true = true;
void _notAny;
const _asyncCheck: ReturnType<typeof fetchUser> extends Promise<ServiceResult<User>> ? true : false = true;
const _syncCheck: ReturnType<typeof readUser> extends ServiceResult<User> ? true : false = true;
const _syncNotPromise: ReturnType<typeof readUser> extends Promise<unknown> ? false : true = true;
const _safeParseCheck: ReturnType<typeof countUsers> extends ServiceResult<number> ? true : false = true;
void _asyncCheck; void _syncCheck; void _syncNotPromise; void _safeParseCheck;

// The schema rides along as a plain runtime property (for the OpenAPI slice / Cockpit to read).
const _schemaOnUnit: StandardSchema<User> = fetchUser.schema;
void _schemaOnUnit;

// A checked service is still an ordinary ServiceUnit -- every Forbid<> boundary that rejects a
// service (a page's props, a component's props, ...) rejects it exactly the same way.
const _stillAService: ServiceUnit<(props: { id: string }) => Promise<ServiceResult<User>>> = fetchUser;
void _stillAService;
const _layer: 'service' = fetchUser.unitLayer;
void _layer;

// Off by default: the two-argument form is untouched -- same signature, same raw return type.
const plainService = defineService('plain', ({ id }: { id: string }) => ({ id, name: 'Ada' }));
const _plainCheck: ReturnType<typeof plainService> extends User ? true : false = true;
void _plainCheck;
// (and it has no `schema` property to speak of)
const _noSchema: 'schema' extends keyof typeof plainService ? false : true = true;
void _noSchema;

export { UserSchema, fetchUser, readUser, countUsers, plainService };
