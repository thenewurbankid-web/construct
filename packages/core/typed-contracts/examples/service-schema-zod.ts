// #585 (part of #575) -- the real-zod twin of service-schema.ts. `zod` is a root devDependency
// of THIS repo only (MIT), pulled in purely to prove a real `z.object({...})` satisfies the
// hand-written `StandardSchema` interface in schema.ts as-is: nothing under
// packages/core/typed-contracts/ imports zod, and a target project that never adds zod loses
// nothing. Zod 3.24+/4 implement Standard Schema (`~standard.validate`), which is the path taken
// here; a pre-3.24 zod would go through the `safeParse` shape instead.
import { z } from 'zod';
import { defineService, type ServiceResult } from '../index.ts';

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  // `.default()` makes output differ from input -- proof the OK branch carries the schema's
  // OUTPUT type (`role: 'user' | 'admin'`), not its input type (`role?: ...`).
  role: z.enum(['user', 'admin']).default('user'),
});
type User = z.output<typeof UserSchema>;

// What a generated service looks like: `fn` hands back the wire value as `unknown`, the schema
// is what a caller's type actually rests on.
const fetchUser = defineService('fetchUser', async ({ id }: { id: string }): Promise<unknown> => {
  const wire: unknown = { id, name: 'Ada' };
  return wire;
}, { schema: UserSchema });

export async function consume(): Promise<string> {
  const result = await fetchUser({ id: 'u1' });
  if (result.status === 'error') return result.issues.map((i) => i.message).join(', ');
  const user: User = result.value;
  return `${user.name} (${user.role})`;
}

// ---- prove the types -----------------------------------------------------
// `User` has `role` REQUIRED (output); had the value been typed from the schema's input
// (`role?:`), `ServiceResult<input>` would not extend `ServiceResult<User>` and `_check` fails.
const _notAny: 0 extends 1 & ReturnType<typeof fetchUser> ? false : true = true;
const _check: ReturnType<typeof fetchUser> extends Promise<ServiceResult<User>> ? true : false = true;
void _notAny; void _check;

// The zod schema rides along on the unit for tooling (`fetchUser.schema` is the very same object).
const _schema: typeof UserSchema = fetchUser.schema;
void _schema;

export { UserSchema, fetchUser };
